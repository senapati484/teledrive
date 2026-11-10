import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getClient } from "../telegram/client";
import { canonicalChannelId } from "../telegram/peerId";
import { finalizeDownloadFile, writeDownloadChunk } from "../storage/downloadStreamWriter";
import {
  getFileExtension,
  IMAGE_EXTS,
  UNRENDERABLE_IMAGE_EXTS,
  VIDEO_EXTS,
} from "./fileUtils";
import type { TeleFile } from "../types";

export const THUMB_MAX_DIMENSION = 320;
export const LEGACY_IMAGE_THUMB_MAX_BYTES = 3 * 1024 * 1024;
export const UPLOAD_THUMB_MAX_BYTES = 40 * 1024 * 1024;

const THUMB_BATCH_SIZE = 20;
const LEGACY_THUMB_CONCURRENCY = 2;

const BROWSER_THUMB_IMAGE_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "avif",
]);

const BROWSER_THUMB_VIDEO_EXTS = new Set(["mp4", "m4v", "webm", "mov", "ogv"]);

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as any).__TAURI_INTERNALS__)
  );
}

export function isThumbnailEligible(file: Pick<TeleFile, "name" | "mime" | "messageId" | "trashed">): boolean {
  if (!file.messageId || file.messageId <= 0 || file.trashed) return false;
  const ext = getFileExtension(file.name);
  if (UNRENDERABLE_IMAGE_EXTS.has(ext) || ext === "svg") return false;
  const mime = (file.mime || "").toLowerCase();
  if (mime.startsWith("image/") || mime.startsWith("video/")) {
    return mime !== "image/svg+xml";
  }
  return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
}

export function isLegacyRasterThumbCandidate(
  file: Pick<TeleFile, "name" | "mime" | "size" | "messageId" | "trashed">
): boolean {
  if (!isThumbnailEligible(file)) return false;
  if (file.size <= 0 || file.size > LEGACY_IMAGE_THUMB_MAX_BYTES) return false;
  const ext = getFileExtension(file.name);
  if (BROWSER_THUMB_IMAGE_EXTS.has(ext)) return true;
  const mime = (file.mime || "").toLowerCase();
  return (
    mime === "image/jpeg" ||
    mime === "image/png" ||
    mime === "image/webp" ||
    mime === "image/gif" ||
    mime === "image/bmp" ||
    mime === "image/avif"
  );
}

export function thumbnailCacheFilename(channelId: string, messageId: number): string {
  const safeChannel = String(channelId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `thumb_${safeChannel}_${messageId}.jpg`;
}

function legacyPreviewCacheFilename(fileName: string, messageId: number): string {
  const ext = getFileExtension(fileName) || "bin";
  return `preview_${messageId}.${ext}`;
}

/**
 * Selects the best compact thumbnail object from a Telegram `MessageMedia`
 * while ignoring vector outline paths (`PhotoPathSize`). Returns `null` if no
 * thumbnail exists so callers never accidentally fall back to a full download.
 */
export function pickBestTelegramThumb(media: any): any | null {
  const rawSizes: any[] | undefined =
    media?.document?.thumbs ?? media?.photo?.sizes;
  if (!Array.isArray(rawSizes) || rawSizes.length === 0) {
    return null;
  }

  const valid = rawSizes.filter((s) => {
    if (!s || typeof s !== "object") return false;
    const className = s.className || s.constructor?.name || "";
    if (className === "PhotoPathSize") return false;
    return true;
  });

  if (valid.length === 0) return null;

  // Prefer crisp medium raster sizes ('m' = 320px, 'x' = 800px, 's' = 100px)
  // within 200 KB before falling back to tiny inline PhotoStrippedSize.
  const preferredOrder = ["m", "s", "x", "y"];
  for (const typeCode of preferredOrder) {
    const match = valid.find(
      (t) =>
        t.type === typeCode &&
        (typeof t.size !== "number" || t.size <= 200 * 1024)
    );
    if (match) return match;
  }

  // Prefer any non-stripped raster thumb under 200 KB.
  const smallRaster = valid.find((t) => {
    const className = t.className || t.constructor?.name || "";
    if (className === "PhotoStrippedSize") return false;
    return typeof t.size === "number" && t.size > 0 && t.size <= 200 * 1024;
  });
  if (smallRaster) return smallRaster;

  // Fall back cleanly to inline stripped thumb (tiny JPEG rendered with 0 extra RPCs).
  return valid[0] ?? null;
}

function scaleDimensions(
  srcWidth: number,
  srcHeight: number,
  maxDim: number = THUMB_MAX_DIMENSION
): { width: number; height: number } {
  if (srcWidth <= 0 || srcHeight <= 0) {
    return { width: maxDim, height: maxDim };
  }
  const ratio = Math.min(1, maxDim / Math.max(srcWidth, srcHeight));
  return {
    width: Math.max(1, Math.round(srcWidth * ratio)),
    height: Math.max(1, Math.round(srcHeight * ratio)),
  };
}

async function canvasToJpegBytes(
  canvas: HTMLCanvasElement,
  quality = 0.76
): Promise<Uint8Array | null> {
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
    } catch {
      resolve(null);
    }
  });
  if (!blob || blob.size === 0) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

async function renderImageBlobToThumbBytes(blob: Blob): Promise<Uint8Array | null> {
  if (typeof document === "undefined") return null;

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      try {
        const { width, height } = scaleDimensions(bitmap.width, bitmap.height);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0, width, height);
        return await canvasToJpegBytes(canvas);
      } finally {
        bitmap.close();
      }
    } catch {
      // Fallback to HTMLImageElement below
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image thumb load failed"));
      el.src = url;
    });
    const { width, height } = scaleDimensions(
      img.naturalWidth || img.width,
      img.naturalHeight || img.height
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    return await canvasToJpegBytes(canvas);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function renderVideoFileToThumbBytes(file: Blob): Promise<Uint8Array | null> {
  if (typeof document === "undefined") return null;
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error("video thumb timeout"));
      }, 3000);

      const cleanup = () => window.clearTimeout(timer);

      video.onloadedmetadata = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const targetTime = duration > 0.2 ? Math.min(1, duration * 0.1) : 0;
        if (targetTime > 0 && video.currentTime !== targetTime) {
          video.currentTime = targetTime;
        } else {
          cleanup();
          resolve();
        }
      };

      video.onseeked = () => {
        cleanup();
        resolve();
      };

      video.onloadeddata = () => {
        if (video.readyState >= 2 && (!Number.isFinite(video.duration) || video.duration <= 0.2)) {
          cleanup();
          resolve();
        }
      };

      video.onerror = () => {
        cleanup();
        reject(new Error("video thumb decode failed"));
      };

      video.src = url;
    });

    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      return null;
    }
    const { width, height } = scaleDimensions(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    return await canvasToJpegBytes(canvas);
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Generates a compact JPEG preview thumbnail (`<= 320px`) for newly uploaded
 * images or browser-playable videos. Never throws — returns `null` cleanly
 * for unsupported codecs or oversized files so uploads never block.
 */
export async function generateUploadThumbnail(
  file: Blob,
  fileName: string,
  mime: string
): Promise<Uint8Array | null> {
  if (file.size <= 0 || file.size > UPLOAD_THUMB_MAX_BYTES) return null;
  const ext = getFileExtension(fileName);
  const mimeLower = (mime || "").toLowerCase();

  if (
    BROWSER_THUMB_IMAGE_EXTS.has(ext) ||
    (mimeLower.startsWith("image/") &&
      mimeLower !== "image/svg+xml" &&
      !UNRENDERABLE_IMAGE_EXTS.has(ext) &&
      ext !== "heic" &&
      ext !== "heif")
  ) {
    return renderImageBlobToThumbBytes(file);
  }

  if (
    BROWSER_THUMB_VIDEO_EXTS.has(ext) ||
    mimeLower === "video/mp4" ||
    mimeLower === "video/webm" ||
    mimeLower === "video/quicktime"
  ) {
    return renderVideoFileToThumbBytes(file);
  }

  return null;
}

// Runtime session cache (`channelId:messageId` -> asset:// or blob: URL, or `null` if confirmed missing).
const thumbMemoryCache = new Map<string, string | null>();
const inflightThumbKeys = new Set<string>();

function thumbCacheKey(channelId: string, messageId: number): string {
  return `${channelId}:${messageId}`;
}

export function getCachedThumbnailUrl(
  file: Pick<TeleFile, "channelId" | "messageId" | "thumbnailUrl">
): string | undefined {
  if (file.thumbnailUrl) return file.thumbnailUrl;
  if (!file.messageId) return undefined;
  const cached = thumbMemoryCache.get(thumbCacheKey(file.channelId, file.messageId));
  return cached ?? undefined;
}

export function clearThumbnailMemoryCache(): void {
  thumbMemoryCache.clear();
  inflightThumbKeys.clear();
}

/**
 * Persists raw JPEG thumbnail bytes to Tauri `preview_cache` (or an in-memory
 * Blob URL in browser mode) and updates the session cache immediately.
 */
export async function seedThumbnailCache(
  channelId: string,
  messageId: number,
  bytes: Uint8Array
): Promise<string | null> {
  if (!messageId || messageId <= 0 || bytes.length === 0) return null;
  const key = thumbCacheKey(channelId, messageId);

  if (isTauriRuntime()) {
    try {
      const targetPath = await invoke<string>("get_preview_cache_path", {
        fileName: thumbnailCacheFilename(channelId, messageId),
      });
      await writeDownloadChunk(targetPath, bytes, false);
      await finalizeDownloadFile(targetPath);
      const url = convertFileSrc(targetPath);
      thumbMemoryCache.set(key, url);
      return url;
    } catch {
      // Fallback to in-memory Blob URL below if cache write fails
    }
  }

  if (typeof URL !== "undefined" && typeof Blob !== "undefined") {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    const url = URL.createObjectURL(new Blob([copy.buffer], { type: "image/jpeg" }));
    thumbMemoryCache.set(key, url);
    return url;
  }

  return null;
}

// Shared bounded concurrency runner for legacy image downscaling fallbacks.
let activeLegacyWorkers = 0;
const legacyQueue: Array<() => Promise<void>> = [];

function enqueueLegacyThumbWork(task: () => Promise<void>): void {
  legacyQueue.push(task);
  drainLegacyQueue();
}

function drainLegacyQueue(): void {
  while (activeLegacyWorkers < LEGACY_THUMB_CONCURRENCY && legacyQueue.length > 0) {
    const next = legacyQueue.shift()!;
    activeLegacyWorkers++;
    void next().finally(() => {
      activeLegacyWorkers--;
      drainLegacyQueue();
    });
  }
}

async function resolveFromLocalDiskCache(file: TeleFile): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const thumbPath = await invoke<string | null>("check_preview_cache", {
      fileName: thumbnailCacheFilename(file.channelId, file.messageId),
    });
    if (thumbPath) {
      return convertFileSrc(thumbPath);
    }

    // Reuse full cached raster image if user previously previewed it cleanly.
    const ext = getFileExtension(file.name);
    if (BROWSER_THUMB_IMAGE_EXTS.has(ext) && file.size > 0 && file.size <= 15 * 1024 * 1024) {
      const previewPath = await invoke<string | null>("check_preview_cache", {
        fileName: legacyPreviewCacheFilename(file.name, file.messageId),
        expectedSize: file.size,
      });
      if (previewPath) {
        return convertFileSrc(previewPath);
      }
    }
  } catch {
    // Ignore local cache lookup errors cleanly
  }
  return null;
}

function toUint8Array(raw: unknown): Uint8Array | null {
  if (!raw) return null;
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (typeof raw === "string") return null;
  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return null;
}

/**
 * Resolves thumbnails for a batch of visible Grid items:
 * 1. Reuses in-memory and `$APPLOCALDATA/preview_cache` hits with zero network RPCs.
 * 2. Batches Telegram `getMessages` (`<= 20` IDs/RPC) and downloads compact `doc.thumbs`/`photo.sizes`.
 * 3. Falls back safely (`<= 3 MiB` raster images, 2-worker limit) when legacy uploads lack `doc.thumbs`.
 */
export function requestFileThumbnails(
  files: TeleFile[],
  onResolved: (fileId: string, url: string) => void
): () => void {
  let cancelled = false;

  const candidates = files.filter((file) => {
    if (!isThumbnailEligible(file)) return false;
    const key = thumbCacheKey(file.channelId, file.messageId);
    if (thumbMemoryCache.has(key)) {
      const existing = thumbMemoryCache.get(key);
      if (existing) onResolved(file.id, existing);
      return false;
    }
    return !inflightThumbKeys.has(key);
  });

  if (candidates.length === 0) {
    return () => {
      cancelled = true;
    };
  }

  for (const file of candidates) {
    inflightThumbKeys.add(thumbCacheKey(file.channelId, file.messageId));
  }

  void (async () => {
    try {
      const uncachedByChannel = new Map<string, TeleFile[]>();

      await Promise.all(
        candidates.map(async (file) => {
          const key = thumbCacheKey(file.channelId, file.messageId);
          const localUrl = await resolveFromLocalDiskCache(file);
          if (cancelled) return;
          if (localUrl) {
            thumbMemoryCache.set(key, localUrl);
            inflightThumbKeys.delete(key);
            onResolved(file.id, localUrl);
            return;
          }
          const list = uncachedByChannel.get(file.channelId) ?? [];
          list.push(file);
          uncachedByChannel.set(file.channelId, list);
        })
      );

      if (cancelled || uncachedByChannel.size === 0) return;

      const client = getClient();
      if (!client.connected) {
        await client.connect().catch(() => {});
      }

      for (const [channelId, channelFiles] of uncachedByChannel.entries()) {
        if (cancelled) break;
        const peer = await client.getInputEntity(canonicalChannelId(channelId)).catch(() => null);
        if (!peer) {
          for (const f of channelFiles) {
            inflightThumbKeys.delete(thumbCacheKey(f.channelId, f.messageId));
          }
          continue;
        }

        for (let offset = 0; offset < channelFiles.length && !cancelled; offset += THUMB_BATCH_SIZE) {
          const slice = channelFiles.slice(offset, offset + THUMB_BATCH_SIZE);
          let messages: any[] = [];
          try {
            messages = await client.getMessages(peer, {
              ids: slice.map((f) => f.messageId),
            });
          } catch {
            for (const f of slice) {
              inflightThumbKeys.delete(thumbCacheKey(f.channelId, f.messageId));
            }
            continue;
          }

          const byMsgId = new Map<number, any>();
          for (const msg of messages) {
            if (msg?.id) byMsgId.set(Number(msg.id), msg);
          }

          for (const file of slice) {
            const key = thumbCacheKey(file.channelId, file.messageId);
            const msg = byMsgId.get(Number(file.messageId));
            if (!msg?.media) {
              thumbMemoryCache.set(key, null);
              inflightThumbKeys.delete(key);
              continue;
            }

            const bestThumb = pickBestTelegramThumb(msg.media);
            if (bestThumb) {
              try {
                const raw = await client.downloadMedia(msg, { thumb: bestThumb } as any);
                const bytes = toUint8Array(raw);
                if (!cancelled && bytes && bytes.length > 0) {
                  const url = await seedThumbnailCache(file.channelId, file.messageId, bytes);
                  if (!cancelled && url) onResolved(file.id, url);
                } else {
                  thumbMemoryCache.set(key, null);
                }
              } catch {
                thumbMemoryCache.set(key, null);
              } finally {
                inflightThumbKeys.delete(key);
              }
              continue;
            }

            // Legacy uploads made without a Telegram thumbnail: only downscale compact raster images.
            if (isLegacyRasterThumbCandidate(file)) {
              enqueueLegacyThumbWork(async () => {
                try {
                  if (cancelled) return;
                  const raw = await client.downloadMedia(msg, {});
                  const bytes = toUint8Array(raw);
                  if (!bytes || bytes.length === 0) {
                    thumbMemoryCache.set(key, null);
                    return;
                  }
                  const copy = new Uint8Array(bytes.length);
                  copy.set(bytes);
                  const mime = file.mime || "image/jpeg";
                  const blob = new Blob([copy.buffer], { type: mime });
                  const thumbBytes = await renderImageBlobToThumbBytes(blob);
                  const finalBytes = thumbBytes ?? (bytes.length <= 150 * 1024 ? bytes : null);
                  if (finalBytes && !cancelled) {
                    const url = await seedThumbnailCache(file.channelId, file.messageId, finalBytes);
                    if (!cancelled && url) onResolved(file.id, url);
                  } else {
                    thumbMemoryCache.set(key, null);
                  }
                } catch {
                  thumbMemoryCache.set(key, null);
                } finally {
                  inflightThumbKeys.delete(key);
                }
              });
            } else {
              thumbMemoryCache.set(key, null);
              inflightThumbKeys.delete(key);
            }
          }
        }
      }
    } catch {
      for (const file of candidates) {
        inflightThumbKeys.delete(thumbCacheKey(file.channelId, file.messageId));
      }
    }
  })();

  return () => {
    cancelled = true;
    for (const file of candidates) {
      const key = thumbCacheKey(file.channelId, file.messageId);
      if (!thumbMemoryCache.has(key)) {
        inflightThumbKeys.delete(key);
      }
    }
  };
}

