/**
 * Multi-device sync coordinator.
 *
 * Polls the Telegram storage channel every POLL_INTERVAL_MS for new index
 * messages and merges any deltas into the in-memory fileStore. Available
 * to all users — there is no Pro gate.
 *
 * Read-only by design: the poll never writes to Telegram, so two devices
 * polling simultaneously can't conflict. The bootstrap gate (`bootstrapComplete`)
 * is the only sequencing constraint — we never start polling until bootstrap
 * has set `lastIndexMsgId` to a sane value.
 *
 * FLOOD_WAIT safety: one revision check plus at most one incremental read
 * per poll, each with a 5s timeout. At the default 30s cadence we hit
 * Telegram at most ~240x/hr per channel, well under any known FLOOD_WAIT
 * threshold for channel reads.
 */
import {
  hasIndexRevisionChanged,
  loadIndexIncremental,
  loadIndexOutcome,
} from "../storage/metadataStore";
import { logger } from "@/lib/logger";
import { withTelegramRetry } from "../telegram/rateLimit";
import { useFileStore } from "../../stores/fileStore";
import { useBackupProgressStore } from "../../stores/backupProgressStore";
import { logEvent } from "../events";
import { isIndexReady } from "../telegram/indexReadiness";
import { filterDeletedMessages } from "../storage/tombstones";

export const DEFAULT_POLL_INTERVAL_MS = 30_000;
export const MIN_POLL_INTERVAL_MS = 10_000;
const SYNC_INDICATOR_MIN_MS = 800;

interface CoordinatorState {
  timerId: ReturnType<typeof setTimeout> | null;
  indicatorTimerId: ReturnType<typeof setTimeout> | null;
  /** Incremented on every start/stop so in-flight ticks can detect staleness. */
  generation: number;
  isRunning: boolean;
  currentChannelId: string | null;
  lastTickAt: number;
  /** Active poll interval in ms; 0 = manual sync only (no background timer). */
  pollIntervalMs: number;
}

const state: CoordinatorState = {
  timerId: null,
  indicatorTimerId: null,
  generation: 0,
  isRunning: false,
  currentChannelId: null,
  lastTickAt: 0,
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
};

function sanitizeIntervalMs(intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 0;
  return Math.max(MIN_POLL_INTERVAL_MS, Math.round(intervalMs));
}

function isCurrent(channelId: string, generation: number): boolean {
  return (
    state.isRunning &&
    state.currentChannelId === channelId &&
    state.generation === generation
  );
}

function canReplaceLocalState(): boolean {
  const store = useFileStore.getState();
  // Never replace a snapshot while local writes are pending or stuck: those
  // files are intentionally optimistic and would otherwise vanish until the
  // next successful save. Uploads set the file list before their debounced
  // index save starts, so the queue state alone is not enough.
  if (store.isSyncing) return false;
  // The backup runner writes its file list before the debounced index save
  // starts, so also honor the run-level flag rather than only queue state.
  if (useBackupProgressStore.getState().active) return false;
  if (
    store.uploadQueue.some(
      (item) => item.status === "pending" || item.status === "uploading",
    )
  ) {
    return false;
  }
  const queueState = store.indexQueueState;
  return queueState === "idle" || queueState === "syncing-remote";
}

async function reloadAuthoritativeSnapshot(
  channelId: string,
  expectedGeneration?: number,
): Promise<boolean> {
  const filesBefore = useFileStore.getState().files;
  const outcome = await loadIndexOutcome(channelId, {
    preserveReadyOnIncomplete: true,
  });
  if (outcome.status !== "ready") return false;
  if (!canReplaceLocalState()) return false;
  // Stop/switch may have happened while we awaited Telegram. Never apply the
  // old channel's snapshot to the new session.
  if (expectedGeneration !== undefined && !isCurrent(channelId, expectedGeneration)) {
    return false;
  }
  // A local action may have landed while the snapshot was loading. The
  // expected-array guard makes that action win instead of being clobbered
  // by the older remote read.
  await useFileStore
    .getState()
    .setRemoteSnapshot(filterDeletedMessages(channelId, outcome.files), filesBefore);
  return useFileStore.getState().files !== filesBefore;
}

/**
 * One poll cycle. Resolves with true if any files were merged, false if
 * nothing changed. NEVER throws — caller is the setTimeout loop and we
 * want it to keep running through transient errors.
 */
async function runOneTick(
  channelId: string,
  generation = state.generation,
  requireCurrentLoop = false,
): Promise<boolean> {
  if (!isIndexReady()) return false;
  const stillCurrent = () =>
    !requireCurrentLoop || isCurrent(channelId, generation);
  // A ready index with no chunks is valid (empty drive). Start from 0 so the
  // first file uploaded by another device can still be discovered.
  const lastMsgId = useFileStore.getState().lastIndexMsgId;

  let mergedAny = false;
  try {
    // The fast index path edits existing messages in place, so a minId
    // cursor alone can never observe renames/trashes/deletes from another
    // device. Check the live chunks first; when they changed, replace the
    // local non-backup view with the authoritative index snapshot.
    const revisionChanged = await hasIndexRevisionChanged(channelId);
    if (!stillCurrent()) return false;
    if (revisionChanged) {
      if (!canReplaceLocalState()) return false;
      mergedAny = await reloadAuthoritativeSnapshot(
        channelId,
        requireCurrentLoop ? generation : undefined,
      );
      if (!stillCurrent()) return false;
      if (mergedAny) {
        logEvent({
          type: "sync.remoteDelta",
          payload: { fileCount: useFileStore.getState().files.length, reason: "revision" },
        });
      }
    } else {
      const result = await withTelegramRetry(
        () => loadIndexIncremental(channelId, lastMsgId),
        "remoteSync.loadIndexIncremental",
        3,
      );
      if (!stillCurrent()) return false;

      if (result.files.length > 0) {
        if (!canReplaceLocalState()) return false;
        // New chunks mean a new epoch. Reloading the complete authoritative
        // set (instead of union-merging the slice) is what propagates
        // deletions; an additive merge would keep removed files forever.
        mergedAny = await reloadAuthoritativeSnapshot(
          channelId,
          requireCurrentLoop ? generation : undefined,
        );
        if (!stillCurrent()) return false;
        if (mergedAny) {
          logEvent({
            type: "sync.remoteDelta",
            payload: {
              fileCount: result.files.length,
              highestMsgId: result.highestMsgId,
            },
          });
        }
      }

      if (result.highestMsgId > lastMsgId) {
        if (!stillCurrent()) return false;
        useFileStore.getState().setLastIndexMsgId(result.highestMsgId);
      }
    }
  } catch (err) {
    // withTelegramRetry has already classified and logged; just keep the
    // loop alive. Hard errors (AUTH_KEY_UNREGISTERED, etc.) cause the
    // wrapper to throw after retries are exhausted.
    logger.warn("[remoteSync] tick failed (will retry next interval):", err);
    return false;
  }

  if (!stillCurrent()) return false;

  // Briefly show the "syncing-remote" indicator so the user knows the
  // background loop is alive, then return to idle.
  if (mergedAny) {
    state.lastTickAt = Date.now();
    flashSyncIndicator(
      channelId,
      requireCurrentLoop ? generation : undefined,
    );
  }
  return mergedAny;
}

function flashSyncIndicator(
  channelId?: string,
  generation?: number,
): void {
  const { setIndexQueueState } = useFileStore.getState();
  setIndexQueueState("syncing-remote");
  if (state.indicatorTimerId) clearTimeout(state.indicatorTimerId);
  state.indicatorTimerId = setTimeout(() => {
    state.indicatorTimerId = null;
    if (
      generation !== undefined &&
      channelId !== undefined &&
      !isCurrent(channelId, generation)
    ) {
      return;
    }
    if (useFileStore.getState().indexQueueState === "syncing-remote") {
      setIndexQueueState("idle");
    }
  }, SYNC_INDICATOR_MIN_MS);
}

function scheduleNext(channelId: string, generation: number): void {
  if (!isCurrent(channelId, generation)) return;
  if (state.pollIntervalMs <= 0) return;
  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }
  state.timerId = setTimeout(async () => {
    state.timerId = null;
    if (!isCurrent(channelId, generation)) return;
    await runOneTick(channelId, generation, true);
    scheduleNext(channelId, generation);
  }, state.pollIntervalMs);
}

/**
 * Updates the background sync poll interval (in ms). Pass `0` for manual-only
 * mode (pauses automatic polling while keeping manual `runSyncTickOnce` active).
 * Non-zero intervals are clamped to `MIN_POLL_INTERVAL_MS` (10s) for FLOOD_WAIT safety.
 */
export function setRemoteSyncInterval(intervalMs: number): void {
  const next = sanitizeIntervalMs(intervalMs);
  if (next === state.pollIntervalMs) return;
  state.pollIntervalMs = next;

  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }

  if (state.isRunning && state.currentChannelId && next > 0) {
    scheduleNext(state.currentChannelId, state.generation);
  }
}

/** Returns the active poll interval in ms (0 = manual only). */
export function getRemoteSyncInterval(): number {
  return state.pollIntervalMs;
}

/**
 * Start the sync loop. Safe to call multiple times — subsequent calls are
 * no-ops unless the channelId changed (optional `intervalMs` still applies).
 */
export function startRemoteSync(channelId: string, intervalMs?: number): void {
  if (intervalMs !== undefined) {
    state.pollIntervalMs = sanitizeIntervalMs(intervalMs);
  }
  if (!channelId) {
    logger.warn("[remoteSync] startRemoteSync called without channelId");
    return;
  }
  if (state.isRunning && state.currentChannelId === channelId) {
    if (state.pollIntervalMs <= 0 && state.timerId) {
      clearTimeout(state.timerId);
      state.timerId = null;
    } else if (state.pollIntervalMs > 0 && !state.timerId) {
      scheduleNext(channelId, state.generation);
    }
    return;
  }
  if (state.isRunning) {
    // Different channel — stop the old loop, start a new one.
    stopRemoteSync();
  }
  state.generation += 1;
  state.isRunning = true;
  state.currentChannelId = channelId;
  state.lastTickAt = 0;

  // Don't start the loop until discovery is ready. An empty index has cursor
  // 0; that is still pollable and must not leave the coordinator "running"
  // without a timer (later start() calls would then be no-ops).
  if (!isIndexReady()) {
    state.isRunning = false;
    state.currentChannelId = null;
    return;
  }

  scheduleNext(channelId, state.generation);
}

/**
 * Stop the sync loop. Used by logout and orchestrator on auth loss.
 */
export function stopRemoteSync(): void {
  // Invalidate any tick that is currently awaiting Telegram.
  state.generation += 1;
  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }
  if (state.indicatorTimerId) {
    clearTimeout(state.indicatorTimerId);
    state.indicatorTimerId = null;
  }
  state.isRunning = false;
  state.currentChannelId = null;
  state.lastTickAt = 0;
  // If we were showing the indicator, drop it.
  if (useFileStore.getState().indexQueueState === "syncing-remote") {
    useFileStore.getState().setIndexQueueState("idle");
  }
}

/**
 * Manually trigger one sync tick. Returns true if any files were merged.
 * Manual ticks are not tied to the loop generation (callers use this while
 * the background loop is stopped), so they run without the staleness guard.
 */
export async function runSyncTickOnce(channelId: string): Promise<boolean> {
  return runOneTick(channelId, state.generation, false);
}

/** Read-only — returns the last successful tick timestamp (0 if never). */
export function getLastSyncTick(): number {
  return state.lastTickAt;
}
