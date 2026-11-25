import type { TeleFile } from "../types";

/**
 * WebDAV protocol helpers shared by the bridge handler and its tests.
 * Everything here is pure: no Tauri, Telegram, or store access.
 */

export interface WebdavErrorOptions {
  /** Adds `Retry-After` to the HTTP response. */
  retryAfterSeconds?: number;
  /**
   * Set when a catalog commit exceeded the server-side deadline but is still
   * queued. `true` means committed, `false` means it failed later.
   */
  commitOutcome?: Promise<boolean>;
}

export class WebdavError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;
  readonly commitOutcome?: Promise<boolean>;

  constructor(status: number, message: string, options: WebdavErrorOptions = {}) {
    super(message);
    this.name = "WebdavError";
    this.status = status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.commitOutcome = options.commitOutcome;
  }
}

export class WebdavPathError extends WebdavError {
  constructor(message = "Invalid WebDAV path") {
    super(400, message);
    this.name = "WebdavPathError";
  }
}

/** Normalizes a decoded virtual path. Rejects traversal and control bytes. */
export function normalizeVirtualPath(input: string): string {
  if (typeof input !== "string") throw new WebdavPathError();
  if (input.includes("\0")) throw new WebdavPathError();
  let decoderFree = input;
  if (decoderFree === "") return "/";
  if (/[\u0001-\u001f\u007f]/.test(decoderFree)) throw new WebdavPathError();
  const segments: string[] = [];
  for (const segment of decoderFree.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") throw new WebdavPathError("Path traversal is not allowed");
    segments.push(segment);
  }
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

export function pathSegments(path: string): string[] {
  return normalizeVirtualPath(path).split("/").filter(Boolean);
}

export function basename(path: string): string {
  const segments = pathSegments(path);
  return segments.length === 0 ? "" : segments[segments.length - 1];
}

export function dirname(path: string): string {
  const segments = pathSegments(path);
  if (segments.length <= 1) return "/";
  return `/${segments.slice(0, -1).join("/")}`;
}

export function joinVirtualPath(parent: string, name: string): string {
  const base = normalizeVirtualPath(parent);
  const clean = name.replace(/^\/+|\/+$/g, "");
  if (!clean) return base;
  return base === "/" ? `/${clean}` : `${base}/${clean}`;
}

/** True when `child` is `parent` or lives below it. */
export function isWithinPath(child: string, parent: string): boolean {
  if (parent === "/") return true;
  return child === parent || child.startsWith(`${parent}/`);
}

/** Percent-encodes a virtual path for use inside a `<D:href>` element. */
export function encodeHref(path: string, isCollection: boolean): string {
  const normalized = normalizeVirtualPath(path);
  const encoded = normalized
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const href = encoded === "" ? "/" : encoded;
  return isCollection && !href.endsWith("/") ? `${href}/` : href;
}

export type ParsedRange =
  | { start: number; end: number }
  | "unsatisfiable"
  | null;

/**
 * Parses a single HTTP `Range` header. Returns `null` when the header is
 * absent/invalid or requests multiple ranges (the caller then serves the full
 * representation, which RFC 9110 permits), `"unsatisfiable"` for 416, or the
 * inclusive byte range.
 */
export function parseRangeHeader(
  header: string | null | undefined,
  size: number
): ParsedRange {
  if (!header) return null;
  const value = header.trim();
  if (!/^bytes\s*=/i.test(value)) return null;
  const spec = value.replace(/^bytes\s*=/i, "").trim();
  if (!spec || spec.includes(",")) return null;
  if (!Number.isFinite(size) || size < 0) return null;

  const dash = spec.indexOf("-");
  if (dash === -1) return null;
  const startText = spec.slice(0, dash).trim();
  const endText = spec.slice(dash + 1).trim();

  if (startText === "") {
    if (endText === "" || !/^\d+$/.test(endText)) return null;
    if (size === 0) return "unsatisfiable";
    const suffix = Number(endText);
    if (suffix <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  if (!/^\d+$/.test(startText)) return null;
  const start = Number(startText);
  if (size === 0 || start >= size) return "unsatisfiable";

  if (endText === "") return { start, end: size - 1 };
  if (!/^\d+$/.test(endText)) return null;
  const endRaw = Number(endText);
  if (endRaw < start) return null;
  return { start, end: Math.min(endRaw, size - 1) };
}

/** RFC 7231 IMF-fixdate. */
export function formatHttpDate(ms: number): string {
  const value = Number.isFinite(ms) && ms > 0 ? ms : Date.now();
  return new Date(value).toUTCString();
}

export function etagForFile(file: TeleFile): string {
  const marker = file.hash ? file.hash : `m${file.messageId}`;
  return `"${marker}-${file.size}"`;
}

export function etagForFolder(folder: Pick<TeleFile, "id" | "uploadedAt">): string {
  return `"d${folder.id}-${folder.uploadedAt || 0}"`;
}

export function parseTimeoutHeader(
  raw: string | null | undefined,
  fallbackSeconds = 600,
  maxSeconds = 3600
): number {
  if (!raw) return fallbackSeconds;
  const first = raw.split(",")[0]?.trim() ?? "";
  if (/^infinite$/i.test(first)) return maxSeconds;
  const match = /^second-(\d+)$/i.exec(first);
  if (!match) return fallbackSeconds;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallbackSeconds;
  return Math.min(maxSeconds, Math.max(1, Math.floor(seconds)));
}

/** Extracts every `<...>` token from an If / Lock-Token header. */
export function extractLockTokens(header: string | null | undefined): string[] {
  if (!header) return [];
  const tokens: string[] = [];
  const matches = header.matchAll(/<([^>]*)>/g);
  for (const match of matches) {
    const token = match[1]?.trim();
    if (token) tokens.push(token);
  }
  return tokens;
}

export function escapeXml(value: string): string {
  // Only the three characters that are illegal in element text. Values are
  // never interpolated into XML attributes, so quotes stay readable (ETags).
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** XML 1.0 forbids most C0 controls; strip them from client-supplied text. */
export function sanitizeXmlText(value: string, maxLength = 512): string {
  const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}
