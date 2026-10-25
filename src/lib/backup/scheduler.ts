/**
 * Backup scheduler — JS-side wrapper around the Rust timer commands.
 *
 * The Rust side (src-tauri/src/lib.rs) owns the timer via
 * `start_backup_scheduler(interval_minutes)` / `stop_backup_scheduler()`.
 * When the timer fires, it emits a `teledrive://backup-tick` Tauri event
 * into the webview. This module:
 *   1. Forwards interval changes to Rust.
 *   2. Listens for tick events and dispatches them to `runBackup` (the
 *      real device-backup orchestrator in `./runner`).
 *   3. Surfaces status to the React layer (currently via fileStore).
 *
 * The interval value is the source of truth in `licenseStore.license.
 * scheduledBackupIntervalMinutes` — when the user picks a new interval,
 * `setProSchedule` updates both the backend AND triggers
 * `applyIntervalChange(intervalMinutes)` here so the timer restarts with
 * the new value.
 *
 * Replaces the previous "metadata-only snapshot" pipeline. The old
 * `takeSnapshot` is preserved in `./snapshot` for the historical audit
 * trail (the text-message breadcrumb it posts is still useful as a
 * timestamped marker in the channel), but it is no longer the active
 * "what runs when the timer fires" path. That's `runBackup` now — it
 * actually walks source folders and uploads real files.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  isBackupRunning,
  startBackup,
} from "./controller";
import { isBackupDue, loadDueState } from "./schedule";
import type { BackupRunSummary } from "./manifest";
import { isIndexReady } from "../telegram/indexReadiness";
import { getBackupScheduleEnabledAt, useLicenseStore } from "@/stores/licenseStore";
import { useAuthStore } from "@/stores/authStore";
import { channelIdKey, getSecret } from "../secure/vault";

let tickUnlisten: UnlistenFn | null = null;
let currentIntervalMinutes: number | null = null;

/**
 * Apply a new interval. Pass null to stop the timer entirely. Pass a
 * positive integer (1..10080) to (re)start it with the new cadence.
 *
 * Idempotent: calling with the same value is a no-op (Rust timer handles
 * the case of restarting with the same interval — start first calls stop,
 * so any interval change is honored).
 */
export async function applyIntervalChange(intervalMinutes: number | null): Promise<void> {
  if (intervalMinutes === currentIntervalMinutes) {
    return;
  }
  currentIntervalMinutes = intervalMinutes;
  try {
    if (intervalMinutes === null || intervalMinutes <= 0) {
      await invoke("stop_backup_scheduler");
      return;
    }
    await invoke("start_backup_scheduler", { intervalMinutes });
  } catch (err) {
    console.warn("[backup.scheduler] Tauri command failed:", err);
    currentIntervalMinutes = null; // back to "unknown" so a retry is possible
    throw err;
  }
}

/**
 * Start listening for tick events. Idempotent: tears down any existing
 * listener first so a re-start (e.g. on logout/login) doesn't double-fire.
 */
export async function ensureTickListenerStarted(): Promise<void> {
  if (tickUnlisten) {
    await tickUnlisten();
    tickUnlisten = null;
  }
  tickUnlisten = await listen("teledrive://backup-tick", async () => {
    await onTick();
  });
}

/**
 * Stop listening for tick events and stop the Rust timer. Used by logout.
 */
export async function stopBackupSchedule(): Promise<void> {
  if (tickUnlisten) {
    await tickUnlisten();
    tickUnlisten = null;
  }
  try {
    await invoke("stop_backup_scheduler");
  } catch (err) {
    console.warn("[backup.scheduler] stop_backup_scheduler failed:", err);
  }
  currentIntervalMinutes = null;
}

/**
 * Tick handler. Called by the Tauri event listener. Runs the real device
 * backup (walker → manifest diff → incremental upload → audit row).
 *
 * Pipes progress into the singleton progress store so the bottom-right
 * overlay can render the run regardless of whether the user is on the
 * Settings page or browsing files.
 *
 * The runner itself surfaces most user-facing errors (no folders, PRO
 * gate, channel not ready). If the runner is mid-flight when another
 * tick fires, the runner's internal guards (e.g. concurrent signal) mean
 * the second tick will still proceed but might overlap — that's fine for
 * v1 because the manifest writes are sequential per-file.
 */
async function onTick(): Promise<void> {
  await checkDueBackup();
}

async function resolveChannelId(): Promise<string | null> {
  const phone = useAuthStore.getState().phoneNumber;
  if (!phone) return null;
  try {
    return await getSecret(channelIdKey(phone));
  } catch {
    return null;
  }
}

export interface BackupLastRun {
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  lastResult: BackupRunSummary | null;
}

/** Read the persisted last-run state for the active account, if signed in. */
export async function loadBackupLastRun(): Promise<BackupLastRun | null> {
  const channelId = await resolveChannelId();
  if (!channelId) return null;
  try {
    return await loadDueState(channelId);
  } catch (err) {
    console.warn("[backup.scheduler] last-run state unavailable:", err);
    return null;
  }
}

/**
 * Run one scheduled backup if (and only if) the interval is due. Used by the
 * Rust tick, app launch, focus, and the 5-minute JS check.
 */
export async function checkDueBackup(): Promise<boolean> {
  if (isBackupRunning()) return false;
  const interval =
    useLicenseStore.getState().license?.scheduledBackupIntervalMinutes ?? null;
  const folders = useLicenseStore.getState().backupFolders;
  if (!interval || interval <= 0 || !folders.paths?.length) return false;
  if (!isIndexReady()) return false;

  const channelId = await resolveChannelId();
  if (!channelId) return false;

  let state;
  try {
    state = await loadDueState(channelId);
  } catch (err) {
    console.warn("[backup.scheduler] due state unavailable:", err);
    return false;
  }

  const due = isBackupDue({
    now: Date.now(),
    ...state,
    scheduleEnabledAt: getBackupScheduleEnabledAt(),
    intervalMinutes: interval,
  });
  if (!due) return false;
  await startBackup({ triggeredBy: "auto", reason: "catch-up" });
  return true;
}

/**
 * Manually trigger a backup right now (the "Run now" button).
 * Doesn't interact with the timer — just runs the real device-backup
 * orchestrator synchronously. Progress is piped into the overlay store.
 */
export async function runBackupNow(): Promise<void> {
  await startBackup({ triggeredBy: "manual", reason: "manual" });
}
