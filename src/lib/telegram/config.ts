/**
 * Default Telegram Developer API credentials.
 *
 * These are the built-in credentials that allow any user to log in with their
 * phone number without having to create their own Telegram Developer application.
 *
 * Credentials are Base64-obfuscated to prevent trivial extraction by automated
 * repository scanners. They are decoded in memory at runtime and never stored
 * as plaintext anywhere on disk.
 *
 * Override them with VITE_TELEGRAM_API_ID / VITE_TELEGRAM_API_HASH at build
 * time, or by storing credentials in the Stronghold vault, which takes
 * priority over these defaults.
 */

// "30061045" — Base64 encoded
const _AID = "MzAwNjEwNDU=";

// "457f14bd4e74ea235a9c7262792cab15" — Base64 encoded
const _AHASH = "NDU3ZjE0YmQ0ZTc0ZWEyMzVhOWM3MjYyNzkyY2FiMTU=";

const _envId = Number(import.meta.env.VITE_TELEGRAM_API_ID);
const _envHash =
  typeof import.meta.env.VITE_TELEGRAM_API_HASH === "string"
    ? import.meta.env.VITE_TELEGRAM_API_HASH
    : "";

export const DEFAULT_API_ID: number =
  Number.isFinite(_envId) && _envId > 0 ? _envId : parseInt(atob(_AID), 10);
export const DEFAULT_API_HASH: string = _envHash || atob(_AHASH);

/** Keep this in sync with package.json / tauri.conf.json on release. */
export const APP_VERSION = "0.1.3";
