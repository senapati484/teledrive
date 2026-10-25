/**
 * Single owner for backup runs. Manual, scheduled, and catch-up callers all
 * funnel through here so there is at most one active run and one cancel path.
 */
import { runBackup, type BackupRunResult } from "./runner";
import { useFileStore } from "@/stores/fileStore";
import { useBackupProgressStore } from "@/stores/backupProgressStore";

interface ActiveRun {
  controller: AbortController;
  promise: Promise<BackupRunResult>;
}

let active: ActiveRun | null = null;

export interface StartBackupOptions {
  triggeredBy: "manual" | "auto";
  reason?: "manual" | "scheduled" | "catch-up";
  signal?: AbortSignal;
}

export function isBackupRunning(): boolean {
  return active !== null;
}

export function startBackup(
  opts: StartBackupOptions,
): Promise<BackupRunResult> {
  if (active) return active.promise;

  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", relayAbort, { once: true });

  const progress = useBackupProgressStore.getState();
  useFileStore.getState().setIndexQueueState("backup-running");
  progress.start(opts.triggeredBy);

  const promise = (async (): Promise<BackupRunResult> => {
    try {
      const result = await runBackup({
        triggeredBy: opts.triggeredBy,
        signal: controller.signal,
        onProgress: (info) => {
          useBackupProgressStore.getState().setProgress(info);
        },
      });
      useBackupProgressStore.getState().finish({
        filesUploaded: result.filesUploaded,
        filesSkipped: result.filesSkipped,
        filesFailed: result.filesFailed,
        status: result.status,
        error: result.error,
        missingRoots: result.missingFolders,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      useBackupProgressStore.getState().fail(message);
      return {
        triggeredBy: opts.triggeredBy,
        deviceRoot: "",
        totalFound: 0,
        filesUploaded: 0,
        filesSkipped: 0,
        filesFailed: 0,
        missingFolders: [],
        auditJobId: null,
        status: "failed",
        error: message,
        durationMs: 0,
        finishedAt: Date.now(),
      };
    } finally {
      opts.signal?.removeEventListener("abort", relayAbort);
      useFileStore.getState().setIndexQueueState("idle");
      active = null;
    }
  })();

  active = { controller, promise };
  return promise;
}

export function cancelBackup(): boolean {
  if (!active) return false;
  active.controller.abort();
  useBackupProgressStore.getState().cancel();
  return true;
}

/** Test-only: clear the active slot. */
export function resetBackupControllerForTests(): void {
  active = null;
}
