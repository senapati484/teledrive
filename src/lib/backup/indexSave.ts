/**
 * Coalesced index persistence for backup runs.
 *
 * The runner mutates the in-memory file store per upload. Writing the full
 * index after every file would flood Telegram, so queue one save per channel
 * and flush it at the end (or after a 2s debounce).
 */
import { enqueueSave } from "../storage/indexQueue";
import type { TeleFile } from "../types";

export interface BackupIndexSaveResult {
  ok: boolean;
  error?: string;
}

const pending = new Map<string, TeleFile[]>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Map<string, Promise<BackupIndexSaveResult>>();

const DEBOUNCE_MS = 2_000;

function scheduleFlush(channelId: string): void {
  const prior = timers.get(channelId);
  if (prior) clearTimeout(prior);
  const timer = setTimeout(() => {
    timers.delete(channelId);
    void flushBackupIndexSave(channelId);
  }, DEBOUNCE_MS);
  timers.set(channelId, timer);
}

export function queueBackupIndexSave(channelId: string, files: TeleFile[]): void {
  pending.set(channelId, files);
  scheduleFlush(channelId);
}

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
    const result = await existing;
    if (!pending.has(channelId)) return result;
  }

  const run = (async (): Promise<BackupIndexSaveResult> => {
    let last: BackupIndexSaveResult = { ok: true };
    while (pending.has(channelId)) {
      const files = pending.get(channelId)!;
      pending.delete(channelId);
      try {
        await enqueueSave(channelId, files);
        last = { ok: true };
      } catch (err) {
        last = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
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
}
