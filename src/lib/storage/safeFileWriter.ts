import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";

// 512KB chunk size ensures fast, reliable serialization across all platforms
const CHUNK_SIZE = 512 * 1024;

/**
 * Safely writes a binary buffer to disk.
 * Bypasses @tauri-apps/plugin-fs bugs, capability scopes, and Windows WebView2
 * binary POST payload limitations ('unexpected invoke body').
 */
export async function saveBinaryFile(
  filePath: string,
  data: Uint8Array | ArrayBuffer | any
): Promise<void> {
  // Normalize input into a Uint8Array
  let bytes: Uint8Array;
  if (data instanceof Uint8Array) {
    bytes = data;
  } else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (Array.isArray(data)) {
    bytes = new Uint8Array(data);
  } else if (data && typeof data === "object" && data.buffer instanceof ArrayBuffer) {
    bytes = new Uint8Array(
      data.buffer,
      typeof data.byteOffset === "number" ? data.byteOffset : 0,
      typeof data.byteLength === "number" ? data.byteLength : data.buffer.byteLength
    );
  } else if (data && typeof data === "object" && Array.isArray((data as any).data)) {
    bytes = new Uint8Array((data as any).data);
  } else {
    bytes = new Uint8Array(data);
  }

  // Android's save dialog returns a Storage Access Framework URI
  // (`content://…`), not a filesystem path. Only tauri-plugin-fs can resolve
  // it through the ContentResolver; the native Rust writer would create a
  // stray relative file (or fail) and leave the chosen document at 0 bytes.
  if (filePath.startsWith("content://")) {
    try {
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      await writeFile(filePath, bytes);
      return;
    } catch (uriErr: any) {
      console.error("[safeFileWriter] Failed to write content URI:", uriErr);
      throw new Error(
        i18n.t("messages:storage.saveFailed", { path: filePath })
      );
    }
  }

  try {
    // If file is smaller than CHUNK_SIZE, write in one shot via native Rust command
    if (bytes.byteLength <= CHUNK_SIZE) {
      await invoke("write_file_binary", {
        path: filePath,
        data: Array.from(bytes),
      });
      return;
    }

    // For larger files, stream write in chunks to prevent IPC overflow on Windows WebView2
    let offset = 0;
    let isFirstChunk = true;

    while (offset < bytes.byteLength) {
      const end = Math.min(offset + CHUNK_SIZE, bytes.byteLength);
      const chunk = bytes.subarray(offset, end);

      await invoke("write_file_chunk", {
        path: filePath,
        data: Array.from(chunk),
        append: !isFirstChunk,
        done: end >= bytes.byteLength,
      });

      isFirstChunk = false;
      offset = end;
    }
  } catch (nativeErr: any) {
    console.warn("[safeFileWriter] Native writer error, attempting fallback:", nativeErr);

    // Fallback: try plugin-fs if available in this environment
    try {
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      await writeFile(filePath, bytes);
    } catch (fallbackErr: any) {
      console.error("[safeFileWriter] Both native writer and fallback failed:", fallbackErr);
      throw new Error(
        i18n.t("messages:storage.saveFailed", { path: filePath })
      );
    }
  }
}
