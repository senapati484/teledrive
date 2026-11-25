import { invoke } from "@tauri-apps/api/core";
import type { StringSession } from "telegram/sessions";
import { isTauriRuntime } from "@/lib/runtime/bridge";
import { logger } from "@/lib/logger";

export type ProxyType = "mtproxy" | "socks5" | "http";

export interface ProxySettings {
  enabled: boolean;
  proxyType: ProxyType;
  host: string;
  port: number;
  secret: string;
  username: string;
  password: string;
}

export interface TestProxyResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

export interface DecodedMtproxySecret {
  secret16: Uint8Array;
  padded: boolean;
  fakeTlsDomain: string | null;
}

export const DEFAULT_PROXY_SETTINGS: ProxySettings = {
  enabled: false,
  proxyType: "mtproxy",
  host: "",
  port: 443,
  secret: "",
  username: "",
  password: "",
};

const CANONICAL_DC_IPV4: Record<number, string> = {
  1: "149.154.175.53",
  2: "149.154.167.51",
  3: "149.154.175.100",
  4: "149.154.167.91",
  5: "91.108.56.130",
};

const WEB_HOST_TO_DC: Record<string, number> = {
  pluto: 1,
  venus: 2,
  aurora: 3,
  vesta: 4,
  flora: 5,
};

const IPV4_TO_WEB_HOST: Record<string, { dcId: number; host: string }> = {
  "149.154.175.53": { dcId: 1, host: "pluto.web.telegram.org" },
  "149.154.167.51": { dcId: 2, host: "venus.web.telegram.org" },
  "149.154.175.100": { dcId: 3, host: "aurora.web.telegram.org" },
  "149.154.167.91": { dcId: 4, host: "vesta.web.telegram.org" },
  "91.108.56.130": { dcId: 5, host: "flora.web.telegram.org" },
};

type ProxyChangeListener = (settings: ProxySettings) => void;
const listeners = new Set<ProxyChangeListener>();
let cachedSettings: ProxySettings | null = null;

export function isProxySupported(): boolean {
  return isTauriRuntime();
}

export function subscribeProxySettings(listener: ProxyChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyProxyListeners(settings: ProxySettings): void {
  cachedSettings = settings;
  for (const listener of listeners) {
    try {
      listener(settings);
    } catch (err) {
      logger.warn("Proxy settings listener failed:", err);
    }
  }
}

function decodeHexBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function decodeBase64Flexible(input: string): Uint8Array | null {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]+=*$/.test(normalized)) {
    return null;
  }
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLen);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Decodes and validates an MTProxy secret across hex and base64url formats,
 * supporting standard (16B), random-padding (`dd...`), and Fake-TLS (`ee...` + domain).
 */
export function decodeMtproxySecret(rawSecret: string): DecodedMtproxySecret {
  const trimmed = rawSecret.trim();
  if (!trimmed) {
    throw new Error("MTProxy secret is required.");
  }

  let bytes: Uint8Array | null = null;
  if (trimmed.length >= 32 && trimmed.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(trimmed)) {
    bytes = decodeHexBytes(trimmed);
  } else {
    bytes = decodeBase64Flexible(trimmed);
  }

  if (!bytes) {
    throw new Error(
      "Invalid MTProxy secret: expected 32 hex chars (standard), 34 chars starting with dd, or ee + secret + domain (Fake-TLS)."
    );
  }

  if (bytes.length === 16) {
    return { secret16: bytes, padded: false, fakeTlsDomain: null };
  }

  if (bytes.length === 17 && bytes[0] === 0xdd) {
    return { secret16: bytes.slice(1, 17), padded: true, fakeTlsDomain: null };
  }

  if (bytes.length >= 18 && bytes[0] === 0xee) {
    const domain = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes.slice(17))
      .replace(/\0+$/, "");
    if (!domain || domain.length > 253 || /[\s\x00-\x1f]/.test(domain)) {
      throw new Error("Invalid MTProxy Fake-TLS secret: SNI domain is empty or malformed.");
    }
    return { secret16: bytes.slice(1, 17), padded: true, fakeTlsDomain: domain };
  }

  throw new Error(
    "Invalid MTProxy secret: expected 32 hex chars (standard), 34 chars starting with dd, or ee + secret + domain (Fake-TLS)."
  );
}

/**
 * Converts any valid MTProxy secret (including `ee...` Fake-TLS) into the 16- or 17-byte
 * `dd...` hex form understood by GramJS's `TCPMTProxy` layer while Rust handles TLS wrapping.
 */
export function normalizeMtproxySecretForGramJs(rawSecret: string): string {
  const decoded = decodeMtproxySecret(rawSecret);
  const hex16 = toHex(decoded.secret16);
  return decoded.padded ? `dd${hex16}` : hex16;
}

export function validateProxySettings(settings: ProxySettings): string | null {
  const host = settings.host.trim();
  if (!host) {
    return "Proxy host is required.";
  }
  if (/[\s\x00-\x1f]/.test(host)) {
    return "Proxy host cannot contain spaces or control characters.";
  }
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) {
    return "Proxy port must be between 1 and 65535.";
  }
  if (settings.proxyType === "mtproxy") {
    try {
      decodeMtproxySecret(settings.secret);
    } catch (err) {
      return err instanceof Error ? err.message : "Invalid MTProxy secret.";
    }
  }
  return null;
}

/**
 * Parses `tg://proxy`, `https://t.me/proxy`, `tg://socks`, `https://t.me/socks`,
 * `socks5://`, or `http://` proxy URLs into structured `ProxySettings` fields.
 */
export function parseProxyLink(rawInput: string): Partial<ProxySettings> {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error("Paste a proxy link to import.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Invalid proxy link URL format.");
  }

  const proto = url.protocol.toLowerCase();
  const hostOrPath = (url.hostname || url.pathname.replace(/^\/+/, "")).toLowerCase();
  const params = url.searchParams;

  // Telegram MTProxy: tg://proxy?server=...&port=...&secret=... or https://t.me/proxy?...
  const isTgMtproxy =
    (proto === "tg:" && hostOrPath === "proxy") ||
    ((proto === "https:" || proto === "http:") &&
      (url.hostname.toLowerCase() === "t.me" || url.hostname.toLowerCase() === "telegram.me") &&
      url.pathname.toLowerCase().replace(/^\/+/, "").startsWith("proxy"));

  if (isTgMtproxy) {
    const server = params.get("server")?.trim() || "";
    const portStr = params.get("port")?.trim() || "443";
    const secret = params.get("secret")?.trim() || "";
    const port = Number(portStr);
    if (!server || !secret || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("MTProxy link must include valid server, port, and secret parameters.");
    }
    decodeMtproxySecret(secret);
    return {
      proxyType: "mtproxy",
      host: server,
      port,
      secret,
      username: "",
      password: "",
    };
  }

  // Telegram SOCKS5: tg://socks?server=...&port=...&user=...&pass=...
  const isTgSocks =
    (proto === "tg:" && hostOrPath === "socks") ||
    ((proto === "https:" || proto === "http:") &&
      (url.hostname.toLowerCase() === "t.me" || url.hostname.toLowerCase() === "telegram.me") &&
      url.pathname.toLowerCase().replace(/^\/+/, "").startsWith("socks"));

  if (isTgSocks) {
    const server = params.get("server")?.trim() || "";
    const portStr = params.get("port")?.trim() || "1080";
    const port = Number(portStr);
    if (!server || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("SOCKS link must include valid server and port parameters.");
    }
    return {
      proxyType: "socks5",
      host: server,
      port,
      secret: "",
      username: params.get("user") || "",
      password: params.get("pass") || "",
    };
  }

  // Standard socks5:// / socks:// / http:// / https:// URLs
  if (proto === "socks5:" || proto === "socks5h:" || proto === "socks:") {
    const port = url.port ? Number(url.port) : 1080;
    if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Invalid SOCKS5 proxy URL.");
    }
    return {
      proxyType: "socks5",
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port,
      secret: "",
      username: decodeURIComponent(url.username || ""),
      password: decodeURIComponent(url.password || ""),
    };
  }

  if (proto === "http:" || proto === "https:") {
    const port = url.port ? Number(url.port) : proto === "https:" ? 443 : 8080;
    if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Invalid HTTP proxy URL.");
    }
    return {
      proxyType: "http",
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port,
      secret: "",
      username: decodeURIComponent(url.username || ""),
      password: decodeURIComponent(url.password || ""),
    };
  }

  throw new Error(
    "Unsupported link format. Supported formats: tg://proxy, t.me/proxy, tg://socks, socks5://, or http://."
  );
}

/** Resolves canonical production Telegram DC IPv4 endpoint for native TCP/proxy sockets. */
export function resolveTelegramDcEndpoint(
  dcId: number,
  dcOptions?: Array<{ id: number; ipv6?: boolean; ipAddress: string; port?: number }>,
  useIpv6: boolean = false
): { id: number; ipAddress: string; port: number } {
  if (dcOptions && dcOptions.length > 0) {
    const exact = dcOptions.find((dc) => dc.id === dcId && Boolean(dc.ipv6) === useIpv6);
    if (exact) {
      return { id: exact.id, ipAddress: exact.ipAddress, port: 443 };
    }
  }
  const canonicalIp = CANONICAL_DC_IPV4[dcId];
  if (canonicalIp) {
    return { id: dcId, ipAddress: canonicalIp, port: 443 };
  }
  throw new Error(`Cannot resolve Telegram DC ${dcId} IP address.`);
}

/**
 * Rewrites a `StringSession`'s DC host & port without touching its `authKey` so
 * switching between WebSocket Direct mode and native TCP Proxy mode never triggers
 * TLS hostname mismatches or loss of the authenticated session.
 */
export function normalizeStringSessionTransport(
  session: StringSession,
  useProxy: boolean
): void {
  const currentAddr = (session.serverAddress || "").trim().toLowerCase();
  const currentDcId = session.dcId || 4;

  if (useProxy) {
    if (!currentAddr) {
      session.setDC(4, CANONICAL_DC_IPV4[4], 443);
      return;
    }
    if (currentAddr.endsWith(".web.telegram.org")) {
      const prefix = currentAddr.split(".")[0].replace(/-1$/, "");
      const mappedDcId = WEB_HOST_TO_DC[prefix] ?? currentDcId;
      const ipv4 = CANONICAL_DC_IPV4[mappedDcId] ?? CANONICAL_DC_IPV4[4];
      session.setDC(mappedDcId, ipv4, 443);
      return;
    }
    if (session.port !== 443) {
      session.setDC(currentDcId, session.serverAddress || CANONICAL_DC_IPV4[currentDcId] || CANONICAL_DC_IPV4[4], 443);
    }
    return;
  }

  // Switching back to Direct WSS mode: restore *.web.telegram.org if session held a raw IPv4 IP
  const mappedWeb = IPV4_TO_WEB_HOST[currentAddr];
  if (mappedWeb) {
    session.setDC(mappedWeb.dcId, mappedWeb.host, 443);
  }
}

export async function getProxySettings(): Promise<ProxySettings> {
  if (!isProxySupported()) {
    return { ...DEFAULT_PROXY_SETTINGS };
  }
  const settings = await invoke<ProxySettings>("get_proxy_settings");
  cachedSettings = settings;
  return settings;
}

export function getCachedProxySettings(): ProxySettings | null {
  return cachedSettings;
}

export async function saveProxySettings(settings: ProxySettings): Promise<ProxySettings> {
  if (!isProxySupported()) {
    throw new Error("Custom proxy settings are only supported in the native TeleDrive app.");
  }
  const saved = await invoke<ProxySettings>("save_proxy_settings", { settings });
  notifyProxyListeners(saved);
  return saved;
}

export async function testProxyConnection(settings: ProxySettings): Promise<TestProxyResult> {
  if (!isProxySupported()) {
    return {
      ok: false,
      latencyMs: 0,
      message: "Proxy testing is only available in the native TeleDrive app.",
    };
  }
  return invoke<TestProxyResult>("test_proxy_connection", { settings });
}
