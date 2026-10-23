import { invoke } from "@tauri-apps/api/core";

export const VAULT_KEY_API_ID      = 'telegram_api_id';
export const VAULT_KEY_API_HASH    = 'telegram_api_hash';
export const VAULT_KEY_SESSION     = 'telegram_session';
export const VAULT_KEY_PHONE       = 'telegram_phone';
/** Generic channel-ID key (legacy). Prefer channelIdKey(phone) for multi-account. */
export const VAULT_KEY_CHANNEL_ID  = 'telegram_channel_id';

/**
 * Returns the vault key for a given phone number's storage channel.
 * E.g.  channelIdKey("+918653420095") → "telegram_channel_id_+918653420095"
 *
 * Normalising: trim whitespace only; keep + prefix and digits as-is.
 * This lets each Telegram account store its own channel ID independently,
 * so logout/login with a different number never loses another account's data.
 */
export function channelIdKey(phone: string): string {
  return `${VAULT_KEY_CHANNEL_ID}_${phone.trim()}`;
}

/**
 * Mock initVault function to maintain backwards compatibility with existing callers.
 * Because we use the reliable Rust file-backed key-value store, no initialisation is needed.
 */
export async function initVault(): Promise<void> {
  // Safe no-op
  return Promise.resolve();
}

/**
 * The Rust vault commands read-modify-write a single JSON file and are not
 * atomic. Serialising all vault access here prevents concurrent writes from
 * losing keys and prevents reads from seeing a half-written file.
 */
let vaultQueue: Promise<unknown> = Promise.resolve();

function runVaultOp<T>(op: () => Promise<T>): Promise<T> {
  const result = vaultQueue.then(op, op);
  vaultQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/**
 * Saves a secret key-value pair to the local file-backed JSON store.
 */
export function saveSecret(key: string, value: string): Promise<void> {
  return runVaultOp(async () => {
    try {
      await invoke("save_vault_value", { key, value });
    } catch (error) {
      console.error(`Failed to save secret for key ${key}:`, error);
      throw error;
    }
  });
}

/**
 * Gets a secret value for a key from the local file-backed JSON store.
 */
export function getSecret(key: string): Promise<string | null> {
  return runVaultOp(async () => {
    try {
      return await invoke<string | null>("load_vault_value", { key });
    } catch (error) {
      console.warn(`Failed to get secret for key ${key}:`, error);
      return null;
    }
  });
}

/**
 * Deletes a secret key-value pair from the local file-backed JSON store.
 */
export function deleteSecret(key: string): Promise<void> {
  return runVaultOp(async () => {
    try {
      await invoke("delete_vault_value", { key });
    } catch (error) {
      console.error(`Failed to delete secret for key ${key}:`, error);
      throw error;
    }
  });
}
