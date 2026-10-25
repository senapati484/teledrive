import { Api } from "telegram";
import { getClient } from "./client";
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

const CHUNK_SIZE = 512 * 1024; // 512KB recommended chunk size for Telegram
const CHUNK_TIMEOUT_MS = 20_000;
const SENDFILE_TIMEOUT_MS = 30_000;

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
): Promise<any> {
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
  
  const isBig = fileSize > 10 * 1024 * 1024; // > 10MB is considered big in MTProto
  const totalParts = Math.ceil(fileSize / CHUNK_SIZE);

  const isPathInput = typeof filePathOrFile === "string";

  try {
    // Upload chunks sequentially
    for (let partIndex = 0; partIndex < totalParts; partIndex++) {
      const start = partIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const currentChunkSize = end - start;

      let chunkBytes: Uint8Array;

      if (isPathInput) {
        // Read the chunk via the Rust command. This bypasses the JS
        // plugin-fs scope restrictions (capability files) which would
        // otherwise reject arbitrary user-picked backup source folders.
        // The Rust side has full filesystem access; we just stream the
        // requested byte range back as a Vec<u8>.
        const rawRes = await invoke<ArrayBuffer | Uint8Array | number[]>("read_file_chunk", {
          path: filePathOrFile as string,
          offset: start,
          length: currentChunkSize,
        });
        if (rawRes instanceof Uint8Array) {
          chunkBytes = rawRes;
        } else if (rawRes instanceof ArrayBuffer) {
          chunkBytes = new Uint8Array(rawRes);
        } else {
          chunkBytes = new Uint8Array(rawRes);
        }
      } else {
        // Read chunk from HTML File object (regular user upload path —
        // file is in the browser's File API, no Rust needed).
        const blobSlice = (filePathOrFile as File).slice(start, end);
        const arrayBuffer = await blobSlice.arrayBuffer();
        chunkBytes = new Uint8Array(arrayBuffer);
      }
      
      if (hasher) {
        try {
          hasher.update(chunkBytes);
        } catch (err) {
          console.warn("[uploader] SHA-256 update failed; uploading without hash:", err);
          hasher = null;
        }
      }

      // Upload part through the shared retry helper. The chunk is re-read
      // from disk on each attempt via the closure — important because the
      // seek/read may have advanced the handle position mid-failure.
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
        onRetry
          ? (e) =>
              onRetry({
                ...e,
                label: chunkLabel,
              })
          : undefined,
      );
      
      // Update progress
      onProgress?.(end, fileSize);
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
    const result = await withTelegramRetry(
      () =>
        withTimeout(
          client.sendFile(channelId, {
            file: inputFile,
            forceDocument: true,
            caption,
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
  } catch (err) {
    // No file handle to close — we read each chunk via a fresh Rust
    // command invocation, which has its own open/read/close lifecycle.
    throw err;
  }
}
