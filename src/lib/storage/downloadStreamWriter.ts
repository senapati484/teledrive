import { invoke } from "@tauri-apps/api/core";
import { writeFile } from "@tauri-apps/plugin-fs";

function isContentUri(path: string): boolean {
  return path.startsWith("content://");
}

/**
 * Writes one download chunk without keeping the whole file in memory.
 * Local paths use the native temp-file writer (atomic rename on finalize);
 * Android SAF URIs must go through plugin-fs because only the platform
 * ContentResolver can write them.
 */
export async function writeDownloadChunk(
  targetPath: string,
  chunk: Uint8Array,
  append: boolean
): Promise<void> {
  if (isContentUri(targetPath)) {
    await writeFile(
      targetPath,
      chunk,
      append ? { append: true } : { create: true }
    );
    return;
  }

  await invoke("write_file_chunk", {
    path: targetPath,
    data: Array.from(chunk),
    append,
    done: false,
    sync: false,
  });
}

/** Commits the temp file over the destination (no-op for content URIs). */
export async function finalizeDownloadFile(targetPath: string): Promise<void> {
  if (isContentUri(targetPath)) return;
  await invoke("write_file_chunk", {
    path: targetPath,
    data: [],
    append: true,
    done: true,
    sync: true,
  });
}

/** Drops partial data so a cancelled/failed download leaves no file behind. */
export async function discardDownloadFile(targetPath: string): Promise<void> {
  try {
    if (isContentUri(targetPath)) {
      // The save dialog already created the document; empty it out.
      await writeFile(targetPath, new Uint8Array(0));
      return;
    }
    await invoke("write_file_chunk", {
      path: targetPath,
      data: [],
      append: true,
      discard: true,
    });
  } catch (err) {
    console.warn(
      "[downloadStreamWriter] Failed to discard partial download:",
      err
    );
  }
}
