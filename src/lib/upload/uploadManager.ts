import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import i18n from "@/i18n";

import { useAuthStore } from "../../stores/authStore";
import { useFileStore } from "../../stores/fileStore";
import { useSupportStore } from "../../stores/supportStore";
import { logEvent } from "../events";
import { channelIdKey, getSecret, VAULT_KEY_CHANNEL_ID } from "../secure/vault";
import { isJunkFile } from "../storage/fileSanitizer";
import { enqueueSave } from "../storage/indexQueue";
import { loadIndex, reconstructMissingFolders } from "../storage/metadataStore";
import { getClient } from "../telegram/client";
import { uploadFileToTelegram } from "../telegram/uploader";
import { TeleFile, UploadItem } from "../types";
import { normalizeFolderPath } from "../utils";

// ---------------------------------------------------------------------------
// MIME type inference from file extension
// Used when the OS/browser does not provide a MIME type (e.g. Tauri native pick)
// ---------------------------------------------------------------------------
const EXTENSION_MIME_MAP: Record<string, string> = {
  // Images
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml", tiff: "image/tiff",
  tif: "image/tiff", heic: "image/heic", heif: "image/heif", ico: "image/x-icon",
  psd: "image/vnd.adobe.photoshop", ai: "application/postscript",

  // Videos
  mp4: "video/mp4", mkv: "video/x-matroska", avi: "video/x-msvideo",
  mov: "video/quicktime", wmv: "video/x-ms-wmv", flv: "video/x-flv",
  webm: "video/webm", m4v: "video/x-m4v", "3gp": "video/3gpp",
  mpeg: "video/mpeg", mpg: "video/mpeg",

  // Audio
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
  flac: "audio/flac", aac: "audio/aac", wma: "audio/x-ms-wma", opus: "audio/opus",
  amr: "audio/amr",

  // Documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  epub: "application/epub+zip",
  pages: "application/vnd.apple.pages",
  numbers: "application/vnd.apple.numbers",
  key: "application/vnd.apple.keynote",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  rtf: "application/rtf",

  // Code / Text
  html: "text/html", htm: "text/html", css: "text/css",
  js: "text/javascript", ts: "text/typescript", jsx: "text/javascript",
  tsx: "text/typescript", json: "application/json", xml: "application/xml",
  yaml: "text/yaml", yml: "text/yaml",
  py: "text/x-python", go: "text/x-go", rs: "text/x-rust",
  c: "text/x-c", cpp: "text/x-c++", h: "text/x-c", cs: "text/x-csharp",
  java: "text/x-java-source", rb: "text/x-ruby", sh: "application/x-sh",
  bat: "application/x-bat", ps1: "application/x-powershell",
  sql: "application/sql", ini: "text/plain", conf: "text/plain",

  // Archives
  zip: "application/zip", rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed", tar: "application/x-tar",
  gz: "application/gzip", bz2: "application/x-bzip2",
  xz: "application/x-xz", iso: "application/x-iso9660-image",
  dmg: "application/x-apple-diskimage",
};

function getMimeFromExtension(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME_MAP[ext] ?? "application/octet-stream";
}

/**
 * Wait until `bootstrapComplete=true` on the file store, capped at `timeoutMs`.
 * The orphan recovery scan in bootstrap.ts runs BEFORE it flips bootstrapComplete,
 * so the upload's optimistic-state merge won't miss files the scan is about to
 * discover. Without this gate, an upload that lands during the scan would write
 * a partial state (only the new file) to Telegram, silently overwriting the
 * previous full index — the bug that wiped the user's files on logout/relogin.
 */
async function waitForBootstrap(timeoutMs: number = 2000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (useFileStore.getState().bootstrapComplete || useFileStore.getState().files.length > 0) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return useFileStore.getState().bootstrapComplete || useFileStore.getState().files.length > 0;
}

let uploadCommitChain = Promise.resolve();
let indexSaveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let activeSavingChannelId: string | null = null;

/**
 * Coalesces/debounces index saves to Telegram during active uploads.
 * If 100 files are uploading, we don't spam Telegram with 100 individual index saves.
 * Instead, we debounce saves while uploads are actively churning, and guarantee
 * a final immediate flush when the queue completes.
 */
export function scheduleUploadIndexSave(channelId: string, immediate = false): void {
  activeSavingChannelId = channelId;
  if (indexSaveDebounceTimer) {
    clearTimeout(indexSaveDebounceTimer);
    indexSaveDebounceTimer = null;
  }

  const runSave = () => {
    indexSaveDebounceTimer = null;
    const targetChannel = activeSavingChannelId || channelId;
    const currentFiles = useFileStore.getState().files;
    if (targetChannel && currentFiles.length > 0) {
      void enqueueSave(targetChannel, currentFiles).catch((err) => {
        console.warn("[uploadManager] Coalesced index save error:", err);
      });
    }
  };

  const { uploadQueue } = useFileStore.getState();
  const hasMoreUploads = uploadQueue.some((i) => i.status === "uploading" || i.status === "pending");

  if (immediate || !hasMoreUploads) {
    runSave();
  } else {
    indexSaveDebounceTimer = setTimeout(runSave, 1500);
  }
}

/**
 * Serializes the in-memory store commit across parallel uploads.
 * Prevents race conditions where concurrent uploads finish around the same millisecond
 * and overwrite each other's optimistic state array.
 */
async function commitUploadedFileToStore(channelId: string, newFile: TeleFile): Promise<TeleFile[]> {
  return new Promise<TeleFile[]>((resolve, reject) => {
    uploadCommitChain = uploadCommitChain
      .catch(() => {})
      .then(async () => {
        try {
          if (!useFileStore.getState().bootstrapComplete && useFileStore.getState().files.length === 0) {
            await waitForBootstrap(2000);
          }

          let existingFiles = useFileStore.getState().files;
          if (existingFiles.length === 0) {
            try {
              existingFiles = await loadIndex(channelId);
            } catch (err) {
              console.warn("[uploadManager] Direct loadIndex fallback error:", err);
            }
          }

          // Build optimistic state, avoiding duplicates by id and messageId
          const baseFiles = existingFiles.filter(
            (f) =>
              f.id !== newFile.id &&
              (!f.messageId || !newFile.messageId || Number(f.messageId) !== Number(newFile.messageId))
          );
          const rawFiles = [...baseFiles, newFile];

          // Reconstruct parent virtual folders dynamically for any user folder path so they exist in the file tree
          const { healedFiles } = reconstructMissingFolders(rawFiles, channelId);

          useFileStore.getState().setFiles(healedFiles);
          useFileStore.getState().setBootstrapComplete(true);

          // Schedule debounced / coalesced index persistence to Telegram
          scheduleUploadIndexSave(channelId);

          resolve(healedFiles);
        } catch (err) {
          reject(err);
        }
      });
  });
}

let isProcessing = false;

/**
 * Triggers the upload queue processor.
 * Starts up to 3 concurrent uploads from 'pending' status.
 */
export async function processQueue(): Promise<void> {
  // If already executing this function, do not overlap
  if (isProcessing) return;
  isProcessing = true;

  try {
    const { uploadQueue, updateQueueItem } = useFileStore.getState();

    const pendingItems = uploadQueue.filter((item) => item.status === "pending");
    const uploadingItems = uploadQueue.filter((item) => item.status === "uploading");

    await invoke("log_vault_state", {
      state: `PROCESS_QUEUE: pending=${pendingItems.length} uploading=${uploadingItems.length} total=${uploadQueue.length}`
    }).catch(() => {});

    // If nothing is uploading or pending, ensure any pending index save is flushed immediately!
    if (uploadingItems.length === 0 && pendingItems.length === 0 && activeSavingChannelId) {
      scheduleUploadIndexSave(activeSavingChannelId, true);
    }

    // Concurrency limit is 3. If full or nothing is pending, exit.
    if (uploadingItems.length >= 3 || pendingItems.length === 0) {
      isProcessing = false;
      return;
    }

    await invoke("log_vault_state", { state: "PROCESS_QUEUE: Fetching channelId from vault..." }).catch(() => {});
    let channelId: string | null = null;
    try {
      const { phoneNumber } = useAuthStore.getState();
      if (phoneNumber) {
        channelId = await getSecret(channelIdKey(phoneNumber));
      }
      if (!channelId) {
        channelId = await getSecret(VAULT_KEY_CHANNEL_ID);
      }
      await invoke("log_vault_state", { state: `PROCESS_QUEUE: Fetched channelId = ${channelId}` }).catch(() => {});
    } catch (err: any) {
      await invoke("log_vault_state", {
        state: `PROCESS_QUEUE_VAULT_ERR: ${err?.message || JSON.stringify(err)}`
      }).catch(() => {});
      isProcessing = false;
      return;
    }

    if (!channelId) {
      toast.error(i18n.t("messages:upload.channelNotConfigured"));
      await invoke("log_vault_state", { state: "PROCESS_QUEUE: channelId is empty/null" }).catch(() => {});
      isProcessing = false;
      return;
    }

    const activeChannelId: string = channelId;

    // Determine how many parallel uploads we can start
    const openSlots = 3 - uploadingItems.length;
    const itemsToStart = pendingItems.slice(0, openSlots);

    await invoke("log_vault_state", {
      state: `PROCESS_QUEUE: Starting ${itemsToStart.length} uploads`
    }).catch(() => {});

    // Immediately set status to uploading to prevent double processing in concurrent processQueue calls
    for (const item of itemsToStart) {
      updateQueueItem(item.id, { status: "uploading", progress: 0 });
    }

    isProcessing = false; // Allow other calls to trigger if needed

    // Start each upload process asynchronously
    for (const item of itemsToStart) {
      // Run the upload task
      void (async () => {
        try {
          let fileSource: string | File;

          if (item.file && typeof item.file === "object" && "path" in item.file && item.file.path) {
            fileSource = item.file.path;
          } else if (item.file instanceof File) {
            fileSource = item.file;
          } else if (item.file && "data" in item.file && item.file.data) {
            // Convert byte array to HTML File object
            fileSource = new File([item.file.data as BlobPart], item.name, { type: (item.file as any).type });
          } else {
            throw new Error("No valid file reference or path found.");
          }

          const destinationFolder = normalizeFolderPath(item.folderPath);

          // Ensure Telegram client is connected before starting the upload
          const client = getClient();
          if (!client.connected) {
            await invoke("log_vault_state", {
              state: `UPLOAD_RECONNECT: Client disconnected for item "${item.name}". Reconnecting...`
            }).catch(() => {});
            await client.connect();
          }

          // --- Phase 1: Upload file bytes to Telegram ---
          // Throttle progress updates to ~120ms intervals to avoid
          // flooding the React render cycle on every 512KB chunk.
          // A rolling 3-second window gives a stable speed readout.
          const PROGRESS_THROTTLE_MS = 120;
          const SPEED_WINDOW_MS = 3000;

          let lastDispatchAt = 0;
          // Ring buffer: [timestampMs, bytesAtThatPoint]
          const speedSamples: Array<[number, number]> = [];

          const message = await uploadFileToTelegram(
            activeChannelId,
            item.name,
            item.size,
            fileSource,
            destinationFolder,
            (uploaded, total) => {
              const now = Date.now();

              // Record sample
              speedSamples.push([now, uploaded]);
              // Prune samples older than the rolling window
              const cutoff = now - SPEED_WINDOW_MS;
              while (speedSamples.length > 1 && speedSamples[0][0] < cutoff) {
                speedSamples.shift();
              }

              // Compute rolling speed (bytes/s)
              let speed: number | undefined;
              let eta: number | undefined;
              if (speedSamples.length >= 2) {
                const oldest = speedSamples[0];
                const dt = (now - oldest[0]) / 1000; // seconds
                if (dt > 0) {
                  speed = (uploaded - oldest[1]) / dt;
                  const remaining = total - uploaded;
                  eta = speed > 0 ? Math.round(remaining / speed) : undefined;
                }
              }

              // Throttle state dispatch
              if (now - lastDispatchAt >= PROGRESS_THROTTLE_MS || uploaded >= total) {
                lastDispatchAt = now;
                const pct = Math.round((uploaded / total) * 100);
                updateQueueItem(item.id, {
                  progress: Math.min(pct, 95),
                  uploadedBytes: uploaded,
                  speed,
                  eta,
                });
              }
            }
          );

          // Build the metadata entry.
          // Priority: file.type (browser/OS) → getMimeFromExtension (extension lookup) → fallback
          const rawMime =
            item.file instanceof File
              ? item.file.type
              : (item.file as any)?.type ?? "";
          const mimeType = rawMime && rawMime !== "application/octet-stream"
            ? rawMime
            : getMimeFromExtension(item.name);

          const newFile: TeleFile = {
            id: item.id,
            name: item.name,
            size: item.size,
            mime: mimeType,
            folderPath: destinationFolder,
            messageId: message.id,
            channelId: activeChannelId,
            uploadedAt: Date.now(),
            starred: false,
            trashed: false,
          };

          // --- Phase 2: Save metadata to store and schedule coalesced index persistence ---
          try {
            const optimisticFiles = await commitUploadedFileToStore(activeChannelId, newFile);

            updateQueueItem(item.id, { status: "done", progress: 100 });
            useSupportStore.getState().incrementUploadCount();
            toast.success(i18n.t("messages:upload.success", { name: item.name }));

            await invoke("log_vault_state", {
              state: `UPLOAD_INDEX_OK name=${item.name} files=${optimisticFiles.length}`,
            }).catch(() => {});
            logEvent({
              type: "file.uploaded",
              payload: { name: item.name, size: Number(newFile.size) || 0 },
            });
          } catch (indexErr: any) {
            console.error(`Store commit error for ${item.name}:`, indexErr);
            await invoke("log_vault_state", {
              state: `UPLOAD_STORE_COMMIT_ERR name=${item.name} err=${indexErr?.message ?? indexErr}`,
            }).catch(() => {});
          }
        } catch (err: any) {
          console.error(`Upload error for ${item.name}:`, err);
          await invoke("log_vault_state", {
            state: `UPLOAD_ERR: ${item.name} size=${item.size} err=${err?.message || JSON.stringify(err)}\nStack: ${err?.stack || "no_stack"}`
          }).catch(() => {});
          updateQueueItem(item.id, {
            status: "error",
            error: err.message || i18n.t("messages:upload.failedFallback"),
          });
          toast.error(i18n.t("messages:upload.failed", { name: item.name, message: err.message || i18n.t("messages:common.unknownError") }));
        } finally {
          // Re-trigger processQueue to pull the next pending items
          void processQueue();
        }
      })();
    }
  } catch (error) {
    console.error("Failed inside processQueue:", error);
    isProcessing = false;
  } finally {
    // Safety net: always release the lock even if we missed a path
    isProcessing = false;
  }
}

// ─── Index saving ──────────────────────────────────────────────────────────
// Index writes from uploads now go through the shared IndexQueue (see
// enqueueSave above). That queue coalesces concurrent uploads and interleaves
// them with user-driven actions (rename, star, move, etc.) into a single
// Telegram edit, so we no longer maintain a separate pendingIndexFiles /
// flushIndexQueue / scheduleIndexFlush pipeline here.

/**
 * Enqueues a list of files and starts the upload processing queue.
 */
export function addFilesToUploadQueue(
  files: (File | { name: string; size: number; path: string; type: string })[]
) {
  const { addToQueue, currentFolder } = useFileStore.getState();
  const normalizedCurrentFolder = normalizeFolderPath(currentFolder);
  let addedCount = 0;

  files.forEach((file) => {
    if (isJunkFile({ name: file.name, size: file.size, folderPath: normalizedCurrentFolder })) {
      return;
    }

    if (file.size === 0) {
      toast.error(i18n.t("messages:upload.emptyFile", { name: file.name }), {
        duration: 4000,
      });
      return;
    }

    const uploadItem: UploadItem = {
      id: Math.random().toString(36).substring(2, 11),
      name: file.name,
      size: file.size,
      progress: 0,
      status: "pending",
      file: file,
      folderPath: normalizedCurrentFolder,
    };
    addToQueue(uploadItem);
    addedCount++;
  });

  // Trigger processor shortly after if we actually added items
  if (addedCount > 0) {
    setTimeout(() => {
      void processQueue();
    }, 50);
  }
}
