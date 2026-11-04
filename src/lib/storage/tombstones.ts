/**
 * Local deletion tombstones.
 *
 * Permanently deleted files are removed from the metadata index before their
 * Telegram messages are deleted in the background. If that message deletion
 * fails (rate limit, timeout, app quit), the orphan scan would otherwise see
 * an unindexed document and resurrect it on the next launch. Remote sync could
 * do the same with a stale index snapshot.
 *
 * Tombstones are deliberately local-only: they are a safety net for this
 * device's deletions, not a cross-device delete log. The index remains the
 * cross-device source of truth.
 */
import type { TeleFile } from "../types";
import { canonicalChannelId, channelKeyVariants } from "../telegram/peerId";

export { canonicalChannelId };

const STORAGE_KEY = "teledrive_deleted_messages_v1";
const MAX_PER_CHANNEL = 5000;

type TombstoneMap = Record<string, number[]>;

function readAll(): TombstoneMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as TombstoneMap) : {};
  } catch (err) {
    console.warn("[tombstones] Failed to read deletion tombstones:", err);
    return {};
  }
}

function writeAll(map: TombstoneMap): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn("[tombstones] Failed to write deletion tombstones:", err);
  }
}

function normalizeIds(ids: Iterable<number>): number[] {
  return [...new Set(ids)].filter((id) => Number.isFinite(id) && id > 0);
}

export function recordDeletedMessages(channelId: string, ids: Iterable<number>): void {
  if (!channelId) return;
  const nextIds = normalizeIds(ids);
  if (nextIds.length === 0) return;

  const map = readAll();
  const variants = channelKeyVariants(channelId);
  const existing = new Set<number>();
  for (const key of variants) {
    for (const id of map[key] ?? []) {
      if (Number.isFinite(id) && id > 0) existing.add(id);
    }
  }
  for (const id of nextIds) existing.add(id);

  // Collapse legacy raw-positive keys into the canonical marked id.
  for (const key of variants) {
    if (key !== canonicalChannelId(channelId)) delete map[key];
  }
  map[canonicalChannelId(channelId)] = [...existing].slice(-MAX_PER_CHANNEL);
  writeAll(map);
}

/** Undo a tombstone after a failed delete rolled the optimistic state back. */
export function clearDeletedMessages(channelId: string, ids: Iterable<number>): void {
  if (!channelId) return;
  const removeIds = new Set(normalizeIds(ids));
  if (removeIds.size === 0) return;

  const map = readAll();
  const variants = channelKeyVariants(channelId);
  const remaining = new Set<number>();
  for (const key of variants) {
    for (const id of map[key] ?? []) {
      if (!removeIds.has(id) && Number.isFinite(id) && id > 0) remaining.add(id);
    }
    if (key !== canonicalChannelId(channelId)) delete map[key];
  }

  const canonical = canonicalChannelId(channelId);
  if (remaining.size === 0) delete map[canonical];
  else map[canonical] = [...remaining];
  writeAll(map);
}

export function getDeletedMessageIds(channelId: string): Set<number> {
  if (!channelId) return new Set();
  const map = readAll();
  const deleted = new Set<number>();
  for (const key of channelKeyVariants(channelId)) {
    for (const id of map[key] ?? []) {
      if (Number.isFinite(id) && id > 0) deleted.add(id);
    }
  }
  return deleted;
}

/** Drop any file whose Telegram message was permanently deleted on this device. */
export function filterDeletedMessages(channelId: string, files: TeleFile[]): TeleFile[] {
  if (!channelId || files.length === 0) return files;
  const deleted = getDeletedMessageIds(channelId);
  if (deleted.size === 0) return files;
  return files.filter((file) => {
    const messageId = Number(file.messageId);
    return !(Number.isFinite(messageId) && messageId > 0 && deleted.has(messageId));
  });
}

/** Test-only reset. */
export function resetDeletedMessagesForTests(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
