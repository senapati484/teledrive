import { TeleFile } from "../types";
import { normalizeFolderPath } from "../utils";
import { getFileCategory } from "./fileUtils";

export interface CategoryBreakdownItem {
  category: string;
  count: number;
  bytes: number;
  percentage: number;
}

export interface ItemStats {
  isDirectory: boolean;
  fullPath: string;
  totalBytes: number;
  fileCount: number;
  folderCount: number;
  lastModifiedAt: number;
  encryptedCount: number;
  offlineCount: number;
  breakdown: CategoryBreakdownItem[];
}

function isDir(file: TeleFile): boolean {
  return file.mime === "inode/directory" || file.mime === "application/x-directory";
}

function safeBytes(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Resolves the canonical virtual path of a file or folder.
 */
export function resolveItemFullPath(item: TeleFile): string {
  const parent = normalizeFolderPath(item.folderPath || "/");
  return parent === "/" ? `/${item.name}` : `${parent}/${item.name}`;
}

/**
 * Computes metadata and recursive statistics for a file or folder.
 * For folders, sums all non-trashed descendant files (and counts nested folders)
 * along with a category-level storage breakdown.
 */
export function computeItemStats(item: TeleFile, allFiles: TeleFile[]): ItemStats {
  const dir = isDir(item);
  const fullPath = resolveItemFullPath(item);

  if (!dir) {
    const bytes = safeBytes(item.size);
    const category = getFileCategory(item.name, item.mime) || "Other";
    return {
      isDirectory: false,
      fullPath,
      totalBytes: bytes,
      fileCount: 1,
      folderCount: 0,
      lastModifiedAt: Math.max(item.uploadedAt || 0, item.lastOpenedAt || 0),
      encryptedCount: item.enc ? 1 : 0,
      offlineCount: item.offline ? 1 : 0,
      breakdown: [
        {
          category,
          count: 1,
          bytes,
          percentage: 100,
        },
      ],
    };
  }

  const normalizedPrefix = normalizeFolderPath(fullPath);
  const descendantPrefix = `${normalizedPrefix}/`;
  let totalBytes = 0;
  let fileCount = 0;
  let folderCount = 0;
  let lastModifiedAt = Math.max(item.uploadedAt || 0, item.lastOpenedAt || 0);
  let encryptedCount = 0;
  let offlineCount = 0;

  const byCategory = new Map<string, { count: number; bytes: number }>();

  for (const candidate of allFiles) {
    if (candidate.id === item.id) continue;
    // Match the same trash/archive state as the inspected folder
    if (Boolean(candidate.trashed) !== Boolean(item.trashed)) continue;

    const candidateFolder = normalizeFolderPath(candidate.folderPath || "/");
    const isDescendant =
      candidateFolder === normalizedPrefix ||
      candidateFolder.startsWith(descendantPrefix);

    if (!isDescendant) continue;

    const ts = Math.max(candidate.uploadedAt || 0, candidate.lastOpenedAt || 0);
    if (ts > lastModifiedAt) lastModifiedAt = ts;

    if (isDir(candidate)) {
      folderCount += 1;
      continue;
    }

    const bytes = safeBytes(candidate.size);
    fileCount += 1;
    totalBytes += bytes;
    if (candidate.enc) encryptedCount += 1;
    if (candidate.offline) offlineCount += 1;

    const category = getFileCategory(candidate.name, candidate.mime) || "Other";
    const entry = byCategory.get(category) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += bytes;
    byCategory.set(category, entry);
  }

  const breakdown: CategoryBreakdownItem[] = Array.from(byCategory.entries())
    .map(([category, info]) => ({
      category,
      count: info.count,
      bytes: info.bytes,
      percentage:
        totalBytes > 0
          ? Math.round((info.bytes / totalBytes) * 1000) / 10
          : fileCount > 0
          ? Math.round((info.count / fileCount) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes || b.count - a.count);

  return {
    isDirectory: true,
    fullPath,
    totalBytes,
    fileCount,
    folderCount,
    lastModifiedAt,
    encryptedCount,
    offlineCount,
    breakdown,
  };
}
