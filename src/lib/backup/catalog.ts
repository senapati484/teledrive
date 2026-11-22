import { folderIdForPath } from "../storage/folderIdentity";
import type { TeleFile } from "../types";
import { BACKUP_ROOT_PREFIX } from "./visibility";

/**
 * File entries carry their own full paths. Nested generated folders can be
 * reconstructed on load and need not consume Telegram index messages.
 * Keep immediate source children (including empty ones), user-created
 * folders, and folders with user state.
 */
export function compactBackupCatalog(files: TeleFile[]): TeleFile[] {
  return files.filter((file) => {
    if (file.mime !== "inode/directory" || file.messageId !== 0 ||
        !file.folderPath.startsWith(BACKUP_ROOT_PREFIX) ||
        file.starred || file.archived || file.trashed) return true;

    const path = `${file.folderPath}/${file.name}`;
    const depth = path.slice(BACKUP_ROOT_PREFIX.length).split("/").length;
    return depth <= 3 || file.id !== folderIdForPath(path);
  });
}
