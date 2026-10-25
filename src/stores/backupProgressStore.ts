/**
 * useBackupProgressStore — singleton (zustand) store that any caller can
 * write to and the bottom-right progress overlay can read from.
 *
 * Why a store, not a hook state
 * -----------------------------
 * The backup runner lives in lib/backup/runner.ts and gets invoked from
 * three places:
 *   1. The "Run backup now" button in BackupSection.tsx
 *   2. The Rust scheduler's `teledrive://backup-tick` event
 *   3. (Future) a tray menu "Backup now" item
 *
 * All three need to drive the same overlay — so the source of truth has
 * to outlive any single component's lifetime. The user can also
 * navigate AWAY from Settings while a backup is running, and the overlay
 * should stay visible. A zustand store survives unmount.
 *
 * The runner doesn't import this directly — instead, the hook layer
 * (useBackupRunner) translates onProgress callbacks into setState calls
 * here. Keeps the runner pure.
 */
import { create } from "zustand";

export type BackupRunStatus = "idle" | "walking" | "uploading" | "done" | "failed" | "cancelled";

export interface BackupProgressState {
  /** True while a run is in flight (between runBackup() start and end). */
  active: boolean;
  /** Coarse-grained phase for the overlay label. */
  status: BackupRunStatus;
  /** "manual" or "auto" — used to label the overlay. */
  triggeredBy: "manual" | "auto" | null;
  /** Unix-ms when the current run started. */
  startedAt: number | null;
  /** Unix-ms when the run finished (set when active flips back to false). */
  finishedAt: number | null;
  /** Files processed so far (uploaded + failed). */
  uploaded: number;
  /** Total files queued for upload. Unknown until the walker finishes. */
  total: number;
  /** Absolute path of the file currently being processed (best-effort). */
  currentFile: string;
  /** Summary from the most-recent completed run. Survives until the next run. */
  lastResult: {
    filesUploaded: number;
    filesSkipped: number;
    filesFailed: number;
    status: "success" | "partial" | "failed" | "cancelled";
    missingRoots: string[];
  } | null;
  /** Error message if the run failed. */
  error: string | null;
  /**
   * Per-chunk retry state, surfaced to the overlay so a FLOOD_WAIT
   * pause looks like progress ("Retrying 3/5 — waiting 30s") rather
   * than a frozen counter. Cleared when the chunk succeeds, when the
   * file moves on, or when the run finishes.
   */
  retry: {
    /** 1-indexed attempt that just failed. */
    attempt: number;
    /** Total attempts allowed. */
    maxAttempts: number;
    /** Milliseconds we are about to wait before the next attempt. */
    waitMs: number;
    /** Telegram's FLOOD_WAIT, if this retry was triggered by one. */
    floodSeconds: number | null;
  } | null;

  // Actions
  start: (triggeredBy: "manual" | "auto") => void;
  setWalking: () => void;
  setProgress: (info: { uploaded: number; total: number; currentFile: string }) => void;
  setRetry: (info: {
    attempt: number;
    maxAttempts: number;
    waitMs: number;
    floodSeconds: number | null;
  }) => void;
  clearRetry: () => void;
  finish: (result: {
    filesUploaded: number;
    filesSkipped: number;
    filesFailed: number;
    status: "success" | "partial" | "failed" | "cancelled";
    error: string | null;
    missingRoots?: string[];
  }) => void;
  fail: (error: string) => void;
  cancel: () => void;
  /** Clear the last-result so the overlay can auto-dismiss. */
  clear: () => void;
}

export const useBackupProgressStore = create<BackupProgressState>((set) => ({
  active: false,
  status: "idle",
  triggeredBy: null,
  startedAt: null,
  finishedAt: null,
  uploaded: 0,
  total: 0,
  currentFile: "",
  lastResult: null,
  error: null,
  retry: null,

  start: (triggeredBy) =>
    set({
      active: true,
      status: "walking",
      triggeredBy,
      startedAt: Date.now(),
      finishedAt: null,
      uploaded: 0,
      total: 0,
      currentFile: "",
      error: null,
      retry: null,
    }),

  setWalking: () => set({ status: "walking", uploaded: 0, total: 0, retry: null }),

  setProgress: ({ uploaded, total, currentFile }) =>
    set({ status: "uploading", uploaded, total, currentFile, retry: null }),

  setRetry: (info) => set({ retry: info }),

  clearRetry: () => set({ retry: null }),

  finish: (result) =>
    set({
      active: false,
      status:
        result.status === "cancelled"
          ? "cancelled"
          : result.status === "failed"
            ? "failed"
            : "done",
      finishedAt: Date.now(),
      lastResult: {
        filesUploaded: result.filesUploaded,
        filesSkipped: result.filesSkipped,
        filesFailed: result.filesFailed,
        status: result.status,
        missingRoots: result.missingRoots ?? [],
      },
      error: result.error,
      uploaded: result.filesUploaded + result.filesFailed,
      total: result.filesUploaded + result.filesFailed + result.filesSkipped,
    }),

  fail: (error) =>
    set({
      active: false,
      status: "failed",
      finishedAt: Date.now(),
      error,
    }),

  cancel: () =>
    set({
      active: false,
      status: "cancelled",
      finishedAt: Date.now(),
    }),

  clear: () =>
    set({
      status: "idle",
      finishedAt: null,
      uploaded: 0,
      total: 0,
      currentFile: "",
      lastResult: null,
      error: null,
      retry: null,
    }),
}));