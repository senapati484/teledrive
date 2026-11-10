import { getClient } from "./client";
import { canonicalChannelId } from "./peerId";
import { getPlatform } from "../platform";
import { save as tauriSaveDialog } from "@tauri-apps/plugin-dialog";
import {
  discardDownloadFile,
  finalizeDownloadFile,
  writeDownloadChunk,
} from "../storage/downloadStreamWriter";
import { useTransferStore } from "../../stores/transferStore";
import {
  concatChunks,
  downloadEta,
  downloadPercent,
  downloadSpeed,
} from "../transfer/downloadMath";
import { toast } from "sonner";
import i18n from "@/i18n";

const DOWNLOAD_CHUNK_SIZE = 512 * 1024;
const DESKTOP_WRITE_BATCH_BYTES = 2 * 1024 * 1024;
// Keep Android WebView JNI IPC payloads compact (~682 KB base64 per flush).
const ANDROID_WRITE_BATCH_BYTES = 512 * 1024;
const PROGRESS_THROTTLE_MS = 200;
const PAUSE_POLL_MS = 100;

function getWriteBatchBytes(): number {
  return getPlatform() === "android"
    ? ANDROID_WRITE_BATCH_BYTES
    : DESKTOP_WRITE_BATCH_BYTES;
}

interface DownloadJob {
  id: string;
  channelId: string;
  messageId: number;
  name: string;
  targetPath: string;
  peer: any;
  media: any;
  size: number;
  received: number;
  written: number;
  pending: Uint8Array[];
  pendingBytes: number;
  state: "running" | "paused" | "cancelling";
  running: boolean;
  lastTickAt: number;
  lastTickBytes: number;
  onProgress?: (progress: number) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const activeDownloads = new Map<string, DownloadJob>();

/**
 * Writes buffered chunks in batches so a large download keeps only a few MiB
 * in memory without paying IPC overhead for every 512 KiB Telegram chunk.
 */
async function flushDownloadBuffer(job: DownloadJob): Promise<void> {
  if (job.pendingBytes <= 0) return;
  const merged = concatChunks(job.pending, job.pendingBytes);
  job.pending = [];
  job.pendingBytes = 0;
  await writeDownloadChunk(job.targetPath, merged, job.written > 0);
  job.written += merged.length;
}

function updateProgress(job: DownloadJob, force = false): void {
  const now = Date.now();
  const elapsed = now - job.lastTickAt;
  if (!force && elapsed < PROGRESS_THROTTLE_MS) return;

  const bytes = job.received;
  const progress = Math.min(99, downloadPercent(bytes, job.size));
  const rawSpeed = downloadSpeed(bytes, job.lastTickBytes, elapsed);
  const speed = rawSpeed > 0 ? rawSpeed : undefined;
  const eta =
    speed !== undefined ? downloadEta(job.size, bytes, speed) : undefined;

  useTransferStore.getState().updateDownload(job.id, {
    progress,
    receivedBytes: bytes,
    speed,
    eta,
  });
  job.lastTickAt = now;
  job.lastTickBytes = bytes;
  job.onProgress?.(progress);
}

async function runDownload(job: DownloadJob): Promise<void> {
  if (job.running) return;
  job.running = true;

  const store = useTransferStore.getState();
  store.updateDownload(job.id, { status: "downloading", error: undefined });

  job.lastTickAt = Date.now();
  job.lastTickBytes = job.received;

  try {
    const client = getClient();
    if (!client.connected) {
      await client.connect();
    }

    // Keep one iterator alive for the whole transfer so pausing only stops
    // consuming chunks — resuming never restarts the offset and cannot race
    // with a previous loop appending to the same file.
    const iterator = client.iterDownload({
      file: job.media,
      requestSize: DOWNLOAD_CHUNK_SIZE,
      msgData: [job.peer, job.messageId],
    });

    for await (const rawChunk of iterator) {
      let state: string = job.state;
      if (state === "cancelling") break;

      while (state === "paused") {
        await sleep(PAUSE_POLL_MS);
        state = job.state;
        if (state === "cancelling") break;
      }
      if (state === "cancelling") break;

      const chunk =
        rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(rawChunk);
      job.pending.push(chunk);
      job.pendingBytes += chunk.length;
      job.received += chunk.length;
      if (job.pendingBytes >= getWriteBatchBytes()) {
        await flushDownloadBuffer(job);
      }
      updateProgress(job);
    }

    if (job.state === "cancelling") {
      await discardDownloadFile(job.targetPath);
      activeDownloads.delete(job.id);
      useTransferStore.getState().updateDownload(job.id, {
        status: "cancelled",
        speed: undefined,
        eta: undefined,
      });
      return;
    }

    if (job.received <= 0) {
      throw new Error(i18n.t("messages:download.errors.mediaFailed"));
    }

    await flushDownloadBuffer(job);
    updateProgress(job, true);

    useTransferStore.getState().updateDownload(job.id, {
      status: "saving",
      progress: 100,
      receivedBytes: job.received,
      speed: undefined,
      eta: undefined,
    });
    job.onProgress?.(100);

    await finalizeDownloadFile(job.targetPath);

    activeDownloads.delete(job.id);
    useTransferStore.getState().updateDownload(job.id, {
      status: "done",
      progress: 100,
      receivedBytes: job.received,
    });
  } catch (error: any) {
    const cancelled = job.state === "cancelling";
    await discardDownloadFile(job.targetPath);
    activeDownloads.delete(job.id);
    useTransferStore.getState().updateDownload(job.id, {
      status: cancelled ? "cancelled" : "error",
      error: cancelled ? undefined : error?.message || String(error),
      speed: undefined,
      eta: undefined,
    });
    if (!cancelled) {
      console.error("[downloader] Download failed:", error);
      toast.error(i18n.t("messages:download.failed"));
    }
  } finally {
    job.running = false;
  }
}

/**
 * Pause an in-flight download. The iterator stays open and the bytes already
 * written are kept, so resuming continues from the same position.
 */
export function pauseDownload(id: string): void {
  const job = activeDownloads.get(id);
  if (!job || !job.running || job.state !== "running") return;
  if (job.size > 0 && job.received >= job.size) return;
  job.state = "paused";
  updateProgress(job, true);
  useTransferStore.getState().updateDownload(id, {
    status: "paused",
    speed: undefined,
    eta: undefined,
  });
}

/** Resume a paused download from the last fully received chunk. */
export function resumeDownload(id: string): void {
  const job = activeDownloads.get(id);
  if (!job || !job.running || job.state !== "paused") return;
  job.state = "running";
  job.lastTickAt = Date.now();
  job.lastTickBytes = job.received;
  useTransferStore.getState().updateDownload(id, {
    status: "downloading",
    error: undefined,
  });
}

/** Cancel a download and discard its partial file. */
export function cancelDownload(id: string): void {
  const job = activeDownloads.get(id);
  if (!job) {
    useTransferStore.getState().removeDownload(id);
    return;
  }
  job.state = "cancelling";
  activeDownloads.delete(id);
  useTransferStore.getState().updateDownload(id, {
    status: "cancelled",
    speed: undefined,
    eta: undefined,
  });
}

/**
 * Safely converts any value (number, bigint, or bigInt.BigInteger object) to a standard JS number.
 */
function toNumber(val: any): number {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "object" && typeof val.toJSNumber === "function") {
    return val.toJSNumber();
  }
  const n = Number(val);
  return isFinite(n) ? n : 0;
}

/**
 * Safely resolves a channel ID string to a peer entity for GramJS client queries.
 */
async function resolvePeer(channelId: string): Promise<any> {
  const client = getClient();
  const id = canonicalChannelId(channelId);
  try {
    return await client.getInputEntity(id);
  } catch (err) {
    console.warn(`[downloader] getInputEntity failed for ${id}, trying getEntity:`, err);
    return await client.getEntity(id);
  }
}

/**
 * Downloads a file from the Telegram channel and saves it to disk using Tauri file dialog.
 */
export async function downloadFileFromTelegram(
  channelId: string,
  messageId: number,
  fileName: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  try {
    const client = getClient();
    if (!client.connected) {
      console.log("[downloader] Client disconnected, reconnecting...");
      await client.connect();
    }

    const peer = await resolvePeer(channelId);
    const messages = await client.getMessages(peer, {
      ids: [messageId],
    });

    const message = messages[0];
    if (!message || !message.media) {
      throw new Error(i18n.t("messages:download.errors.mediaNotFound"));
    }

    const size = toNumber(
      (message as any).file?.size ??
        (message.media as any)?.document?.size ??
        0
    );

    // Ask where to save before burning bandwidth.
    const safeFileName =
      fileName.replace(/[/\\?%*:|"<>]/g, "_").trim() || "download";
    const targetPath = await tauriSaveDialog({
      defaultPath: safeFileName,
    });

    if (!targetPath) {
      toast.info(i18n.t("messages:download.cancelled"));
      return;
    }

    const id = `${channelId}:${messageId}:${Date.now()}`;
    useTransferStore.getState().addDownload({
      id,
      name: fileName,
      size,
      progress: 0,
      receivedBytes: 0,
      status: "downloading",
      channelId,
      messageId,
    });

    const job: DownloadJob = {
      id,
      channelId,
      messageId,
      name: fileName,
      targetPath,
      peer,
      media: message.media,
      size,
      received: 0,
      written: 0,
      pending: [],
      pendingBytes: 0,
      state: "running",
      running: false,
      lastTickAt: Date.now(),
      lastTickBytes: 0,
      onProgress,
    };

    activeDownloads.set(id, job);
    void runDownload(job);
  } catch (error: any) {
    console.error("Failed to download file:", error);
    toast.error(i18n.t("messages:download.failed"));
    throw error;
  }
}

/**
 * Streams a Telegram file directly to a local filesystem path in bounded batches
 * without accumulating the full file in JavaScript RAM.
 * Supports AbortSignal cancellation and automatically cleans up partial temp files.
 */
export async function streamFileToLocalPath(
  channelId: string,
  messageId: number,
  targetPath: string,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
  expectedSize = 0
): Promise<number> {
  if (signal?.aborted) {
    throw new DOMException("Download aborted", "AbortError");
  }

  const client = getClient();
  if (!client.connected) {
    await client.connect();
  }
  if (signal?.aborted) {
    throw new DOMException("Download aborted", "AbortError");
  }

  const peer = await resolvePeer(channelId);
  const messages = await client.getMessages(peer, {
    ids: [messageId],
  });

  const message = messages[0];
  if (!message || !message.media) {
    throw new Error(i18n.t("messages:download.errors.mediaNotFound"));
  }

  const size = toNumber(
    (message as any).file?.size ??
      (message.media as any)?.document?.size ??
      expectedSize
  );

  const batchLimit = getWriteBatchBytes();
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let received = 0;
  let written = 0;
  let lastProgressPct = -1;

  const flushBatch = async () => {
    if (pendingBytes <= 0) return;
    const merged = concatChunks(pending, pendingBytes);
    pending = [];
    pendingBytes = 0;
    await writeDownloadChunk(targetPath, merged, written > 0);
    written += merged.length;
  };

  try {
    const iterator = client.iterDownload({
      file: message.media,
      requestSize: DOWNLOAD_CHUNK_SIZE,
      msgData: [peer, messageId],
    });

    for await (const rawChunk of iterator) {
      if (signal?.aborted) {
        await discardDownloadFile(targetPath);
        throw new DOMException("Download aborted", "AbortError");
      }
      const chunk =
        rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(rawChunk);
      pending.push(chunk);
      pendingBytes += chunk.length;
      received += chunk.length;

      if (pendingBytes >= batchLimit) {
        await flushBatch();
      }

      if (size > 0) {
        const pct = Math.min(99, downloadPercent(received, size));
        if (pct !== lastProgressPct) {
          lastProgressPct = pct;
          onProgress?.(pct);
        }
      }
    }

    if (signal?.aborted) {
      await discardDownloadFile(targetPath);
      throw new DOMException("Download aborted", "AbortError");
    }

    if (received <= 0) {
      throw new Error(i18n.t("messages:download.errors.mediaFailed"));
    }

    await flushBatch();
    await finalizeDownloadFile(targetPath);
    onProgress?.(100);
    return received;
  } catch (err) {
    await discardDownloadFile(targetPath);
    throw err;
  }
}

/**
 * Downloads at most `maxBytes` from the start of a Telegram file into memory.
 * Stops chunk iteration early so previewing huge text/log/CSV files or sniffing
 * unknown binary headers never downloads or buffers the entire file in RAM.
 */
export async function downloadFilePrefixToBuffer(
  channelId: string,
  messageId: number,
  maxBytes: number,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal
): Promise<{ data: Uint8Array; truncated: boolean; totalSize: number }> {
  if (signal?.aborted) {
    throw new DOMException("Download aborted", "AbortError");
  }

  const client = getClient();
  if (!client.connected) {
    await client.connect();
  }
  if (signal?.aborted) {
    throw new DOMException("Download aborted", "AbortError");
  }

  const peer = await resolvePeer(channelId);
  const messages = await client.getMessages(peer, {
    ids: [messageId],
  });

  const message = messages[0];
  if (!message || !message.media) {
    throw new Error(i18n.t("messages:download.errors.mediaNotFound"));
  }

  const totalSize = toNumber(
    (message as any).file?.size ??
      (message.media as any)?.document?.size ??
      0
  );
  const requestSize =
    maxBytes <= 64 * 1024 ? 64 * 1024 : DOWNLOAD_CHUNK_SIZE;
  const progressDenominator =
    totalSize > 0 ? Math.min(totalSize, maxBytes) : maxBytes;

  const chunks: Uint8Array[] = [];
  let received = 0;

  const iterator = client.iterDownload({
    file: message.media,
    requestSize,
    msgData: [peer, messageId],
  });

  for await (const rawChunk of iterator) {
    if (signal?.aborted) {
      throw new DOMException("Download aborted", "AbortError");
    }
    const chunk =
      rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(rawChunk);
    if (chunk.length === 0) continue;

    const remaining = maxBytes - received;
    if (remaining <= 0) break;

    if (chunk.length > remaining) {
      chunks.push(chunk.subarray(0, remaining));
      received += remaining;
    } else {
      chunks.push(chunk);
      received += chunk.length;
    }

    if (progressDenominator > 0) {
      onProgress?.(Math.min(99, downloadPercent(received, progressDenominator)));
    }
    if (received >= maxBytes) {
      break;
    }
  }

  if (signal?.aborted) {
    throw new DOMException("Download aborted", "AbortError");
  }
  if (received <= 0) {
    throw new Error(i18n.t("messages:download.errors.mediaFailed"));
  }

  onProgress?.(100);
  const data = concatChunks(chunks, received);
  const truncated = totalSize > 0 ? totalSize > data.length : received >= maxBytes;
  return { data, truncated, totalSize };
}

/**
 * Downloads a file's media from Telegram into a memory buffer (Uint8Array).
 * Primarily used for smaller in-app file previews (text, images, PDFs).
 */
export async function downloadFileToBuffer(
  channelId: string,
  messageId: number,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (signal?.aborted) {
    throw new DOMException("Download aborted", "AbortError");
  }
  const client = getClient();
  
  try {
    if (!client.connected) {
      console.log("[downloader] Client disconnected, reconnecting...");
      await client.connect();
    }
    if (signal?.aborted) {
      throw new DOMException("Download aborted", "AbortError");
    }
    
    const peer = await resolvePeer(channelId);
    const messages = await client.getMessages(peer, {
      ids: [messageId],
    });
    
    const message = messages[0];
    if (!message || !message.media) {
      throw new Error(i18n.t("messages:download.errors.mediaNotFound"));
    }
    
    const buffer = (await client.downloadMedia(message.media, {
      progressCallback: (downloadedBytes: any, totalBytes: any) => {
        if (signal?.aborted) return;
        const downloaded = toNumber(downloadedBytes);
        const total = toNumber(totalBytes);
        if (total > 0) {
          const pct = Math.round((downloaded / total) * 100);
          onProgress?.(pct);
        }
      },
    })) as any;

    if (signal?.aborted) {
      throw new DOMException("Download aborted", "AbortError");
    }
    
    if (!buffer) {
      throw new Error(i18n.t("messages:download.errors.mediaFailed"));
    }
    
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(buffer)) {
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else if (buffer instanceof Uint8Array) {
      return buffer;
    } else if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
    return new Uint8Array(buffer);
  } catch (error: any) {
    if (error?.name !== "AbortError") {
      console.error("Failed to download file to buffer:", error);
    }
    throw error;
  }
}
