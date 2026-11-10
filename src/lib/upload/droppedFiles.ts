import { normalizeFolderPath } from "../utils";

export interface CollectedDropFile {
  file: File;
  relativePath?: string;
}

export interface CollectedDropTree {
  files: CollectedDropFile[];
  emptyFolderPaths: string[];
}

/**
 * Resolves the destination virtual folder path for a file uploaded from a
 * folder picker (`webkitRelativePath`) or recursive folder drag-and-drop.
 * E.g. `baseFolderPath = "/Work"`, `relativePath = "Photos/2026/a.jpg"`
 * returns `"/Work/Photos/2026"`.
 */
export function resolveRelativeUploadFolder(
  baseFolderPath: string,
  relativePath?: string | null
): string {
  const base = normalizeFolderPath(baseFolderPath);
  if (!relativePath) return base;

  const segments = relativePath
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "." && s !== "..");

  // Drop the trailing filename segment; only keep containing directories.
  if (segments.length <= 1) {
    return base;
  }

  const subDirs = segments.slice(0, -1).join("/");
  return normalizeFolderPath(base === "/" ? `/${subDirs}` : `${base}/${subDirs}`);
}

/**
 * Joins a relative folder path (e.g. `"EmptyDir/Sub"`) onto `baseFolderPath`.
 */
export function joinVirtualFolderPath(
  baseFolderPath: string,
  relativeFolderPath: string
): string {
  const base = normalizeFolderPath(baseFolderPath);
  const sub = normalizeFolderPath(relativeFolderPath);
  if (sub === "/") return base;
  return normalizeFolderPath(base === "/" ? sub : `${base}${sub}`);
}

interface DropEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (f: File) => void, error?: (err: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: DropEntryLike[]) => void,
      error?: (err: unknown) => void
    ) => void;
  };
}

function readAllDirectoryEntries(
  reader: NonNullable<DropEntryLike["createReader"]> extends () => infer R ? R : never
): Promise<DropEntryLike[]> {
  return new Promise((resolve) => {
    const all: DropEntryLike[] = [];
    const readNextBatch = () => {
      reader.readEntries(
        (batch) => {
          if (!batch || batch.length === 0) {
            resolve(all);
            return;
          }
          all.push(...batch);
          readNextBatch();
        },
        () => resolve(all)
      );
    };
    readNextBatch();
  });
}

function readEntryAsFile(entry: DropEntryLike): Promise<File | null> {
  if (!entry.file) return Promise.resolve(null);
  return new Promise((resolve) => {
    entry.file!(
      (file) => resolve(file),
      () => resolve(null)
    );
  });
}

async function walkDropEntry(
  entry: DropEntryLike,
  parentRelPath: string,
  out: CollectedDropTree
): Promise<void> {
  const relPath = parentRelPath ? `${parentRelPath}/${entry.name}` : entry.name;

  if (entry.isFile) {
    const file = await readEntryAsFile(entry);
    if (file) {
      out.files.push({
        file,
        relativePath: parentRelPath ? relPath : undefined,
      });
    }
    return;
  }

  if (entry.isDirectory && entry.createReader) {
    const children = await readAllDirectoryEntries(entry.createReader());
    if (children.length === 0) {
      out.emptyFolderPaths.push(`/${relPath}`);
      return;
    }
    for (const child of children) {
      await walkDropEntry(child, relPath, out);
    }
  }
}

/**
 * Walks dropped `DataTransfer` items synchronously before awaiting directory
 * traversal (browsers clear `DataTransferItemList` after the drop turn yields),
 * returning nested files with relative paths plus any empty directories.
 */
export async function collectDroppedFilesAndFolders(
  dataTransfer: Pick<DataTransfer, "items" | "files">
): Promise<CollectedDropTree> {
  const result: CollectedDropTree = { files: [], emptyFolderPaths: [] };

  const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
  const entries: DropEntryLike[] = [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    const getEntry = (item as unknown as { webkitGetAsEntry?: () => DropEntryLike | null })
      .webkitGetAsEntry;
    if (typeof getEntry === "function") {
      const entry = getEntry.call(item);
      if (entry) {
        entries.push(entry);
      }
    }
  }

  if (entries.length > 0) {
    for (const entry of entries) {
      await walkDropEntry(entry, "", result);
    }
    return result;
  }

  const files = dataTransfer.files ? Array.from(dataTransfer.files) : [];
  for (const file of files) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    result.files.push({
      file,
      relativePath: rel && rel.includes("/") ? rel : undefined,
    });
  }
  return result;
}

