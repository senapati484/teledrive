import { isBackupItem } from "../backup/visibility";
import { normalizeFolderPath } from "../files/pathUtils";
import type { TeleFile } from "../types";
import {
  basename,
  isWithinPath,
  normalizeVirtualPath,
} from "./protocol";

/** Pure virtual-tree helpers over the flat `TeleFile[]` catalog. */

export function isFolderEntry(entry: Pick<TeleFile, "mime">): boolean {
  return entry.mime === "inode/directory" || entry.mime === "application/x-directory";
}

/** Absolute virtual path of a catalog entry. */
export function fullPathOf(entry: Pick<TeleFile, "folderPath" | "name">): string {
  const parent = normalizeFolderPath(entry.folderPath);
  const name = entry.name.replace(/^\/+|\/+$/g, "");
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

/**
 * The set of entries the app renders in My Drive: not trashed, not archived,
 * and outside the device-backup namespace (which has its own sidebar view).
 */
export function visibleDriveEntries(files: TeleFile[]): TeleFile[] {
  const out: TeleFile[] = [];
  for (const file of files) {
    if (!file || file.trashed || file.archived) continue;
    if (isBackupItem(file)) continue;
    out.push(file);
  }
  return out;
}

function preferEntry(candidate: TeleFile, existing: TeleFile): boolean {
  if (isFolderEntry(candidate) !== isFolderEntry(existing)) {
    return isFolderEntry(candidate);
  }
  if ((candidate.uploadedAt || 0) !== (existing.uploadedAt || 0)) {
    return (candidate.uploadedAt || 0) > (existing.uploadedAt || 0);
  }
  return (candidate.messageId || 0) > (existing.messageId || 0);
}

/**
 * Deduplicates direct children by name. WebDAV hrefs must be unique; when the
 * catalog holds real duplicates the most recent entry wins (folders beat files
 * with the same name because the tree cannot represent both).
 */
export function dedupeChildrenByName(children: TeleFile[]): TeleFile[] {
  const byName = new Map<string, TeleFile>();
  for (const entry of children) {
    const existing = byName.get(entry.name);
    if (!existing || preferEntry(entry, existing)) {
      byName.set(entry.name, entry);
    }
  }
  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

export function childrenOf(files: TeleFile[], path: string): TeleFile[] {
  const normalized = normalizeVirtualPath(path);
  const direct = visibleDriveEntries(files).filter(
    (entry) => normalizeFolderPath(entry.folderPath) === normalized
  );
  return dedupeChildrenByName(direct);
}

/** Finds the entry addressed by `path`; folders win when a file collides. */
export function findEntryByPath(files: TeleFile[], path: string): TeleFile | null {
  const normalized = normalizeVirtualPath(path);
  if (normalized === "/") return null;
  let best: TeleFile | null = null;
  for (const entry of visibleDriveEntries(files)) {
    if (fullPathOf(entry) !== normalized) continue;
    if (!best || preferEntry(entry, best)) best = entry;
  }
  return best;
}

/**
 * True when `path` behaves as a collection. This includes implicit folders:
 * a path with child entries is a folder even if its synthetic folder entry has
 * not been healed into the catalog yet.
 */
export function folderExists(files: TeleFile[], path: string): boolean {
  const normalized = normalizeVirtualPath(path);
  if (normalized === "/") return true;
  const entry = findEntryByPath(files, normalized);
  if (entry) return isFolderEntry(entry);
  return visibleDriveEntries(files).some((file) =>
    isWithinPath(normalizeFolderPath(file.folderPath), normalized)
  );
}

export interface TreeNode {
  path: string;
  name: string;
  isFolder: boolean;
  file: TeleFile | null;
}

/** Resolves a path to a file, an explicit folder, or an implicit folder. */
export function nodeForPath(files: TeleFile[], path: string): TreeNode | null {
  const normalized = normalizeVirtualPath(path);
  if (normalized === "/") {
    return { path: "/", name: "TeleDrive", isFolder: true, file: null };
  }
  const entry = findEntryByPath(files, normalized);
  if (entry) {
    return {
      path: normalized,
      name: entry.name,
      isFolder: isFolderEntry(entry),
      file: entry,
    };
  }
  if (folderExists(files, normalized)) {
    return { path: normalized, name: basename(normalized), isFolder: true, file: null };
  }
  return null;
}

/** Every visible entry at or below `path` (used for recursive DELETE/MOVE/COPY). */
export function subtreeEntries(files: TeleFile[], path: string): TeleFile[] {
  const normalized = normalizeVirtualPath(path);
  return visibleDriveEntries(files).filter((entry) =>
    isWithinPath(fullPathOf(entry), normalized)
  );
}

/** Rewrites the folder prefix of an entry when its ancestor folder moves. */
export function rebaseFolderPath(
  folderPath: string,
  fromPath: string,
  toPath: string
): string {
  const parent = normalizeFolderPath(folderPath);
  if (!isWithinPath(parent, fromPath)) return parent;
  const relative = parent.slice(fromPath.length);
  const base = toPath === "/" ? "" : toPath;
  return normalizeFolderPath(`${base}${relative}`);
}

/**
 * Direct children of a collection as `TreeNode`s, including implicit folders
 * that only exist because files below them reference the path. Guarantees that
 * every addressable href appears in a Depth:1 PROPFIND even before the catalog
 * has been healed.
 */
export function childNodesOf(files: TeleFile[], path: string): TreeNode[] {
  const normalized = normalizeVirtualPath(path);
  const direct = childrenOf(files, normalized);
  const nodes: TreeNode[] = direct.map((entry) => ({
    path: fullPathOf(entry),
    name: entry.name,
    isFolder: isFolderEntry(entry),
    file: entry,
  }));
  const seen = new Set(nodes.map((node) => node.name));
  const prefix = normalized === "/" ? "/" : `${normalized}/`;

  for (const entry of visibleDriveEntries(files)) {
    const parent = normalizeFolderPath(entry.folderPath);
    if (parent === normalized) continue;
    if (!isWithinPath(parent, normalized)) continue;
    const relative = parent.slice(prefix.length);
    const first = relative.split("/")[0];
    if (!first || seen.has(first)) continue;
    seen.add(first);
    nodes.push({
      path: normalized === "/" ? `/${first}` : `${normalized}/${first}`,
      name: first,
      isFolder: true,
      file: null,
    });
  }

  return nodes.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}
