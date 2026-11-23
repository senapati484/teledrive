import { useEffect, useRef } from "react";
import { useAppLockStore } from "@/stores/appLockStore";

/**
 * Global lifecycle and idle timer watcher for TeleDrive App Lock.
 *
 * Automatically locks the application when:
 * 1. User is idle for longer than `autoLockMinutes`
 * 2. Window is blurred or minimized (if `lockOnMinimize` is enabled)
 * 3. User presses Cmd+L (macOS) or Ctrl+L (Windows/Linux)
 */
export function useAppLockWatcher() {
  const enabled = useAppLockStore((s) => s.enabled);
  const isLocked = useAppLockStore((s) => s.isLocked);
  const autoLockMinutes = useAppLockStore((s) => s.autoLockMinutes);
  const lockOnMinimize = useAppLockStore((s) => s.lockOnMinimize);
  const lockNow = useAppLockStore((s) => s.lockNow);

  const lastActivityRef = useRef<number>(Date.now());

  // Idle timer check
  useEffect(() => {
    if (!enabled || isLocked || autoLockMinutes <= 0) return;

    const timeoutMs = autoLockMinutes * 60 * 1000;

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= timeoutMs) {
        lockNow();
      }
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, [enabled, isLocked, autoLockMinutes, lockNow]);

  // User activity listeners to reset idle timer
  useEffect(() => {
    if (!enabled || isLocked) return;

    let throttled = false;
    const handleActivity = () => {
      if (throttled) return;
      throttled = true;
      lastActivityRef.current = Date.now();
      setTimeout(() => {
        throttled = false;
      }, 1000);
    };

    window.addEventListener("mousemove", handleActivity, { passive: true });
    window.addEventListener("mousedown", handleActivity, { passive: true });
    window.addEventListener("keydown", handleActivity, { passive: true });
    window.addEventListener("touchstart", handleActivity, { passive: true });
    window.addEventListener("scroll", handleActivity, { passive: true });

    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("mousedown", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
      window.removeEventListener("scroll", handleActivity);
    };
  }, [enabled, isLocked]);

  // Window blur / minimize listener
  useEffect(() => {
    if (!enabled || isLocked || !lockOnMinimize) return;

    const handleBlur = () => {
      lockNow();
    };

    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [enabled, isLocked, lockOnMinimize, lockNow]);

  // Global keyboard shortcut: Cmd+L (Mac) / Ctrl+L (Win/Linux)
  useEffect(() => {
    if (!enabled || isLocked) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check Cmd+L on macOS or Ctrl+L on Windows/Linux
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key.toLowerCase() === "l") {
        e.preventDefault();
        lockNow();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, isLocked, lockNow]);
}
