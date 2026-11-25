import { Api, TelegramClient } from "telegram";
import { ConnectionTCPObfuscated } from "telegram/network";
import { logger } from "@/lib/logger";
import { StringSession } from "telegram/sessions";
import { getPlatform } from "../platform";
import { APP_VERSION } from "./config";
import {
  discoverTelegramRoute,
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
let activeRouteSignature: string | null = null;
/** Remembers the last working native route in this session so subsequent connects avoid probing delay. */
let sessionPreferredRoute: ProxySettings | null | undefined = undefined;

function routeSignature(route: ProxySettings | null): string {
  return route ? JSON.stringify(route) : "wss-direct";
}

async function resolveInitialRoute(): Promise<ProxySettings | null> {
  if (!isProxySupported()) {
    return null;
  }
  if (sessionPreferredRoute !== undefined) {
    return sessionPreferredRoute;
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

/**
 * Instantiates and connects a `TelegramClient` over either standard WSS (`route === null`)
 * or a native Rust socket route (`Direct` raw MTProto TCP, `MTProxy`, `SOCKS5`, or `HTTP`).
 */
async function connectWithRoute(
  apiId: number,
  apiHash: string,
  sessionString: string,
  route: ProxySettings | null,
  fastAttempt: boolean = false
): Promise<TelegramClient> {
  const stringSession = new StringSession(sessionString);
  const useNativeTcp = route !== null;
  normalizeStringSessionTransport(stringSession, useNativeTcp);

  const platform = getPlatform();
  const deviceModel =
    platform === "android"
      ? "TeleDrive Android"
      : platform === "ios"
      ? "TeleDrive iOS"
      : "TeleDrive Desktop";

  const clientParams: Record<string, any> = {
    connectionRetries: useNativeTcp || fastAttempt ? 2 : 5,
    retryDelay: useNativeTcp || fastAttempt ? 500 : 1000,
    useWSS: !useNativeTcp,
    deviceModel,
    systemVersion: "1.0.0",
    appVersion: APP_VERSION,
    langCode: "en",
    systemLangCode: "en",
  };

  if (route) {
    clientParams.networkSocket = createTauriProxySocketClass(route);
    if (route.proxyType === "mtproxy") {
      clientParams.proxy = {
        ip: route.host,
        port: route.port,
        secret: normalizeMtproxySecretForGramJs(route.secret),
        MTProxy: true,
      };
    } else {
      clientParams.connection = ConnectionTCPObfuscated;
    }
  }

  const client = new TelegramClient(stringSession, apiId, apiHash, clientParams);

  if (useNativeTcp) {
    // Route DC lookups and exported upload/download DCs to raw IPv4 endpoints over TCP
    (client as any).getDC = async (dcId: number) => {
      if (!(client as any)._config) {
        try {
          (client as any)._config = await client.invoke(new Api.help.GetConfig());
        } catch {
          // Fall back to canonical production DC map when initial config is unavailable
        }
      }
      return resolveTelegramDcEndpoint(
        dcId,
        (client as any)._config?.dcOptions,
        Boolean((client as any)._useIPV6)
      );
    };
  }

  client.setLogLevel("warn" as any);

  try {
    await client.connect();
  } catch (err) {
    try {
      await client.disconnect();
    } catch {
      /* ignore */
    }
    throw err;
  }

  return client;
}

export async function initClient(
  apiId: number,
  apiHash: string,
  sessionString: string = "",
  forceNew: boolean = false
): Promise<void> {
  const initialRoute = await resolveInitialRoute();
  const initialSig = routeSignature(initialRoute);

  // If already instantiated with the SAME credentials, session, route, and no force-new requested, reuse or reconnect
  if (
    !forceNew &&
    clientInstance &&
    activeApiId === apiId &&
    activeApiHash === apiHash &&
    activeSessionString === sessionString &&
    activeRouteSignature === initialSig
  ) {
    if (!clientInstance.connected) {
      try {
        await clientInstance.connect();
        isConnectedStatus = true;
      } catch (err) {
        logger.warn("Reconnection failed, creating fresh client with automatic fallback:", err);
      }
    }
    if (isConnectedStatus && clientInstance?.connected) {
      return;
    }
  }

  // Tear down any existing client
  if (clientInstance) {
    try {
      await clientInstance.disconnect();
    } catch {
      /* ignore */
    }
    clientInstance = null;
    isConnectedStatus = false;
    activeApiId = null;
    activeApiHash = null;
    activeSessionString = null;
    activeRouteSignature = null;
  }

  const nativeFallbackAvailable = isProxySupported();
  let connectedClient: TelegramClient | null = null;
  let usedRoute: ProxySettings | null = initialRoute;
  let primaryError: unknown;

  try {
    connectedClient = await connectWithRoute(
      apiId,
      apiHash,
      sessionString,
      initialRoute,
      nativeFallbackAvailable
    );
  } catch (err) {
    primaryError = err;
    if (!nativeFallbackAvailable) {
      throw err;
    }

    logger.warn(
      `Primary Telegram transport (${initialSig}) failed; probing fallback routes automatically:`,
      err
    );

    // 1. Discover any reachable native route in Rust (saved proxy -> Direct TCP -> OS SOCKS5 -> OS HTTP)
    const discovered = await discoverTelegramRoute();
    if (discovered && routeSignature(discovered) !== initialSig) {
      try {
        connectedClient = await connectWithRoute(apiId, apiHash, sessionString, discovered, true);
        usedRoute = discovered;
        logger.info(`Connected seamlessly via fallback route: ${discovered.proxyType}`);
      } catch (fallbackErr) {
        logger.warn(`Discovered fallback route (${discovered.proxyType}) failed to connect:`, fallbackErr);
      }
    }

    // 2. If primary wasn't WSS direct (e.g. cached proxy went offline on a new Wi-Fi), also try WSS direct
    if (!connectedClient && initialRoute !== null) {
      try {
        connectedClient = await connectWithRoute(apiId, apiHash, sessionString, null, true);
        usedRoute = null;
        logger.info("Connected seamlessly via direct WSS fallback.");
      } catch (wssErr) {
        logger.warn("Direct WSS fallback also failed:", wssErr);
      }
    }

    if (!connectedClient) {
      // Clear stale cached route so next attempt starts fresh, then surface error to caller/restoreSession
      sessionPreferredRoute = undefined;
      throw primaryError;
    }
  }

  if (nativeFallbackAvailable) {
    sessionPreferredRoute = usedRoute;
  }

  clientInstance = connectedClient;
  isConnectedStatus = true;
  activeApiId = apiId;
  activeApiHash = apiHash;
  activeSessionString = sessionString;
  activeRouteSignature = routeSignature(usedRoute);
}

/**
 * Rebuilds and reconnects the active `TelegramClient` in place (e.g. after network/Wi-Fi changes)
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
 * Ensures the client instance is connected. If the connection was dropped or the network changed,
 * attempts to reconnect — falling back across transports automatically if direct reconnect fails.
 */
export async function ensureConnected(): Promise<TelegramClient> {
  const client = getClient();
  if (!client.connected) {
    try {
      await client.connect();
      isConnectedStatus = true;
    } catch (err) {
      logger.warn("[TelegramClient] Direct reconnection failed, trying route fallback:", err);
      sessionPreferredRoute = undefined;
      try {
        await reconnectActiveClient();
        return getClient();
      } catch (fallbackErr) {
        logger.warn("[TelegramClient] Fallback reconnection attempt failed:", fallbackErr);
      }
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
  activeRouteSignature = null;
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
  activeRouteSignature = null;
  sessionPreferredRoute = undefined;
}

export function isClientConnected(): boolean {
  return isConnectedStatus && clientInstance !== null;
}
