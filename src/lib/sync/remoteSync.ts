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
import { withTelegramRetry } from "../telegram/rateLimit";
import { useFileStore } from "../../stores/fileStore";
import { logEvent } from "../events";
import { isIndexReady } from "../telegram/indexReadiness";
import { filterDeletedMessages } from "../storage/tombstones";

const POLL_INTERVAL_MS = 30_000;
const SYNC_INDICATOR_MIN_MS = 800;

interface CoordinatorState {
  timerId: ReturnType<typeof setTimeout> | null;
  isRunning: boolean;
  currentChannelId: string | null;
  lastTickAt: number;
}

const state: CoordinatorState = {
  timerId: null,
  isRunning: false,
  currentChannelId: null,
  lastTickAt: 0,
};

function canReplaceLocalState(): boolean {
  const queueState = useFileStore.getState().indexQueueState;
  // Never replace a snapshot while local writes are pending or stuck: those
  // files are intentionally optimistic and would otherwise vanish until the
  // next successful save.
  return queueState === "idle" || queueState === "syncing-remote";
}

async function reloadAuthoritativeSnapshot(channelId: string): Promise<boolean> {
  const filesBefore = useFileStore.getState().files;
  const outcome = await loadIndexOutcome(channelId);
  if (outcome.status !== "ready") return false;
  if (!canReplaceLocalState()) return false;
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
async function runOneTick(channelId: string): Promise<boolean> {
  if (!isIndexReady()) return false;
  const lastMsgId = useFileStore.getState().lastIndexMsgId;
  if (lastMsgId <= 0) {
    // Bootstrap hasn't recorded a cursor yet — skip. Next start() call
    // (after bootstrap completes) will re-evaluate.
    return false;
  }

  let mergedAny = false;
  try {
    // The fast index path edits existing messages in place, so a minId
    // cursor alone can never observe renames/trashes/deletes from another
    // device. Check the live chunks first; when they changed, replace the
    // local non-backup view with the authoritative index snapshot.
    const revisionChanged = await hasIndexRevisionChanged(channelId);
    if (revisionChanged) {
      if (!canReplaceLocalState()) return false;
      mergedAny = await reloadAuthoritativeSnapshot(channelId);
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

      if (result.files.length > 0) {
        if (!canReplaceLocalState()) return false;
        // New chunks mean a new epoch. Reloading the complete authoritative
        // set (instead of union-merging the slice) is what propagates
        // deletions; an additive merge would keep removed files forever.
        mergedAny = await reloadAuthoritativeSnapshot(channelId);
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
        useFileStore.getState().setLastIndexMsgId(result.highestMsgId);
      }
    }
  } catch (err) {
    // withTelegramRetry has already classified and logged; just keep the
    // loop alive. Hard errors (AUTH_KEY_UNREGISTERED, etc.) cause the
    // wrapper to throw after retries are exhausted.
    console.warn("[remoteSync] tick failed (will retry next interval):", err);
    return false;
  }

  // Briefly show the "syncing-remote" indicator so the user knows the
  // background loop is alive, then return to idle.
  if (mergedAny) {
    state.lastTickAt = Date.now();
    flashSyncIndicator();
  }
  return mergedAny;
}

function flashSyncIndicator(): void {
  const { setIndexQueueState } = useFileStore.getState();
  setIndexQueueState("syncing-remote");
  setTimeout(() => {
    if (useFileStore.getState().indexQueueState === "syncing-remote") {
      setIndexQueueState("idle");
    }
  }, SYNC_INDICATOR_MIN_MS);
}

function scheduleNext(channelId: string): void {
  if (!state.isRunning) return;
  state.timerId = setTimeout(async () => {
    await runOneTick(channelId);
    scheduleNext(channelId);
  }, POLL_INTERVAL_MS);
}

/**
 * Start the sync loop. Safe to call multiple times — subsequent calls are
 * no-ops unless the channelId changed.
 */
export function startRemoteSync(channelId: string): void {
  if (!channelId) {
    console.warn("[remoteSync] startRemoteSync called without channelId");
    return;
  }
  if (state.isRunning && state.currentChannelId === channelId) {
    return;
  }
  if (state.isRunning) {
    // Different channel — stop the old loop, start a new one.
    stopRemoteSync();
  }
  state.isRunning = true;
  state.currentChannelId = channelId;
  state.lastTickAt = 0;

  // Don't start the loop until discovery is ready and a cursor exists.
  if (!isIndexReady() || useFileStore.getState().lastIndexMsgId <= 0) {
    return;
  }

  scheduleNext(channelId);
}

/**
 * Stop the sync loop. Used by logout and orchestrator on auth loss.
 */
export function stopRemoteSync(): void {
  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
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
 */
export async function runSyncTickOnce(channelId: string): Promise<boolean> {
  return runOneTick(channelId);
}

/** Read-only — returns the last successful tick timestamp (0 if never). */
export function getLastSyncTick(): number {
  return state.lastTickAt;
}
