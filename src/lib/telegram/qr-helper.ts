import { TelegramClient, Api } from "telegram";
import QRCode from "qrcode";

export interface QrLoginCallbacks {
  onQrUrl: (qrDataUrl: string, expires: number, tgUrl?: string) => void;
  onSuccess: () => void;
  onPasswordNeeded: () => void;
  onError: (err: any) => void;
}

/**
 * Starts Telegram QR Code authentication flow.
 * Displays the QR code and listens for user approval from their Telegram mobile app
 * (via Settings -> Devices -> Link Desktop Device, or 1-tap deep link tg://login?token=...).
 *
 * @returns A cancellation function that cleans up event handlers and polling timers.
 */
export function startQrLogin(
  client: TelegramClient,
  apiId: number,
  apiHash: string,
  callbacks: QrLoginCallbacks
): () => void {
  let isCancelled = false;
  let refreshTimer: NodeJS.Timeout | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let isChecking = false;

  // Process the result returned by auth.ExportLoginToken
  const processExportResult = async (result: any): Promise<boolean> => {
    if (isCancelled) return true;

    if (result instanceof Api.auth.LoginTokenSuccess) {
      isCancelled = true;
      cleanup();
      callbacks.onSuccess();
      return true;
    }

    if (result instanceof Api.auth.LoginTokenMigrateTo) {
      try {
        await (client as any)._switchDC(result.dcId);
        const migrated = await client.invoke(
          new Api.auth.ImportLoginToken({
            token: result.token,
          })
        );
        if (migrated instanceof Api.auth.LoginTokenSuccess) {
          isCancelled = true;
          cleanup();
          callbacks.onSuccess();
          return true;
        }
      } catch (migrateErr) {
        console.error("DC migration error during QR login:", migrateErr);
        throw migrateErr;
      }
    }

    if (result instanceof Api.auth.LoginToken) {
      const base64UrlToken = Buffer.from(result.token)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const tgUrl = `tg://login?token=${base64UrlToken}`;
      const dataUrl = await QRCode.toDataURL(tgUrl, {
        width: 240,
        margin: 1,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });

      if (!isCancelled) {
        callbacks.onQrUrl(dataUrl, result.expires, tgUrl);

        // Schedule token refresh 2 seconds before expiry
        if (refreshTimer) {
          clearTimeout(refreshTimer);
          refreshTimer = null;
        }
        const nowSec = Math.floor(Date.now() / 1000);
        const refreshInSec = Math.max(5, result.expires - nowSec - 2);
        refreshTimer = setTimeout(() => {
          if (!isCancelled) {
            checkApprovalStatus();
          }
        }, refreshInSec * 1000);
      }
      return false;
    }

    return false;
  };

  // Actively query login status from Telegram
  const checkApprovalStatus = async (): Promise<boolean> => {
    if (isCancelled || isChecking) return false;
    isChecking = true;
    try {
      const result = await client.invoke(
        new Api.auth.ExportLoginToken({
          apiId: Number(apiId),
          apiHash: apiHash,
          exceptIds: [],
        })
      );
      return await processExportResult(result);
    } catch (err: any) {
      if (
        err.errorMessage === "SESSION_PASSWORD_NEEDED" ||
        err.message?.includes("SESSION_PASSWORD_NEEDED")
      ) {
        isCancelled = true;
        cleanup();
        callbacks.onPasswordNeeded();
        return true;
      }
      if (!isCancelled) {
        console.warn("QR check non-fatal error:", err);
      }
      return false;
    } finally {
      isChecking = false;
    }
  };

  // Regular gentle polling (every 3 seconds) while QR login is active.
  // This ensures that even if push updates are missed when the app is backgrounded,
  // the login is completed within 3 seconds of the user approving in Telegram.
  const startPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (!isCancelled) {
        checkApprovalStatus();
      }
    }, 3000);
  };

  // Push update handler from Telegram's MTProto stream
  const updateHandler = async (update: any) => {
    if (isCancelled) return;
    if (
      update instanceof Api.UpdateLoginToken ||
      update?.className === "UpdateLoginToken"
    ) {
      await checkApprovalStatus();
    }
  };

  client.addEventHandler(updateHandler);

  // When app regains focus or visibility (e.g. user confirmed in Telegram and switched back)
  let lastResumeCheck = 0;
  const handleResume = () => {
    if (isCancelled) return;
    const now = Date.now();
    if (now - lastResumeCheck > 1500) {
      lastResumeCheck = now;
      checkApprovalStatus();
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("focus", handleResume);
    document.addEventListener("visibilitychange", handleResume);
  }

  const cleanup = () => {
    isCancelled = true;
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
    }
    try {
      client.removeEventHandler(updateHandler, undefined as any);
    } catch {
      // Ignore cleanup error
    }
  };

  // Initial fetch and start polling
  checkApprovalStatus().then((done) => {
    if (!done && !isCancelled) {
      startPolling();
    }
  });

  return cleanup;
}
