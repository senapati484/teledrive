import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { getPlatform } from "../platform";
import { APP_VERSION } from "./config";

let clientInstance: TelegramClient | null = null;
let isConnectedStatus = false;
let activeApiId: number | null = null;
let activeApiHash: string | null = null;
let activeSessionString: string | null = null;

export async function initClient(
  apiId: number,
  apiHash: string,
  sessionString: string = "",
  forceNew: boolean = false
): Promise<void> {
  // If already instantiated with the SAME credentials, session and no force-new requested, reuse or reconnect
  if (
    !forceNew &&
    clientInstance &&
    activeApiId === apiId &&
    activeApiHash === apiHash &&
    activeSessionString === sessionString
  ) {
    if (!clientInstance.connected) {
      try {
        await clientInstance.connect();
        isConnectedStatus = true;
      } catch (err) {
        console.warn("Reconnection failed, creating fresh client:", err);
      }
    }
    if (isConnectedStatus && clientInstance?.connected) {
      return;
    }
  }

  // Tear down any existing client
  if (clientInstance) {
    try { await clientInstance.disconnect(); } catch { /* ignore */ }
    clientInstance = null;
    isConnectedStatus = false;
    activeApiId = null;
    activeApiHash = null;
    activeSessionString = null;
  }

  const stringSession = new StringSession(sessionString);
  const platform = getPlatform();
  const deviceModel =
    platform === "android"
      ? "TeleDrive Android"
      : platform === "ios"
      ? "TeleDrive iOS"
      : "TeleDrive Desktop";

  clientInstance = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: true,
    deviceModel,
    systemVersion: "1.0.0",
    appVersion: APP_VERSION,
    langCode: "en",
    systemLangCode: "en",
  });

  // Set the log level to warn
  clientInstance.setLogLevel("warn" as any);

  await clientInstance.connect();
  isConnectedStatus = true;
  activeApiId = apiId;
  activeApiHash = apiHash;
  activeSessionString = sessionString;
}

export function getClient(): TelegramClient {
  if (!clientInstance) {
    throw new Error("TelegramClient not initialized. Call initClient first.");
  }
  return clientInstance;
}

export async function disconnectClient(): Promise<void> {
  const client = clientInstance;
  clientInstance = null;
  isConnectedStatus = false;
  activeApiId = null;
  activeApiHash = null;
  activeSessionString = null;
  if (client) {
    try {
      await client.disconnect();
    } catch (err) {
      console.warn("Error during TelegramClient disconnect:", err);
    }
  }
}

/** Alias used during logout to ensure the next initClient creates a fresh client */
export function resetClient(): void {
  clientInstance = null;
  isConnectedStatus = false;
  activeApiId = null;
  activeApiHash = null;
  activeSessionString = null;
}

export function isClientConnected(): boolean {
  return isConnectedStatus && clientInstance !== null;
}
