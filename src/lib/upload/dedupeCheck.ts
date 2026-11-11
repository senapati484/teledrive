import { invoke } from "@tauri-apps/api/core";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

import { getClient } from "../telegram/client";
import { canonicalChannelId } from "../telegram/peerId";
import { resolveFileSegments } from "../files/segmentHelpers";
import type { TeleFile, TeleFileSegment } from "../types";
import { normalizeFolderPath } from "../utils";

export const MANUAL_UPLOAD_HASH_CAP_BYTES = 2 * 1024 * 1024 * 1024;
const HASH_SLICE_BYTES = 1024 * 1024;

/**
 * Computes streaming SHA-256 over a browser `File` or local filesystem path
 * without buffering the file in RAM. Returns `null` past `MANUAL_UPLOAD_HASH_CAP_BYTES`.
 */
export async function computeUploadSourceSha256(
  source: string | File,
  fileSize: number
): Promise<string | null> {
  if (fileSize <= 0 || fileSize > MANUAL_UPLOAD_HASH_CAP_BYTES) {
    return null;
  }

  try {
    if (typeof source === "string") {
      // Reuse fast Rust streaming SHA-256 command when running natively on disk.
      return await invoke<string>("hash_file", { path: source });
    }

    const hasher = sha256.create();
    for (let offset = 0; offset < fileSize; offset += HASH_SLICE_BYTES) {
      const end = Math.min(offset + HASH_SLICE_BYTES, fileSize);
      const buf = await source.slice(offset, end).arrayBuffer();
      hasher.update(new Uint8Array(buf));
    }
    return bytesToHex(hasher.digest());
  } catch {
    return null;
  }
}

export type DuplicateMatch =
  | { kind: "exact_in_folder"; existing: TeleFile }
  | { kind: "cloneable"; existing: TeleFile };

/**
 * Fast O(n) metadata check (~0.1ms) to decide whether a pre-upload disk read
 * for full SHA-256 dedupe could possibly match any existing drive entry.
 */
export function hasUploadDuplicateSizeCandidate(
  files: TeleFile[],
  fileSize: number,
  isEncrypted: boolean
): boolean {
  if (fileSize <= 0) return false;
  for (const file of files) {
    if (file.trashed || !file.hash) continue;
    const effectiveSize = file.enc?.plainSize ?? file.size;
    if (effectiveSize !== fileSize) continue;
    if (Boolean(file.enc) !== isEncrypted) continue;
    if (resolveFileSegments(file).length > 0) return true;
  }
  return false;
}

/**
 * Finds an identical non-trashed file in the drive by content `hash` and `size`.
 * Enforces matching encryption status (`Boolean(enc)`) so plaintext copies are
 * never cloned into an encrypted target or vice versa.
 */
export function findUploadDuplicateMatch(
  files: TeleFile[],
  folderPath: string,
  fileName: string,
  fileSize: number,
  hash: string,
  isEncrypted: boolean
): DuplicateMatch | null {
  if (!hash || fileSize <= 0) return null;
  const targetFolder = normalizeFolderPath(folderPath);

  let cloneCandidate: TeleFile | null = null;
  for (const file of files) {
    if (file.trashed || !file.hash || file.hash !== hash) continue;
    const effectiveSize = file.enc?.plainSize ?? file.size;
    if (effectiveSize !== fileSize) continue;
    if (Boolean(file.enc) !== isEncrypted) continue;
    if (resolveFileSegments(file).length === 0) continue;

    if (
      normalizeFolderPath(file.folderPath) === targetFolder &&
      file.name === fileName
    ) {
      return { kind: "exact_in_folder", existing: file };
    }
    if (!cloneCandidate && !file.archived) {
      cloneCandidate = file;
    }
  }

  return cloneCandidate ? { kind: "cloneable", existing: cloneCandidate } : null;
}

/**
 * Zero-byte server clone: creates fresh Telegram channel message(s) referencing
 * existing MTProto `Document` handle(s), giving the duplicate its own independent
 * `messageId`s in ~100ms without re-uploading a single byte.
 */
export async function cloneTelegramFileMessages(
  channelId: string,
  existing: TeleFile,
  destinationFolder: string,
  fileName: string
): Promise<{ message: any; segments?: TeleFileSegment[] }> {
  const client = getClient();
  const peer = await client.getInputEntity(canonicalChannelId(channelId));
  const segs = resolveFileSegments(existing);
  if (segs.length === 0) {
    throw new Error("Source file has no live Telegram messages to clone.");
  }

  const msgs = await client.getMessages(peer, {
    ids: segs.map((s) => s.messageId),
  });
  const byId = new Map<number, any>();
  for (const m of Array.isArray(msgs) ? msgs : []) {
    if (m?.id) byId.set(Number(m.id), m);
  }

  const clonedSegments: TeleFileSegment[] = [];
  let primaryMessage: any = null;

  for (let i = 0; i < segs.length; i++) {
    const srcMsg = byId.get(segs[i].messageId);
    const doc = srcMsg?.media?.document;
    if (!doc) {
      throw new Error("Source document missing on Telegram; falling back to upload.");
    }
    const isMulti = segs.length > 1;
    const caption =
      i === 0
        ? `teledrive_file:${JSON.stringify({
            folder: destinationFolder,
            ...(isMulti ? { name: fileName, seg: 0, totalSegs: segs.length } : {}),
          })}`
        : `teledrive_file_part:${JSON.stringify({
            folder: destinationFolder,
            name: fileName,
            seg: i,
            totalSegs: segs.length,
          })}`;

    const sent = await client.sendFile(peer, {
      file: doc,
      forceDocument: true,
      caption,
    });

    if (i === 0) primaryMessage = sent;
    clonedSegments.push({
      messageId: Number(sent.id),
      size: segs[i].size,
    });
  }

  return {
    message: primaryMessage,
    segments: clonedSegments.length > 1 ? clonedSegments : undefined,
  };
}
