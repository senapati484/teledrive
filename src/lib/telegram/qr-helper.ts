import { TelegramClient, Api } from "telegram";
import { Buffer } from "buffer";
import { classNameOf } from "./loginFlow";

let qrCodeModulePromise: Promise<typeof import("qrcode")> | null = null;

/** Load the QR encoder only when QR login is actually used. */
function loadQrCodeModule(): Promise<typeof import("qrcode")> {
  if (!qrCodeModulePromise) {
    qrCodeModulePromise = import("qrcode").catch((err) => {
      qrCodeModulePromise = null;
      throw err;
    });
  }
  return qrCodeModulePromise;
}

export interface QrLoginCallbacks {
  onQrUrl: (qrDataUrl: string, expires: number, tgUrl?: string) => void;
  /** Receives the auth.Authorization result so its future_auth_token is kept. */
  onSuccess: (authorization?: any) => void;
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
  let lastTgUrl: string | null = null;
  let lastQrDataUrl: string | null = null;

  const isPageHidden = () =>
    typeof document !== "undefined" && document.visibilityState === "hidden";

  // Process the result returned by auth.ExportLoginToken. Constructor checks
  // must be name-based because production bundles and GramJS can disagree on
  // `instanceof` after chunk splitting.
  const processExportResult = async (result: any): Promise<boolean> => {
    if (isCancelled) return true;

    const resultName = classNameOf(result);

    if (resultName === "auth.LoginTokenSuccess") {
      isCancelled = true;
      cleanup();
      callbacks.onSuccess(result.authorization);
      return true;
    }

    if (resultName === "auth.LoginTokenMigrateTo") {
      try {
        await (client as any)._switchDC(result.dcId);
        const migrated = await client.invoke(
          new Api.auth.ImportLoginToken({
            token: result.token,
          })
        );
        if (classNameOf(migrated) === "auth.LoginTokenSuccess") {
          isCancelled = true;
          cleanup();
          callbacks.onSuccess((migrated as any).authorization);
          return true;
        }
      } catch (migrateErr) {
        console.error("DC migration error during QR login:", migrateErr);
        throw migrateErr;
      }
    }

    if (resultName === "auth.LoginToken") {
      const base64UrlToken = Buffer.from(result.token)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const tgUrl = `tg://login?token=${base64UrlToken}`;

      // Telegram may return the same token on every poll. Re-encoding an
      // identical QR code (and re-rendering the parent) is pure busywork, so
      // only rebuild and publish it when it actually changes.
      const tokenChanged = tgUrl !== lastTgUrl;
      if (tokenChanged) {
        const QRCode = await loadQrCodeModule();
        lastQrDataUrl = await QRCode.toDataURL(tgUrl, {
          width: 240,
          margin: 1,
          color: {
            dark: "#000000",
            light: "#ffffff",
          },
        });
        lastTgUrl = tgUrl;
      }

      if (!isCancelled && lastQrDataUrl) {
        if (tokenChanged) {
          callbacks.onQrUrl(lastQrDataUrl, result.expires, tgUrl);
        }

        // Schedule token refresh 2 seconds before expiry
        if (refreshTimer) {
          clearTimeout(refreshTimer);
          refreshTimer = null;
        }
        const nowSec = Math.floor(Date.now() / 1000);
        const refreshInSec = Math.max(5, result.expires - nowSec - 2);
        refreshTimer = setTimeout(() => {
          if (!isCancelled && !isPageHidden()) {
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
      const errMsg =
        typeof err === "string"
          ? err
          : err?.errorMessage || err?.message || "";
      if (/SESSION_PASSWORD_NEEDED/.test(errMsg)) {
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
      if (!isCancelled && !isPageHidden()) {
        checkApprovalStatus();
      }
    }, 3000);
  };

  // Push update handler from Telegram's MTProto stream
  const updateHandler = async (update: any) => {
    if (isCancelled) return;
    const updateName = update?.className || update?.constructor?.name || "";
    if (updateName === "UpdateLoginToken") {
      await checkApprovalStatus();
    }
  };

  client.addEventHandler(updateHandler);

  // When app regains focus or visibility (e.g. user confirmed in Telegram and switched back)
  let lastResumeCheck = 0;
  const handleResume = () => {
    if (isCancelled || isPageHidden()) return;
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

  // Tauri mobile: the webview may not fire window focus when the user returns
  // from the Telegram app. The native window focus event is a reliable resume
  // signal, which acts as our "callback" after the user taps Confirm.
  let unlistenNativeFocus: (() => void) | null = null;
  void (async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const unlisten = await getCurrentWindow().onFocusChanged(({ payload }) => {
        if (payload) handleResume();
      });
      if (isCancelled) {
        unlisten();
      } else {
        unlistenNativeFocus = unlisten;
      }
    } catch {
      // Non-Tauri/browser environment: window focus + polling is enough.
    }
  })();

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
    if (unlistenNativeFocus) {
      try {
        unlistenNativeFocus();
      } catch {
        // Ignore cleanup error
      }
      unlistenNativeFocus = null;
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
