/**
 * Logs the current Telegram session out while preserving the server-issued
 * future auth token. Keeping that token lets the same account sign back in
 * without another SMS/app code (Telegram may ask only for the 2FA password).
 */

import { Api } from "telegram";
import { disconnectClient, getClient } from "./client";
import { saveFutureAuthToken } from "./futureAuth";
import { clearPendingLogin } from "./loginStorage";

const LOGOUT_TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

export async function logoutTelegram(): Promise<void> {
  try {
    const client = getClient();
    if (client?.connected) {
      const result: any = await withTimeout(
        client.invoke(new Api.auth.LogOut()),
        LOGOUT_TIMEOUT_MS
      );
      if (result?.futureAuthToken) {
        await saveFutureAuthToken(result.futureAuthToken);
      }
    }
  } catch (err) {
    console.warn("[logout] auth.logOut failed (non-fatal):", err);
  } finally {
    await clearPendingLogin();
    await disconnectClient();
  }
}
