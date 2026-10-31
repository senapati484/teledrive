import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { readFile, remove, mkdir, exists } from "@tauri-apps/plugin-fs";
import { saveBinaryFile } from "./safeFileWriter";
import { downloadFileToBuffer } from "../telegram/downloader";
import { TeleFile } from "../types";

/**
 * Returns the resolved local filesystem path for a cached offline file.
 */
export async function getOfflineFilePath(fileId: string): Promise<string> {
  const dataDir = await appLocalDataDir();
  const offlineDir = await join(dataDir, "offline_files");
  
  // Ensure the directory exists
  try {
    const dirExists = await exists(offlineDir);
    if (!dirExists) {
      await mkdir(offlineDir, { recursive: true });
    }
  } catch {
    // If exists checks fail, attempt to make directory anyway
    try {
      await mkdir(offlineDir, { recursive: true });
    } catch {
      // Ignored
    }
  }

  return await join(offlineDir, `offline_${fileId}`);
}

/**
 * Saves a Telegram file's contents to local cache for offline access.
 */
export async function cacheFileOffline(
  channelId: string,
  messageId: number,
  fileId: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const buffer = await downloadFileToBuffer(channelId, messageId, onProgress);
  const localPath = await getOfflineFilePath(fileId);
  await saveBinaryFile(localPath, buffer);
}

/**
 * Removes a file's offline local cache.
 */
export async function removeOfflineCache(fileId: string): Promise<void> {
  try {
    const localPath = await getOfflineFilePath(fileId);
    const fileExists = await exists(localPath);
    if (fileExists) {
      await remove(localPath);
    }
  } catch (err) {
    console.warn(`[offlineStorage] Failed to delete local offline cache for ${fileId}:`, err);
  }
}

/**
 * Reads the cached offline file contents from local storage.
 */
export async function readOfflineCache(fileId: string): Promise<Uint8Array> {
  const localPath = await getOfflineFilePath(fileId);
  return await readFile(localPath);
}

/**
 * Check if a file actually exists in the local offline cache.
 */
export async function isCachedOffline(fileId: string): Promise<boolean> {
  try {
    const localPath = await getOfflineFilePath(fileId);
    return await exists(localPath);
  } catch {
    return false;
  }
}

/**
 * Synchronizes the offline metadata flags with the actual files present in the local cache.
 * - If a file is cached on disk, it ensures `offline: true`.
 * - If a file is marked offline but missing from disk, and the client is online, it downloads it in the background.
 */
export async function syncOfflineStatusWithDisk(files: TeleFile[]): Promise<TeleFile[]> {
  return await Promise.all(
    files.map(async (file) => {
      // Folders/directories cannot be cached offline
      if (file.mime === "inode/directory" || file.mime === "application/x-directory") {
        return file;
      }
      
      const cached = await isCachedOffline(file.id);
      if (cached) {
        if (!file.offline) {
          return { ...file, offline: true };
        }
      } else {
        if (file.offline) {
          // It's marked offline but not cached. If online, trigger background caching.
          if (typeof navigator !== "undefined" && navigator.onLine && file.channelId && file.messageId && file.messageId !== 0) {
            console.log(`[offlineStorage] Background syncing missing offline file: ${file.name}`);
            cacheFileOffline(file.channelId, file.messageId, file.id).catch((err) => {
              console.warn(`[offlineStorage] Background sync failed for ${file.name}:`, err);
            });
          }
        }
      }
      return file;
    })
  );
}
