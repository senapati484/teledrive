import { WebdavError, normalizeVirtualPath } from "./protocol";

/**
 * Wire contract between the Rust socket (`src-tauri/src/webdav.rs`) and this
 * frontend bridge. Rust emits `teledrive://webdav-request` with a payload that
 * flattens a `BridgeRequest` plus an `id`; the handler replies through the
 * `webdav_bridge_response` command with `{ id, response: WebdavBridgeResponse }`.
 */

export interface WebdavBridgeRequest {
  id: number;
  method: string;
  /** Percent-decoded, normalized virtual path starting with `/`. */
  path: string;
  depth?: string;
  destination?: string;
  overwrite?: string;
  lockToken?: string;
  ifHeader?: string;
  timeout?: string;
  range?: string;
  contentType?: string;
  contentLength?: number;
  /** Temp file holding the PUT request body. */
  bodyPath?: string;
  /** Temp path the handler writes GET bytes to. */
  outputPath?: string;
}

export interface WebdavBridgeResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  bodyPath?: string;
}

function readString(
  raw: Record<string, unknown>,
  key: string,
  options: { optional?: boolean } = {}
): string | undefined {
  const value = raw[key];
  if (value === undefined || value === null) {
    if (options.optional) return undefined;
    throw new WebdavError(400, `Missing bridge field "${key}"`);
  }
  if (typeof value !== "string") {
    throw new WebdavError(400, `Bridge field "${key}" must be a string`);
  }
  return value;
}

/**
 * Validates an event payload before the handler touches the catalog. Unknown
 * fields are ignored; the required shape is intentionally strict so a Rust
 * regression fails loudly in tests instead of silently serving wrong paths.
 */
export function parseBridgeRequest(raw: unknown): WebdavBridgeRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new WebdavError(400, "Invalid bridge request payload");
  }
  const object = raw as Record<string, unknown>;
  const id = object.id;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new WebdavError(400, "Bridge request id must be a positive integer");
  }
  const method = readString(object, "method")!.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(method)) {
    throw new WebdavError(400, "Malformed bridge method");
  }
  const path = normalizeVirtualPath(readString(object, "path")!);
  const destinationRaw = readString(object, "destination", { optional: true });
  const destination =
    destinationRaw === undefined ? undefined : normalizeVirtualPath(destinationRaw);

  let contentLength: number | undefined;
  if (object.contentLength !== undefined && object.contentLength !== null) {
    if (
      typeof object.contentLength !== "number" ||
      !Number.isFinite(object.contentLength) ||
      object.contentLength < 0
    ) {
      throw new WebdavError(400, "Bridge contentLength must be a non-negative number");
    }
    contentLength = object.contentLength;
  }

  return {
    id,
    method,
    path,
    depth: readString(object, "depth", { optional: true }),
    destination,
    overwrite: readString(object, "overwrite", { optional: true }),
    lockToken: readString(object, "lockToken", { optional: true }),
    ifHeader: readString(object, "ifHeader", { optional: true }),
    timeout: readString(object, "timeout", { optional: true }),
    range: readString(object, "range", { optional: true }),
    contentType: readString(object, "contentType", { optional: true }),
    contentLength,
    bodyPath: readString(object, "bodyPath", { optional: true }),
    outputPath: readString(object, "outputPath", { optional: true }),
  };
}

/** Clamps a response into the HTTP status range Rust can serialize. */
export function normalizeBridgeResponse(
  response: WebdavBridgeResponse
): WebdavBridgeResponse {
  const status =
    Number.isInteger(response.status) && response.status >= 200 && response.status <= 599
      ? response.status
      : 500;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers ?? {})) {
    if (typeof value !== "string") continue;
    if (!name || /[\r\n]/.test(name) || /[\r\n]/.test(value)) continue;
    headers[name] = value;
  }
  return {
    status,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(typeof response.body === "string" ? { body: response.body } : {}),
    ...(typeof response.bodyPath === "string" ? { bodyPath: response.bodyPath } : {}),
  };
}
