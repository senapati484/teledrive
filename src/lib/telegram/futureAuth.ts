/**
 * Telegram "future auth tokens".
 *
 * auth.authorization / auth.loggedOut may contain a future_auth_token. Passing
 * these back in CodeSettings.logoutTokens lets Telegram skip the login code for
 * an account that recently logged out on this client. This reduces code
 * requests (and therefore PHONE_NUMBER_FLOOD / FLOOD_WAIT lockouts).
 */

import { Buffer } from "buffer";
import { getSecret, saveSecret } from "../secure/vault";

export const VAULT_KEY_FUTURE_AUTH_TOKENS = "telegram_future_auth_tokens_v1";
const MAX_TOKENS = 5;

/** Serialises the read-modify-write so concurrent saves don't drop tokens. */
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => undefined);
  return run;
}

function toBase64(token: any): string | null {
  if (!token) return null;
  try {
    if (typeof token === "string") return token;
    if (typeof token.toString === "function" && (token._isBuffer || Buffer.isBuffer(token))) {
      return token.toString("base64");
    }
    if (token instanceof Uint8Array || ArrayBuffer.isView(token)) {
      return Buffer.from(token.buffer, token.byteOffset, token.byteLength).toString("base64");
    }
    if (Array.isArray(token)) {
      return Buffer.from(token).toString("base64");
    }
    return Buffer.from(token).toString("base64");
  } catch {
    return null;
  }
}

async function readTokens(): Promise<string[]> {
  try {
    const raw = await getSecret(VAULT_KEY_FUTURE_AUTH_TOKENS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === "string" && t.length > 0);
  } catch (err) {
    console.warn("[futureAuth] Could not read future auth tokens:", err);
    return [];
  }
}

/**
 * Stores a token emitted by auth.signIn / auth.checkPassword / QR login or
 * auth.logOut. Duplicates are removed and the list is capped.
 */
export function saveFutureAuthToken(token: any): Promise<void> {
  const encoded = toBase64(token);
  if (!encoded) return Promise.resolve();
  return enqueueWrite(async () => {
    try {
      const existing = await readTokens();
      const next = [encoded, ...existing.filter((t) => t !== encoded)].slice(
        0,
        MAX_TOKENS
      );
      await saveSecret(VAULT_KEY_FUTURE_AUTH_TOKENS, JSON.stringify(next));
    } catch (err) {
      console.warn("[futureAuth] Could not save future auth token:", err);
    }
  });
}

/** Loads tokens in the Buffer form expected by CodeSettings.logoutTokens. */
export async function loadLogoutTokens(): Promise<Buffer[]> {
  const tokens = await readTokens();
  const result: Buffer[] = [];
  for (const t of tokens) {
    try {
      const buf = Buffer.from(t, "base64");
      if (buf.length > 0) result.push(buf);
    } catch {
      // Skip malformed tokens.
    }
  }
  return result;
}

export function clearFutureAuthTokens(): Promise<void> {
  return enqueueWrite(async () => {
    try {
      await saveSecret(VAULT_KEY_FUTURE_AUTH_TOKENS, "[]");
    } catch {
      // Ignore.
    }
  });
}
