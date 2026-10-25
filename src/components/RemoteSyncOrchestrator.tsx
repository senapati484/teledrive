/**
 * Headless orchestrator that runs the multi-device sync loop AND the
 * scheduled-backup tick listener.
 *
 * Mounted once at the App root (post-auth). Manages the lifecycle of:
 *   - `startRemoteSync` / `stopRemoteSync` based on auth and bootstrap
 *   - `ensureTickListenerStarted` (so the Rust timer's tick events reach
 *     the snapshot sender) on app start
 *
 * Renders nothing. All state lives in module-scoped vars inside
 * remoteSync.ts / scheduler.ts.
 *
 * NOTE: Multi-device sync is now available to all authenticated users.
 * Plan checks have been removed — TeleDrive is a free application.
 */
import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useFileStore } from "@/stores/fileStore";
import { useLicenseStore } from "@/stores/licenseStore";
import { startRemoteSync, stopRemoteSync } from "@/lib/sync/remoteSync";
import {
  applyIntervalChange,
  checkDueBackup,
  ensureTickListenerStarted,
  stopBackupSchedule,
} from "@/lib/backup/scheduler";
import { getStorageChannelId } from "@/lib/telegram/channelManager";

export default function RemoteSyncOrchestrator(): null {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const indexLoadState = useFileStore((s) => s.indexLoadState);
  const lastIndexMsgId = useFileStore((s) => s.lastIndexMsgId);
  const intervalMinutes =
    useLicenseStore((s) => s.license?.scheduledBackupIntervalMinutes) ?? null;

  // Effect 1 — bootstrap listener for backup ticks. Runs once on mount,
  // tears down on unmount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureTickListenerStarted();
      } catch (err) {
        if (!cancelled) console.warn("[RemoteSyncOrchestrator] tick listener failed:", err);
      }
    })();
    return () => {
      cancelled = true;
      void stopBackupSchedule();
    };
  }, []);

  // Effect 2 — react to interval changes. When the user picks a new
  // interval, push it to the Rust timer.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (intervalMinutes === null || intervalMinutes <= 0) {
      void applyIntervalChange(null);
      return;
    }
    void applyIntervalChange(intervalMinutes);
  }, [isAuthenticated, intervalMinutes]);

  // Effect 3 — react to auth + discovery changes. Start the remote sync loop
  // only when the index is complete/writable; stop while it is loading or
  // incomplete (independent reads would otherwise race an unknown base).
  // Multi-device sync is now available to ALL authenticated users.
  useEffect(() => {
    if (!isAuthenticated || indexLoadState !== "ready") {
      stopRemoteSync();
      return;
    }

    let cancelled = false;
    let retryHandle: ReturnType<typeof setTimeout> | null = null;

    async function tryStart(): Promise<void> {
      if (cancelled) return;
      try {
        const phone = useAuthStore.getState().phoneNumber;
        const channelId = await getStorageChannelId(phone);
        if (cancelled) return;
        if (channelId) {
          startRemoteSync(channelId);
        }
      } catch (err) {
        console.warn(
          "[RemoteSyncOrchestrator] channel id not ready, retrying in 2s:",
          err,
        );
        retryHandle = setTimeout(tryStart, 2000);
      }
    }

    void tryStart();

    return () => {
      cancelled = true;
      if (retryHandle) clearTimeout(retryHandle);
      stopRemoteSync();
    };
  }, [isAuthenticated, indexLoadState, lastIndexMsgId]);

  // Effect 4 — due checks on launch, focus, and a 5-minute heartbeat.
  // The Rust tick is only a hint; every path re-checks the manifest anchor.
  useEffect(() => {
    if (!isAuthenticated || indexLoadState !== "ready") return;

    const check = () => {
      void checkDueBackup();
    };
    check();

    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };
    const timer = setInterval(check, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", check);
    };
  }, [isAuthenticated, indexLoadState, intervalMinutes]);

  return null;
}
