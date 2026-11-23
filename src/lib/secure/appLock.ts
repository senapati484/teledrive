/**
 * Application Lock & Passcode Management for TeleDrive.
 *
 * Implements local application security:
 *   - Opt-in app lock (disabled by default)
 *   - Device credentials / biometrics (Touch ID, Windows Hello, OS user password)
 *   - Custom TeleDrive PIN (4–6 digits) or alphanumeric passphrase
 *   - PBKDF2-HMAC-SHA256 (200,000 iterations) with 32-byte CSPRNG salt
 *   - AES-GCM-256 canary verification
 *   - Anti-brute-force rate limiting with exponential cooldowns
 */

import { deleteSecret, getSecret, saveSecret } from "./vault";
import { logger } from "@/lib/logger";

export const VAULT_KEY_APPLOCK_CONFIG = "teledrive_applock_config";
export const CANARY_PLAINTEXT = "TELEDRIVE_LOCK_OK";
export const DEFAULT_PBKDF2_ITERATIONS = 200_000;
export const DEFAULT_AUTO_LOCK_MINUTES = 5;

export type AppLockMode = "device_biometric" | "custom_passcode";
export type PasscodeFormat = "pin" | "alphanumeric";

export interface StoredAppLockConfig {
  version: 1;
  enabled: boolean;
  mode: AppLockMode;
  passcodeFormat?: PasscodeFormat;
  pinLength?: number;
  saltB64?: string;
  iterations?: number;
  canaryIvB64?: string;
  canaryCiphertextB64?: string;
  autoLockMinutes: number; // 0 = immediate, 1, 5, 15, 60, -1 = never
  lockOnMinimize: boolean;
  privacyShield: boolean;
  failedAttempts: number;
  lockoutUntilMs: number;
  updatedAt: number;
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto SubtleCrypto is unavailable in this environment.");
  }
  return subtle;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length));
  globalThis.crypto.getRandomValues(out);
  return out;
}

function toStrictBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  out.set(bytes);
  return out;
}

/**
 * Derives a 256-bit AES-GCM CryptoKey from a user passcode and salt.
 */
export async function derivePasscodeKey(
  passcode: string,
  salt: Uint8Array,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const enc = new TextEncoder();
  const rawPasscode = enc.encode(passcode);

  const baseKey = await subtle.importKey(
    "raw",
    rawPasscode,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toStrictBytes(salt),
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts the canary verification token with the derived key.
 */
export async function createCanary(
  key: CryptoKey
): Promise<{ ivB64: string; ciphertextB64: string }> {
  const subtle = getSubtle();
  const iv = randomBytes(12);
  const enc = new TextEncoder();
  const plainBytes = enc.encode(CANARY_PLAINTEXT);

  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plainBytes
  );

  return {
    ivB64: bytesToBase64(iv),
    ciphertextB64: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Attempts to decrypt the canary verification token using the derived key.
 * Returns true if decryption matches CANARY_PLAINTEXT, false otherwise.
 */
export async function verifyCanary(
  key: CryptoKey,
  ivB64: string,
  ciphertextB64: string
): Promise<boolean> {
  try {
    const subtle = getSubtle();
    const iv = base64ToBytes(ivB64);
    const ciphertext = base64ToBytes(ciphertextB64);

    const decrypted = await subtle.decrypt(
      { name: "AES-GCM", iv: toStrictBytes(iv) },
      key,
      toStrictBytes(ciphertext)
    );

    const dec = new TextDecoder();
    return dec.decode(decrypted) === CANARY_PLAINTEXT;
  } catch {
    return false;
  }
}

/**
 * Loads the persisted app lock configuration from the vault.
 * Returns null if not configured or empty.
 */
export async function loadAppLockConfig(): Promise<StoredAppLockConfig | null> {
  try {
    const raw = await getSecret(VAULT_KEY_APPLOCK_CONFIG);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAppLockConfig;
    if (parsed && parsed.version === 1) {
      return parsed;
    }
    return null;
  } catch (err) {
    logger.warn("[AppLock] Failed to load config from vault:", err);
    return null;
  }
}

/**
 * Persists the app lock configuration to the vault.
 */
export async function saveAppLockConfig(config: StoredAppLockConfig): Promise<void> {
  const serialized = JSON.stringify(config);
  await saveSecret(VAULT_KEY_APPLOCK_CONFIG, serialized);
}

/**
 * Clears the app lock configuration from the vault.
 */
export async function clearAppLockConfig(): Promise<void> {
  await deleteSecret(VAULT_KEY_APPLOCK_CONFIG).catch(() => {});
}

/**
 * Calculates cooldown lockout penalty in milliseconds based on consecutive failures.
 */
export function calculateLockoutPenalty(failedAttempts: number): number {
  if (failedAttempts < 4) return 0;
  if (failedAttempts === 4) return 15_000;  // 15 seconds
  if (failedAttempts === 5) return 30_000;  // 30 seconds
  if (failedAttempts === 6) return 60_000;  // 1 minute
  if (failedAttempts <= 8) return 120_000;  // 2 minutes
  return 900_000;                          // 15 minutes
}

/**
 * Factory for a new custom passcode configuration.
 */
export async function createPasscodeConfig(
  passcode: string,
  format: PasscodeFormat,
  options?: Partial<StoredAppLockConfig>
): Promise<StoredAppLockConfig> {
  const salt = randomBytes(32);
  const key = await derivePasscodeKey(passcode, salt);
  const canary = await createCanary(key);

  return {
    version: 1,
    enabled: true,
    mode: "custom_passcode",
    passcodeFormat: format,
    pinLength: format === "pin" ? passcode.length : undefined,
    saltB64: bytesToBase64(salt),
    iterations: DEFAULT_PBKDF2_ITERATIONS,
    canaryIvB64: canary.ivB64,
    canaryCiphertextB64: canary.ciphertextB64,
    autoLockMinutes: options?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES,
    lockOnMinimize: options?.lockOnMinimize ?? false,
    privacyShield: options?.privacyShield ?? true,
    failedAttempts: 0,
    lockoutUntilMs: 0,
    updatedAt: Date.now(),
  };
}

/**
 * Factory for a new device biometric configuration.
 */
export function createBiometricConfig(
  options?: Partial<StoredAppLockConfig>
): StoredAppLockConfig {
  return {
    version: 1,
    enabled: true,
    mode: "device_biometric",
    autoLockMinutes: options?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES,
    lockOnMinimize: options?.lockOnMinimize ?? false,
    privacyShield: options?.privacyShield ?? true,
    failedAttempts: 0,
    lockoutUntilMs: 0,
    updatedAt: Date.now(),
  };
}

/**
 * Verifies a submitted passcode against the stored configuration.
 */
export async function verifyPasscode(
  passcode: string,
  config: StoredAppLockConfig
): Promise<boolean> {
  if (
    config.mode !== "custom_passcode" ||
    !config.saltB64 ||
    !config.canaryIvB64 ||
    !config.canaryCiphertextB64
  ) {
    return false;
  }

  const salt = base64ToBytes(config.saltB64);
  const iterations = config.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  const key = await derivePasscodeKey(passcode, salt, iterations);
  return verifyCanary(key, config.canaryIvB64, config.canaryCiphertextB64);
}
