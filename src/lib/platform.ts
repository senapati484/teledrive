/**
 * Platform detection utilities for Tauri 2 mobile + desktop.
 *
 * Usage:
 *   import { getPlatform, isMobilePlatform, isTouchDevice } from '@/lib/platform';
 *
 *   const p = getPlatform();        // 'android' | 'ios' | 'desktop'
 *   const mobile = isMobilePlatform(); // true on Android / iOS
 */

export type AppPlatform = "desktop" | "android" | "ios";

let _platform: AppPlatform | null = null;

/**
 * Detects the runtime platform using Navigator properties and user agent.
 */
export function detectPlatform(): AppPlatform {
  if (typeof window === "undefined" || !window.navigator) {
    return "desktop";
  }

  const ua = window.navigator.userAgent.toLowerCase();

  if (/android/.test(ua)) {
    return "android";
  }

  if (/iphone|ipad|ipod/.test(ua)) {
    return "ios";
  }

  // iPadOS 13+ desktop mode reporting as Macintosh
  if (
    window.navigator.maxTouchPoints &&
    window.navigator.maxTouchPoints > 2 &&
    /macintosh/.test(ua)
  ) {
    return "ios";
  }

  return "desktop";
}

/**
 * Returns the current platform ('android' | 'ios' | 'desktop').
 */
export function getPlatform(): AppPlatform {
  if (_platform === null) {
    _platform = detectPlatform();
  }
  return _platform;
}

/**
 * Returns true if running on a mobile OS (Android or iOS/iPadOS).
 */
export function isMobilePlatform(): boolean {
  const p = getPlatform();
  return p === "android" || p === "ios";
}

/**
 * Returns true if device supports touch input.
 */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined" || !window.navigator) return false;
  return "ontouchstart" in window || window.navigator.maxTouchPoints > 0;
}

export async function initPlatform(): Promise<void> {
  const p = getPlatform();
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.classList.add(`platform-${p}`);
    if (p === "android" || p === "ios") {
      root.classList.add("platform-mobile");
      root.style.setProperty("--safe-area-top", "max(env(safe-area-inset-top, 0px), 24px)");
      root.style.setProperty("--safe-area-bottom", "max(env(safe-area-inset-bottom, 0px), 16px)");
    }
  }
}


