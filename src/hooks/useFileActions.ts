import { getSecret, VAULT_KEY_CHANNEL_ID, channelIdKey } from "../lib/secure/vault";
import {
  deleteTelegramMessage,
  folderIdForPath,
  fullPathForFolder,
  findFoldersByPath,
} from "../lib/storage/metadataStore";
import { useFileStore } from "../stores/fileStore";
import { useAuthStore } from "../stores/authStore";
import { TeleFile } from "../lib/types";
import { toast } from "sonner";
import { cacheFileOffline, removeOfflineCache } from "../lib/storage/offlineStorage";
import { invoke } from "@tauri-apps/api/core";
import { enqueueSave, flushAllQueues, retryQueue } from "../lib/storage/indexQueue";
import { useCallback, useMemo } from "react";
import { logEvent } from "../lib/events";
import i18n from "../i18n";
import { useTranslation } from "react-i18next";


/**
 * ActionQueue — serializes offline-toggle operations (which touch local FS)
 * so a single file can't have two concurrent download/remove flows.
 *
 * Index writes are no longer serialized here. The IndexQueue owns all
 * index persistence and coalesces concurrent actions automatically.
 */
class ActionQueue {
  private queue: (() => Promise<any>)[] = [];
  private running = false;

  async enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const res = await task();
          resolve(res);
        } catch (err) {
          reject(err);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.running) return;
    this.running = true;
    useFileStore.getState().setIsOperating(true);

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        try {
          await task();
        } catch (err) {
          console.error("Error executing queued task:", err);
        }
      }
    }

    this.running = false;
    useFileStore.getState().setIsOperating(false);
  }
}

const fileActionQueue = new ActionQueue();

const DIRECTORY_MIMES = new Set(["inode/directory", "application/x-directory"]);

function isFolder(file: TeleFile): boolean {
  return DIRECTORY_MIMES.has(file.mime);
}

function normalizeFolderPath(path: string): string {
  if (!path || path === "/") return "/";
  return `/${path.split("/").filter(Boolean).join("/")}`;
}

function getFolderFullPath(folder: TeleFile): string {
  const parentPath = normalizeFolderPath(folder.folderPath);
  return parentPath === "/" ? `/${folder.name}` : `${parentPath}/${folder.name}`;
}

function isSameOrDescendantPath(path: string, parentPath: string): boolean {
  const normalizedPath = normalizeFolderPath(path);
  const normalizedParentPath = normalizeFolderPath(parentPath);
  return normalizedPath === normalizedParentPath || normalizedPath.startsWith(`${normalizedParentPath}/`);
}

/**
 * Push a snapshot of the current files array onto the rollback ring.
 * Each call to `applyOptimistic` does this BEFORE mutating, so each action
 * gets its own independent rollback target (replaces the old global
 * `originalFilesBeforeOptimistic` which only worked for the first action).
 */
function pushSnapshotForRollback(): void {
  useFileStore.getState().pushSnapshot();
}

/**
 * Pop the most recent rollback snapshot and restore the files array to it.
 * Called when an action's index save fails with a HARD error.
 */
function rollbackToLastSnapshot(): boolean {
  const snap = useFileStore.getState().popSnapshot();
  if (!snap) return false;
  useFileStore.getState().setFiles(snap);
  return true;
}

/**
 * Optimistically apply a new files array and persist it to Telegram.
 *
 * - Pushes a rollback snapshot BEFORE the optimistic update so each call
 *   has its own independent rollback target.
 * - Routes the persistence through the IndexQueue, which coalesces
 *   concurrent calls into a single Telegram edit. Transient errors
 *   (FLOOD_WAIT, timeout) stay optimistic and retry indefinitely; hard
 *   errors trigger a rollback to the snapshot.
 */
async function applyOptimistic(
  channelId: string,
  nextFiles: TeleFile[],
  options: { skipRollbackOnHardError?: boolean; eventType?: string; eventPayload?: Record<string, unknown> } = {}
): Promise<void> {
  const store = useFileStore.getState();

  // Suppress writes before bootstrap completes. Bootstrap reads the
  // authoritative index from Telegram and populates the store; if a user
  // action fires before that, persisting our optimistic state would
  // overwrite Telegram with a partial / stale index and lose data on
  // the next restart. The user can retry the action once bootstrap
  // completes (which takes < 1s in practice).
  if (!store.bootstrapComplete && store.files.length === 0) {
    await invoke("log_vault_state", {
      state: `ACTION_SUPPRESSED_PRE_BOOTSTRAP files=${nextFiles.length}`,
    }).catch(() => {});
    if (!options.skipRollbackOnHardError) {
      rollbackToLastSnapshot();
    }
    toast.error(i18n.t("files:actions.bootstrapPending"));
    throw new Error("Bootstrap not complete");
  }

  pushSnapshotForRollback();
  store.setFiles(nextFiles);
  store.setSyncing(true);

  try {
    await enqueueSave(channelId, nextFiles);
    // Commit succeeded (or is being transparently retried). Clear this
    // snapshot from the ring — the optimistic state is now canonical.
    useFileStore.getState().popSnapshot();
    await invoke("log_vault_state", {
      state: `ACTION_OK files=${nextFiles.length}`,
    }).catch(() => {});
    // Audit-log this action. Fire-and-forget — failures never interrupt
    // the user's flow. Caller passes `eventType` for known actions;
    // falls back to a generic type for un-tagged callers (none today,
    // but keeps the hook forward-compatible).
    if (options.eventType) {
      logEvent({
        type: options.eventType,
        payload: { fileCount: nextFiles.length, ...(options.eventPayload ?? {}) },
      });
    }
  } catch (err: any) {
    if (options.skipRollbackOnHardError) {
      await invoke("log_vault_state", {
        state: `ACTION_HARD_ERR_NO_ROLLBACK: ${err?.message ?? err}`,
      }).catch(() => {});
      throw err;
    }
    // Hard error path: roll back to the pre-action snapshot.
    const rolled = rollbackToLastSnapshot();
    await invoke("log_vault_state", {
      state: `ACTION_HARD_ERR rolled=${rolled}: ${err?.message ?? err}`,
    }).catch(() => {});
    toast.error(
      i18n.t("files:actions.saveFailed", { error: err?.message ?? i18n.t("files:actions.unknownError") })
    );
    throw err;
  } finally {
    useFileStore.getState().setSyncing(false);
  }
}

if (typeof window !== "undefined") {
  // Best-effort flush on tab close. The queue resolves any pending entries
  // so callers don't hang. We don't try to await (browsers can't).
  window.addEventListener("beforeunload", () => {
    void flushAllQueues();
  });

  // Expose a tiny dev hook so the diagnostics page can force a retry.
  (window as any).__teledriveRetryIndex = (channelId: string) =>
    retryQueue(channelId);

  // Emergency gate release. If bootstrap ever wedges past its safety nets
  // (Tauri IPC deadlock, hung GramJS request, etc.), the user can open
  // DevTools and run `__teledriveForceBootstrapComplete()` to flip the gate
  // so drag/drop/rename/delete work again. This should never normally need
  // to run — the dead-man switch in bootstrap.ts handles it — but it's a
  // cheap last-resort escape hatch.
  (window as any).__teledriveForceBootstrapComplete = () => {
    useFileStore.getState().setBootstrapComplete(true);
    console.warn(
      "[teledrive] bootstrapComplete forced to true via dev hook — gate bypassed"
    );
  };
}

export function useFileActions() {
  const isOperating = useFileStore((state) => state.isOperating);
  const currentFolder = useFileStore((state) => state.currentFolder);
  const phoneNumber = useAuthStore((state) => state.phoneNumber);
  const { t } = useTranslation("files");

  const getChannelId = useCallback(async () => {
    let cid: string | null = null;
    if (phoneNumber) {
      cid = await getSecret(channelIdKey(phoneNumber));
    }
    if (!cid) {
      cid = await getSecret(VAULT_KEY_CHANNEL_ID);
    }
    if (!cid) {
      toast.error(t("actions.channelNotInitialized"));
      throw new Error("Channel ID missing");
    }
    return cid;
  }, [phoneNumber, t]);

  const createFolder = useCallback(async (name: string) => {
    if (!name.trim()) return;
    try {
      const channelId = await getChannelId();
      const trimmed = name.trim();

      // No-op if a folder with the same full path already exists. With the
      // pre-fix code, the UI would happily create a second `Code` folder
      // every time the user typed the same name — and `reconstructMissingFolders`
      // would also re-create one on the next bootstrap. This guard closes that
      // loop at the user-facing entry point.
      const files = useFileStore.getState().files;
      const targetParent = normalizeFolderPath(currentFolder);
      const newFullPath =
        targetParent === "/" ? `/${trimmed}` : `${targetParent}/${trimmed}`;
      if (findFoldersByPath(files, newFullPath).length > 0) {
        toast.info(t("actions.folder.alreadyExists", { name: trimmed }));
        return;
      }

      const newFolder: TeleFile = {
        // Deterministic id keyed on the full path. Mirrors the canonical
        // scheme used by `reconstructMissingFolders` in metadataStore.ts —
        // every cold start computing this folder arrives at the same id,
        // so the dedup pass on recovery (collapseDuplicateFolders) does not
        // see two different ids for the same path. A random id here would
        // create one entry per cold start with no way to dedupe later.
        id: folderIdForPath(newFullPath),
        name: trimmed,
        size: 0,
        mime: "inode/directory",
        folderPath: currentFolder,
        messageId: 0,
        channelId,
        uploadedAt: Date.now(),
        starred: false,
        trashed: false,
      };

      toast.success(t("actions.folder.created", { name: trimmed }));
      await applyOptimistic(channelId, [...files, newFolder], { eventType: "folder.created", eventPayload: { name: trimmed } });
    } catch (err: any) {
      console.error("Failed to create folder:", err);
      toast.error(err.message || t("actions.folder.createFailed"));
    }
  }, [currentFolder, getChannelId, t]);

  const renameFile = useCallback(async (fileId: string, newName: string) => {
    if (!newName.trim()) return;
    try {
      const channelId = await getChannelId();
      const allFiles = useFileStore.getState().files;
      const fileToRename = allFiles.find((f) => f.id === fileId);
      if (!fileToRename) throw new Error(t("actions.fileNotFound"));

      const isFolderRename = fileToRename.mime === "inode/directory" || fileToRename.mime === "application/x-directory";

      let oldPath = "";
      let newPath = "";
      if (isFolderRename) {
        // Match by path, not by id — every folder entry sharing the same
        // full path gets renamed together. With duplicates, matching by id
        // would only rename one entry and leave the others at the old name,
        // which is exactly what produced the "stale folder" bug.
        oldPath = fullPathForFolder(fileToRename);
        const trimmedName = newName.trim();
        newPath = fileToRename.folderPath === "/"
          ? `/${trimmedName}`
          : `${fileToRename.folderPath}/${trimmedName}`;
      }

      const updatedFiles = allFiles.map((f) => {
        if (isFolderRename) {
          // Apply rename to ALL folder entries sharing the old full path
          // (handles duplicates from the pre-fix bootstrap bug).
          if (isFolder(f) && fullPathForFolder(f) === oldPath) {
            return { ...f, name: newName.trim() };
          }
          // Children whose folderPath equals the old folder path get moved.
          if (f.folderPath === oldPath) {
            return { ...f, folderPath: newPath };
          }
          // Descendants (subfolders / files inside subfolders) get the new prefix.
          if (f.folderPath.startsWith(oldPath + "/")) {
            return { ...f, folderPath: newPath + f.folderPath.substring(oldPath.length) };
          }
          return f;
        }
        // File (non-folder) rename: id-based rename still works because
        // each uploaded file has exactly one entry per messageId now.
        if (f.id === fileId) {
          return { ...f, name: newName.trim() };
        }
        return f;
      });

      toast.success(t("actions.rename.success"));
      await applyOptimistic(channelId, updatedFiles, { eventType: "file.renamed", eventPayload: { name: fileToRename.name } });
    } catch (err: any) {
      console.error("Failed to rename:", err);
      toast.error(err.message || t("actions.rename.failed"));
    }
  }, [getChannelId, t]);

  const toggleStar = useCallback(async (file: TeleFile) => {
    try {
      const channelId = await getChannelId();
      const allFiles = useFileStore.getState().files;
      const currentFile = allFiles.find((f) => f.id === file.id);
      const nextStarred = currentFile ? !currentFile.starred : !file.starred;

      const updatedFiles = allFiles.map((f) =>
        f.id === file.id ? { ...f, starred: nextStarred } : f
      );

      toast.success(nextStarred ? t("actions.star.added") : t("actions.star.removed"));
      await applyOptimistic(channelId, updatedFiles, { eventType: nextStarred ? "file.starred" : "file.unstarred", eventPayload: { name: file.name } });
    } catch (err: any) {
      console.error("Failed to toggle star:", err);
      toast.error(err.message || t("actions.star.failed"));
    }
  }, [getChannelId, t]);

  const moveToTrash = useCallback(async (file: TeleFile) => {
    try {
      const channelId = await getChannelId();
      const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
      const allFiles = useFileStore.getState().files;

      const folderPathPrefix = file.folderPath === "/"
        ? `/${file.name}`
        : `${file.folderPath}/${file.name}`;

      const updatedFiles = allFiles.map((f) => {
        if (f.id === file.id || (isFolder && (f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/")))) {
          return { ...f, trashed: true };
        }
        return f;
      });

      toast.success(t("actions.trash.moved", { name: file.name }));
      await applyOptimistic(channelId, updatedFiles, { eventType: "file.trashed", eventPayload: { name: file.name } });
    } catch (err: any) {
      console.error("Failed to move to trash:", err);
      toast.error(err.message || t("actions.trash.moveFailed"));
    }
  }, [getChannelId, t]);

  const restoreFromTrash = useCallback(async (file: TeleFile) => {
    try {
      const channelId = await getChannelId();
      const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
      const allFiles = useFileStore.getState().files;

      const folderPathPrefix = file.folderPath === "/"
        ? `/${file.name}`
        : `${file.folderPath}/${file.name}`;

      const updatedFiles = allFiles.map((f) => {
        if (f.id === file.id || (isFolder && (f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/")))) {
          return { ...f, trashed: false };
        }
        return f;
      });

      toast.success(t("actions.trash.restored", { name: file.name }));
      await applyOptimistic(channelId, updatedFiles, { eventType: "file.restored", eventPayload: { name: file.name } });
    } catch (err: any) {
      console.error("Failed to restore from trash:", err);
      toast.error(err.message || t("actions.trash.restoreFailed"));
    }
  }, [getChannelId, t]);

  const archiveFile = useCallback(async (file: TeleFile) => {
    try {
      const channelId = await getChannelId();
      const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
      const allFiles = useFileStore.getState().files;

      const folderPathPrefix = file.folderPath === "/"
        ? `/${file.name}`
        : `${file.folderPath}/${file.name}`;

      const updatedFiles = allFiles.map((f) => {
        if (f.id === file.id || (isFolder && (f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/")))) {
          return { ...f, archived: true, starred: false };
        }
        return f;
      });

      toast.success(t("actions.archive.archived", { name: file.name }));
      await applyOptimistic(channelId, updatedFiles, { eventType: "file.archived", eventPayload: { name: file.name } });
    } catch (err: any) {
      console.error("Failed to archive:", err);
      toast.error(err.message || t("actions.archive.archiveFailed"));
    }
  }, [getChannelId, t]);

  const unarchiveFile = useCallback(async (file: TeleFile) => {
    try {
      const channelId = await getChannelId();
      const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
      const allFiles = useFileStore.getState().files;

      const folderPathPrefix = file.folderPath === "/"
        ? `/${file.name}`
        : `${file.folderPath}/${file.name}`;

      const updatedFiles = allFiles.map((f) => {
        if (f.id === file.id || (isFolder && (f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/")))) {
          return { ...f, archived: false };
        }
        return f;
      });

      toast.success(t("actions.archive.unarchived", { name: file.name }));
      await applyOptimistic(channelId, updatedFiles, { eventType: "file.unarchived", eventPayload: { name: file.name } });
    } catch (err: any) {
      console.error("Failed to unarchive:", err);
      toast.error(err.message || t("actions.archive.unarchiveFailed"));
    }
  }, [getChannelId, t]);

  const deletePermanently = useCallback(async (fileId: string) => {
    try {
      const channelId = await getChannelId();
      const allFiles = useFileStore.getState().files;
      const fileToDelete = allFiles.find((f) => f.id === fileId);
      if (!fileToDelete) throw new Error(t("actions.fileNotFound"));

      const isFolder = fileToDelete.mime === "inode/directory" || fileToDelete.mime === "application/x-directory";

      let targets: TeleFile[] = [];
      let active: TeleFile[] = [];

      if (isFolder) {
        const folderPathPrefix = fileToDelete.folderPath === "/"
          ? `/${fileToDelete.name}`
          : `${fileToDelete.folderPath}/${fileToDelete.name}`;

        targets = allFiles.filter((f) => f.id === fileId || f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/"));
        active = allFiles.filter((f) => f.id !== fileId && f.folderPath !== folderPathPrefix && !f.folderPath.startsWith(folderPathPrefix + "/"));
      } else {
        targets = [fileToDelete];
        active = allFiles.filter((f) => f.id !== fileId);
      }

      toast.success(t("actions.delete.success"));
      await applyOptimistic(channelId, active, { eventType: "file.deleted", eventPayload: { fileId } });

      // After the index commits, asynchronously delete offline caches and
      // Telegram messages in the background. If the index save had failed,
      // applyOptimistic would have rolled back and we'd never reach here.
      void (async () => {
        try {
          await Promise.allSettled(targets.map((f) => removeOfflineCache(f.id)));
          const deletionPromises = targets
            .filter((f) => f.messageId && f.messageId !== 0)
            .map((f) =>
              deleteTelegramMessage(channelId, f.messageId).catch((err) => {
                console.warn(
                  `[deletePermanently] Could not delete message ${f.messageId} for "${f.name}":`,
                  err?.message || err
                );
              })
            );
          await Promise.allSettled(deletionPromises);
          logEvent({ type: "file.deleted.acknowledged", payload: { fileId } });
        } catch (err) {
          console.error("[deletePermanently] Background deletion error:", err);
        }
      })();
    } catch (err: any) {
      console.error("Failed to delete permanently:", err);
      toast.error(err.message || t("actions.delete.failed"));
    }
  }, [getChannelId, t]);

  const emptyTrash = useCallback(async () => {
    try {
      const channelId = await getChannelId();
      const allFiles = useFileStore.getState().files;
      const trashed = allFiles.filter((f) => f.trashed);
      const active = allFiles.filter((f) => !f.trashed);

      if (trashed.length === 0) {
        toast.info(t("actions.emptyTrash.alreadyEmpty"));
        return;
      }

      toast.success(t("actions.emptyTrash.success", { count: trashed.length }));
      await applyOptimistic(channelId, active, { eventType: "files.deleted", eventPayload: { count: trashed.length } });

      // After the index commits, asynchronously clear cache & delete telegram messages in background
      void (async () => {
        try {
          await Promise.allSettled(trashed.map((f) => removeOfflineCache(f.id)));
          const deletionPromises = trashed
            .filter((f) => f.messageId && f.messageId !== 0)
            .map((f) =>
              deleteTelegramMessage(channelId, f.messageId).catch((err) => {
                console.warn(
                  `[emptyTrash] Could not delete message ${f.messageId} for "${f.name}":`,
                  err?.message || err
                );
              })
            );
          await Promise.allSettled(deletionPromises);
        } catch (err) {
          console.error("[emptyTrash] Background deletion error:", err);
        }
      })();
    } catch (err: any) {
      console.error("Failed to empty trash:", err);
      toast.error(err.message || t("actions.emptyTrash.failed"));
    }
  }, [getChannelId, t]);

  const moveMultipleToTrash = useCallback(async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
      const files = useFileStore.getState().files;
      const fileIdSet = new Set(fileIds);
      const targetFiles = files.filter((f) => fileIdSet.has(f.id));

      const folderPrefixes = targetFiles
        .filter(isFolder)
        .map(getFolderFullPath);

      const updatedFiles = files.map((f) => {
        const isInTarget = fileIdSet.has(f.id);
        const isInTrashedFolder = folderPrefixes.some(
          (prefix) => f.folderPath === prefix || f.folderPath.startsWith(prefix + "/")
        );
        if (isInTarget || isInTrashedFolder) {
          return { ...f, trashed: true };
        }
        return f;
      });

      toast.success(t("actions.bulk.trashed", { count: fileIds.length }));
      await applyOptimistic(channelId, updatedFiles, { eventType: "files.trashed", eventPayload: { count: fileIds.length } });
    } catch (err: any) {
      console.error("Failed to move multiple to trash:", err);
      toast.error(err.message || t("actions.bulk.trashFailed"));
    }
  }, [getChannelId, t]);

  const restoreMultipleFromTrash = useCallback(async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
      const files = useFileStore.getState().files;
      const fileIdSet = new Set(fileIds);
      const targetFiles = files.filter((f) => fileIdSet.has(f.id));

      const folderPrefixes = targetFiles
        .filter(isFolder)
        .map(getFolderFullPath);

      const updatedFiles = files.map((f) => {
        const isInTarget = fileIdSet.has(f.id);
        const isInRestoredFolder = folderPrefixes.some(
          (prefix) => f.folderPath === prefix || f.folderPath.startsWith(prefix + "/")
        );
        if (isInTarget || isInRestoredFolder) {
          return { ...f, trashed: false };
        }
        return f;
      });

      toast.success(t("actions.bulk.restored", { count: fileIds.length }));
      await applyOptimistic(channelId, updatedFiles, { eventType: "files.restored", eventPayload: { count: fileIds.length } });
    } catch (err: any) {
      console.error("Failed to restore multiple from trash:", err);
      toast.error(err.message || t("actions.bulk.restoreFailed"));
    }
  }, [getChannelId, t]);

  const deleteMultiplePermanently = useCallback(async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
      const files = useFileStore.getState().files;
      const fileIdSet = new Set(fileIds);
      const targetFiles = files.filter((f) => fileIdSet.has(f.id));
      
      const folderPrefixes = targetFiles
        .filter(isFolder)
        .map(getFolderFullPath);

      const isTargetOrInFolder = (f: TeleFile) => {
        return fileIdSet.has(f.id) || folderPrefixes.some(
          (prefix) => f.folderPath === prefix || f.folderPath.startsWith(prefix + "/")
        );
      };

      const targets = files.filter(isTargetOrInFolder);
      const active = files.filter((f) => !isTargetOrInFolder(f));

      toast.success(t("actions.bulk.deleted", { count: fileIds.length }));
      await applyOptimistic(channelId, active, { eventType: "files.deleted", eventPayload: { count: fileIds.length } });

      // After the index commits, asynchronously clear cache & delete telegram messages in background
      void (async () => {
        try {
          await Promise.allSettled(targets.map((f) => removeOfflineCache(f.id)));
          const deletionPromises = targets
            .filter((f) => f.messageId && f.messageId !== 0)
            .map((f) =>
              deleteTelegramMessage(channelId, f.messageId).catch((err) => {
                console.warn(
                  `[deleteMultiplePermanently] Could not delete message ${f.messageId} for "${f.name}":`,
                  err?.message || err
                );
              })
            );
          await Promise.allSettled(deletionPromises);
        } catch (err) {
          console.error("[deleteMultiplePermanently] Background deletion error:", err);
        }
      })();
    } catch (err: any) {
      console.error("Failed to delete multiple permanently:", err);
      toast.error(err.message || t("actions.bulk.deleteFailed"));
    }
  }, [getChannelId, t]);

  const archiveMultiple = useCallback(async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
      const files = useFileStore.getState().files;
      const fileIdSet = new Set(fileIds);
      const targetFiles = files.filter((f) => fileIdSet.has(f.id));

      const folderPrefixes = targetFiles
        .filter(isFolder)
        .map(getFolderFullPath);

      const updatedFiles = files.map((f) => {
        const isInTarget = fileIdSet.has(f.id);
        const isInArchivedFolder = folderPrefixes.some(
          (prefix) => f.folderPath === prefix || f.folderPath.startsWith(prefix + "/")
        );
        if (isInTarget || isInArchivedFolder) {
          return { ...f, archived: true, starred: false };
        }
        return f;
      });

      toast.success(t("actions.bulk.archived", { count: fileIds.length }));
      await applyOptimistic(channelId, updatedFiles, { eventType: "files.archived", eventPayload: { count: fileIds.length } });
    } catch (err: any) {
      console.error("Failed to archive multiple:", err);
      toast.error(err.message || t("actions.bulk.archiveFailed"));
    }
  }, [getChannelId, t]);

  const starMultiple = useCallback(async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
      const files = useFileStore.getState().files;
      const fileIdSet = new Set(fileIds);
      const targetFiles = files.filter((f) => fileIdSet.has(f.id));

      const folderPrefixes = targetFiles
        .filter(isFolder)
        .map(getFolderFullPath);

      const updatedFiles = files.map((f) => {
        const isInTarget = fileIdSet.has(f.id);
        const isInTargetFolder = folderPrefixes.some(
          (prefix) => f.folderPath === prefix || f.folderPath.startsWith(prefix + "/")
        );
        if ((isInTarget || isInTargetFolder) && !f.trashed && !f.archived) {
          return { ...f, starred: true };
        }
        return f;
      });

      toast.success(t("actions.bulk.starred", { count: fileIds.length }));
      await applyOptimistic(channelId, updatedFiles, { eventType: "files.starred", eventPayload: { count: fileIds.length } });
    } catch (err: any) {
      console.error("Failed to star multiple:", err);
      toast.error(err.message || t("actions.bulk.starFailed"));
    }
  }, [getChannelId, t]);

  const unarchiveMultiple = useCallback(async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
      const files = useFileStore.getState().files;
      const fileIdSet = new Set(fileIds);
      const targetFiles = files.filter((f) => fileIdSet.has(f.id));

      const folderPrefixes = targetFiles
        .filter(isFolder)
        .map(getFolderFullPath);

      const updatedFiles = files.map((f) => {
        const isInTarget = fileIdSet.has(f.id);
        const isInArchivedFolder = folderPrefixes.some(
          (prefix) => f.folderPath === prefix || f.folderPath.startsWith(prefix + "/")
        );
        if (isInTarget || isInArchivedFolder) {
          return { ...f, archived: false };
        }
        return f;
      });

      toast.success(t("actions.bulk.unarchived", { count: fileIds.length }));
      await applyOptimistic(channelId, updatedFiles, { eventType: "files.unarchived", eventPayload: { count: fileIds.length } });
    } catch (err: any) {
      console.error("Failed to unarchive multiple:", err);
      toast.error(err.message || t("actions.bulk.unarchiveFailed"));
    }
  }, [getChannelId, t]);

  const toggleOffline = useCallback(async (file: TeleFile) => {
    return fileActionQueue.enqueue(async () => {
      try {
        const channelId = await getChannelId();
        const allFiles = useFileStore.getState().files;
        const currentFile = allFiles.find((f) => f.id === file.id);
        const nextOffline = currentFile ? !currentFile.offline : !file.offline;

        if (nextOffline) {
          toast.info(t("actions.offline.downloading", { name: file.name }));
          await cacheFileOffline(channelId, file.messageId, file.id);
          toast.success(t("actions.offline.available", { name: file.name }));
        } else {
          await removeOfflineCache(file.id);
          toast.success(t("actions.offline.unavailable", { name: file.name }));
        }

        // Update the offline flag through the same optimistic + queue path
        // as every other action. This way a flood-wait on the index write
        // doesn't block the user, and the toggle stays consistent with the
        // visible files array.
        const updatedFiles = useFileStore
          .getState()
          .files.map((f) =>
            f.id === file.id ? { ...f, offline: nextOffline } : f
          );
        await applyOptimistic(channelId, updatedFiles, { eventType: "file.offlineToggled", eventPayload: { name: file.name, offline: nextOffline } });
      } catch (err: any) {
        console.error("Failed to toggle offline availability:", err);
        toast.error(err.message || t("actions.offline.failed"));
      }
    });
  }, [getChannelId, t]);

  const moveMultipleFilesOrFolders = useCallback(async (fileIds: string[], targetFolderPath: string) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
      const normalizedTargetPath = normalizeFolderPath(targetFolderPath);
      
      const files = useFileStore.getState().files;
      const selectedIdSet = new Set(fileIds);
      const selectedFiles = files.filter((f) => selectedIdSet.has(f.id));

      if (selectedFiles.length === 0) {
        toast.info(t("actions.move.nothingToMove"));
        return;
      }

      if (normalizedTargetPath !== "/") {
        const targetFolderExists = files.some(
          (f) => isFolder(f) && getFolderFullPath(f) === normalizedTargetPath
        );
        if (!targetFolderExists) {
          throw new Error(t("actions.move.destinationMissing"));
        }
      }

      const selectedFolders = selectedFiles.filter(isFolder);
      const selectedFolderPaths = selectedFolders.map((folder) => ({
        folder,
        fullPath: getFolderFullPath(folder),
      }));

      for (const { folder, fullPath } of selectedFolderPaths) {
        if (isSameOrDescendantPath(normalizedTargetPath, fullPath)) {
          throw new Error(t("actions.move.intoItself", { name: folder.name }));
        }
      }

      const rootSelectedIds = new Set<string>();
      for (const file of selectedFiles) {
        const filePath = isFolder(file) ? getFolderFullPath(file) : normalizeFolderPath(file.folderPath);
        const isCoveredBySelectedParent = selectedFolderPaths.some(
          ({ folder, fullPath }) => folder.id !== file.id && isSameOrDescendantPath(filePath, fullPath)
        );

        if (!isCoveredBySelectedParent) {
          rootSelectedIds.add(file.id);
        }
      }

      const movedRootFolders = selectedFolders
        .filter((folder) => rootSelectedIds.has(folder.id))
        .map((folder) => {
          const oldFullPath = getFolderFullPath(folder);
          const newFullPath = normalizedTargetPath === "/"
            ? `/${folder.name}`
            : `${normalizedTargetPath}/${folder.name}`;
          return { folder, oldFullPath, newFullPath };
        });
      
      const updatedFiles = files.map((f) => {
        // Files/folers explicitly selected: re-home them.
        if (rootSelectedIds.has(f.id)) {
          if (normalizeFolderPath(f.folderPath) === normalizedTargetPath) return f;
          return { ...f, folderPath: normalizedTargetPath };
        }

        for (const { oldFullPath, newFullPath } of movedRootFolders) {
          // Apply the path shift to EVERY folder entry sharing the old full
          // path — handles duplicates from the pre-fix bootstrap bug. Files
          // (non-folders) match by their `folderPath` field as before.
          if (isFolder(f) && fullPathForFolder(f) === oldFullPath) {
            return { ...f, folderPath: newFullPath };
          }
          const currentPath = normalizeFolderPath(f.folderPath);
          if (currentPath === oldFullPath) {
            return { ...f, folderPath: newFullPath };
          }
          if (currentPath.startsWith(`${oldFullPath}/`)) {
            return { ...f, folderPath: `${newFullPath}${currentPath.substring(oldFullPath.length)}` };
          }
        }

        return f;
      });

      const hasChanges = updatedFiles.some((file, index) => file !== files[index]);
      if (!hasChanges) {
        toast.info(t("actions.move.alreadyInFolder"));
        return;
      }

      toast.success(t("actions.move.success", { count: fileIds.length }));
      await applyOptimistic(channelId, updatedFiles, { eventType: "files.moved", eventPayload: { count: fileIds.length, target: targetFolderPath } });
    } catch (err: any) {
      console.error("Failed to move items:", err);
      toast.error(err.message || t("actions.move.failed"));
    }
  }, [getChannelId, t]);

  return useMemo(() => ({
    isOperating,
    createFolder,
    renameFile,
    toggleStar,
    moveToTrash,
    restoreFromTrash,
    archiveFile,
    unarchiveFile,
    deletePermanently,
    emptyTrash,
    moveMultipleToTrash,
    restoreMultipleFromTrash,
    deleteMultiplePermanently,
    starMultiple,
    archiveMultiple,
    unarchiveMultiple,
    toggleOffline,
    moveMultipleFilesOrFolders,
  }), [
    isOperating,
    createFolder,
    renameFile,
    toggleStar,
    moveToTrash,
    restoreFromTrash,
    archiveFile,
    unarchiveFile,
    deletePermanently,
    emptyTrash,
    moveMultipleToTrash,
    restoreMultipleFromTrash,
    deleteMultiplePermanently,
    starMultiple,
    archiveMultiple,
    unarchiveMultiple,
    toggleOffline,
    moveMultipleFilesOrFolders,
  ]);
}
