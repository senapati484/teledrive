import { TelegramClient, Api } from "telegram";
import QRCode from "qrcode";

export interface QrLoginCallbacks {
  onQrUrl: (qrDataUrl: string, expires: number) => void;
  onSuccess: () => void;
  onPasswordNeeded: () => void;
  onError: (err: any) => void;
}

/**
 * Starts Telegram QR Code authentication flow.
 * Displays the QR code and listens for user approval from their Telegram mobile app
 * (Settings -> Devices -> Link Desktop Device).
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

  const updateHandler = async (update: any) => {
    if (isCancelled) return;
    if (update instanceof Api.UpdateLoginToken) {
      try {
        const result2 = await client.invoke(
          new Api.auth.ExportLoginToken({
            apiId: Number(apiId),
            apiHash: apiHash,
            exceptIds: [],
          })
        );

        if (result2 instanceof Api.auth.LoginTokenSuccess) {
          isCancelled = true;
          cleanup();
          callbacks.onSuccess();
          return;
        }

        if (result2 instanceof Api.auth.LoginTokenMigrateTo) {
          await (client as any)._switchDC(result2.dcId);
          const migrated = await client.invoke(
            new Api.auth.ImportLoginToken({
              token: result2.token,
            })
          );
          if (migrated instanceof Api.auth.LoginTokenSuccess) {
            isCancelled = true;
            cleanup();
            callbacks.onSuccess();
            return;
          }
        }
      } catch (err: any) {
        if (
          err.errorMessage === "SESSION_PASSWORD_NEEDED" ||
          err.message?.includes("SESSION_PASSWORD_NEEDED")
        ) {
          isCancelled = true;
          cleanup();
          callbacks.onPasswordNeeded();
        } else {
          callbacks.onError(err);
        }
      }
    }
  };

  client.addEventHandler(updateHandler);

  const fetchToken = async () => {
    if (isCancelled) return;
    try {
      const result = await client.invoke(
        new Api.auth.ExportLoginToken({
          apiId: Number(apiId),
          apiHash: apiHash,
          exceptIds: [],
        })
      );

      if (result instanceof Api.auth.LoginTokenSuccess) {
        isCancelled = true;
        cleanup();
        callbacks.onSuccess();
        return;
      }

      if (result instanceof Api.auth.LoginTokenMigrateTo) {
        await (client as any)._switchDC(result.dcId);
        return fetchToken();
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
          callbacks.onQrUrl(dataUrl, result.expires);

          // Calculate time until expiration with a safety margin (refresh 2 seconds early)
          const nowSec = Math.floor(Date.now() / 1000);
          const refreshInSec = Math.max(5, (result.expires - nowSec) - 2);
          refreshTimer = setTimeout(() => {
            if (!isCancelled) {
              fetchToken();
            }
          }, refreshInSec * 1000);
        }
      }
    } catch (err: any) {
      if (!isCancelled) {
        callbacks.onError(err);
      }
    }
  };

  const cleanup = () => {
    isCancelled = true;
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    try {
      client.removeEventHandler(updateHandler, undefined as any);
    } catch {
      // Ignore cleanup error
    }
  };

  // Initial fetch
  fetchToken();

  return cleanup;
}
