import type { TeleFile } from "../types";

/**
 * Checks whether a file or directory entry represents system or version-control junk
 * (e.g. .DS_Store, Git internal object hashes, hook samples, plumbing files)
 * that should never be indexed, stored, or displayed in TeleDrive.
 */
export function isJunkFile(
  file: Partial<TeleFile> | { name: string; folderPath?: string; mime?: string; size?: number }
): boolean {
  if (!file) return false;
  const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
  const name = (file.name || "").trim();
  const folderPath = (file.folderPath || "").trim();

  if (isFolder) {
    return name === ".git" || folderPath.includes("/.git");
  }

  // 1. Files inside .git directories
  if (folderPath.includes("/.git") || folderPath === ".git" || folderPath.startsWith("/.git")) {
    return true;
  }

  // 2. OS metadata / junk (macOS, Windows, Linux)
  if (
    name === ".DS_Store" ||
    name.startsWith("._") ||
    name === "Thumbs.db" ||
    name === "desktop.ini" ||
    name === "ehthumbs.db" ||
    name === ".directory" ||
    name.startsWith(".Trash-") ||
    name.endsWith("~")
  ) {
    return true;
  }

  // 3. Temporary / partial lock files
  if (name.startsWith("~$") || name.endsWith(".crdownload") || name.endsWith(".tmp")) {
    return true;
  }

  return false;
}

/**
 * Filters out all junk files from a TeleFile array.
 */
export function filterJunkFiles(files: TeleFile[]): TeleFile[] {
  return files.filter((f) => !isJunkFile(f));
}
