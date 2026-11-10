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
import type { TeleFileEncryption, TeleFileSegment } from "../types";
import {
  EncryptionError,
  requireEncryptionKey,
  StreamDecryptor,
  useEncryptionStore,
} from "../secure/e2ee";
import {
  DEFAULT_DOWNLOAD_CONCURRENCY,
  iteratePipelinedDownloadParts,
} from "./pipelinedDownload";
import { isWebRuntime, triggerBrowserBlobDownload } from "../runtime/bridge";

export interface DownloadFileOptions {
  segments?: TeleFileSegment[];
  enc?: TeleFileEncryption;
  encryptionKey?: CryptoKey | null;
  plainSize?: number;
}

const DOWNLOAD_CHUNK_SIZE = 512 * 1024;
const DESKTOP_WRITE_BATCH_BYTES = 2 * 1024 * 1024;
// Keep Android WebView JNI IPC payloads compact (~682 KB base64 per flush).
const ANDROID_WRITE_BATCH_BYTES = 512 * 1024;
const PROGRESS_THROTTLE_MS = 200;
const PAUSE_POLL_MS = 100;

export function getWriteBatchBytes(): number {
  return getPlatform() === "android"
    ? ANDROID_WRITE_BATCH_BYTES
    : DESKTOP_WRITE_BATCH_BYTES;
}

export interface ExternalTransferControl {
  pause?: () => void;
  resume?: () => void;
  cancel?: () => void;
}

const externalTransferControls = new Map<string, ExternalTransferControl>();

export function registerExternalTransferControl(
  id: string,
  control: ExternalTransferControl
): void {
  externalTransferControls.set(id, control);
}

export function unregisterExternalTransferControl(id: string): void {
  externalTransferControls.delete(id);
}

interface ResolvedDownloadSegment {
  messageId: number;
  media: any;
  size: number;
}

interface DownloadJob {
  id: string;
  channelId: string;
  messageId: number;
  name: string;
  targetPath: string;
  peer: any;
  media: any;
  segments: ResolvedDownloadSegment[];
  decryptor: StreamDecryptor | null;
  size: number;
  received: number;
  written: number;
  pending: Uint8Array[];
  pendingBytes: number;
  state: "running" | "paused" | "cancelling";
  abortController: AbortController;
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

    const waitWhilePaused = async (): Promise<boolean> => {
      while ((job.state as string) === "paused") {
        await sleep(PAUSE_POLL_MS);
      }
      return (job.state as string) !== "cancelling";
    };

    for (const seg of job.segments) {
      if ((job.state as string) === "cancelling") break;

      const iterator = iteratePipelinedDownloadParts({
        client,
        media: seg.media,
        peer: job.peer,
        messageId: seg.messageId,
        fileSize: seg.size,
        requestSize: DOWNLOAD_CHUNK_SIZE,
        concurrency: DEFAULT_DOWNLOAD_CONCURRENCY,
        signal: job.abortController.signal,
        waitWhilePaused,
      });

      for await (const wireChunk of iterator) {
        if ((job.state as string) === "cancelling") break;
        const outChunk = job.decryptor
          ? await job.decryptor.pushChunk(wireChunk)
          : wireChunk;

        if (outChunk.length > 0) {
          job.pending.push(outChunk);
          job.pendingBytes += outChunk.length;
          job.received += outChunk.length;
          if (job.pendingBytes >= getWriteBatchBytes()) {
            await flushDownloadBuffer(job);
          }
          updateProgress(job);
        }
      }
    }

    if ((job.state as string) === "cancelling") {
      await discardDownloadFile(job.targetPath);
      activeDownloads.delete(job.id);
      useTransferStore.getState().updateDownload(job.id, {
        status: "cancelled",
        speed: undefined,
        eta: undefined,
      });
      return;
    }

    if (job.decryptor) {
      job.decryptor.finish();
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
    if (
      error instanceof EncryptionError &&
      error.code === "invalid_passphrase" &&
      !useEncryptionStore.getState().configured
    ) {
      void useEncryptionStore.getState().lock();
    }
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
      toast.error(error?.message || i18n.t("messages:download.failed"));
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
  const ext = externalTransferControls.get(id);
  if (ext?.pause) {
    ext.pause();
    return;
  }
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
  const ext = externalTransferControls.get(id);
  if (ext?.resume) {
    ext.resume();
    return;
  }
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
  const ext = externalTransferControls.get(id);
  if (ext?.cancel) {
    ext.cancel();
    return;
  }
  const job = activeDownloads.get(id);
  if (!job) {
    useTransferStore.getState().removeDownload(id);
    return;
  }
  job.state = "cancelling";
  job.abortController.abort();
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

export async function resolveDownloadSegments(
  channelId: string,
  messageId: number,
  options?: DownloadFileOptions
): Promise<{ peer: any; segments: ResolvedDownloadSegment[]; totalSize: number }> {
  const client = getClient();
  if (!client.connected) {
    await client.connect();
  }

  const peer = await resolvePeer(channelId);
  const segSpecs =
    options?.segments && options.segments.length > 0
      ? options.segments
      : [{ messageId, size: 0 }];

  const messages = await client.getMessages(peer, {
    ids: segSpecs.map((s) => s.messageId),
  });
  const byId = new Map<number, any>();
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m?.id) byId.set(Number(m.id), m);
  }

  const resolved: ResolvedDownloadSegment[] = [];
  let wireTotal = 0;

  for (let i = 0; i < segSpecs.length; i++) {
    const spec = segSpecs[i];
    let msg = byId.get(Number(spec.messageId));
    if (!msg && segSpecs.length === 1 && Array.isArray(messages) && messages.length === 1) {
      msg = messages[0];
    }
    if (!msg || !msg.media) {
      throw new Error(i18n.t("messages:download.errors.mediaNotFound"));
    }
    const segSize = toNumber(
      (msg as any).file?.size ??
        (msg.media as any)?.document?.size ??
        spec.size ??
        0
    );
    wireTotal += segSize;
    resolved.push({
      messageId: Number(spec.messageId),
      media: msg.media,
      size: segSize,
    });
  }

  const totalSize = options?.plainSize ?? options?.enc?.plainSize ?? wireTotal;
  return { peer, segments: resolved, totalSize };
}

/**
 * Unified multi-segment & E2EE plaintext chunk stream used across disk streaming,
 * preview prefix reads, ZIP bundling, and memory buffer fallbacks.
 */
export async function* iterateTelegramPlainChunks(params: {
  peer: any;
  segments: ResolvedDownloadSegment[];
  enc?: TeleFileEncryption;
  encryptionKey?: CryptoKey | null;
  requestSize?: number;
  signal?: AbortSignal;
}): AsyncGenerator<Uint8Array> {
  const client = getClient();
  const decryptor =
    params.enc && params.enc.v === 1
      ? new StreamDecryptor(
          params.encryptionKey ?? (await requireEncryptionKey(params.enc.s))
        )
      : null;

  let finishedAllSegments = false;
  try {
    for (const seg of params.segments) {
      if (params.signal?.aborted) {
        throw new DOMException("Download aborted", "AbortError");
      }
      const iterator = iteratePipelinedDownloadParts({
        client,
        media: seg.media,
        peer: params.peer,
        messageId: seg.messageId,
        fileSize: seg.size,
        requestSize: params.requestSize ?? DOWNLOAD_CHUNK_SIZE,
        concurrency: DEFAULT_DOWNLOAD_CONCURRENCY,
        signal: params.signal,
      });

      for await (const wireChunk of iterator) {
        if (params.signal?.aborted) {
          throw new DOMException("Download aborted", "AbortError");
        }
        const outChunk = decryptor ? await decryptor.pushChunk(wireChunk) : wireChunk;
        if (outChunk.length > 0) {
          yield outChunk;
        }
      }
    }

    if (params.signal?.aborted) {
      throw new DOMException("Download aborted", "AbortError");
    }
    if (decryptor) {
      decryptor.finish();
    }
    finishedAllSegments = true;
  } catch (err: any) {
    if (
      err instanceof EncryptionError &&
      err.code === "invalid_passphrase" &&
      !useEncryptionStore.getState().configured
    ) {
      void useEncryptionStore.getState().lock();
    }
    throw err;
  } finally {
    // Do not validate stream EOF truncation if caller intentionally broke early
    // (e.g., prefix inspection at 64 KiB).
    void finishedAllSegments;
  }
}

/**
 * Downloads a file from the Telegram channel and saves it to disk using Tauri file dialog.
 */
export async function downloadFileFromTelegram(
  channelId: string,
  messageId: number,
  fileName: string,
  onProgress?: (progress: number) => void,
  options?: DownloadFileOptions
): Promise<void> {
  try {
    let decryptionKey: CryptoKey | null = options?.encryptionKey ?? null;
    if (options?.enc && options.enc.v === 1 && !decryptionKey) {
      decryptionKey = await requireEncryptionKey(options.enc.s);
    }

    const { peer, segments, totalSize } = await resolveDownloadSegments(
      channelId,
      messageId,
      options
    );

    // Ask where to save before burning bandwidth.
    const safeFileName =
      fileName.replace(/[/\\?%*:|"<>]/g, "_").trim() || "download";

    if (isWebRuntime()) {
      const BROWSER_DOWNLOAD_RAM_LIMIT = 1.5 * 1024 * 1024 * 1024;
      if (totalSize > BROWSER_DOWNLOAD_RAM_LIMIT) {
        throw new Error(
          "Files larger than 1.5 GiB require the desktop or mobile app to stream directly to disk."
        );
      }
      const id = `${channelId}:${messageId}:${Date.now()}`;
      const ac = new AbortController();
      let paused = false;
      registerExternalTransferControl(id, {
        pause: () => {
          paused = true;
          useTransferStore.getState().updateDownload(id, { status: "paused", speed: undefined, eta: undefined });
        },
        resume: () => {
          paused = false;
          useTransferStore.getState().updateDownload(id, { status: "downloading", error: undefined });
        },
        cancel: () => {
          ac.abort();
          unregisterExternalTransferControl(id);
          useTransferStore.getState().updateDownload(id, { status: "cancelled", speed: undefined, eta: undefined });
        },
      });
      useTransferStore.getState().addDownload({
        id,
        name: fileName,
        size: totalSize,
        progress: 0,
        receivedBytes: 0,
        status: "downloading",
        channelId,
        messageId,
      });

      const chunks: Uint8Array[] = [];
      let received = 0;
      let lastTickAt = Date.now();
      let lastTickBytes = 0;
      try {
        for await (const chunk of iterateTelegramPlainChunks({
          peer,
          segments,
          enc: options?.enc,
          encryptionKey: decryptionKey,
          requestSize: DOWNLOAD_CHUNK_SIZE,
          signal: ac.signal,
        })) {
          while (paused && !ac.signal.aborted) {
            await sleep(PAUSE_POLL_MS);
          }
          if (ac.signal.aborted) break;
          chunks.push(chunk);
          received += chunk.length;
          const now = Date.now();
          const elapsed = now - lastTickAt;
          if (elapsed >= PROGRESS_THROTTLE_MS) {
            const pct = Math.min(99, downloadPercent(received, totalSize));
            const rawSpeed = downloadSpeed(received, lastTickBytes, elapsed);
            const speed = rawSpeed > 0 ? rawSpeed : undefined;
            const eta = speed !== undefined ? downloadEta(totalSize, received, speed) : undefined;
            useTransferStore.getState().updateDownload(id, {
              progress: pct,
              receivedBytes: received,
              speed,
              eta,
            });
            onProgress?.(pct);
            lastTickAt = now;
            lastTickBytes = received;
          }
        }
        if (ac.signal.aborted) return;
        const blob = new Blob(chunks as BlobPart[]);
        triggerBrowserBlobDownload(blob, safeFileName);
        onProgress?.(100);
        useTransferStore.getState().updateDownload(id, {
          status: "done",
          progress: 100,
          receivedBytes: received,
          speed: undefined,
          eta: undefined,
        });
      } catch (err: any) {
        if (!ac.signal.aborted) {
          useTransferStore.getState().updateDownload(id, {
            status: "error",
            error: err?.message || String(err),
            speed: undefined,
            eta: undefined,
          });
          throw err;
        }
      } finally {
        unregisterExternalTransferControl(id);
      }
      return;
    }

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
      size: totalSize,
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
      media: segments[0].media,
      segments,
      decryptor: decryptionKey ? new StreamDecryptor(decryptionKey) : null,
      size: totalSize,
      received: 0,
      written: 0,
      pending: [],
      pendingBytes: 0,
      state: "running",
      abortController: new AbortController(),
      running: false,
      lastTickAt: Date.now(),
      lastTickBytes: 0,
      onProgress,
    };

    activeDownloads.set(id, job);
    void runDownload(job);
  } catch (error: any) {
    console.error("Failed to download file:", error);
    if (error instanceof EncryptionError && error.code === "locked") {
      return;
    }
    toast.error(error?.message || i18n.t("messages:download.failed"));
    throw error;
  }
}

/**
 * Streams a Telegram file (single or multi-segment, plain or E2EE) directly to
 * a local filesystem path in bounded batches without buffering in JavaScript RAM.
 */
export async function streamFileToLocalPath(
  channelId: string,
  messageId: number,
  targetPath: string,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
  expectedSize = 0,
  options?: DownloadFileOptions
): Promise<number> {
  if (signal?.aborted) {
    throw new DOMException("Download aborted", "AbortError");
  }

  let decryptionKey: CryptoKey | null = options?.encryptionKey ?? null;
  if (options?.enc && options.enc.v === 1 && !decryptionKey) {
    decryptionKey = await requireEncryptionKey(options.enc.s);
  }

  const { peer, segments, totalSize } = await resolveDownloadSegments(
    channelId,
    messageId,
    options
  );
  const effectiveSize = totalSize > 0 ? totalSize : expectedSize;

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
    for await (const chunk of iterateTelegramPlainChunks({
      peer,
      segments,
      enc: options?.enc,
      encryptionKey: decryptionKey,
      requestSize: DOWNLOAD_CHUNK_SIZE,
      signal,
    })) {
      if (signal?.aborted) {
        await discardDownloadFile(targetPath);
        throw new DOMException("Download aborted", "AbortError");
      }
      pending.push(chunk);
      pendingBytes += chunk.length;
      received += chunk.length;

      if (pendingBytes >= batchLimit) {
        await flushBatch();
      }

      if (effectiveSize > 0) {
        const pct = Math.min(99, downloadPercent(received, effectiveSize));
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
 * Downloads at most `maxBytes` of plaintext from the start of a Telegram file into memory.
 */
export async function downloadFilePrefixToBuffer(
  channelId: string,
  messageId: number,
  maxBytes: number,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
  options?: DownloadFileOptions
): Promise<{ data: Uint8Array; truncated: boolean; totalSize: number }> {
  if (signal?.aborted) {
    throw new DOMException("Download aborted", "AbortError");
  }

  let decryptionKey: CryptoKey | null = options?.encryptionKey ?? null;
  if (options?.enc && options.enc.v === 1 && !decryptionKey) {
    decryptionKey = await requireEncryptionKey(options.enc.s);
  }

  const { peer, segments, totalSize } = await resolveDownloadSegments(
    channelId,
    messageId,
    options
  );

  // For E2EE streams, block 0 framing requires >= 512 KiB chunks to yield decrypted output cleanly.
  const requestSize =
    options?.enc?.v === 1
      ? DOWNLOAD_CHUNK_SIZE
      : maxBytes <= 64 * 1024
      ? 64 * 1024
      : DOWNLOAD_CHUNK_SIZE;
  const progressDenominator =
    totalSize > 0 ? Math.min(totalSize, maxBytes) : maxBytes;

  const chunks: Uint8Array[] = [];
  let received = 0;

  for await (const chunk of iterateTelegramPlainChunks({
    peer,
    segments,
    enc: options?.enc,
    encryptionKey: decryptionKey,
    requestSize,
    signal,
  })) {
    if (signal?.aborted) {
      throw new DOMException("Download aborted", "AbortError");
    }
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
 * Downloads a file's media (plain, encrypted, or multi-segment) into memory.
 */
export async function downloadFileToBuffer(
  channelId: string,
  messageId: number,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
  options?: DownloadFileOptions
): Promise<Uint8Array> {
  if (signal?.aborted) {
    throw new DOMException("Download aborted", "AbortError");
  }

  // Fast path: when multi-segment or E2EE is involved, stream sequentially and decrypt.
  if (options?.enc?.v === 1 || (options?.segments && options.segments.length > 1)) {
    let decryptionKey: CryptoKey | null = options?.encryptionKey ?? null;
    if (options?.enc && options.enc.v === 1 && !decryptionKey) {
      decryptionKey = await requireEncryptionKey(options.enc.s);
    }
    const { peer, segments, totalSize } = await resolveDownloadSegments(
      channelId,
      messageId,
      options
    );
    const chunks: Uint8Array[] = [];
    let received = 0;
    for await (const chunk of iterateTelegramPlainChunks({
      peer,
      segments,
      enc: options?.enc,
      encryptionKey: decryptionKey,
      requestSize: DOWNLOAD_CHUNK_SIZE,
      signal,
    })) {
      chunks.push(chunk);
      received += chunk.length;
      if (totalSize > 0) {
        onProgress?.(Math.min(99, downloadPercent(received, totalSize)));
      }
    }
    if (received <= 0) {
      throw new Error(i18n.t("messages:download.errors.mediaFailed"));
    }
    onProgress?.(100);
    return concatChunks(chunks, received);
  }

  const client = getClient();
  try {
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

    const buffer = (await client.downloadMedia(message.media, {
      progressCallback: (downloadedBytes: any, totalBytes: any) => {
        if (signal?.aborted) return;
        const downloaded = toNumber(downloadedBytes);
        const total = toNumber(totalBytes);
        if (total > 0) {
          onProgress?.(Math.round((downloaded / total) * 100));
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
