import { logger } from "@/lib/logger";

let wakeLockSentinel: any = null;
let activeLocksCount = 0;
let listenerAttached = false;

async function requestLock(): Promise<void> {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
    return;
  }
  try {
    wakeLockSentinel = await (navigator as any).wakeLock.request("screen");
    wakeLockSentinel.addEventListener("release", () => {
      wakeLockSentinel = null;
    });
  } catch (err) {
    logger.debug("[WakeLock] Failed to acquire screen wake lock:", err);
  }
}

function handleVisibilityChange(): void {
  if (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    activeLocksCount > 0 &&
    !wakeLockSentinel
  ) {
    void requestLock();
  }
}

/**
 * Acquire a screen wake lock to keep the device CPU and screen alive
 * during long operations (uploads, downloads, device backup).
 */
export async function acquireWakeLock(): Promise<void> {
  activeLocksCount++;
  if (!listenerAttached && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    listenerAttached = true;
  }
  if (!wakeLockSentinel) {
    await requestLock();
  }
}

/**
 * Release a previously acquired wake lock.
 */
export async function releaseWakeLock(): Promise<void> {
  activeLocksCount = Math.max(0, activeLocksCount - 1);
  if (activeLocksCount === 0 && wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch {
      // ignore
    } finally {
      wakeLockSentinel = null;
    }
  }
}

/**
 * Reset all wake locks (e.g. on logout or teardown).
 */
export async function resetWakeLock(): Promise<void> {
  activeLocksCount = 0;
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch {
      // ignore
    } finally {
      wakeLockSentinel = null;
    }
  }
  if (listenerAttached && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    listenerAttached = false;
  }
}
