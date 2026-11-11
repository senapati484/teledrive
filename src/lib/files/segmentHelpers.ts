import type { TeleFile, TeleFileSegment } from "../types";

/**
 * Returns every positive Telegram message ID backing a virtual file
 * (`file.messageId` plus any additional segments in `file.segments`).
 */
export function getFileMessageIds(
  file: Pick<TeleFile, "messageId" | "segments">
): number[] {
  const ids = new Set<number>();
  const primary = Number(file.messageId);
  if (Number.isFinite(primary) && primary > 0) {
    ids.add(primary);
  }
  if (Array.isArray(file.segments)) {
    for (const seg of file.segments) {
      const segId = Number(seg?.messageId);
      if (Number.isFinite(segId) && segId > 0) {
        ids.add(segId);
      }
    }
  }
  return Array.from(ids);
}

/**
 * Resolves the ordered list of Telegram message segments for streaming/download.
 * Single-message files synthesize a single-element list cleanly.
 */
export function resolveFileSegments(
  file: Pick<TeleFile, "messageId" | "size" | "segments">
): TeleFileSegment[] {
  if (Array.isArray(file.segments) && file.segments.length > 0) {
    return file.segments
      .filter((s) => Number.isFinite(Number(s?.messageId)) && Number(s.messageId) > 0)
      .map((s) => ({
        messageId: Number(s.messageId),
        size: Number(s.size) || 0,
      }));
  }
  const msgId = Number(file.messageId);
  if (Number.isFinite(msgId) && msgId > 0) {
    return [{ messageId: msgId, size: Number(file.size) || 0 }];
  }
  return [];
}

export function isEncryptedFile(file: Pick<TeleFile, "enc">): boolean {
  return Boolean(file.enc && file.enc.v === 1);
}

