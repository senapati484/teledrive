import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

let clientInstance: TelegramClient | null = null;
let isConnectedStatus = false;
let activeApiId: number | null = null;

export async function initClient(
  apiId: number,
  apiHash: string,
  sessionString: string = "",
  forceNew: boolean = false
): Promise<void> {
  // If already instantiated with the SAME credentials and no force-new requested, reuse or reconnect
  if (!forceNew && clientInstance && activeApiId === apiId) {
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
  }

  const stringSession = new StringSession(sessionString);
  
  clientInstance = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: true,
    deviceModel: "TeleDrive Desktop",
    systemVersion: "1.0.0",
    appVersion: "0.1.2",
    langCode: "en",
    systemLangCode: "en",
  });

  // Set the log level to warn
  clientInstance.setLogLevel("warn" as any);

  await clientInstance.connect();
  isConnectedStatus = true;
  activeApiId = apiId;
}

export function getClient(): TelegramClient {
  if (!clientInstance) {
    throw new Error("TelegramClient not initialized. Call initClient first.");
  }
  return clientInstance;
}

export async function disconnectClient(): Promise<void> {
  if (clientInstance) {
    try {
      await clientInstance.disconnect();
    } catch (err) {
      console.warn("Error during TelegramClient disconnect:", err);
    }
    clientInstance = null;
    isConnectedStatus = false;
    activeApiId = null;
  }
}

/** Alias used during logout to ensure the next initClient creates a fresh client */
export function resetClient(): void {
  clientInstance = null;
  isConnectedStatus = false;
  activeApiId = null;
}

export function isClientConnected(): boolean {
  return isConnectedStatus && clientInstance !== null;
}
