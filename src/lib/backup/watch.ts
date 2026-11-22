import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { logger } from "@/lib/logger";
import { isMobilePlatform } from "@/lib/platform";
import { isWebRuntime, logVaultState } from "@/lib/runtime/bridge";
import { useFileStore } from "@/stores/fileStore";
import { useLicenseStore } from "@/stores/licenseStore";
import { isIndexReady } from "../telegram/indexReadiness";
import { isBackupRunning, startBackup } from "./controller";
import { backupPathKey } from "./manifest";
import type { BackupRunResult } from "./runner";
import { pathMatchesExclude } from "./sourceFolders";
import { walkSourceFolders } from "./walker";

const QUIET_MS = 3000;
const RESCAN_MS = 60_000;
/** Delays between automatic retries after a run with failed files. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
/** How often folders that could not be monitored are tried again. */
const REWATCH_MS = 5 * 60_000;

export interface BackupWatchStatus {
  /** off = not in on-change mode; active = every folder monitored. */
  state: "off" | "starting" | "active" | "degraded" | "error";
  /** Folders that are not being monitored right now. */
  unwatched: string[];
  /** Unix-ms of the next automatic retry after failures, if any. */
  nextRetryAt: number | null;
}

export const useBackupWatchStatus = create<BackupWatchStatus>(() => ({
  state: "off",
  unwatched: [],
  nextRetryAt: null,
}));

let watcherId = 0;
let nativeWatchQueue: Promise<unknown> = Promise.resolve();

function queueNativeWatch<T>(action: () => Promise<T>): Promise<T> {
  const next = nativeWatchQueue.then(action);
  nativeWatchQueue = next.catch(() => {});
  return next;
}

/**
 * Whether a finished run should be retried automatically. Missing source
 * folders alone are not retried: nothing changes until the folder is back,
 * and its return produces a watcher event (or the periodic rescan).
 */
export function shouldRetry(result: Pick<BackupRunResult, "status" | "filesFailed">): boolean {
  if (result.status === "failed") return true;
  return result.status === "partial" && result.filesFailed > 0;
}

export function retryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

export function watchBackupFolders(paths: string[]): (() => void) | undefined {
  if (isWebRuntime() || isMobilePlatform()) return;

  const id = String(++watcherId);
  const roots = paths.map(backupPathKey);
  const pending = new Set<string>();
  const abort = new AbortController();
  let stopped = false;
  let running = false;
  let scanPending = true;
  let failures = 0;
  let retryAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rewatchTimer: ReturnType<typeof setTimeout> | undefined;
  let lastWait = "";
  let snapshot: Map<string, string> | undefined;
  let scanning = false;

  useBackupWatchStatus.setState({ state: "starting", unwatched: [], nextRetryAt: null });

  function schedule(delay = QUIET_MS) {
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), delay);
  }

  function setRetryAt(value: number | null) {
    retryAt = value;
    useBackupWatchStatus.setState({ nextRetryAt: value });
  }

  // A metadata scan also catches writes the operating system did not report,
  // for example when a watched folder is moved and recreated on Windows.
  async function reconcile() {
    if (stopped || scanning || running || isBackupRunning()) return;
    scanning = true;
    try {
      const folders = useLicenseStore.getState().backupFolders;
      const walk = await walkSourceFolders(folders, { signal: abort.signal });
      if (stopped || !walk.complete || walk.cancelled) return;
      const next = new Map(walk.files.map((file) => [
        backupPathKey(file.absPath), `${file.size}:${file.mtimeMs}`,
      ]));
      for (const dir of walk.directories ?? []) {
        next.set(backupPathKey(dir.absPath), "directory");
      }
      if (snapshot) {
        for (const [path, stat] of next) {
          if (snapshot.get(path) !== stat) pending.add(path);
        }
        for (const path of snapshot.keys()) {
          if (!next.has(path)) pending.add(path);
        }
      } else {
        scanPending = true;
      }
      snapshot = next;
      if (retryAt === null && (scanPending || pending.size)) schedule();
    } catch (error) {
      if (!stopped) logger.warn("[backup.watch] Folder scan failed:", error);
    } finally {
      scanning = false;
    }
  }

  const rescan = setInterval(() => void reconcile(), RESCAN_MS);

  async function flush() {
    if (stopped || running || (!scanPending && !pending.size)) return;
    if (!isIndexReady() || isBackupRunning()) {
      const wait = isIndexReady() ? "backup_running" : useFileStore.getState().indexLoadState;
      if (wait !== lastWait) {
        lastWait = wait;
        void logVaultState(`BACKUP_WATCH_WAIT state=${wait}`);
      }
      schedule();
      return;
    }
    lastWait = "";

    const changedPaths = new Set(pending);
    pending.clear();
    scanPending = false;
    running = true;
    void logVaultState(`BACKUP_WATCH_RUN changed=${changedPaths.size}`);
    setRetryAt(null);
    const result = await startBackup({
      triggeredBy: "auto",
      changedPaths,
      signal: abort.signal,
    });
    running = false;
    if (stopped) return;
    void logVaultState(`BACKUP_WATCH_RESULT status=${result.status} uploaded=${result.filesUploaded} skipped=${result.filesSkipped} failed=${result.filesFailed}`);
    if (shouldRetry(result)) {
      for (const path of changedPaths) pending.add(path);
      scanPending = true;
      const delay = retryDelay(failures++);
      setRetryAt(Date.now() + delay);
      schedule(delay);
    } else {
      failures = 0;
      if (scanPending || pending.size) schedule();
    }
  }

  async function startNative(watchPaths: string[]): Promise<void> {
    try {
      const unwatched = await queueNativeWatch(async () =>
        stopped ? [] : invoke<string[]>("start_backup_watch", { id, paths: watchPaths }),
      );
      if (stopped) return;
      useBackupWatchStatus.setState({
        state: unwatched.length ? "degraded" : "active",
        unwatched,
      });
      void logVaultState(`BACKUP_WATCH_START watched=${watchPaths.length - unwatched.length} unwatched=${unwatched.length}`);
      if (unwatched.length) scheduleRewatch();
    } catch (error) {
      if (stopped) return;
      logger.warn("[backup.watch] Could not monitor backup folders:", error);
      void logVaultState("BACKUP_WATCH_START_FAILED");
      useBackupWatchStatus.setState({ state: "error", unwatched: [...paths] });
      scheduleRewatch();
    }
  }

  // A folder that was missing (unplugged drive, not yet created) is tried
  // again periodically; when it comes back a full scan catches up.
  function scheduleRewatch() {
    clearTimeout(rewatchTimer);
    rewatchTimer = setTimeout(() => {
      if (stopped) return;
      const before = useBackupWatchStatus.getState().unwatched.length;
      void startNative(paths).then(() => {
        if (!stopped && useBackupWatchStatus.getState().unwatched.length < before) {
          scanPending = true;
          schedule();
        }
      });
    }, REWATCH_MS);
  }

  const ready = (async () => {
    const unlisten = await listen<string[]>(`teledrive://backup-change/${id}`, ({ payload }) => {
      if (stopped) return;
      if (!payload.length) scanPending = true;
      const { excludes } = useLicenseStore.getState().backupFolders;
      for (const path of payload) {
        const key = backupPathKey(path);
        if (roots.some((root) => key === root ||
          (key.startsWith(root + "/") &&
            !pathMatchesExclude(path.replace(/\\/g, "/").slice(root.length + 1), excludes).matches))) {
          pending.add(key);
        }
      }
      // While waiting out a retry backoff, new edits join the queued run
      // instead of resetting the timer to a few seconds.
      if (retryAt !== null) return;
      if (scanPending || pending.size) schedule();
    });
    await startNative(paths);
    return unlisten;
  })();

  void ready.catch((error) => {
    logger.warn("[backup.watch] Listener failed:", error);
    void logVaultState("BACKUP_WATCH_LISTENER_FAILED");
  })
    .finally(() => { if (!stopped) { void reconcile(); schedule(); } });

  return () => {
    stopped = true;
    abort.abort();
    clearTimeout(timer);
    clearTimeout(rewatchTimer);
    clearInterval(rescan);
    useBackupWatchStatus.setState({ state: "off", unwatched: [], nextRetryAt: null });
    void ready.then((unlisten) => unlisten())
      .catch(() => {})
      .finally(() => queueNativeWatch(() => invoke("stop_backup_watch", { id })))
      .catch((error) => logger.warn("[backup.watch] Could not stop folder monitoring:", error));
  };
}
