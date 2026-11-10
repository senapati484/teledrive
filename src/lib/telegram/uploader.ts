import { Api } from "telegram";
import { getClient } from "./client";
import { canonicalChannelId } from "./peerId";
// NOTE: we deliberately do NOT import @tauri-apps/plugin-fs here. Its
// `open()` is gated by capability scopes (`fs:allow-open` etc.) — those
// scopes are baked at build time and can't accept the user's arbitrary
// backup source folders. For file-path inputs we read chunks via a Rust
// command (`read_file_chunk`) which has full filesystem access because
// Tauri Rust commands are not subject to the JS plugin-fs scope.
import bigInt from "big-integer";
import { Buffer } from "buffer";
import { invoke } from "@tauri-apps/api/core";
import { withTimeout } from "../storage/metadataStore";
import { withTelegramRetry } from "./rateLimit";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import i18n from "@/i18n";

export const UPLOAD_CHUNK_SIZE = 512 * 1024; // 512 KiB recommended chunk size for Telegram
export const FREE_MAX_FILE_PARTS = 4000; // ~2,000 MiB (1.95 GiB) Telegram non-Premium cap
export const PREMIUM_MAX_FILE_PARTS = 8000; // ~4,000 MiB (3.91 GiB) Telegram Premium cap
export const DEFAULT_BIG_PART_CONCURRENCY = 3;

const CHUNK_SIZE = UPLOAD_CHUNK_SIZE;
const CHUNK_TIMEOUT_MS = 20_000;
const SENDFILE_TIMEOUT_MS = 90_000;
const PREMIUM_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedPremium: { isPremium: boolean | null; checkedAt: number } | null = null;

export function resetCachedPremiumStatus(): void {
  cachedPremium = null;
}

export type UploadSizeValidation =
  | { ok: true; totalParts: number; isBig: boolean }
  | {
      ok: false;
      reason: "empty" | "exceeds_free_limit" | "exceeds_premium_limit";
      totalParts: number;
      maxBytes: number;
    };

/**
 * Validates file size against Telegram's MTProto single-file part limits
 * (4,000 × 512 KiB parts for standard accounts, 8,000 × 512 KiB parts for Premium).
 * When `isPremium === null` (account status could not be determined), 2–4 GiB files
 * are allowed to attempt upload rather than being false-rejected.
 */
export function validateUploadSizeForAccount(
  fileSize: number,
  isPremium: boolean | null
): UploadSizeValidation {
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return { ok: false, reason: "empty", totalParts: 0, maxBytes: 0 };
  }
  const totalParts = Math.ceil(fileSize / UPLOAD_CHUNK_SIZE);
  if (totalParts > PREMIUM_MAX_FILE_PARTS) {
    return {
      ok: false,
      reason: "exceeds_premium_limit",
      totalParts,
      maxBytes: PREMIUM_MAX_FILE_PARTS * UPLOAD_CHUNK_SIZE,
    };
  }
  if (isPremium === false && totalParts > FREE_MAX_FILE_PARTS) {
    return {
      ok: false,
      reason: "exceeds_free_limit",
      totalParts,
      maxBytes: FREE_MAX_FILE_PARTS * UPLOAD_CHUNK_SIZE,
    };
  }
  return {
    ok: true,
    totalParts,
    isBig: fileSize > 10 * 1024 * 1024,
  };
}

/**
 * Queries Telegram for the signed-in account's Premium status (cached 5 min).
 * Returns `null` if offline or if the mocked client lacks `getMe()`.
 */
export async function detectAccountIsPremium(): Promise<boolean | null> {
  const now = Date.now();
  if (cachedPremium && now - cachedPremium.checkedAt < PREMIUM_CACHE_TTL_MS) {
    return cachedPremium.isPremium;
  }
  try {
    const client = getClient() as any;
    if (typeof client?.getMe !== "function") {
      return null;
    }
    const me = await client.getMe();
    const isPremium = typeof me?.premium === "boolean" ? me.premium : null;
    cachedPremium = { isPremium, checkedAt: now };
    return isPremium;
  } catch {
    return null;
  }
}

async function readUploadChunk(
  filePathOrFile: string | File,
  isPathInput: boolean,
  start: number,
  end: number
): Promise<Uint8Array> {
  if (isPathInput) {
    // Read the chunk via the Rust command. This bypasses the JS
    // plugin-fs scope restrictions (capability files) which would
    // otherwise reject arbitrary user-picked backup source folders.
    // The Rust side has full filesystem access; we just stream the
    // requested byte range back as a Vec<u8>.
    const rawRes = await invoke<ArrayBuffer | Uint8Array | number[]>("read_file_chunk", {
      path: filePathOrFile as string,
      offset: start,
      length: end - start,
    });
    if (rawRes instanceof Uint8Array) {
      return rawRes;
    }
    return new Uint8Array(rawRes);
  }
  // Read chunk from HTML File object (regular user upload path —
  // file is in the browser's File API, no Rust needed).
  const blobSlice = (filePathOrFile as File).slice(start, end);
  return new Uint8Array(await blobSlice.arrayBuffer());
}

function buildTelegramThumbFile(thumbBytes: Uint8Array): File | Buffer {
  if (typeof File !== "undefined") {
    const copy = new Uint8Array(thumbBytes.length);
    copy.set(thumbBytes);
    return new File([copy.buffer], "thumb.jpg", { type: "image/jpeg" });
  }
  const buf = Buffer.from(thumbBytes);
  return Object.assign(buf, { name: "thumb.jpg" });
}

interface UploadProgressCallback {
  (uploadedBytes: number, totalBytes: number): void;
}

export interface HashedUploadResult {
  message: any;
  hash: string | null;
}

/**
 * Distinguish the hashed wrapper from a raw GramJS message. Regular callers
 * still receive the message object unchanged.
 */
export function isHashedUploadResult(value: unknown): value is HashedUploadResult {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    "message" in (value as Record<string, unknown>) &&
    "hash" in (value as Record<string, unknown>)
  );
}

/**
 * Optional callback fired when a chunk or the finalize step is about
 * to be retried. The backup runner wires this to the progress store
 * so the user sees "Retrying 3/5 — waiting 30s" in the overlay
 * instead of a frozen counter. Optional because the regular upload
 * path doesn't have a progress store equivalent.
 */
export type UploadRetryCallback = (event: {
  attempt: number;
  maxAttempts: number;
  waitMs: number;
  floodSeconds: number | null;
  label: string;
  error: any;
}) => void;

/**
 * Uploads a file (either from local native path or browser File object) to Telegram storage channel.
 * Returns the message object representing the uploaded file document.
 */
export async function uploadFileToTelegram(
  channelId: string,
  fileName: string,
  fileSize: number,
  filePathOrFile: string | File,
  folderPath: string = "/",
  onProgress?: UploadProgressCallback,
  onRetry?: UploadRetryCallback,
  hash = false,
  thumbBytes?: Uint8Array | null,
): Promise<any> {
  if (fileSize <= 0) {
    throw new Error(`Cannot upload 0-byte file "${fileName}": Telegram MTProto requires at least 1 byte.`);
  }

  const rawValidation = validateUploadSizeForAccount(fileSize, null);
  if (!rawValidation.ok) {
    throw new Error(
      i18n.t("messages:upload.exceedsPremiumLimit", {
        name: fileName,
        defaultValue: `"${fileName}" exceeds Telegram's ~4 GB single-file limit.`,
      })
    );
  }
  if (rawValidation.totalParts > FREE_MAX_FILE_PARTS) {
    const isPremium = await detectAccountIsPremium();
    const accountValidation = validateUploadSizeForAccount(fileSize, isPremium);
    if (!accountValidation.ok) {
      throw new Error(
        i18n.t("messages:upload.exceedsFreeLimit", {
          name: fileName,
          defaultValue: `"${fileName}" exceeds Telegram's ~2 GB upload limit for standard accounts (Telegram Premium supports up to ~4 GB).`,
        })
      );
    }
  }

  const client = getClient();

  let hasher: ReturnType<typeof sha256.create> | null = null;
  if (hash) {
    try {
      hasher = sha256.create();
    } catch (err) {
      console.warn("[uploader] SHA-256 init failed; uploading without hash:", err);
    }
  }

  // Setup file ID using bigInt which is required by GramJS API
  const fileId = bigInt(Math.floor(Math.random() * 1e15));

  const isBig = rawValidation.isBig;
  const totalParts = rawValidation.totalParts;
  const isPathInput = typeof filePathOrFile === "string";

  // Read & hash chunks sequentially (so SHA-256 is deterministic and only ~1.5 MiB
  // sits in flight), while pipelining up to 3 concurrent SaveBigFilePart RPCs for
  // multi-10MB files. Automatically steps down to 1 if Telegram reports FLOOD_WAIT.
  let partConcurrency = isBig ? DEFAULT_BIG_PART_CONCURRENCY : 1;
  let uploadedBytes = 0;
  let abortedError: any = null;
  const inFlight = new Set<Promise<void>>();

  const uploadSinglePart = async (partIndex: number, chunkBytes: Uint8Array) => {
    const chunkLabel = `${isBig ? "SaveBigFilePart" : "SaveFilePart"}(${partIndex}/${totalParts})`;
    await withTelegramRetry(
      () =>
        withTimeout(
          isBig
            ? client.invoke(
                new Api.upload.SaveBigFilePart({
                  fileId,
                  filePart: partIndex,
                  fileTotalParts: totalParts,
                  bytes: Buffer.from(chunkBytes),
                })
              )
            : client.invoke(
                new Api.upload.SaveFilePart({
                  fileId,
                  filePart: partIndex,
                  bytes: Buffer.from(chunkBytes),
                })
              ),
          CHUNK_TIMEOUT_MS,
          chunkLabel
        ),
      chunkLabel,
      // Cap at 5 attempts per chunk — 5 × 30s (FLOOD_WAIT_CAP) = 150s
      // worst case before failing. Combined with the per-batch
      // breather in the runner, persistent rate limits surface as
      // file failures (visible in the overlay) rather than 8-minute
      // stalls.
      5,
      (e) => {
        if (e.floodSeconds !== null && partConcurrency > 1) {
          partConcurrency = 1;
        }
        onRetry?.({
          ...e,
          label: chunkLabel,
        });
      },
    );

    uploadedBytes += chunkBytes.length;
    onProgress?.(Math.min(uploadedBytes, fileSize), fileSize);
  };

  for (let partIndex = 0; partIndex < totalParts; partIndex++) {
    while (inFlight.size >= partConcurrency && !abortedError) {
      await Promise.race(inFlight).catch(() => {});
    }
    if (abortedError) break;

    const start = partIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, fileSize);
    const chunkBytes = await readUploadChunk(filePathOrFile, isPathInput, start, end);

    if (hasher) {
      try {
        hasher.update(chunkBytes);
      } catch (err) {
        console.warn("[uploader] SHA-256 update failed; uploading without hash:", err);
        hasher = null;
      }
    }

    let task!: Promise<void>;
    task = uploadSinglePart(partIndex, chunkBytes)
      .catch((err) => {
        if (!abortedError) {
          abortedError = err;
        }
      })
      .finally(() => {
        inFlight.delete(task);
      });
    inFlight.add(task);
  }

  if (inFlight.size > 0) {
    await Promise.allSettled(inFlight);
  }
  if (abortedError) {
    throw abortedError;
  }

  // Finalize upload inside Telegram
  let inputFile: Api.TypeInputFile;
  if (isBig) {
    inputFile = new Api.InputFileBig({
      id: fileId,
      parts: totalParts,
      name: fileName,
    });
  } else {
    inputFile = new Api.InputFile({
      id: fileId,
      parts: totalParts,
      name: fileName,
      md5Checksum: "",
    });
  }

  // Send document to storage channel with folder path JSON metadata caption.
  // Finalize also goes through the retry helper — the file is already fully
  // uploaded to Telegram at this point, so the only failure modes here are
  // transient network/rate-limit issues.
  const caption = `teledrive_file:${JSON.stringify({ folder: folderPath })}`;
  const finalizeLabel = "client.sendFile";
  const thumbFile = thumbBytes && thumbBytes.length > 0
    ? buildTelegramThumbFile(thumbBytes)
    : undefined;
  const result = await withTelegramRetry(
    () =>
      withTimeout(
        client.sendFile(canonicalChannelId(channelId), {
          file: inputFile,
          forceDocument: true,
          caption,
          ...(thumbFile ? { thumb: thumbFile as any } : {}),
        }),
        SENDFILE_TIMEOUT_MS,
        finalizeLabel
      ),
    finalizeLabel,
    // Finalize cap: 3 attempts × 30s = 90s worst case. The chunks
    // are already on Telegram, so a 90s wait is plenty.
    3,
    onRetry
      ? (e) =>
          onRetry({
            ...e,
            label: finalizeLabel,
          })
      : undefined,
  );

  if (!hash) return result;

  let contentHash: string | null = null;
  if (hasher) {
    try {
      contentHash = bytesToHex(hasher.digest());
    } catch (err) {
      console.warn("[uploader] SHA-256 digest failed; uploading without hash:", err);
    }
  }
  return { message: result, hash: contentHash } satisfies HashedUploadResult;
}
