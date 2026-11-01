/**
 * Coalesced and throttled index persistence for backup runs.
 *
 * During large multi-file backup runs (e.g. 300+ files), uploads churn
 * continuously. The runner mutates the in-memory file store per upload and
 * appends each entry to the durable backup manifest on Telegram.
 *
 * Persisting the full Telegram index after every file would flood Telegram
 * channels with messages/edits and trigger severe FLOOD_WAIT rate limits
 * (e.g. "A wait of 221 seconds is required").
 *
 * Therefore:
 *   1. Automatic checkpoint saves during active backup are throttled:
 *      they fire at most once every CHECKPOINT_INTERVAL_MS and require at
 *      least CHECKPOINT_MIN_FILES uploaded since the last flush.
 *   2. When the backup finishes (or pauses/cancels), flushBackupIndexSave()
 *      flushes the latest snapshot immediately in a single clean write.
 */
import { enqueueSave, isChannelQueueRateLimited } from "../storage/indexQueue";
import type { TeleFile } from "../types";

export interface BackupIndexSaveResult {
  ok: boolean;
  error?: string;
}

const pending = new Map<string, TeleFile[]>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Map<string, Promise<BackupIndexSaveResult>>();

interface ChannelStats {
  lastFlushAt: number;
  filesSinceLastFlush: number;
}

const channelStats = new Map<string, ChannelStats>();

/**
 * Throttle parameters for automatic background checkpoints during backup:
 * Minimum interval between automatic checkpoints (30 seconds).
 */
export const BACKUP_CHECKPOINT_INTERVAL_MS = 30_000;

/**
 * Minimum number of files uploaded before triggering an automatic checkpoint.
 */
export const BACKUP_CHECKPOINT_MIN_FILES = 20;

/**
 * Quiet debounce window for scheduled flushes (3 seconds).
 */
export const BACKUP_DEBOUNCE_MS = 3_000;

function scheduleFlush(channelId: string, delayMs = BACKUP_DEBOUNCE_MS): void {
  const prior = timers.get(channelId);
  if (prior) clearTimeout(prior);
  const timer = setTimeout(() => {
    timers.delete(channelId);
    void flushBackupIndexSave(channelId).catch((err) => {
      console.warn("[backup.indexSave] Background flush failed (non-fatal):", err);
    });
  }, delayMs);
  timers.set(channelId, timer);
}

/**
 * Queues a backup index snapshot in memory and schedules a checkpoint if
 * enough files and time have elapsed.
 */
export function queueBackupIndexSave(channelId: string, files: TeleFile[]): void {
  pending.set(channelId, files);

  let stats = channelStats.get(channelId);
  if (!stats) {
    stats = { lastFlushAt: 0, filesSinceLastFlush: 0 };
    channelStats.set(channelId, stats);
  }
  stats.filesSinceLastFlush++;

  // If the Telegram index queue is currently under rate limit cooldown,
  // do not schedule an eager checkpoint; let the cooldown expire first.
  if (isChannelQueueRateLimited(channelId)) {
    return;
  }

  const now = Date.now();
  const timeSinceLastFlush = now - stats.lastFlushAt;

  // Only schedule an automatic checkpoint if at least BACKUP_CHECKPOINT_MIN_FILES
  // have been uploaded AND at least BACKUP_CHECKPOINT_INTERVAL_MS have passed.
  if (
    stats.filesSinceLastFlush >= BACKUP_CHECKPOINT_MIN_FILES &&
    timeSinceLastFlush >= BACKUP_CHECKPOINT_INTERVAL_MS
  ) {
    scheduleFlush(channelId);
  }
}

/**
 * Flushes the latest queued index snapshot immediately.
 * Called at the end of a backup run, or when stopping/pausing.
 */
export async function flushBackupIndexSave(
  channelId: string,
): Promise<BackupIndexSaveResult> {
  const timer = timers.get(channelId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(channelId);
  }

  const existing = inflight.get(channelId);
  if (existing) {
    try {
      const result = await existing;
      if (!pending.has(channelId)) return result;
    } catch {
      // Existing failed; fall through to drain any newly pending files
    }
  }

  const run = (async (): Promise<BackupIndexSaveResult> => {
    let last: BackupIndexSaveResult = { ok: true };
    while (pending.has(channelId)) {
      const files = pending.get(channelId)!;
      pending.delete(channelId);
      try {
        await enqueueSave(channelId, files);
        last = { ok: true };
        const stats = channelStats.get(channelId) ?? { lastFlushAt: 0, filesSinceLastFlush: 0 };
        stats.lastFlushAt = Date.now();
        stats.filesSinceLastFlush = 0;
        channelStats.set(channelId, stats);
      } catch (err) {
        last = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
        console.warn("[backup.indexSave] Save error:", last.error);
        break;
      }
    }
    return last;
  })();

  inflight.set(channelId, run);
  try {
    return await run;
  } finally {
    inflight.delete(channelId);
  }
}

export function resetBackupIndexSaveForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  pending.clear();
  inflight.clear();
  channelStats.clear();
}
