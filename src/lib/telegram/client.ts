import { Api, TelegramClient } from "telegram";
import { ConnectionTCPObfuscated } from "telegram/network";
import { logger } from "@/lib/logger";
import { StringSession } from "telegram/sessions";
import { getPlatform } from "../platform";
import { APP_VERSION } from "./config";
import {
  getProxySettings,
  isProxySupported,
  normalizeMtproxySecretForGramJs,
  normalizeStringSessionTransport,
  resolveTelegramDcEndpoint,
  validateProxySettings,
  type ProxySettings,
} from "./proxy";
import { createTauriProxySocketClass } from "./proxySocket";

let clientInstance: TelegramClient | null = null;
let isConnectedStatus = false;
let activeApiId: number | null = null;
let activeApiHash: string | null = null;
let activeSessionString: string | null = null;
let activeProxySignature: string | null = null;

async function resolveActiveProxySettings(): Promise<ProxySettings | null> {
  if (!isProxySupported()) {
    return null;
  }
  try {
    const settings = await getProxySettings();
    if (!settings.enabled) {
      return null;
    }
    const validationError = validateProxySettings(settings);
    if (validationError) {
      logger.warn("Ignoring invalid enabled proxy settings:", validationError);
      return null;
    }
    return settings;
  } catch (err) {
    logger.warn("Failed to load proxy settings; using direct connection:", err);
    return null;
  }
}

export async function initClient(
  apiId: number,
  apiHash: string,
  sessionString: string = "",
  forceNew: boolean = false
): Promise<void> {
  const proxySettings = await resolveActiveProxySettings();
  const proxySignature = proxySettings ? JSON.stringify(proxySettings) : "direct";

  // If already instantiated with the SAME credentials, session, proxy, and no force-new requested, reuse or reconnect
  if (
    !forceNew &&
    clientInstance &&
    activeApiId === apiId &&
    activeApiHash === apiHash &&
    activeSessionString === sessionString &&
    activeProxySignature === proxySignature
  ) {
    if (!clientInstance.connected) {
      try {
        await clientInstance.connect();
        isConnectedStatus = true;
      } catch (err) {
        logger.warn("Reconnection failed, creating fresh client:", err);
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
    activeProxySignature = null;
  }

  const stringSession = new StringSession(sessionString);
  normalizeStringSessionTransport(stringSession, proxySettings !== null);

  const platform = getPlatform();
  const deviceModel =
    platform === "android"
      ? "TeleDrive Android"
      : platform === "ios"
      ? "TeleDrive iOS"
      : "TeleDrive Desktop";

  const clientParams: Record<string, any> = {
    connectionRetries: proxySettings ? 2 : 5,
    retryDelay: proxySettings ? 500 : 1000,
    useWSS: proxySettings === null,
    deviceModel,
    systemVersion: "1.0.0",
    appVersion: APP_VERSION,
    langCode: "en",
    systemLangCode: "en",
  };

  if (proxySettings) {
    clientParams.networkSocket = createTauriProxySocketClass(proxySettings);
    if (proxySettings.proxyType === "mtproxy") {
      clientParams.proxy = {
        ip: proxySettings.host,
        port: proxySettings.port,
        secret: normalizeMtproxySecretForGramJs(proxySettings.secret),
        MTProxy: true,
      };
    } else {
      clientParams.connection = ConnectionTCPObfuscated;
    }
  }

  const nextClient = new TelegramClient(stringSession, apiId, apiHash, clientParams);

  if (proxySettings) {
    // Route DC lookups and exported upload/download DCs to raw IPv4 endpoints over TCP proxy
    (nextClient as any).getDC = async (dcId: number) => {
      if (!(nextClient as any)._config) {
        try {
          (nextClient as any)._config = await nextClient.invoke(new Api.help.GetConfig());
        } catch {
          // Fall back to canonical production DC map when initial config is unavailable
        }
      }
      return resolveTelegramDcEndpoint(
        dcId,
        (nextClient as any)._config?.dcOptions,
        Boolean((nextClient as any)._useIPV6)
      );
    };
  }

  // Set the log level to warn
  nextClient.setLogLevel("warn" as any);

  try {
    await nextClient.connect();
  } catch (err) {
    try { await nextClient.disconnect(); } catch { /* ignore */ }
    throw err;
  }

  clientInstance = nextClient;
  isConnectedStatus = true;
  activeApiId = apiId;
  activeApiHash = apiHash;
  activeSessionString = sessionString;
  activeProxySignature = proxySignature;
}

/**
 * Rebuilds and reconnects the active `TelegramClient` in place (e.g. after proxy changes)
 * while preserving the current API credentials and session authKey.
 */
export async function reconnectActiveClient(
  fallbackCredentials?: { apiId: number; apiHash: string; sessionString?: string }
): Promise<boolean> {
  const apiId = activeApiId ?? fallbackCredentials?.apiId ?? null;
  const apiHash = activeApiHash ?? fallbackCredentials?.apiHash ?? null;
  if (!apiId || !apiHash) {
    return false;
  }
  const savedSession =
    (typeof clientInstance?.session?.save === "function"
      ? (clientInstance.session.save() as unknown as string)
      : null) ||
    activeSessionString ||
    fallbackCredentials?.sessionString ||
    "";

  await initClient(apiId, apiHash, savedSession, true);
  return true;
}

export function getClient(): TelegramClient {
  if (!clientInstance) {
    throw new Error("TelegramClient not initialized. Call initClient first.");
  }
  return clientInstance;
}

/**
 * Ensures the client instance is connected. If the connection was dropped
 * (e.g. app was backgrounded or network socket dropped), attempts to reconnect.
 */
export async function ensureConnected(): Promise<TelegramClient> {
  const client = getClient();
  if (!client.connected) {
    try {
      await client.connect();
      isConnectedStatus = true;
    } catch (err) {
      logger.warn("[TelegramClient] Reconnection attempt failed:", err);
    }
  }
  return client;
}

export async function disconnectClient(): Promise<void> {
  const client = clientInstance;
  clientInstance = null;
  isConnectedStatus = false;
  activeApiId = null;
  activeApiHash = null;
  activeSessionString = null;
  activeProxySignature = null;
  if (client) {
    try {
      await client.disconnect();
    } catch (err) {
      logger.warn("Error during TelegramClient disconnect:", err);
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
  activeProxySignature = null;
}

export function isClientConnected(): boolean {
  return isConnectedStatus && clientInstance !== null;
}
