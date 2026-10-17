import { getSecret, VAULT_KEY_CHANNEL_ID, channelIdKey } from "../secure/vault";

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
import { uploadFileToTelegram } from "../telegram/uploader";
import { useFileStore } from "../../stores/fileStore";
import { useAuthStore } from "../../stores/authStore";
import { TeleFile, UploadItem } from "../types";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { enqueueSave } from "../storage/indexQueue";
import { getClient } from "../telegram/client";
import { logEvent } from "../events";
import { isJunkFile } from "../storage/fileSanitizer";
import i18n from "@/i18n";

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
    const { uploadQueue, updateQueueItem, setFiles } = useFileStore.getState();

    const pendingItems = uploadQueue.filter((item) => item.status === "pending");
    const uploadingItems = uploadQueue.filter((item) => item.status === "uploading");

    await invoke("log_vault_state", {
      state: `PROCESS_QUEUE: pending=${pendingItems.length} uploading=${uploadingItems.length} total=${uploadQueue.length}`
    }).catch(() => {});

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
      (async () => {
        try {
          let fileSource: string | File;

          if (item.file && typeof item.file === "object" && "path" in item.file && item.file.path) {
            fileSource = item.file.path;
          } else if (item.file instanceof File) {
            fileSource = item.file;
          } else if (item.file && "data" in item.file && item.file.data) {
            // Convert byte array to HTML File object
            fileSource = new File([item.file.data], item.name, { type: (item.file as any).type });
          } else {
            throw new Error("No valid file reference or path found.");
          }

          const destinationFolder = item.folderPath || "/";

          // Ensure Telegram client is connected before starting the upload
          const client = getClient();
          if (!client.connected) {
            await invoke("log_vault_state", {
              state: `UPLOAD_RECONNECT: Client disconnected for item "${item.name}". Reconnecting...`
            }).catch(() => {});
            await client.connect();
          }

          // --- Phase 1: Upload file bytes to Telegram ---
          const message = await uploadFileToTelegram(
            channelId,
            item.name,
            item.size,
            fileSource,
            destinationFolder,
            (uploaded, total) => {
              const pct = Math.round((uploaded / total) * 100);
              // Cap at 95% until indexing succeeds
              updateQueueItem(item.id, { progress: Math.min(pct, 95) });
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
            channelId,
            uploadedAt: Date.now(),
            starred: false,
            trashed: false,
          };

          // --- Phase 2: Save metadata index to Telegram via the shared IndexQueue ---
          // Ensure we don't clobber state if bootstrap is starting up cold with 0 files
          if (!useFileStore.getState().bootstrapComplete && useFileStore.getState().files.length === 0) {
            await waitForBootstrap(2000);
          }

          let existingFiles = useFileStore.getState().files;
          if (existingFiles.length === 0) {
            try {
              const { loadIndex } = await import("../storage/metadataStore");
              existingFiles = await loadIndex(channelId);
            } catch (err) {
              console.warn("[uploadManager] Direct loadIndex fallback error:", err);
            }
          }

          const optimisticFiles = [
            ...existingFiles.filter((f) => f.id !== newFile.id),
            newFile,
          ];
          setFiles(optimisticFiles);
          useFileStore.getState().setBootstrapComplete(true);

          updateQueueItem(item.id, { status: "done", progress: 100 });
          toast.success(i18n.t("messages:upload.success", { name: item.name }));

          try {
            await enqueueSave(channelId, optimisticFiles);
            await invoke("log_vault_state", {
              state: `UPLOAD_INDEX_OK name=${item.name} files=${optimisticFiles.length}`,
            }).catch(() => {});
            logEvent({
              type: "file.uploaded",
              payload: { name: item.name, size: Number(newFile.size) || 0 },
            });
          } catch (indexErr: any) {
            // Hard error from the queue (auth lost, channel missing, etc.).
            // Roll back the optimistic files array for this single upload by
            // removing the just-added entry; transient errors are swallowed
            // by the queue and the entry will retry on its own.
            const isHard =
              /AUTH_KEY_UNREGISTERED|SESSION_REVOKED|CHANNEL_PRIVATE|PEER_ID_INVALID|CHAT_WRITE_FORBIDDEN|JSON/i.test(
                indexErr?.message ?? ""
              );
            if (isHard) {
              const rolled = useFileStore
                .getState()
                .files.filter((f) => f.id !== newFile.id);
              useFileStore.getState().setFiles(rolled);
              await invoke("log_vault_state", {
                state: `UPLOAD_INDEX_HARD_ERR rolled name=${item.name} err=${indexErr?.message ?? indexErr}`,
              }).catch(() => {});
              toast.error(
                i18n.t("messages:upload.indexSaveFailed", { name: item.name })
              );
            } else {
              await invoke("log_vault_state", {
                state: `UPLOAD_INDEX_TRANSIENT_ERR name=${item.name} err=${indexErr?.message ?? indexErr}`,
              }).catch(() => {});
            }
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
          processQueue();
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
  let addedCount = 0;

  files.forEach((file) => {
    if (isJunkFile({ name: file.name, size: file.size, folderPath: currentFolder })) {
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
      folderPath: currentFolder,
    };
    addToQueue(uploadItem);
    addedCount++;
  });

  // Trigger processor shortly after if we actually added items
  if (addedCount > 0) {
    setTimeout(() => processQueue(), 50);
  }
}
