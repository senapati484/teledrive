import { loadManifest, type BackupRunSummary } from "./manifest";

export interface BackupDueInput {
  now: number;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  lastResult: BackupRunSummary | null;
  scheduleEnabledAt: number | null;
  intervalMinutes: number | null;
}

const FAILURE_GUARD_MS = 30 * 60 * 1000;
export const PARTIAL_RETRY_MS = 60 * 60 * 1000;

export function isBackupDue(input: BackupDueInput): boolean {
  const { intervalMinutes } = input;
  if (!intervalMinutes || intervalMinutes <= 0) return false;
  // A run that left failed files is retried after an hour instead of waiting
  // a whole interval (which could be a day). Missing source folders alone
  // are not retried early: nothing changes until the folder returns.
  if (
    input.lastResult?.status === "partial" &&
    input.lastResult.failed > 0 &&
    input.lastAttemptAt &&
    input.now - input.lastAttemptAt >= PARTIAL_RETRY_MS &&
    PARTIAL_RETRY_MS < intervalMinutes * 60_000
  ) {
    return true;
  }
  const anchor = Math.max(
    input.lastSuccessAt ?? 0,
    input.scheduleEnabledAt ?? input.now,
  );
  if (input.now - anchor < intervalMinutes * 60_000) return false;
  if (
    input.lastAttemptAt &&
    input.now - input.lastAttemptAt < FAILURE_GUARD_MS &&
    (input.lastResult?.status === "failed" ||
      input.lastResult?.status === "cancelled")
  ) {
    return false;
  }
  return true;
}

export async function loadDueState(channelId: string): Promise<{
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  lastResult: BackupRunSummary | null;
}> {
  const manifest = await loadManifest(channelId);
  return {
    lastSuccessAt: manifest.lastSuccessAt,
    lastAttemptAt: manifest.lastAttemptAt,
    lastResult: manifest.lastResult,
  };
}
