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
import {
  E2EE_BLOCK_SIZE,
  E2EE_FRAME_OVERHEAD,
  E2EE_HEADER_BYTES,
  StreamEncryptor,
  base64ToBytes,
} from "../secure/e2ee";
import {
  clearUploadCheckpoint,
  loadUploadCheckpoint,
  saveUploadCheckpoint,
  type UploadCheckpoint,
} from "../upload/uploadCheckpoints";
import type { TeleFileEncryption, TeleFileSegment } from "../types";

export const UPLOAD_CHUNK_SIZE = 512 * 1024; // 512 KiB recommended chunk size for Telegram
export const FREE_MAX_FILE_PARTS = 4000; // ~2,000 MiB (1.95 GiB) Telegram non-Premium cap
export const PREMIUM_MAX_FILE_PARTS = 8000; // ~4,000 MiB (3.91 GiB) Telegram Premium cap
// Conservative plaintext segment ceilings aligned cleanly to 512 KiB blocks
// (leaves >= 199 parts headroom below Telegram's cap for E2EE framing overhead).
export const SAFE_FREE_SEGMENT_BYTES = 1_900 * 1024 * 1024;
export const SAFE_PREMIUM_SEGMENT_BYTES = 3_800 * 1024 * 1024;
export const DEFAULT_BIG_PART_CONCURRENCY = 3;

export interface PlannedSegment {
  index: number;
  offset: number;
  size: number;
}

/**
 * Splits `totalSize` into sequential upload segments bounded by `maxSegmentBytes`.
 * Returns a single segment `{ index: 0, offset: 0, size: totalSize }` when no split is needed.
 */
export function planFileSegments(
  totalSize: number,
  maxSegmentBytes: number
): PlannedSegment[] {
  if (totalSize <= 0 || maxSegmentBytes <= 0) return [];
  if (totalSize <= maxSegmentBytes) {
    return [{ index: 0, offset: 0, size: totalSize }];
  }
  const segments: PlannedSegment[] = [];
  let offset = 0;
  let index = 0;
  while (offset < totalSize) {
    const size = Math.min(maxSegmentBytes, totalSize - offset);
    segments.push({ index, offset, size });
    offset += size;
    index++;
  }
  return segments;
}

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
  segments?: TeleFileSegment[];
  enc?: TeleFileEncryption;
}

export interface UploadAdvancedOptions {
  /** Stable fingerprint key enabling part-level & segment-level checkpoint resume. */
  checkpointKey?: string;
  /** Split files exceeding Telegram single-file caps into sequential messages (default: true). */
  allowMultiSegment?: boolean;
  /** Override segment threshold (for tests). */
  maxSegmentBytesOverride?: number;
  /** Active E2EE AES-GCM master key (enables TDE1 streaming envelope encryption). */
  encryptionKey?: CryptoKey | null;
  /** Public PBKDF2 KDF salt base64 embedded into `TeleFile.enc.s`. */
  encryptionSaltB64?: string | null;
  /** Optional anonymized Telegram document filename when encrypting (e.g., `<id>.tde`). */
  anonymizedFileName?: string;
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

function appendChunkBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const merged = new Uint8Array(a.length + b.length);
  merged.set(a, 0);
  merged.set(b, a.length);
  return merged;
}

function isStaleResumeError(err: any): boolean {
  const msg = String(err?.errorMessage || err?.message || "").toUpperCase();
  return msg.includes("FILE_ID_INVALID") || msg.includes("FILE_PART_") || msg.includes("PART_INVALID");
}

/**
 * Uploads a file (either from local native path or browser File object) to Telegram storage channel.
 * Supports pipelined chunks, resumable checkpoints, >2/4 GB multi-segment splitting,
 * and optional streaming client-side E2EE (`TDE1`).
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
  advanced?: UploadAdvancedOptions,
): Promise<any> {
  if (fileSize <= 0) {
    throw new Error(`Cannot upload 0-byte file "${fileName}": Telegram MTProto requires at least 1 byte.`);
  }

  const allowMultiSegment = advanced?.allowMultiSegment ?? true;
  const isEncrypted = Boolean(advanced?.encryptionKey);
  const effectiveWireTotalEstimate = isEncrypted
    ? E2EE_HEADER_BYTES +
      fileSize +
      Math.ceil(fileSize / E2EE_BLOCK_SIZE) * E2EE_FRAME_OVERHEAD
    : fileSize;

  let maxPlainSegmentBytes = SAFE_FREE_SEGMENT_BYTES;
  if (advanced?.maxSegmentBytesOverride && advanced.maxSegmentBytesOverride > 0) {
    maxPlainSegmentBytes = advanced.maxSegmentBytesOverride;
  } else if (!allowMultiSegment) {
    const rawValidation = validateUploadSizeForAccount(effectiveWireTotalEstimate, null);
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
      const accountValidation = validateUploadSizeForAccount(effectiveWireTotalEstimate, isPremium);
      if (!accountValidation.ok) {
        throw new Error(
          i18n.t("messages:upload.exceedsFreeLimit", {
            name: fileName,
            defaultValue: `"${fileName}" exceeds Telegram's ~2 GB upload limit for standard accounts (Telegram Premium supports up to ~4 GB).`,
          })
        );
      }
    }
    maxPlainSegmentBytes = Math.max(fileSize, SAFE_PREMIUM_SEGMENT_BYTES);
  } else if (Math.ceil(effectiveWireTotalEstimate / CHUNK_SIZE) > FREE_MAX_FILE_PARTS) {
    const isPremium = await detectAccountIsPremium();
    maxPlainSegmentBytes =
      isPremium === true ? SAFE_PREMIUM_SEGMENT_BYTES : SAFE_FREE_SEGMENT_BYTES;
  } else {
    maxPlainSegmentBytes = SAFE_FREE_SEGMENT_BYTES;
  }

  const plannedSegments = planFileSegments(fileSize, maxPlainSegmentBytes);
  const totalSegs = plannedSegments.length;
  const isPathInput = typeof filePathOrFile === "string";
  const client = getClient();

  let hasher: ReturnType<typeof sha256.create> | null = null;
  if (hash) {
    try {
      hasher = sha256.create();
    } catch (err) {
      console.warn("[uploader] SHA-256 init failed; uploading without hash:", err);
    }
  }

  const checkpointKey = advanced?.checkpointKey;
  let activeCheckpoint: UploadCheckpoint | null =
    checkpointKey ? loadUploadCheckpoint(checkpointKey) : null;
  if (activeCheckpoint && activeCheckpoint.encrypted !== isEncrypted) {
    clearUploadCheckpoint(checkpointKey!);
    activeCheckpoint = null;
  }

  let presetFileSalt: Uint8Array | undefined;
  if (isEncrypted && activeCheckpoint?.fileSaltB64) {
    try {
      const parsedSalt = base64ToBytes(activeCheckpoint.fileSaltB64);
      if (parsedSalt.length === 16) presetFileSalt = parsedSalt;
    } catch {
      presetFileSalt = undefined;
    }
  }

  const encryptor = advanced?.encryptionKey
    ? new StreamEncryptor(advanced.encryptionKey, E2EE_BLOCK_SIZE, presetFileSalt)
    : null;

  const uploadedSegments: TeleFileSegment[] = [];
  let primaryMessage: any = null;
  let completedPlainPriorSegs = 0;

  // Replay completed segments locally for deterministic SHA-256 & nonce state
  const priorCompletedCount = activeCheckpoint?.completedSegments?.length ?? 0;
  for (let i = 0; i < totalSegs; i++) {
    const seg = plannedSegments[i];
    const isMulti = totalSegs > 1;
    const baseTelegramFileName = isEncrypted
      ? advanced?.anonymizedFileName || `encrypted_${Math.random().toString(36).slice(2, 10)}.tde`
      : isMulti
      ? `${fileName}.part${String(i + 1).padStart(3, "0")}`
      : fileName;

    if (
      activeCheckpoint &&
      i < priorCompletedCount &&
      activeCheckpoint.completedSegments[i]?.messageId > 0
    ) {
      if (hasher) {
        for (let off = 0; off < seg.size; off += CHUNK_SIZE) {
          const end = Math.min(off + CHUNK_SIZE, seg.size);
          const buf = await readUploadChunk(
            filePathOrFile,
            isPathInput,
            seg.offset + off,
            seg.offset + end
          );
          try {
            hasher.update(buf);
          } catch {
            hasher = null;
            break;
          }
        }
      }
      if (encryptor) {
        encryptor.advanceBlockIndex(Math.ceil(seg.size / E2EE_BLOCK_SIZE));
      }
      uploadedSegments.push(activeCheckpoint.completedSegments[i]);
      completedPlainPriorSegs += seg.size;
      onProgress?.(completedPlainPriorSegs, fileSize);
      continue;
    }

    const segWireSize = encryptor
      ? (i === 0 ? E2EE_HEADER_BYTES : 0) +
        seg.size +
        Math.ceil(seg.size / E2EE_BLOCK_SIZE) * E2EE_FRAME_OVERHEAD
      : seg.size;
    const segTotalParts = Math.ceil(segWireSize / CHUNK_SIZE);
    const isBigSeg = segWireSize > 10 * 1024 * 1024;

    const uploadThisSegment = async (
      allowResumeCheckpoint: boolean,
      skipHashUpdate: boolean
    ): Promise<{ sentMsg: any; wireSize: number }> => {
      const canResume =
        allowResumeCheckpoint &&
        activeCheckpoint &&
        activeCheckpoint.segmentIndex === i &&
        activeCheckpoint.totalParts === segTotalParts &&
        activeCheckpoint.completedParts > 0 &&
        activeCheckpoint.completedParts < segTotalParts;

      const segFileId = canResume
        ? bigInt(activeCheckpoint!.fileIdStr)
        : bigInt(Math.floor(Math.random() * 1e15));
      const resumeFromPart = canResume ? activeCheckpoint!.completedParts : 0;

      let partConcurrency = isBigSeg ? DEFAULT_BIG_PART_CONCURRENCY : 1;
      let wireSentBytes = 0;
      let abortedError: any = null;
      const inFlight = new Set<Promise<void>>();
      const ackedParts = new Set<number>();
      let contiguousAcked = resumeFromPart;
      for (let p = 0; p < resumeFromPart; p++) ackedParts.add(p);

      const persistProgress = () => {
        if (!checkpointKey) return;
        saveUploadCheckpoint({
          key: checkpointKey,
          segmentIndex: i,
          fileIdStr: segFileId.toString(),
          totalParts: segTotalParts,
          completedParts: contiguousAcked,
          fileSaltB64: encryptor?.fileSaltB64,
          completedSegments: [...uploadedSegments],
          encrypted: isEncrypted,
          updatedAt: Date.now(),
        });
      };

      const dispatchPart = async (partIndex: number, wireBytes: Uint8Array) => {
        while (inFlight.size >= partConcurrency && !abortedError) {
          await Promise.race(inFlight).catch(() => {});
        }
        if (abortedError) return;

        const chunkLabel = `${isBigSeg ? "SaveBigFilePart" : "SaveFilePart"}(${partIndex}/${segTotalParts})`;
        let task!: Promise<void>;
        task = (async () => {
          await withTelegramRetry(
            () =>
              withTimeout(
                isBigSeg
                  ? client.invoke(
                      new Api.upload.SaveBigFilePart({
                        fileId: segFileId,
                        filePart: partIndex,
                        fileTotalParts: segTotalParts,
                        bytes: Buffer.from(wireBytes),
                      })
                    )
                  : client.invoke(
                      new Api.upload.SaveFilePart({
                        fileId: segFileId,
                        filePart: partIndex,
                        bytes: Buffer.from(wireBytes),
                      })
                    ),
                CHUNK_TIMEOUT_MS,
                chunkLabel
              ),
            chunkLabel,
            5,
            (e) => {
              if (e.floodSeconds !== null && partConcurrency > 1) {
                partConcurrency = 1;
              }
              onRetry?.({
                ...e,
                label: chunkLabel,
              });
            }
          );

          wireSentBytes += wireBytes.length;
          ackedParts.add(partIndex);
          while (ackedParts.has(contiguousAcked)) {
            contiguousAcked++;
          }
          if (checkpointKey && (contiguousAcked % 5 === 0 || contiguousAcked === segTotalParts)) {
            persistProgress();
          }

          const segFraction = segWireSize > 0 ? Math.min(1, wireSentBytes / segWireSize) : 1;
          const approxPlainDone =
            completedPlainPriorSegs + Math.round(seg.size * segFraction);
          onProgress?.(Math.min(approxPlainDone, fileSize), fileSize);
        })()
          .catch((err) => {
            if (!abortedError) abortedError = err;
          })
          .finally(() => {
            inFlight.delete(task);
          });
        inFlight.add(task);
      };

      if (encryptor) {
        let pendingCipher: Uint8Array = i === 0 ? encryptor.header : new Uint8Array(0);
        let plainCursor = 0;
        let outPartIndex = 0;

        while ((plainCursor < seg.size || pendingCipher.length > 0) && !abortedError) {
          while (pendingCipher.length < CHUNK_SIZE && plainCursor < seg.size) {
            const take = Math.min(E2EE_BLOCK_SIZE, seg.size - plainCursor);
            const rawBlock = await readUploadChunk(
              filePathOrFile,
              isPathInput,
              seg.offset + plainCursor,
              seg.offset + plainCursor + take
            );
            plainCursor += take;

            if (hasher && !skipHashUpdate) {
              try {
                hasher.update(rawBlock);
              } catch (err) {
                console.warn("[uploader] SHA-256 update failed; uploading without hash:", err);
                hasher = null;
              }
            }

            const encryptedFrame = await encryptor.encryptBlock(rawBlock);
            pendingCipher = appendChunkBytes(pendingCipher, encryptedFrame);
          }

          const emitLen = Math.min(CHUNK_SIZE, pendingCipher.length);
          const wirePart = pendingCipher.slice(0, emitLen);
          pendingCipher = pendingCipher.slice(emitLen);
          const currentPartIdx = outPartIndex++;

          if (currentPartIdx < resumeFromPart) {
            wireSentBytes += wirePart.length;
            continue;
          }
          await dispatchPart(currentPartIdx, wirePart);
        }
      } else {
        for (let partIndex = 0; partIndex < segTotalParts; partIndex++) {
          if (abortedError) break;
          const start = partIndex * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, seg.size);

          // Skip disk read completely for resumed parts when hash isn't requested
          if (partIndex < resumeFromPart && (!hasher || skipHashUpdate)) {
            wireSentBytes += end - start;
            continue;
          }

          const chunkBytes = await readUploadChunk(
            filePathOrFile,
            isPathInput,
            seg.offset + start,
            seg.offset + end
          );

          if (hasher && !skipHashUpdate) {
            try {
              hasher.update(chunkBytes);
            } catch (err) {
              console.warn("[uploader] SHA-256 update failed; uploading without hash:", err);
              hasher = null;
            }
          }

          if (partIndex < resumeFromPart) {
            wireSentBytes += chunkBytes.length;
            continue;
          }
          await dispatchPart(partIndex, chunkBytes);
        }
      }

      if (inFlight.size > 0) {
        await Promise.allSettled(inFlight);
      }
      if (abortedError) {
        persistProgress();
        throw abortedError;
      }

      const inputFile: Api.TypeInputFile = isBigSeg
        ? new Api.InputFileBig({
            id: segFileId,
            parts: segTotalParts,
            name: baseTelegramFileName,
          })
        : new Api.InputFile({
            id: segFileId,
            parts: segTotalParts,
            name: baseTelegramFileName,
            md5Checksum: "",
          });

      const caption =
        i === 0
          ? `teledrive_file:${JSON.stringify({
              folder: folderPath,
              ...(isMulti ? { name: fileName, seg: 0, totalSegs } : {}),
            })}`
          : `teledrive_file_part:${JSON.stringify({
              folder: folderPath,
              name: fileName,
              seg: i,
              totalSegs,
            })}`;

      const finalizeLabel = "client.sendFile";
      const thumbFile =
        i === 0 && !isEncrypted && thumbBytes && thumbBytes.length > 0
          ? buildTelegramThumbFile(thumbBytes)
          : undefined;

      const sentMsg = await withTelegramRetry(
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
        3,
        onRetry
          ? (e) =>
              onRetry({
                ...e,
                label: finalizeLabel,
              })
          : undefined
      );

      return { sentMsg, wireSize: segWireSize };
    };

    let segResult: { sentMsg: any; wireSize: number };
    const segStartBlockIndex = Math.ceil(seg.offset / E2EE_BLOCK_SIZE);
    try {
      encryptor?.setBlockIndex(segStartBlockIndex);
      segResult = await uploadThisSegment(true, false);
    } catch (err: any) {
      if (checkpointKey && activeCheckpoint && isStaleResumeError(err)) {
        clearUploadCheckpoint(checkpointKey);
        activeCheckpoint = null;
        encryptor?.setBlockIndex(segStartBlockIndex);
        segResult = await uploadThisSegment(false, true);
      } else {
        throw err;
      }
    }

    if (i === 0) primaryMessage = segResult.sentMsg;
    uploadedSegments.push({
      messageId: Number(segResult.sentMsg.id),
      size: segResult.wireSize,
    });
    completedPlainPriorSegs += seg.size;
    onProgress?.(completedPlainPriorSegs, fileSize);

    if (checkpointKey && i + 1 < totalSegs) {
      saveUploadCheckpoint({
        key: checkpointKey,
        segmentIndex: i + 1,
        fileIdStr: "0",
        totalParts: 0,
        completedParts: 0,
        fileSaltB64: encryptor?.fileSaltB64,
        completedSegments: [...uploadedSegments],
        encrypted: isEncrypted,
        updatedAt: Date.now(),
      });
    }
  }

  if (checkpointKey) {
    clearUploadCheckpoint(checkpointKey);
  }

  const finalSegments = uploadedSegments.length > 1 ? uploadedSegments : undefined;
  const encMeta: TeleFileEncryption | undefined = isEncrypted
    ? {
        v: 1,
        s: advanced?.encryptionSaltB64 || encryptor!.fileSaltB64,
        plainSize: fileSize,
      }
    : undefined;

  if (!hash && !finalSegments && !encMeta) {
    return primaryMessage;
  }

  let contentHash: string | null = null;
  if (hasher) {
    try {
      contentHash = bytesToHex(hasher.digest());
    } catch (err) {
      console.warn("[uploader] SHA-256 digest failed; uploading without hash:", err);
    }
  }

  return {
    message: primaryMessage,
    hash: contentHash,
    ...(finalSegments ? { segments: finalSegments } : {}),
    ...(encMeta ? { enc: encMeta } : {}),
  } satisfies HashedUploadResult;
}
