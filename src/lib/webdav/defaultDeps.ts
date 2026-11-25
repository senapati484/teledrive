import { useAuthStore } from "../../stores/authStore";
import { useFileStore } from "../../stores/fileStore";
import type { TeleFile, TeleFileSegment } from "../types";
import { logger } from "../logger";
import { useEncryptionStore } from "../secure/e2ee";
import { channelIdKey, getSecret, VAULT_KEY_CHANNEL_ID } from "../secure/vault";
import {
  deleteTelegramMessage,
  reconstructMissingFolders,
} from "../storage/metadataStore";
import {
  clearDeletedMessages,
  recordDeletedMessages,
} from "../storage/tombstones";
import {
  enqueueSave,
  ensureFreshIndexForWrite,
  getIndexBackoffMs,
  IndexConflictError,
  IndexRetryExhaustedError,
} from "../storage/indexQueue";
import { streamTeleFileRangeToLocalPath } from "../telegram/downloader";
import {
  isHashedUploadResult,
  uploadFileToTelegram,
} from "../telegram/uploader";
import { cloneTelegramFileMessages } from "../upload/dedupeCheck";
import { getMimeFromExtension } from "../upload/uploadManager";
import {
  clearUploadCheckpoint,
  loadUploadCheckpoint,
} from "../upload/uploadCheckpoints";
import {
  createWebdavHandler,
  DEFAULT_METADATA_COMMIT_DEADLINE_MS,
  type WebdavHandler,
  type WebdavHandlerDeps,
} from "./handler";
import { webdavLocks } from "./locks";

async function resolveChannelId(): Promise<string | null> {
  const phone = useAuthStore.getState().phoneNumber;
  if (phone) {
    const perAccount = await getSecret(channelIdKey(phone));
    if (perAccount) return perAccount;
  }
  return getSecret(VAULT_KEY_CHANNEL_ID);
}

function newId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return `webdav_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Real app wiring for the WebDAV bridge (telegram, catalog, index queue). */
export function createDefaultWebdavDeps(): WebdavHandlerDeps {
  return {
    now: () => Date.now(),
    newId,
    getFiles: () => useFileStore.getState().files,
    setFiles: (files: TeleFile[]) => useFileStore.getState().setFiles(files),
    isAuthenticated: () => useAuthStore.getState().isAuthenticated,
    isIndexReady: () => useFileStore.getState().indexLoadState === "ready",
    isBootstrapComplete: () => useFileStore.getState().bootstrapComplete,
    getChannelId: resolveChannelId,
    saveIndex: (channelId, files) => enqueueSave(channelId, files),
    isDeferredError: (err) => err instanceof IndexRetryExhaustedError,
    uploadFile: async (args) => {
      const result = await uploadFileToTelegram(
        args.channelId,
        args.name,
        args.size,
        args.sourcePath,
        args.folderPath,
        undefined,
        args.onRetry,
        true,
        null,
        {
          checkpointKey: args.checkpointKey,
          allowMultiSegment: true,
          encryptionKey: args.encryptionKey,
          encryptionSaltB64: args.encryptionSaltB64,
          anonymizedFileName: args.anonymizedFileName,
          floodWaitAbortSeconds: args.floodWaitAbortSeconds,
        }
      );
      if (isHashedUploadResult(result)) {
        return {
          message: result.message,
          hash: result.hash,
          segments: result.segments,
          enc: result.enc,
        };
      }
      return { message: result };
    },
    cloneFile: async (channelId, existing, destinationFolder, fileName) => {
      const cloned = await cloneTelegramFileMessages(
        channelId,
        existing,
        destinationFolder,
        fileName
      );
      return { message: cloned.message, segments: cloned.segments };
    },
    deleteMessages: async (channelId, ids) => {
      await Promise.allSettled(
        ids.map((id) =>
          deleteTelegramMessage(channelId, id).catch((err) => {
            logger.warn(`[webdav] Failed to delete Telegram message ${id}:`, err?.message ?? err);
          })
        )
      );
    },
    downloadRange: async (channelId, file, start, end, targetPath, encryptionKey) => {
      return streamTeleFileRangeToLocalPath(
        channelId,
        file,
        start,
        end,
        targetPath,
        { encryptionKey }
      );
    },
    encryption: () => {
      const state = useEncryptionStore.getState();
      return {
        configured: state.configured,
        encryptNewUploads: state.encryptNewUploads,
        masterKey: state.masterKey,
        saltB64: state.config?.saltB64 ?? null,
      };
    },
    checkpoint: {
      load: (key) => {
        const checkpoint = loadUploadCheckpoint(key);
        return checkpoint
          ? { completedSegments: checkpoint.completedSegments as TeleFileSegment[] | undefined }
          : null;
      },
      clear: (key) => clearUploadCheckpoint(key),
    },
    mimeForName: getMimeFromExtension,
    prepareWrite: async (channelId) => {
      await ensureFreshIndexForWrite(channelId);
    },
    getIndexBackoffMs: (channelId) => getIndexBackoffMs(channelId),
    metadataCommitDeadlineMs: DEFAULT_METADATA_COMMIT_DEADLINE_MS,
    floodWaitAbortSeconds: 10,
    catalogCoalesceMs: 250,
    describeConflict: (err) => {
      if (!(err instanceof IndexConflictError)) return null;
      return { transient: err.transient, message: err.message };
    },
    validateSize: async (size) => {
      if (size <= 0) {
        return { ok: false, message: "Telegram cannot store empty files" };
      }
      // Multi-segment uploads split at the Telegram single-file cap, so the
      // only hard ceiling here is a local safety limit against filling the
      // temp volume. Real Telegram limits surface as 507 via the uploader.
      const maxBytes = 100 * 1024 * 1024 * 1024;
      if (size > maxBytes) {
        return { ok: false, message: "File exceeds the 100 GiB WebDAV upload limit" };
      }
      return { ok: true };
    },
    reconstructMissingFolders: (files, channelId) =>
      reconstructMissingFolders(files, channelId),
    recordDeletedMessages,
    clearDeletedMessages,
    locks: webdavLocks,
    log: (message) => logger.warn(`[webdav] ${message}`),
  };
}

let singleton: WebdavHandler | null = null;

export function getWebdavHandler(): WebdavHandler {
  if (!singleton) singleton = createWebdavHandler(createDefaultWebdavDeps());
  return singleton;
}

/** Exposed for tests. */
export function resetWebdavHandlerForTests(): void {
  singleton = null;
  webdavLocks.clear();
}
