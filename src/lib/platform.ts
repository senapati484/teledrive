/**
 * Platform detection utilities for Tauri 2 mobile + desktop.
 *
 * Usage:
 *   import { getPlatform, isMobilePlatform } from '@/lib/platform';
 *
 *   const p = await getPlatform();   // 'android' | 'ios' | 'desktop'
 *   const mobile = isMobilePlatform(); // true after init
 */

type AppPlatform = "desktop" | "android" | "ios";

let _platform: AppPlatform | null = null;

/**
 * Returns the current Tauri platform asynchronously.
 * Result is cached after the first call.
 */
export async function getPlatform(): Promise<AppPlatform> {
  if (_platform !== null) return _platform;

  try {
    // Dynamically import to avoid bundling issues when plugin is not installed
    const { platform } = await import("@tauri-apps/plugin-os");
    const p = await platform();
    if (p === "android" || p === "ios") {
      _platform = p;
    } else {
      _platform = "desktop";
    }
  } catch {
    // Fallback: check user agent for mobile WebView
    const ua = navigator.userAgent.toLowerCase();
    if (/android/.test(ua)) {
      _platform = "android";
    } else if (/iphone|ipad|ipod/.test(ua)) {
      _platform = "ios";
    } else {
      _platform = "desktop";
    }
  }

  return _platform;
}

/**
 * Synchronous check — only reliable AFTER getPlatform() has been awaited once.
 * Returns false (desktop) if platform detection hasn't completed yet.
 */
export function isMobilePlatform(): boolean {
  return _platform === "android" || _platform === "ios";
}

/**
 * Initialize platform detection. Call this early in the app lifecycle
 * (e.g., in main.tsx before rendering) so synchronous checks work correctly.
 */
export async function initPlatform(): Promise<void> {
  await getPlatform();
}
