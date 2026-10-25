/**
 * Pending index marker — a tiny, synchronous record that an optimistic file
 * state has not been committed to Telegram yet.
 *
 * The payload itself lives in the file cache (localStorage), flushed
 * synchronously before the marker is written. On the next bootstrap, the
 * marker tells us whether that cache is newer than the index loaded from
 * Telegram. This survives crashes and failed logout flushes.
 */

import type { TeleFile } from "../types";

const KEY_PREFIX = "teledrive_pending_index:";

export interface PendingIndexMarker {
  channelId: string;
  /** Effective `savedAt` of the epoch the local state was based on. 0 = unknown. */
  baseSavedAt: number;
  /** Unix ms when the local change was recorded. */
  at: number;
}

export function writePendingMarker(marker: PendingIndexMarker): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      KEY_PREFIX + marker.channelId,
      JSON.stringify(marker)
    );
  } catch (err) {
    console.warn("[pendingIndex] Failed to write marker:", err);
  }
}

export function readPendingMarker(channelId: string): PendingIndexMarker | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + channelId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.channelId !== channelId) return null;
    if (
      typeof parsed.baseSavedAt !== "number" ||
      !Number.isFinite(parsed.baseSavedAt) ||
      parsed.baseSavedAt < 0
    ) {
      return null;
    }
    if (typeof parsed.at !== "number" || !Number.isFinite(parsed.at)) {
      return null;
    }
    return {
      channelId,
      baseSavedAt: parsed.baseSavedAt,
      at: parsed.at,
    };
  } catch {
    return null;
  }
}

export function clearPendingMarker(channelId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(KEY_PREFIX + channelId);
  } catch (err) {
    console.warn("[pendingIndex] Failed to clear marker:", err);
  }
}

export type PendingIndexResolution =
  | { kind: "none"; files: TeleFile[]; replay: false }
  | { kind: "keep-cache"; files: TeleFile[]; replay: true }
  | { kind: "merge"; files: TeleFile[]; replay: boolean }
  | { kind: "discard"; files: TeleFile[]; replay: false };

/**
 * Decide what to do with the local cache when Telegram's index has loaded.
 *
 * - Newer/equal base: the cache contains an uncommitted action -> keep it and
 *   replay one save.
 * - Older base: the remote epoch already includes (or supersedes) the change ->
 *   discard the marker.
 * - Unknown base (legacy queue, no epoch): additive merge only. Never remove
 *   loaded files, and only replay when the cache contributes ids the loaded
 *   index lacks.
 */
export function resolvePendingIndex(
  marker: PendingIndexMarker | null,
  cachedFiles: TeleFile[],
  loadedFiles: TeleFile[],
  loadedSavedAt: number
): PendingIndexResolution {
  if (!marker) {
    return { kind: "none", files: loadedFiles, replay: false };
  }

  if (marker.baseSavedAt > 0) {
    if (marker.baseSavedAt >= loadedSavedAt) {
      return { kind: "keep-cache", files: cachedFiles, replay: true };
    }
    return { kind: "discard", files: loadedFiles, replay: false };
  }

  const loadedIds = new Set(loadedFiles.map((f) => f.id));
  const seen = new Set(cachedFiles.map((f) => f.id));
  const merged = [...cachedFiles];
  for (const file of loadedFiles) {
    if (seen.has(file.id)) continue;
    merged.push(file);
    seen.add(file.id);
  }

  const cacheHasExtra = cachedFiles.some((f) => !loadedIds.has(f.id));
  if (!cacheHasExtra) {
    return { kind: "discard", files: loadedFiles, replay: false };
  }
  return { kind: "merge", files: merged, replay: true };
}
