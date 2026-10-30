/**
 * Index recovery — read-only scan of channel history for files that are no
 * longer reachable from the live index, plus an explicit, user-triggered
 * replace that is the ONLY write allowed while discovery is incomplete.
 *
 * Scanning never writes and never deletes. Restore verifies that each file's
 * Telegram message still exists before persisting a fresh v2 generation.
 */

import { Api } from "telegram";
import { getClient } from "../telegram/client";
import {
  reconstructMissingFolders,
  resolveChannelInputPeer,
  withTimeout,
} from "./metadataStore";
import {
  parseIndexMessage,
  isValidManifest,
  type ParsedIndexChunk,
} from "./indexFormat";
import { normalizeFolderPath } from "../utils";
import { enqueueSaveDuringRecovery } from "./indexQueue";
import { useFileStore } from "../../stores/fileStore";
import { clearPendingMarker, writePendingMarker } from "./pendingIndex";
import type { TeleFile } from "../types";
import { invoke } from "@tauri-apps/api/core";
import { filterDeletedMessages, getDeletedMessageIds } from "./tombstones";

const MAX_SCAN_CHUNKS = 5000;
const MAX_SCAN_MS = 60_000;
const MAX_CHANNEL_FILE_MESSAGES = 10_000;
const MAX_CHANNEL_FILE_MS = 45_000;
const PAGE_SIZE = 100;

export interface RecoverableFile {
  file: TeleFile;
  epochAt: number;
  epochMsgIds: number[];
}

export interface RecoveryReport {
  scannedEpochs: number;
  scannedChunks: number;
  scannedChannelMessages: number;
  recoverable: RecoverableFile[];
  cancelled: boolean;
}

export interface RestoreResult {
  restored: number;
  skipped: number;
}

export interface MergeRestoreResult extends RestoreResult {
  alreadyPresent: number;
}

interface EpochCandidate {
  at: number;
  ids: number[];
  files: TeleFile[];
}

function contentKey(file: TeleFile): string {
  const parent = normalizeFolderPath(file.folderPath || "/");
  const parentKey = parent === "/" ? "" : parent.replace(/\/+$/, "");
  if (file.mime === "inode/directory" || file.mime === "application/x-directory") {
    // Folders need their own name too: two sibling folders under the same
    // parent are distinct and must not collapse into one another.
    return `folder:${parentKey}/${file.name}`;
  }
  return `${parentKey}::${file.name}::${file.size}`;
}

function epochTimestampOf(chunks: ParsedIndexChunk[]): number {
  let at = 0;
  for (const chunk of chunks) {
    if (chunk.savedAt && chunk.savedAt > at) at = chunk.savedAt;
    if (chunk.editedAt > at) at = chunk.editedAt;
  }
  return at;
}

function groupLegacyWindows(
  parsed: Map<number, ParsedIndexChunk>
): ParsedIndexChunk[][] {
  const sorted = [...parsed.values()].sort((a, b) => a.msgId - b.msgId);
  const windows: ParsedIndexChunk[][] = [];
  let current: ParsedIndexChunk[] = [];
  let maxIndex = -1;

  for (const chunk of sorted) {
    if (current.length === 0 || chunk.chunkIndex > maxIndex) {
      current.push(chunk);
      maxIndex = Math.max(maxIndex, chunk.chunkIndex);
    } else {
      windows.push(current);
      current = [chunk];
      maxIndex = chunk.chunkIndex;
    }
  }
  if (current.length > 0) windows.push(current);

  return windows.filter((window) => {
    const zero = window.find((c) => c.chunkIndex === 0);
    // A manifest epoch is handled separately; never treat it as legacy.
    return !(zero && isValidManifest(zero));
  });
}

async function fetchMessagesByIds(
  client: any,
  peer: any,
  ids: number[],
  signal?: AbortSignal
): Promise<Map<number, any>> {
  const found = new Map<number, any>();
  for (let i = 0; i < ids.length; i += PAGE_SIZE) {
    if (signal?.aborted) return found;
    const batch = ids.slice(i, i + PAGE_SIZE);
    const messages = await withTimeout(
      client.getMessages(peer, { ids: batch }),
      10_000,
      "recovery.getMessages(ids)"
    );
    for (const msg of Array.isArray(messages) ? messages : []) {
      const id = Number(msg?.id);
      if (Number.isFinite(id) && id > 0) found.set(id, msg);
    }
  }
  return found;
}

function uploadedFileFromMessage(
  msg: any,
  channelId: string
): TeleFile | null {
  const media = (msg as any)?.media;
  const doc = media?.document;
  if (!doc) return null;

  const caption = String((msg as any)?.message ?? (msg as any)?.text ?? "").trim();
  if (!caption.startsWith("teledrive_file:")) return null;

  let folderPath = "/";
  try {
    const meta = JSON.parse(caption.slice("teledrive_file:".length));
    if (!meta || typeof meta.folder !== "string") return null;
    folderPath = normalizeFolderPath(meta.folder);
  } catch {
    return null;
  }

  const attributes = Array.isArray(doc.attributes) ? doc.attributes : [];
  const filenameAttr = attributes.find(
    (attr: any) =>
      attr?.className === "DocumentAttributeFilename" ||
      attr?._ === "documentAttributeFilename"
  );
  const name =
    (typeof filenameAttr?.fileName === "string" && filenameAttr.fileName.trim()) ||
    `file-${Number(msg?.id) || 0}`;

  const file: TeleFile = {
    id: `recovered_${Number(msg.id)}`,
    name,
    size: Number(doc.size) || 0,
    mime: doc.mimeType || "application/octet-stream",
    folderPath,
    messageId: Number(msg.id),
    channelId,
    uploadedAt: (Number(msg.date) || 0) * 1000,
    starred: false,
    trashed: false,
    archived: false,
  };
  return file;
}

/**
 * Read every TeleDrive document ever sent to the channel (bounded, read-only).
 * This is the safety net when index snapshots are gone: the file bytes and
 * their folder caption still live in channel history.
 */
async function scanChannelFileMessages(
  client: any,
  peer: any,
  channelId: string,
  signal: AbortSignal | undefined,
  shouldSkip: (file: TeleFile) => boolean
): Promise<{ files: RecoverableFile[]; scanned: number; cancelled: boolean }> {
  const files: RecoverableFile[] = [];
  let offsetId = 0;
  let scanned = 0;
  let cancelled = false;
  const started = Date.now();

  while (
    scanned < MAX_CHANNEL_FILE_MESSAGES &&
    Date.now() - started < MAX_CHANNEL_FILE_MS
  ) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }

    let page: any[] = [];
    try {
      page = await withTimeout(
        client.getMessages(peer, {
          filter: new Api.InputMessagesFilterDocument(),
          limit: PAGE_SIZE,
          ...(offsetId > 0 ? { offsetId } : {}),
        }),
        10_000,
        "recovery.channelFiles"
      );
    } catch {
      break;
    }
    if (!Array.isArray(page) || page.length === 0) break;

    let oldest = offsetId;
    for (const msg of page) {
      const id = Number(msg?.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      oldest = oldest === 0 ? id : Math.min(oldest, id);
      scanned++;
      const file = uploadedFileFromMessage(msg, channelId);
      if (!file || shouldSkip(file)) continue;
      files.push({
        file,
        epochAt: -1,
        epochMsgIds: [id],
      });
    }

    if (oldest === offsetId) break;
    offsetId = oldest;
    if (page.length < PAGE_SIZE) break;
  }

  return {
    files,
    scanned,
    cancelled: cancelled || signal?.aborted === true,
  };
}

/**
 * Scan channel history for index chunks. Read-only: it never calls the queue,
 * saveIndex, deleteMessages, or editMessage.
 */
export async function scanIndexHistory(
  channelId: string,
  signal?: AbortSignal
): Promise<RecoveryReport> {
  if (signal?.aborted) {
    return {
      scannedEpochs: 0,
      scannedChunks: 0,
      scannedChannelMessages: 0,
      recoverable: [],
      cancelled: true,
    };
  }

  const client = getClient();
  const peer = await resolveChannelInputPeer(channelId);
  const started = Date.now();

  const parsed = new Map<number, ParsedIndexChunk>();
  let offsetId = 0;
  let cancelled = false;

  while (parsed.size < MAX_SCAN_CHUNKS && Date.now() - started < MAX_SCAN_MS) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }
    const page = await withTimeout(
      client.getMessages(peer, {
        search: "teledrive_index",
        limit: PAGE_SIZE,
        offsetId,
      }),
      10_000,
      "recovery.scan"
    );
    const messages = Array.isArray(page) ? page : [];
    if (messages.length === 0) break;

    let oldest = offsetId;
    for (const msg of messages) {
      const id = Number(msg?.id);
      if (Number.isFinite(id) && id > 0) {
        oldest = oldest === 0 ? id : Math.min(oldest, id);
      }
      const chunk = parseIndexMessage(msg);
      if (chunk) parsed.set(chunk.msgId, chunk);
    }
    if (oldest === offsetId) break;
    offsetId = oldest;
    if (messages.length < PAGE_SIZE) break;
  }

  const candidates: EpochCandidate[] = [];

  // Manifest epochs name their chunks explicitly; fetch any not in the scan.
  for (const chunk of parsed.values()) {
    if (chunk.chunkIndex !== 0 || !isValidManifest(chunk) || !chunk.savedAt) {
      continue;
    }
    const ids = [chunk.msgId, ...(chunk.chunkMsgIds ?? [])];
    const missing = ids.filter((id) => !parsed.has(id));
    let extra = new Map<number, any>();
    if (missing.length > 0) {
      if (signal?.aborted) {
        cancelled = true;
        break;
      }
      extra = await fetchMessagesByIds(client, peer, missing, signal);
    }
    const chunks: ParsedIndexChunk[] = [];
    for (const id of ids) {
      const item = parsed.get(id);
      if (item) {
        chunks.push(item);
        continue;
      }
      const msg = extra.get(id);
      const parsedExtra = msg ? parseIndexMessage(msg) : null;
      if (parsedExtra) chunks.push(parsedExtra);
    }
    if (chunks.length === 0) continue;
    const files: TeleFile[] = [];
    for (const c of chunks) {
      for (const f of c.files) {
        files.push(f);
      }
    }
    candidates.push({
      at: chunk.savedAt,
      ids,
      files,
    });
  }

  const windows = groupLegacyWindows(parsed);
  for (const window of windows) {
    const files: TeleFile[] = [];
    for (const chunk of window) {
      for (const f of chunk.files) {
        files.push(f);
      }
    }
    if (files.length === 0) continue;
    candidates.push({
      at: epochTimestampOf(window),
      ids: window.map((c) => c.msgId),
      files,
    });
  }

  const current = useFileStore.getState().files;
  const currentIds = new Set(current.map((f) => f.id));
  const currentPathKeys = new Set(current.map(pathKey));
  const seenMessageIds = new Set(
    current
      .map((f) => Number(f.messageId))
      .filter((id) => Number.isFinite(id) && id > 0)
  );
  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  const recoverable: RecoverableFile[] = [];

  candidates.sort((a, b) => b.at - a.at);
  for (const epoch of candidates) {
    for (const file of epoch.files) {
      const messageId = Number(file.messageId);
      if (currentIds.has(file.id)) continue;
      if (Number.isFinite(messageId) && messageId > 0 && seenMessageIds.has(messageId)) {
        continue;
      }
      if (seenIds.has(file.id)) continue;
      const key = contentKey(file);
      if (seenContent.has(key)) continue;
      seenIds.add(file.id);
      if (Number.isFinite(messageId) && messageId > 0) seenMessageIds.add(messageId);
      seenContent.add(key);
      recoverable.push({
        file,
        epochAt: epoch.at,
        epochMsgIds: epoch.ids,
      });
    }
  }

  // Index snapshots can be deleted after a commit. The actual uploaded
  // documents cannot, so scan channel history as a final safety net.
  const raw = await scanChannelFileMessages(
    client,
    peer,
    channelId,
    signal,
    (file) => {
      const messageId = Number(file.messageId);
      if (currentIds.has(file.id)) return true;
      if (currentPathKeys.has(pathKey(file))) return true;
      if (Number.isFinite(messageId) && messageId > 0 && seenMessageIds.has(messageId)) {
        return true;
      }
      return seenContent.has(contentKey(file));
    }
  );
  const rawPaths = new Set(currentPathKeys);
  for (const entry of raw.files) {
    const key = pathKey(entry.file);
    if (rawPaths.has(key)) continue;
    rawPaths.add(key);
    seenMessageIds.add(Number(entry.file.messageId));
    recoverable.push(entry);
  }

  const deleted = getDeletedMessageIds(channelId);
  const visibleRecoverable =
    deleted.size === 0
      ? recoverable
      : recoverable.filter((entry) => {
          const messageId = Number(entry.file.messageId);
          return !(Number.isFinite(messageId) && messageId > 0 && deleted.has(messageId));
        });

  return {
    scannedEpochs: candidates.length,
    scannedChunks: parsed.size,
    scannedChannelMessages: raw.scanned,
    recoverable: visibleRecoverable,
    cancelled:
      cancelled || raw.cancelled || signal?.aborted === true,
  };
}

/**
 * Verify that message-backed files still have a live Telegram message.
 * Folders (messageId <= 0) are always considered live.
 */
export async function verifyExistingMessages(
  channelId: string,
  files: TeleFile[]
): Promise<{ live: TeleFile[]; missing: TeleFile[] }> {
  const client = getClient();
  const peer = await resolveChannelInputPeer(channelId);
  const ids = [
    ...new Set(
      files
        .map((f) => Number(f.messageId))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  const found = await fetchMessagesByIds(client, peer, ids);
  const live: TeleFile[] = [];
  const missing: TeleFile[] = [];
  for (const file of files) {
    const id = Number(file.messageId);
    if (!Number.isFinite(id) || id <= 0) {
      live.push(file);
      continue;
    }
    const msg = found.get(id);
    const empty =
      !msg ||
      msg.className === "MessageEmpty" ||
      msg._ === "messageEmpty" ||
      msg?.empty === true;
    if (empty) missing.push(file);
    else live.push(file);
  }
  return { live, missing };
}

function pathKey(file: TeleFile): string {
  const parent = normalizeFolderPath(file.folderPath ?? "/").replace(/\/+$/, "");
  const isFolder =
    file.mime === "inode/directory" || file.mime === "application/x-directory";
  return isFolder
    ? `folder:${parent}/${file.name}`
    : `file:${parent}/${file.name}`;
}

/**
 * Add recovered files to the current drive. Current files always win, so a
 * restore never removes or replaces anything the user can already see.
 */
export async function mergeIndexFromRecovery(
  channelId: string,
  files: TeleFile[],
  options?: { trustedMessageIds?: Set<number> }
): Promise<MergeRestoreResult> {
  const trusted = options?.trustedMessageIds;
  const untrusted = trusted
    ? files.filter((f) => {
        const id = Number(f.messageId);
        return !(Number.isFinite(id) && id > 0 && trusted.has(id));
      })
    : files;

  let live = files;
  let missing: TeleFile[] = [];
  if (untrusted.length > 0) {
    const verified = await verifyExistingMessages(channelId, untrusted);
    const missingMessageIds = new Set(
      verified.missing.map((f) => Number(f.messageId))
    );
    missing = verified.missing;
    live = files.filter((f) => !missingMessageIds.has(Number(f.messageId)));
  }
  if (missing.length > 0) {
    await invoke("log_vault_state", {
      state: `INDEX_RECOVERY_SKIP_MISSING count=${missing.length} ids=[${missing
        .map((f) => f.messageId)
        .join(",")}]`,
    }).catch(() => {});
  }

  // A permanently deleted file may still have its Telegram document if the
  // original delete failed. Recovery must not resurrect it.
  live = filterDeletedMessages(channelId, live);

  const current = useFileStore.getState().files;
  const currentIds = new Set(current.map((f) => f.id));
  const currentMsgIds = new Set(
    current
      .map((f) => Number(f.messageId))
      .filter((id) => Number.isFinite(id) && id > 0)
  );
  const currentPaths = new Set(current.map(pathKey));

  const additions: TeleFile[] = [];
  let alreadyPresent = 0;
  for (const file of live) {
    const messageId = Number(file.messageId);
    if (
      currentIds.has(file.id) ||
      (Number.isFinite(messageId) && messageId > 0 && currentMsgIds.has(messageId))
    ) {
      alreadyPresent++;
      continue;
    }
    const key = pathKey(file);
    if (currentPaths.has(key)) {
      alreadyPresent++;
      continue;
    }
    additions.push(file);
    currentIds.add(file.id);
    if (Number.isFinite(messageId) && messageId > 0) currentMsgIds.add(messageId);
    currentPaths.add(key);
  }

  const merged = reconstructMissingFolders(
    [...current, ...additions],
    channelId
  ).healedFiles;

  // Make the restored files visible and crash-safe before touching Telegram.
  // A 460-file index can hit a 5-minute FLOOD_WAIT; the dialog must never sit
  // on a spinner while Telegram cools down.
  const store = useFileStore.getState();
  store.setFiles(merged);
  store.setIndexLoadState("ready", null);
  store.setBootstrapComplete(true);
  store.flushFileCacheNow();
  writePendingMarker({
    channelId,
    baseSavedAt: 0,
    at: Date.now(),
  });

  const save = enqueueSaveDuringRecovery(channelId, merged)
    .then(() => {
      clearPendingMarker(channelId);
      return true;
    })
    .catch((err) => {
      console.warn("[recovery] Background index save failed:", err);
      void invoke("log_vault_state", {
        state: `INDEX_RECOVERY_SAVE_FAIL reason=${String(err?.message ?? err).slice(0, 200)}`,
      }).catch(() => {});
      return false;
    });

  const settled = await Promise.race([
    save,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_500)),
  ]);

  await invoke("log_vault_state", {
    state: `INDEX_RECOVERY_MERGE current=${current.length} added=${additions.length} already=${alreadyPresent} skipped=${missing.length} queued=${settled ? 0 : 1}`,
  }).catch(() => {});

  return {
    restored: additions.length,
    skipped: missing.length,
    alreadyPresent,
  };
}

/**
 * Replace the live index with a recovered set. This is the only writer
 * permitted while discovery is incomplete. Missing Telegram messages are
 * skipped (and logged), never restored.
 */
export async function replaceIndexFromRecovery(
  channelId: string,
  files: TeleFile[]
): Promise<RestoreResult> {
  const verified = await verifyExistingMessages(channelId, files);
  const { missing } = verified;
  const live = filterDeletedMessages(channelId, verified.live);
  if (missing.length > 0) {
    await invoke("log_vault_state", {
      state: `INDEX_RECOVERY_SKIP_MISSING count=${missing.length} ids=[${missing
        .map((f) => f.messageId)
        .join(",")}]`,
    }).catch(() => {});
  }

  await enqueueSaveDuringRecovery(channelId, live);
  clearPendingMarker(channelId);

  const store = useFileStore.getState();
  store.setFiles(live);
  store.setIndexLoadState("ready", null);
  store.setBootstrapComplete(true);
  await invoke("log_vault_state", {
    state: `INDEX_RECOVERY_OK files=${live.length} skipped=${missing.length}`,
  }).catch(() => {});

  return { restored: live.length, skipped: missing.length };
}

const SCAN_MARKER_PREFIX = "teledrive_recovery_scanned:";

/**
 * One-time-per-channel recovery offer. Runs after the first ready bootstrap.
 * Never restores automatically; it only reports candidates to the caller.
 */
export async function maybeOfferRecovery(
  channelId: string,
  onFound: (report: RecoveryReport) => void
): Promise<void> {
  if (typeof localStorage === "undefined") return;
  const key = SCAN_MARKER_PREFIX + channelId;
  try {
    if (localStorage.getItem(key)) return;
  } catch {
    return;
  }

  try {
    const report = await scanIndexHistory(channelId);
    if (report.cancelled) return;
    try {
      localStorage.setItem(key, "1");
    } catch {
      // Non-fatal.
    }
    if (report.recoverable.length > 0) onFound(report);
  } catch (err) {
    console.warn("[recovery] Background scan failed:", err);
  }
}
