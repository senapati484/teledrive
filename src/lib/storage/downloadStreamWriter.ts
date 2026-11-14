import { invoke } from "@tauri-apps/api/core";

function isContentUri(path: string): boolean {
  return path.startsWith("content://");
}

/** Encodes bytes to RFC 4648 base64 with maximum performance and no call stack overflow. */
export function uint8ToBase64(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) return "";
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  const SLICE = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + SLICE));
  }
  return btoa(binary);
}

/**
 * Writes one download chunk without keeping the whole file in memory.
 * Local paths use the native temp-file writer (atomic rename on finalize);
 * Android SAF `content://` URIs stream through the native Rust SAF FD pool
 * using compact base64 chunks (avoiding plugin-fs's unsupported `wa`/`wt` modes).
 */
export async function writeDownloadChunk(
  targetPath: string,
  chunk: Uint8Array,
  append: boolean
): Promise<void> {
  if (isContentUri(targetPath)) {
    await invoke("write_file_chunk", {
      path: targetPath,
      dataB64: uint8ToBase64(chunk),
      append,
      done: false,
      sync: false,
    });
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

/** Commits the temp file or flushes/closes the open Android SAF file descriptor. */
export async function finalizeDownloadFile(targetPath: string): Promise<void> {
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
