/**
 * Persistence for the in-progress phone login.
 *
 * The pending record contains phoneCodeHash and the temporary session string
 * that owns the corresponding auth key. Storing it means a reload/re-render
 * never has to request a fresh code (which is what triggers Telegram's flood
 * limits). It lives in the app's file-backed vault, not localStorage.
 */

import { deleteSecret, getSecret, saveSecret } from "../secure/vault";
import {
  CODE_REQUEST_WINDOW_MS,
  PendingLogin,
  pruneRequestTimes,
  recordRequestTime,
} from "./loginFlow";

export const VAULT_KEY_PENDING_LOGIN = "telegram_pending_login_v1";
const REQUESTS_LS_KEY = "teledrive_login_requests_v1";
const FLOOD_LS_KEY = "teledrive_login_flood_v1";

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function loadPendingLogin(): Promise<PendingLogin | null> {
  try {
    const raw = await getSecret(VAULT_KEY_PENDING_LOGIN);
    if (!raw) return null;
    const parsed = safeParse<PendingLogin | null>(raw, null);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.phone !== "string" ||
      !parsed.phone ||
      typeof parsed.tempSession !== "string" ||
      !parsed.tempSession ||
      typeof parsed.expiresAt !== "number" ||
      (!parsed.phoneCodeHash && !parsed.requiresPassword)
    ) {
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn("[loginStorage] Could not load pending login:", err);
    return null;
  }
}

export async function savePendingLogin(pending: PendingLogin): Promise<void> {
  try {
    await saveSecret(VAULT_KEY_PENDING_LOGIN, JSON.stringify(pending));
  } catch (err) {
    console.warn("[loginStorage] Could not persist pending login:", err);
  }
}

export async function clearPendingLogin(): Promise<void> {
  try {
    await deleteSecret(VAULT_KEY_PENDING_LOGIN);
  } catch (err) {
    console.warn("[loginStorage] Could not clear pending login:", err);
  }
}

function loadRequestMap(): Record<string, number[]> {
  if (typeof localStorage === "undefined") return {};
  return safeParse<Record<string, number[]>>(
    localStorage.getItem(REQUESTS_LS_KEY),
    {}
  );
}

export function loadRequestTimes(phone: string, now: number = Date.now()): number[] {
  const map = loadRequestMap();
  return pruneRequestTimes(map[phone] || [], now);
}

export function recordCodeRequest(
  phone: string,
  now: number = Date.now()
): number[] {
  const map = loadRequestMap();
  const updated = recordRequestTime(map[phone] || [], now);
  map[phone] = updated;
  // Keep the map bounded if a device tries many numbers.
  const entries = Object.entries(map).sort(
    (a, b) => (b[1][b[1].length - 1] || 0) - (a[1][a[1].length - 1] || 0)
  );
  const trimmed = Object.fromEntries(entries.slice(0, 10));
  try {
    localStorage.setItem(REQUESTS_LS_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage may be disabled; the in-memory flow still works.
  }
  return updated;
}

/** Removes request history older than the rolling one-hour window. */
export function pruneAllRequestHistory(now: number = Date.now()): void {
  const map = loadRequestMap();
  const cleaned: Record<string, number[]> = {};
  for (const [phone, times] of Object.entries(map)) {
    const recent = pruneRequestTimes(times, now);
    if (recent.length > 0) cleaned[phone] = recent;
  }
  try {
    localStorage.setItem(REQUESTS_LS_KEY, JSON.stringify(cleaned));
  } catch {
    // Ignore.
  }
}

export { CODE_REQUEST_WINDOW_MS };

function loadFloodMap(): Record<string, number> {
  if (typeof localStorage === "undefined") return {};
  return safeParse<Record<string, number>>(
    localStorage.getItem(FLOOD_LS_KEY),
    {}
  );
}

export function loadFloodUntil(phone: string): number {
  const map = loadFloodMap();
  const until = map[phone] || 0;
  return until > Date.now() ? until : 0;
}

export function saveFloodUntil(phone: string, until: number): void {
  const map = loadFloodMap();
  if (until > Date.now()) {
    map[phone] = until;
  } else {
    delete map[phone];
  }
  try {
    localStorage.setItem(FLOOD_LS_KEY, JSON.stringify(map));
  } catch {
    // Ignore.
  }
}
