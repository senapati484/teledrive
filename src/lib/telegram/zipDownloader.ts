import { Zip, ZipPassThrough } from "fflate";
import { save as tauriSaveDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import i18n from "@/i18n";

import { useTransferStore } from "../../stores/transferStore";
import {
  discardDownloadFile,
  finalizeDownloadFile,
  writeDownloadChunk,
} from "../storage/downloadStreamWriter";
import { concatChunks, downloadEta, downloadPercent, downloadSpeed } from "../transfer/downloadMath";
import { normalizeFolderPath } from "../utils";
import type { TeleFile } from "../types";
import { getClient } from "./client";
import {
  getWriteBatchBytes,
  iterateTelegramPlainChunks,
  registerExternalTransferControl,
  resolveDownloadSegments,
  unregisterExternalTransferControl,
} from "./downloader";
import { EncryptionError, requireEncryptionKey } from "../secure/e2ee";

const PROGRESS_THROTTLE_MS = 200;
const PAUSE_POLL_MS = 100;

const DIRECTORY_MIMES = new Set(["inode/directory", "application/x-directory"]);

function isDirectoryEntry(file: Pick<TeleFile, "mime">): boolean {
  return DIRECTORY_MIMES.has(file.mime);
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as any).__TAURI_INTERNALS__)
  );
}

function sanitizeZipSegment(segment: string): string {
  return segment.replace(/[\0<>:"/\\|?*]/g, "_").trim() || "item";
}

function dedupeArchivePath(rawPath: string, usedPaths: Set<string>): string {
  if (!usedPaths.has(rawPath)) {
    usedPaths.add(rawPath);
    return rawPath;
  }

  const slash = rawPath.lastIndexOf("/");
  const dir = slash >= 0 ? rawPath.slice(0, slash + 1) : "";
  const base = slash >= 0 ? rawPath.slice(slash + 1) : rawPath;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";

  let counter = 2;
  while (true) {
    const candidate = `${dir}${stem} (${counter})${ext}`;
    if (!usedPaths.has(candidate)) {
      usedPaths.add(candidate);
      return candidate;
    }
    counter++;
  }
}

export interface ZipExportEntry {
  file: TeleFile;
  archivePath: string;
}

/**
 * Resolves a flat list of archive entries `{ file, archivePath }` for any
 * combination of files and folders while preserving nested subfolder paths,
 * ignoring trashed descendants, deduplicating nested selections, and making
 * every ZIP entry path unique.
 */
export function collectFilesForZipExport(
  allFiles: TeleFile[],
  selectedItems: TeleFile[]
): ZipExportEntry[] {
  const seenFileIds = new Set<string>();
  const usedPaths = new Set<string>();
  const entries: ZipExportEntry[] = [];

  const nonTrashedFiles = allFiles.filter(
    (f) => !isDirectoryEntry(f) && !f.trashed && Number(f.messageId) > 0
  );

  for (const item of selectedItems) {
    if (isDirectoryEntry(item)) {
      const folderParent = normalizeFolderPath(item.folderPath);
      const folderFullPath =
        folderParent === "/"
          ? `/${item.name}`
          : `${folderParent}/${item.name}`;
      const rootFolderName = sanitizeZipSegment(item.name);

      const descendants = nonTrashedFiles
        .filter((f) => {
          const fp = normalizeFolderPath(f.folderPath);
          return fp === folderFullPath || fp.startsWith(`${folderFullPath}/`);
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const desc of descendants) {
        if (seenFileIds.has(desc.id)) continue;
        seenFileIds.add(desc.id);

        const fp = normalizeFolderPath(desc.folderPath);
        const relSub = fp.slice(folderFullPath.length).replace(/^\/+/, "");
        const subSegments = relSub
          ? relSub.split("/").filter(Boolean).map(sanitizeZipSegment)
          : [];
        const rawPath = [
          rootFolderName,
          ...subSegments,
          sanitizeZipSegment(desc.name),
        ].join("/");

        entries.push({
          file: desc,
          archivePath: dedupeArchivePath(rawPath, usedPaths),
        });
      }
      continue;
    }

    if (item.trashed || !item.messageId || item.messageId <= 0) continue;
    if (seenFileIds.has(item.id)) continue;
    seenFileIds.add(item.id);

    entries.push({
      file: item,
      archivePath: dedupeArchivePath(sanitizeZipSegment(item.name), usedPaths),
    });
  }

  return entries;
}

export function suggestZipArchiveName(selectedItems: TeleFile[]): string {
  if (selectedItems.length === 1) {
    const base = sanitizeZipSegment(selectedItems[0].name).replace(/\.zip$/i, "");
    return `${base || "teledrive-archive"}.zip`;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return `teledrive-files-${stamp}.zip`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Streams one or more selected TeleDrive files/folders into a single `.zip`
 * archive using `fflate` zero-copy streaming (`ZipPassThrough`) piped straight
 * into disk batches (`writeDownloadChunk`), keeping memory bounded cleanly.
 */
export async function downloadSelectionAsZip(
  allFiles: TeleFile[],
  selectedItems: TeleFile[]
): Promise<void> {
  const entries = collectFilesForZipExport(allFiles, selectedItems);
  if (entries.length === 0) {
    toast.info(
      i18n.t("messages:download.zipEmpty", {
        defaultValue: "No downloadable files found in the selection.",
      })
    );
    return;
  }

  const keyBySalt = new Map<string, CryptoKey>();
  for (const entry of entries) {
    const salt = entry.file.enc?.v === 1 ? entry.file.enc.s : null;
    if (!salt || keyBySalt.has(salt)) continue;
    try {
      keyBySalt.set(salt, await requireEncryptionKey(salt));
    } catch (err) {
      if (err instanceof EncryptionError && err.code === "locked") return;
      throw err;
    }
  }

  const archiveName = suggestZipArchiveName(selectedItems);
  const inTauri = isTauriRuntime();
  let targetPath: string | null = null;

  if (inTauri) {
    targetPath = await tauriSaveDialog({
      defaultPath: archiveName,
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
    });
    if (!targetPath) {
      toast.info(i18n.t("messages:download.cancelled"));
      return;
    }
  }

  const totalBytes = entries.reduce(
    (sum, e) => sum + Math.max(0, Number(e.file.enc?.plainSize ?? e.file.size) || 0),
    0
  );
  const jobId = `zip:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;

  useTransferStore.getState().addDownload({
    id: jobId,
    name: archiveName,
    size: totalBytes,
    progress: 0,
    receivedBytes: 0,
    status: "downloading",
    channelId: entries[0].file.channelId,
    messageId: 0,
  });

  let state: "running" | "paused" | "cancelling" = "running";
  let lastTickAt = Date.now();
  let lastTickBytes = 0;
  let receivedBytes = 0;

  registerExternalTransferControl(jobId, {
    pause: () => {
      if (state !== "running") return;
      state = "paused";
      useTransferStore.getState().updateDownload(jobId, {
        status: "paused",
        speed: undefined,
        eta: undefined,
      });
    },
    resume: () => {
      if (state !== "paused") return;
      state = "running";
      lastTickAt = Date.now();
      lastTickBytes = receivedBytes;
      useTransferStore.getState().updateDownload(jobId, {
        status: "downloading",
        error: undefined,
      });
    },
    cancel: () => {
      state = "cancelling";
      unregisterExternalTransferControl(jobId);
      useTransferStore.getState().updateDownload(jobId, {
        status: "cancelled",
        speed: undefined,
        eta: undefined,
      });
    },
  });

  const batchThreshold = getWriteBatchBytes();
  let pendingOut: Uint8Array[] = [];
  let pendingOutBytes = 0;
  let writtenBytes = 0;
  let browserChunks: BlobPart[] = [];
  let writeChain = Promise.resolve();
  let streamWriteError: Error | null = null;

  const enqueueOutWrite = (chunk: Uint8Array, forceFlush: boolean) => {
    if (chunk.length > 0) {
      if (inTauri && targetPath) {
        pendingOut.push(chunk);
        pendingOutBytes += chunk.length;
      } else {
        const copy = new Uint8Array(chunk.length);
        copy.set(chunk);
        browserChunks.push(copy.buffer);
      }
    }

    if (inTauri && targetPath && (forceFlush || pendingOutBytes >= batchThreshold)) {
      const toFlush = pendingOut;
      const toFlushBytes = pendingOutBytes;
      pendingOut = [];
      pendingOutBytes = 0;
      if (toFlushBytes > 0) {
        const merged = concatChunks(toFlush, toFlushBytes);
        const append = writtenBytes > 0;
        writtenBytes += merged.length;
        writeChain = writeChain.then(async () => {
          if (streamWriteError) return;
          try {
            await writeDownloadChunk(targetPath!, merged, append);
          } catch (err: any) {
            streamWriteError = err instanceof Error ? err : new Error(String(err));
          }
        });
      }
    }
  };

  try {
    const client = getClient();
    if (!client.connected) {
      await client.connect();
    }

    let zipStreamError: Error | null = null;
    const zip = new Zip((err, data, final) => {
      if (err) {
        zipStreamError = err instanceof Error ? err : new Error(String(err));
        return;
      }
      enqueueOutWrite(data, final);
    });

    for (const entry of entries) {
      if ((state as string) === "cancelling") break;
      const { file, archivePath } = entry;

      const { peer, segments } = await resolveDownloadSegments(
        file.channelId,
        file.messageId,
        {
          segments: file.segments,
          enc: file.enc,
          plainSize: file.enc?.plainSize ?? file.size,
        }
      );

      const zipEntry = new ZipPassThrough(archivePath);
      if (file.uploadedAt && Number.isFinite(file.uploadedAt)) {
        zipEntry.mtime = new Date(file.uploadedAt);
      }
      zip.add(zipEntry);

      for await (const chunk of iterateTelegramPlainChunks({
        peer,
        segments,
        enc: file.enc,
        encryptionKey: file.enc?.v === 1 ? (keyBySalt.get(file.enc.s) ?? null) : null,
      })) {
        while ((state as string) === "paused") {
          await sleep(PAUSE_POLL_MS);
        }
        if ((state as string) === "cancelling") break;

        zipEntry.push(chunk, false);
        receivedBytes += chunk.length;

        if (zipStreamError) throw zipStreamError;
        if (streamWriteError) throw streamWriteError;

        // Backpressure when buffered disk writes build up
        await writeChain;

        const now = Date.now();
        const elapsed = now - lastTickAt;
        if (elapsed >= PROGRESS_THROTTLE_MS) {
          const progress = Math.min(99, downloadPercent(receivedBytes, totalBytes));
          const speed = downloadSpeed(receivedBytes, lastTickBytes, elapsed);
          const eta = speed > 0 ? downloadEta(totalBytes, receivedBytes, speed) : undefined;
          useTransferStore.getState().updateDownload(jobId, {
            progress,
            receivedBytes,
            speed: speed > 0 ? speed : undefined,
            eta,
          });
          lastTickAt = now;
          lastTickBytes = receivedBytes;
        }
      }

      if ((state as string) === "cancelling") break;
      zipEntry.push(new Uint8Array(0), true);
      if (zipStreamError) throw zipStreamError;
      if (streamWriteError) throw streamWriteError;
    }

    if ((state as string) === "cancelling") {
      if (inTauri && targetPath) {
        await discardDownloadFile(targetPath);
      }
      browserChunks = [];
      return;
    }

    zip.end();
    enqueueOutWrite(new Uint8Array(0), true);
    await writeChain;
    if (zipStreamError) throw zipStreamError;
    if (streamWriteError) throw streamWriteError;

    useTransferStore.getState().updateDownload(jobId, {
      status: "saving",
      progress: 100,
      receivedBytes,
      speed: undefined,
      eta: undefined,
    });

    if (inTauri && targetPath) {
      await finalizeDownloadFile(targetPath);
    } else if (typeof document !== "undefined") {
      const blob = new Blob(browserChunks, { type: "application/zip" });
      browserChunks = [];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = archiveName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }

    unregisterExternalTransferControl(jobId);
    useTransferStore.getState().updateDownload(jobId, {
      status: "done",
      progress: 100,
      receivedBytes,
    });
    toast.success(
      i18n.t("messages:download.zipSuccess", {
        name: archiveName,
        defaultValue: `"${archiveName}" saved successfully!`,
      })
    );
  } catch (err: any) {
    const cancelled = (state as string) === "cancelling";
    unregisterExternalTransferControl(jobId);
    if (inTauri && targetPath) {
      await discardDownloadFile(targetPath);
    }
    browserChunks = [];

    useTransferStore.getState().updateDownload(jobId, {
      status: cancelled ? "cancelled" : "error",
      error: cancelled ? undefined : err?.message || String(err),
      speed: undefined,
      eta: undefined,
    });

    if (!cancelled) {
      console.error("[zipDownloader] ZIP export failed:", err);
      toast.error(
        i18n.t("messages:download.zipFailed", {
          defaultValue: "Failed to create ZIP archive.",
        })
      );
    }
  }
}
