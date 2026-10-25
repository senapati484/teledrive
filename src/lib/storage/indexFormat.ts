import { gzipSync, gunzipSync, strFromU8, strToU8 } from "fflate";
import type { TeleFile } from "../types";
import { normalizeFolderPath } from "../utils";

export const INDEX_VERSION = 3;
export const TELEGRAM_TEXT_LIMIT = 4096;
export const CHUNK_TEXT_TARGET = 3900;
export const CHUNK_FILE_CAP = 60;
const COMPRESSED_PREFIX = "teledrive_index gz:";
const BASE64_CHUNK = 0x8000;
export const MAX_MANIFEST_BUDGET = 2400;
export const MANIFEST_OMIT_ESTIMATE = 3000;

export interface IndexChunkPayload {
  teledrive_index: true;
  version: number;
  chunkIndex: number;
  totalChunks: number;
  savedAt?: number;
  chunkMsgIds?: number[];
  files: TeleFile[];
}

export interface ParsedIndexChunk {
  msgId: number;
  version: number;
  chunkIndex: number;
  totalChunks: number;
  savedAt?: number;
  chunkMsgIds?: number[];
  files: TeleFile[];
  editedAt: number;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function toMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value > 1e12 ? value : value * 1000;
  }
  return 0;
}

function messageTimestampMs(msg: any): number {
  const edited = toMs(msg?.editDate);
  if (edited > 0) return edited;
  return toMs(msg?.date);
}

export function isFolderMime(mime: string | undefined): boolean {
  return mime === "inode/directory" || mime === "application/x-directory";
}

export function encodeChunkIds(ids: number[]): string {
  if (ids.length === 0) return "";
  if (!ids.every(isPositiveInt)) {
    throw new Error("chunk ids must be positive integers");
  }
  const parts: string[] = [ids[0].toString(36)];
  for (let i = 1; i < ids.length; i++) {
    const delta = ids[i] - ids[i - 1];
    const magnitude = Math.abs(delta).toString(36);
    parts.push(delta < 0 ? `-${magnitude}` : magnitude);
  }
  return parts.join(",");
}

export function decodeChunkIds(encoded: string): number[] {
  if (encoded === "") return [];
  if (typeof encoded !== "string") {
    throw new Error("chunk ids encoding must be a string");
  }
  const parts = encoded.split(",");
  if (parts.some((part) => part.length === 0)) {
    throw new Error("chunk ids encoding has an empty segment");
  }

  const first = parts[0];
  if (!/^[0-9a-z]+$/i.test(first)) {
    throw new Error("chunk ids encoding has an invalid first id");
  }
  let current = parseInt(first, 36);
  if (!isPositiveInt(current)) {
    throw new Error("chunk ids encoding has a non-positive first id");
  }
  const ids: number[] = [current];

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const negative = part.startsWith("-");
    const digits = negative ? part.slice(1) : part;
    if (!digits || !/^[0-9a-z]+$/i.test(digits)) {
      throw new Error("chunk ids encoding has an invalid delta");
    }
    const delta = parseInt(digits, 36) * (negative ? -1 : 1);
    current += delta;
    if (!isPositiveInt(current)) {
      throw new Error("chunk ids encoding resolves to a non-positive id");
    }
    ids.push(current);
  }
  return ids;
}

export function isValidManifest(chunk: ParsedIndexChunk): boolean {
  if (chunk.chunkIndex !== 0) return false;
  if (!Array.isArray(chunk.chunkMsgIds)) return false;
  if (chunk.chunkMsgIds.length !== chunk.totalChunks - 1) return false;
  if (!chunk.chunkMsgIds.every(isPositiveInt)) return false;
  if (new Set(chunk.chunkMsgIds).size !== chunk.chunkMsgIds.length) return false;
  return true;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Telegram charges one message per 4096-char chunk. Large libraries with long
 * backup paths used to need 40+ messages, which immediately hit FLOOD_WAIT.
 * gzip + base64 keeps the same JSON payload but packs far more files into each
 * Telegram message, so a 500-file index is ~8-10 messages instead of 47.
 */
export function serializeChunk(chunk: IndexChunkPayload): string {
  const json = JSON.stringify(chunk);
  const compressed = gzipSync(strToU8(json), { level: 6 });
  return COMPRESSED_PREFIX + bytesToBase64(compressed);
}

function decodeChunkText(text: string): any {
  if (text.startsWith(COMPRESSED_PREFIX)) {
    const bytes = base64ToBytes(text.slice(COMPRESSED_PREFIX.length));
    return JSON.parse(strFromU8(gunzipSync(bytes)));
  }
  return JSON.parse(text);
}

export function parseIndexMessage(msg: any): ParsedIndexChunk | null {
  const text = msg?.text ?? msg?.message;
  if (typeof text !== "string" || !text.includes("teledrive_index")) return null;

  let data: any;
  try {
    data = decodeChunkText(text);
  } catch {
    return null;
  }

  if (!data || data.teledrive_index !== true) return null;

  const chunkIndex = data.chunkIndex;
  const totalChunks = data.totalChunks;
  if (
    !Number.isInteger(chunkIndex) ||
    !Number.isInteger(totalChunks) ||
    totalChunks <= 0 ||
    chunkIndex < 0 ||
    chunkIndex >= totalChunks
  ) {
    return null;
  }
  if (!Array.isArray(data.files)) return null;

  const msgId = Number(msg?.id);
  if (!Number.isFinite(msgId) || msgId <= 0) return null;

  const files = (data.files as TeleFile[])
    .filter((f) => f && typeof f.id === "string" && f.id.length > 0)
    .map((f) => ({ ...f, folderPath: normalizeFolderPath(f.folderPath) }));

  let chunkMsgIds: number[] | undefined;
  if (Array.isArray(data.chunkMsgIds)) {
    const ids = data.chunkMsgIds.filter(isPositiveInt);
    if (ids.length === data.chunkMsgIds.length) chunkMsgIds = ids;
  }

  const savedAt =
    typeof data.savedAt === "number" && Number.isFinite(data.savedAt) && data.savedAt > 0
      ? data.savedAt
      : undefined;

  const version =
    typeof data.version === "number" && Number.isFinite(data.version) ? data.version : 1;

  return {
    msgId,
    version,
    chunkIndex,
    totalChunks,
    savedAt,
    chunkMsgIds,
    files,
    editedAt: messageTimestampMs(msg),
  };
}

export function epochTimestamp(chunks: ParsedIndexChunk[]): number {
  let saved = 0;
  let edited = 0;
  for (const chunk of chunks) {
    if (chunk.savedAt && chunk.savedAt > saved) saved = chunk.savedAt;
    if (chunk.editedAt > edited) edited = chunk.editedAt;
  }
  return saved > 0 ? saved : edited;
}

export function manifestBudget(totalChunks: number): number {
  return Math.min(MAX_MANIFEST_BUDGET, 24 + 12 * Math.max(1, totalChunks));
}

function serializedChunkLength(files: TeleFile[]): number {
  return serializeChunk({
    teledrive_index: true,
    version: INDEX_VERSION,
    chunkIndex: 1,
    totalChunks: 99,
    savedAt: 1,
    files,
  }).length;
}

function fileChars(file: TeleFile): number {
  return JSON.stringify(file).length + 2;
}

function packRaw(files: TeleFile[], rawLimit: number): TeleFile[][] {
  if (files.length === 0) return [[]];
  const chunks: TeleFile[][] = [];
  let current: TeleFile[] = [];
  let chars = 120;
  for (const file of files) {
    const len = fileChars(file);
    if (
      current.length > 0 &&
      (chars + len > rawLimit || current.length >= CHUNK_FILE_CAP)
    ) {
      chunks.push(current);
      current = [];
      chars = 120;
    }
    current.push(file);
    chars += len;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function splitToSerializedLimit(
  files: TeleFile[],
  limit: number
): TeleFile[][] {
  if (files.length <= 1 || serializedChunkLength(files) <= limit) {
    return [files];
  }
  const mid = Math.ceil(files.length / 2);
  return [
    ...splitToSerializedLimit(files.slice(0, mid), limit),
    ...splitToSerializedLimit(files.slice(mid), limit),
  ];
}

function packWithFirstBudget(files: TeleFile[], firstLimit: number): TeleFile[][] {
  if (files.length === 0) return [[]];
  const raw = packRaw(files, 40_000);
  const chunks: TeleFile[][] = [];
  raw.forEach((chunk, i) => {
    chunks.push(
      ...splitToSerializedLimit(
        chunk,
        i === 0 ? firstLimit : TELEGRAM_TEXT_LIMIT - 24
      )
    );
  });
  return chunks;
}

function estimateChunkCount(files: TeleFile[]): number {
  return packWithFirstBudget(files, TELEGRAM_TEXT_LIMIT - 24).length;
}

export function packChunks(files: TeleFile[]): {
  chunks: TeleFile[][];
  manifestOmitted: boolean;
} {
  if (files.length === 0) {
    return { chunks: [[]], manifestOmitted: false };
  }

  let totalChunks = Math.max(1, estimateChunkCount(files));
  let chunks = packWithFirstBudget(files, TELEGRAM_TEXT_LIMIT - 24);

  for (let attempt = 0; attempt < 6; attempt++) {
    const budget = manifestBudget(totalChunks);
    const firstBudget = Math.max(400, 3600 - budget);
    const candidate = packWithFirstBudget(files, firstBudget);
    chunks = candidate;
    if (candidate.length === totalChunks) break;
    totalChunks = candidate.length;
  }

  const manifestOmitted =
    chunks.length > 300 || 24 + 4 * chunks.length > MANIFEST_OMIT_ESTIMATE;
  return { chunks, manifestOmitted };
}
