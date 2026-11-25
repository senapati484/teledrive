import { logger } from "../logger";
import { isTauriRuntime } from "../runtime/bridge";
import { getWebdavHandler } from "./defaultDeps";
import { normalizeBridgeResponse, parseBridgeRequest } from "./types";

/**
 * Register once per webview. Rust emits one event per HTTP request and waits
 * for `webdav_bridge_response`; every path (including malformed payloads) must
 * send a reply or the client would hang until the Rust timeout.
 */
const EVENT_NAME = "teledrive://webdav-request";

let started = false;
let unlisten: (() => void) | null = null;
let inFlight = 0;

export async function startWebdavBridge(): Promise<void> {
  if (started || !isTauriRuntime()) return;
  started = true;
  try {
    const [{ listen }, { invoke }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/core"),
    ]);
    const handler = getWebdavHandler();

    unlisten = await listen<unknown>(EVENT_NAME, (event) => {
      inFlight += 1;
      void handleEvent(event.payload).finally(() => {
        inFlight -= 1;
      });
    });

    // Only now is it safe for Rust to bind the socket: events emitted before
    // this listener existed would be dropped and the client would hang.
    await invoke("webdav_bridge_ready").catch((err: unknown) => {
      logger.warn("[webdav] Failed to start the configured server:", err);
    });

    async function handleEvent(raw: unknown): Promise<void> {
      let id: number | null = null;
      try {
        if (raw && typeof raw === "object" && "id" in raw && typeof raw.id === "number") {
          id = raw.id;
        }
        const request = parseBridgeRequest(raw);
        id = request.id;
        const response = await handler.handle(request);
        await invoke("webdav_bridge_response", {
          id: request.id,
          response: normalizeBridgeResponse(response),
        });
      } catch (err) {
        logger.warn("[webdav] Bridge request failed:", err);
        if (id !== null) {
          await invoke("webdav_bridge_response", {
            id,
            response: { status: 500, body: "WebDAV bridge error" },
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    started = false;
    logger.warn("[webdav] Failed to register the bridge listener:", err);
  }
}

export function stopWebdavBridge(): void {
  unlisten?.();
  unlisten = null;
  started = false;
}

/** Test/telemetry hook; intentionally not surfaced in the UI. */
export function webdavBridgeInFlight(): number {
  return inFlight;
}
