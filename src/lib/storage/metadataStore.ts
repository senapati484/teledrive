import { Api } from "telegram";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { getClient } from "../telegram/client";
import { TeleFile } from "../types";
import { useFileStore } from "../../stores/fileStore";
import { enqueueSave, getIndexQueue } from "./indexQueue";
import { filterDeletedMessages } from "./tombstones";
import { normalizeFolderPath } from "../utils";
import { withTelegramRetry } from "../telegram/rateLimit";
import {
  epochTimestamp,
  isValidManifest,
  parseIndexMessage,
  type ParsedIndexChunk,
} from "./indexFormat";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic folder id from a full virtual path.
 *
 * Same path → same id, every cold start. Replaces the old `healed_<random>`
 * scheme that produced duplicate folder entries on every bootstrap (Bug 1 in
 * the plan). Folders created via `createFolder` keep their original random id
 * for backwards compatibility — the dedupe pass on recovery collapses them
 * to the canonical `folder_<hash>` only if duplicates exist.
 *
 * Slashes, dots, and unicode are preserved in the base64 — the id is an
 * opaque internal token, never shown to users. Length cap protects against
 * pathological paths.
 */
export function folderIdForPath(fullPath: string): string {
  const normalized = fullPath === "/" ? "/" : fullPath.replace(/\/+$/, "");
  // Hash the FULL path. The previous base64-truncation scheme kept only the
  // first 36 bytes, so any folder tree deeper than that (e.g. backup device
  // folders) collapsed to a single shared id and id-based actions modified
  // unrelated folders. A 128-bit slice of SHA-256 makes collisions infeasible.
  const digest = bytesToHex(sha256(new TextEncoder().encode(normalized)));
  return `folder_${digest.slice(0, 32)}`;
}

/**
 * Deduplicates a file list by messageId. Folders (messageId === 0) are kept
 * as-is — they have no Telegram message to anchor to, and multiple folder
 * entries for the same path are collapsed by `collapseDuplicateFolders`
 * below.
 *
 * Tie-break for files with identical uploadedAt: prefer the one whose name
 * is NOT a `recovered_*` placeholder, since user-renamed entries reflect
 * current intent better than orphan-recovered ones.
 */
export function dedupeByMessageId(files: TeleFile[]): TeleFile[] {
  const byMsgId = new Map<number, TeleFile>();
  const folders: TeleFile[] = [];
  for (const f of files) {
    if (!f.messageId || f.messageId === 0) {
      folders.push(f);
      continue;
    }
    const existing = byMsgId.get(f.messageId);
    if (!existing) {
      byMsgId.set(f.messageId, f);
      continue;
    }
    // Prefer the entry with the larger uploadedAt (last write wins).
    // If equal, prefer the non-recovered id (user-renamed > orphan-recovered).
    const newer =
      f.uploadedAt > existing.uploadedAt
        ? f
        : f.uploadedAt < existing.uploadedAt
        ? existing
        : existing.id.startsWith("recovered_") && !f.id.startsWith("recovered_")
        ? f
        : existing;
    byMsgId.set(f.messageId, newer);
  }
  return [...folders, ...byMsgId.values()];
}

/**
 * Deduplicates a file list by CONTENT KEY (folderPath::name::size).
 *
 * This catches the case where `dedupeByMessageId` cannot help: a backup
 * retry that succeeds the second time after the first Telegram response
 * was lost produces two REAL Telegram messages with different messageIds
 * for the same logical file. Without this pass, both stay in the store
 * and the user sees the same backup file twice in the file browser.
 *
 * Tie-break for content-key ties: prefer the entry with the larger
 * `uploadedAt` (last write wins). If equal, prefer the larger
 * `messageId` (higher Telegram messageId = newer Telegram message).
 *
 * Folders are skipped — folder dedup is owned by `collapseDuplicateFolders`
 * (it needs the parent path, which `name` alone doesn't carry).
 */
const RETRY_DEDUPE_WINDOW_MS = 15 * 60 * 1000;

function preferNewerFile(a: TeleFile, b: TeleFile): TeleFile {
  // Last-write-wins; tie-break by larger messageId (newer Telegram msg).
  return b.uploadedAt > a.uploadedAt
    ? b
    : b.uploadedAt < a.uploadedAt
    ? a
    : b.messageId > a.messageId
    ? b
    : a;
}

/**
 * A same-name/same-size pair is only collapsed when we can prove it is the
 * same logical upload. Identical content hashes are proof. Otherwise we only
 * collapse the retry-orphan case: one entry is a `recovered_*` placeholder for
 * a lost upload response and the other is the normal entry created by the
 * retry, uploaded within a short window.
 *
 * The old key-only scheme treated any two distinct files with the same name
 * and size in the same folder as duplicates and persisted the reduced list,
 * silently deleting a real file.
 */
function isSameLogicalUpload(a: TeleFile, b: TeleFile): boolean {
  if (a.hash && b.hash) return a.hash === b.hash;
  const aRecovered = a.id.startsWith("recovered_");
  const bRecovered = b.id.startsWith("recovered_");
  if (aRecovered === bRecovered) return false;
  return Math.abs((a.uploadedAt || 0) - (b.uploadedAt || 0)) <= RETRY_DEDUPE_WINDOW_MS;
}

export function dedupeByContentKey(files: TeleFile[]): TeleFile[] {
  const byContentKey = new Map<string, TeleFile[]>();
  const folders: TeleFile[] = [];
  for (const f of files) {
    if (!f.messageId || f.messageId === 0 || isFolderMime(f.mime)) {
      folders.push(f);
      continue;
    }
    const parent = !f.folderPath || f.folderPath === "/" ? "" : f.folderPath.replace(/\/+$/, "");
    const key = `${parent}::${f.name}::${f.size}`;
    const group = byContentKey.get(key);
    if (group) group.push(f);
    else byContentKey.set(key, [f]);
  }

  const result: TeleFile[] = [...folders];
  for (const group of byContentKey.values()) {
    const kept: TeleFile[] = [];
    for (const candidate of group) {
      const duplicateIndex = kept.findIndex((existing) =>
        isSameLogicalUpload(existing, candidate)
      );
      if (duplicateIndex === -1) kept.push(candidate);
      else kept[duplicateIndex] = preferNewerFile(kept[duplicateIndex], candidate);
    }
    result.push(...kept);
  }
  return result;
}

/**
 * Collapses duplicate folder entries to a single canonical entry per full
 * path. Keeps the existing entry with the LOWEST id (deterministic across
 * cold starts — id sort is stable for ties, and `healed_*` / `folder_*` /
 * random ids all sort as strings).
 *
 * Why not always prefer the path-derived `folderIdForPath`? Because that
 * would rewrite every existing folder entry's id, which would break
 * `selectedIds` references in the user's current selection state. Keeping
 * the lowest existing id avoids that churn.
 */
export function collapseDuplicateFolders(files: TeleFile[]): TeleFile[] {
  const byPath = new Map<string, TeleFile>();
  const nonFolders: TeleFile[] = [];
  for (const f of files) {
    if (!isFolderMime(f.mime)) {
      nonFolders.push(f);
      continue;
    }
    const fullPath = getFolderFullPath(f);
    const existing = byPath.get(fullPath);
    if (!existing) {
      byPath.set(fullPath, f);
      continue;
    }
    // Keep the lower-id entry so the result is deterministic.
    const keeper = f.id < existing.id ? f : existing;
    byPath.set(fullPath, keeper);
  }
  return [...byPath.values(), ...nonFolders];
}

function isFolderMime(mime: string | undefined): boolean {
  return mime === "inode/directory" || mime === "application/x-directory";
}

function getFolderFullPath(f: TeleFile): string {
  const parent = !f.folderPath || f.folderPath === "/" ? "" : f.folderPath.replace(/\/+$/, "");
  return `${parent}/${f.name}`;
}

/**
 * Returns the full path of a folder entry (`/<parent>/<name>` or `/<name>`).
 * Exported so move/rename in useFileActions can match folder entries by
 * path rather than by id — that way duplicate folder entries (same path,
 * different ids) all get updated consistently.
 */
export function fullPathForFolder(folder: TeleFile): string {
  return getFolderFullPath(folder);
}

/**
 * Returns every folder entry whose full path matches `fullPath`. With the
 * pre-fix code, duplicates meant a move/rename would update ONE entry and
 * leave the others behind; with this helper, callers can update all of them.
 */
export function findFoldersByPath(files: TeleFile[], fullPath: string): TeleFile[] {
  const out: TeleFile[] = [];
  for (const f of files) {
    if (!isFolderMime(f.mime)) continue;
    if (getFolderFullPath(f) === fullPath) out.push(f);
  }
  return out;
}

class Mutex {
  private promise: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release: () => void;
    const nextPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const currentPromise = this.promise;
    this.promise = currentPromise.then(() => nextPromise);
    await currentPromise;
    return release!;
  }

  /**
   * Tries to acquire the mutex within `timeoutMs` milliseconds.
   * Throws an error if the lock cannot be acquired in time.
   */
  async acquireWithTimeout(timeoutMs: number): Promise<() => void> {
    let timeoutId: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Mutex acquisition timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    const releasePromise = this.acquire();
    try {
      const release = await Promise.race([releasePromise, timeoutPromise]);
      clearTimeout(timeoutId);
      return release;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }
}

const metadataMutex = new Mutex();

/**
 * Runs a task exclusively (under the metadata mutex lock) to serialize index updates.
 */
export async function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const release = await metadataMutex.acquire();
  try {
    return await task();
  } finally {
    release();
  }
}

/**
 * Runs a task exclusively but gives up if the lock isn't acquired within 15 seconds.
 * Prevents indefinite deadlocks when two operations compete for the mutex.
 */
export async function runExclusiveWithTimeout<T>(task: () => Promise<T>): Promise<T> {
  const release = await metadataMutex.acquireWithTimeout(15_000);
  try {
    return await task();
  } finally {
    release();
  }
}

/**
 * Helper to wrap any promise in a timeout to prevent indefinite hangs.
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout of ${timeoutMs}ms exceeded for ${label}`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function resolveChannelInputPeer(channelId: string) {
  const client = getClient();
  try {
    // Session cache is normally instant. Bound it anyway: a half-open
    // connection must never leave recovery or bootstrap on a spinner forever.
    return await withTimeout(
      client.getInputEntity(channelId),
      5000,
      "client.getInputEntity"
    );
  } catch (err) {
    console.warn("[metadataStore] getInputEntity failed, falling back to getEntity with timeout:", err);
    return withTimeout(client.getEntity(channelId), 5000, "client.getEntity");
  }
}

// ---------------------------------------------------------------------------
// Virtual Folder Reconstruction & Auto-Healing
// ---------------------------------------------------------------------------

/**
 * Reconstructs missing virtual folders from a file list.
 */
export function reconstructMissingFolders(
  files: TeleFile[],
  channelId: string
): { healedFiles: TeleFile[]; changed: boolean } {
  const existingFolderPaths = new Set<string>();
  for (const f of files) {
    if (f.mime === "inode/directory" || f.mime === "application/x-directory") {
      const parent = normalizeFolderPath(f.folderPath);
      const fullPath = parent === "/" ? `/${f.name}` : `${parent}/${f.name}`;
      existingFolderPaths.add(fullPath);
    }
  }

  // Collect every distinct folderPath that needs ancestor walking. Walking
  // every file's path independently was O(N × depth) — for a 218-file
  // backup all sitting under /TeleDrive Backups/<device>/Documents/Work/
  // Reports/2026, we'd split "Work", "Reports", "2026" 218 times for no
  // benefit. Pre-deduping cuts this to one walk per unique path.
  const distinctPaths = new Set<string>();
  for (const f of files) {
    if (f.trashed || f.archived) continue;
    const path = normalizeFolderPath(f.folderPath);
    if (!path || path === "/") continue;
    distinctPaths.add(path);
  }

  const reconstructedFolders: TeleFile[] = [];
  let changed = false;

  for (const path of distinctPaths) {
    const segments = path.split("/").filter(Boolean);
    let currentParent = "/";

    for (let i = 0; i < segments.length; i++) {
      const name = segments[i];
      const folderFullPath = currentParent === "/" ? `/${name}` : `${currentParent}/${name}`;

      if (!existingFolderPaths.has(folderFullPath)) {
        const newFolder: TeleFile = {
          // Stable id derived from the full path. Two cold starts computing
          // this folder will agree on the same id, so the deduplication pass
          // on recovery doesn't see two different ids for the same folder.
          id: folderIdForPath(folderFullPath),
          name,
          size: 0,
          mime: "inode/directory",
          folderPath: currentParent,
          messageId: 0,
          channelId,
          uploadedAt: Date.now(),
          starred: false,
          trashed: false,
          archived: false,
        };
        reconstructedFolders.push(newFolder);
        existingFolderPaths.add(folderFullPath);
        changed = true;
      }

      currentParent = folderFullPath;
    }
  }

  return {
    healedFiles: [...files, ...reconstructedFolders],
    changed,
  };
}

async function healAndSave(channelId: string, files: TeleFile[]): Promise<TeleFile[]> {
  // Reconstruct first (so folder entries exist for any folderPath references),
  // THEN dedupe. Order matters: reconstructMissingFolders creates folder
  // entries with deterministic ids, and dedupeByMessageId / collapseDuplicateFolders
  // would otherwise drop folder duplicates that have the same id but different
  // random metadata. Doing it this way means duplicate folders from previous
  // cold starts collapse to one canonical entry before they hit the queue.
  const { healedFiles, changed } = reconstructMissingFolders(files, channelId);
  // Order: dedupeByMessageId → dedupeByContentKey → collapseDuplicateFolders.
  // - dedupeByMessageId handles single-message races (same Telegram message
  //   represented twice).
  // - dedupeByContentKey handles retry pairs (two distinct Telegram messages
  //   for the same logical file — see T1.3 in the Tier 1 plan).
  // - collapseDuplicateFolders finally handles folder-entry duplicates by
  //   full path.
  const cleaned = collapseDuplicateFolders(dedupeByContentKey(dedupeByMessageId(healedFiles)));
  if (changed || cleaned.length !== files.length) {
    console.log(
      `[metadataStore] Healed ${changed ? "folders" : ""}${
        changed && cleaned.length !== files.length ? " + " : ""
      }${
        cleaned.length !== files.length
          ? `dedup removed ${files.length - cleaned.length}`
          : ""
      }. Saving updated index to Telegram...`
    );
    enqueueSave(channelId, cleaned, { recordPending: false }).catch((err) => {
      console.error("[metadataStore] Failed to save healed index to Telegram:", err);
    });
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// Index discovery
// ---------------------------------------------------------------------------

export type { ParsedIndexChunk } from "./indexFormat";

/**
 * Parses a list of Telegram messages into ParsedIndexChunk records.
 * Filters out non-index messages and malformed chunks.
 */
export function parseIndexMessages(messages: any[]): ParsedIndexChunk[] {
  const parsed: ParsedIndexChunk[] = [];
  const sorted = [...messages].sort((a: any, b: any) => Number(a?.id) - Number(b?.id));
  for (const msg of sorted) {
    const chunk = parseIndexMessage(msg);
    if (chunk) parsed.push(chunk);
  }
  return parsed;
}

/**
 * Returns the chunks of a complete epoch in chunkIndex order, or null when
 * the window contains duplicates, mismatched totalChunks, or gaps.
 */
function coherentEpoch(chunks: ParsedIndexChunk[]): ParsedIndexChunk[] | null {
  const total = chunks[0]?.totalChunks;
  if (!total || chunks.length !== total) return null;
  const byIndex = new Map<number, ParsedIndexChunk>();
  for (const chunk of chunks) {
    if (chunk.totalChunks !== total) return null;
    if (byIndex.has(chunk.chunkIndex)) return null;
    byIndex.set(chunk.chunkIndex, chunk);
  }
  const ordered: ParsedIndexChunk[] = [];
  for (let i = 0; i < total; i++) {
    const chunk = byIndex.get(i);
    if (!chunk) return null;
    ordered.push(chunk);
  }
  return ordered;
}

/**
 * For a single totalChunks group, finds the most-recent COMPLETE save epoch.
 *
 * Telegram message ids within a channel are STRICTLY INCREASING, so epoch
 * boundaries must be detected by chunkIndex repetition: each save emits
 * chunks 0..N-1, so seeing chunkIndex=K where K <= previously-seen max
 * means a new save window started.
 *
 * Returns the chosen epoch (in chunkIndex-sorted order) or null if no
 * epoch in this group is complete.
 */
export function findMostRecentCoherentEpoch(
  chunks: ParsedIndexChunk[]
): ParsedIndexChunk[] | null {
  if (chunks.length === 0) return null;
  const sorted = [...chunks].sort((a, b) => a.msgId - b.msgId);

  const epochs: ParsedIndexChunk[][] = [];
  let current: ParsedIndexChunk[] = [sorted[0]];
  let maxChunkIdx = sorted[0].chunkIndex;
  for (let i = 1; i < sorted.length; i++) {
    const c = sorted[i];
    if (c.chunkIndex <= maxChunkIdx) {
      epochs.push(current);
      current = [c];
      maxChunkIdx = c.chunkIndex;
    } else {
      current.push(c);
      maxChunkIdx = c.chunkIndex;
    }
  }
  epochs.push(current);

  for (let i = epochs.length - 1; i >= 0; i--) {
    const epoch = coherentEpoch(epochs[i]);
    if (epoch) return epoch;
  }
  return null;
}

function coherentFromParsed(parsed: ParsedIndexChunk[]): ParsedIndexChunk[] | null {
  if (parsed.length === 0) return null;

  const byTotal = new Map<number, ParsedIndexChunk[]>();
  for (const p of parsed) {
    const list = byTotal.get(p.totalChunks);
    if (list) list.push(p);
    else byTotal.set(p.totalChunks, [p]);
  }

  let best: ParsedIndexChunk[] | null = null;
  let bestMaxId = -Infinity;
  let bestMinId = -Infinity;
  for (const chunks of byTotal.values()) {
    const coherent = findMostRecentCoherentEpoch(chunks);
    if (!coherent) continue;
    const maxId = coherent.reduce((m, c) => Math.max(m, c.msgId), -Infinity);
    const minId = coherent.reduce((m, c) => Math.min(m, c.msgId), Infinity);
    if (maxId > bestMaxId || (maxId === bestMaxId && minId > bestMinId)) {
      best = coherent;
      bestMaxId = maxId;
      bestMinId = minId;
    }
  }
  return best;
}

/**
 * Picks the most-recent fully-coherent set of index chunks from a list of
 * Telegram messages.
 *
 * Exported so the IndexQueue's commitOnce can reuse the same selection
 * logic to identify the current "live" index for edit/delete targets.
 */
export function pickCoherentIndexSet(messages: any[]): ParsedIndexChunk[] | null {
  return coherentFromParsed(parseIndexMessages(messages));
}

/**
 * Parses one message into a chunk, keeping the original text in a side map so
 * the writer can reuse unchanged payloads verbatim.
 */
function collectIndexChunks(
  messages: any[],
  texts: Map<number, string>
): ParsedIndexChunk[] {
  const parsed: ParsedIndexChunk[] = [];
  for (const msg of messages) {
    const chunk = parseIndexMessage(msg);
    if (!chunk) continue;
    const text = msg?.text ?? msg?.message;
    if (typeof text === "string") texts.set(chunk.msgId, text);
    parsed.push(chunk);
  }
  return parsed;
}

interface ManifestCandidate {
  kind: "manifest";
  chunk0: ParsedIndexChunk;
  ids: number[];
  timestamp: number;
  maxMsgId: number;
}

interface LegacyCandidate {
  kind: "legacy";
  chunks: ParsedIndexChunk[];
  timestamp: number;
  maxMsgId: number;
  format: 1 | 2;
}

type IndexCandidate = ManifestCandidate | LegacyCandidate;

function collectCandidates(parsed: ParsedIndexChunk[]): IndexCandidate[] {
  const manifestCandidates: ManifestCandidate[] = [];
  for (const chunk of parsed) {
    if (chunk.chunkIndex !== 0) continue;
    if (!isValidManifest(chunk)) continue;
    if (!chunk.savedAt) continue;
    manifestCandidates.push({
      kind: "manifest",
      chunk0: chunk,
      ids: [...(chunk.chunkMsgIds ?? [])],
      timestamp: chunk.savedAt,
      maxMsgId: chunk.msgId,
    });
  }

  // A v2 chunk 0 that carries a manifest must never be assembled as a legacy
  // epoch: its named ids are the only source of truth. If they are missing,
  // discovery is incomplete rather than presenting a Frankenstein merge.
  const legacyParsed = parsed.filter(
    (chunk) => !(chunk.chunkIndex === 0 && Array.isArray(chunk.chunkMsgIds))
  );
  const legacySet = coherentFromParsed(legacyParsed);
  const legacyCandidates: LegacyCandidate[] = legacySet
    ? [
        {
          kind: "legacy",
          chunks: legacySet,
          timestamp: epochTimestamp(legacySet),
          maxMsgId: legacySet.reduce((m, c) => Math.max(m, c.msgId), 0),
          format: legacySet[0]?.version >= 2 ? 2 : 1,
        },
      ]
    : [];

  return [...manifestCandidates, ...legacyCandidates].sort(
    (a, b) => b.timestamp - a.timestamp || b.maxMsgId - a.maxMsgId
  );
}

export type DiscoveryIncompleteReason =
  | "not_found"
  | "partial_manifest"
  | "timeout"
  | "network";

export type DiscoveryResult =
  | {
      status: "ready";
      files: TeleFile[];
      /** Ordered (chunk 0 first) Telegram message ids of the live index. */
      ids: number[];
      /** Original chunk texts, aligned with `ids`. */
      texts: string[];
      /** Effective epoch timestamp in ms (max savedAt, else max editDate). */
      savedAt: number;
      format: 1 | 2;
      chunks: ParsedIndexChunk[];
    }
  | { status: "incomplete"; reason: DiscoveryIncompleteReason };

function mergeChunkFiles(chunks: ParsedIndexChunk[]): TeleFile[] {
  const byId = new Map<string, TeleFile>();
  for (const chunk of chunks) {
    for (const file of chunk.files) byId.set(file.id, file);
  }
  return Array.from(byId.values());
}

function readyFromChunks(
  chunks: ParsedIndexChunk[],
  texts: Map<number, string>,
  format: 1 | 2
): DiscoveryResult {
  const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  return {
    status: "ready",
    files: mergeChunkFiles(ordered),
    ids: ordered.map((c) => c.msgId),
    texts: ordered.map((c) => texts.get(c.msgId) ?? ""),
    savedAt: epochTimestamp(ordered),
    format,
    chunks: ordered,
  };
}

function messageTextOf(msg: any): string {
  const text = msg?.text ?? msg?.message;
  return typeof text === "string" ? text : "";
}

const INITIAL_FETCH_TIMEOUT_MS = 5000;
const MANIFEST_FETCH_TIMEOUT_MS = 5000;
const SEARCH_BUDGET_MS = 15_000;
const HISTORY_BUDGET_MS = 30_000;
const SEARCH_MAX_PAGES = 20;
const HISTORY_MAX_MESSAGES = 10_000;
const MAX_MANIFEST_ATTEMPTS = 3;

/**
 * Discovers the live index. Reads pinned + recent messages, then follows the
 * manifest of the newest valid v2 chunk 0, then falls back to Telegram search
 * and finally paginated history. Never writes to Telegram and never mutates
 * the store, so an incomplete result cannot damage the cached index.
 */
export async function discoverIndex(channelId: string): Promise<DiscoveryResult> {
  console.log("INDEX_DISCOVERY_START");
  const client = getClient();
  let peer: any;
  try {
    peer = await resolveChannelInputPeer(channelId);
  } catch (err) {
    console.warn("[metadataStore] discoverIndex: resolve failed:", err);
    return { status: "incomplete", reason: "network" };
  }

  const messagesById = new Map<number, any>();
  const texts = new Map<number, string>();
  let sawIndexMarker = false;
  let fetchSucceeded = false;
  let fetchFailed = false;
  let timedOut = false;

  const addMessages = (messages: any[] | undefined | null) => {
    for (const msg of messages ?? []) {
      const id = Number(msg?.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      if (!messagesById.has(id)) messagesById.set(id, msg);
      const text = messageTextOf(msg);
      if (text.includes("teledrive_index")) {
        texts.set(id, text);
        sawIndexMarker = true;
      }
    }
  };

  const [pinnedRes, recentRes] = await Promise.allSettled([
    withTimeout(
      client.getMessages(peer, {
        filter: new Api.InputMessagesFilterPinned(),
        limit: 100,
      }),
      INITIAL_FETCH_TIMEOUT_MS,
      "client.getMessages(pinned)"
    ),
    withTimeout(
      client.getMessages(peer, { limit: 100 }),
      INITIAL_FETCH_TIMEOUT_MS,
      "client.getMessages(recent)"
    ),
  ]);

  let pinned: any[] = [];
  let recent: any[] = [];
  if (pinnedRes.status === "fulfilled" && Array.isArray(pinnedRes.value)) {
    pinned = pinnedRes.value;
    fetchSucceeded = true;
    addMessages(pinned);
  } else if (pinnedRes.status === "rejected") {
    fetchFailed = true;
    console.warn("[metadataStore] discoverIndex: pinned fetch failed:", pinnedRes.reason);
  }
  if (recentRes.status === "fulfilled" && Array.isArray(recentRes.value)) {
    recent = recentRes.value;
    fetchSucceeded = true;
    addMessages(recent);
  } else if (recentRes.status === "rejected") {
    fetchFailed = true;
    console.warn("[metadataStore] discoverIndex: recent fetch failed:", recentRes.reason);
  }

  const fetchedManifestRounds = new Map<number, number>();

  const fetchChunkMessages = async (ids: number[]): Promise<void> => {
    const missing = ids.filter((id) => !messagesById.has(id));
    for (let i = 0; i < missing.length; i += 100) {
      const batch = missing.slice(i, i + 100);
      try {
        const result = await withTimeout(
          client.getMessages(peer, { ids: batch }),
          MANIFEST_FETCH_TIMEOUT_MS,
          "client.getMessages(ids)"
        );
        if (Array.isArray(result)) addMessages(result);
      } catch (err) {
        console.warn("[metadataStore] discoverIndex: chunk id fetch failed:", err);
      }
    }
  };

  const validateManifest = (
    candidate: ManifestCandidate,
    chunks: ParsedIndexChunk[]
  ): ParsedIndexChunk[] | null => {
    const total = candidate.ids.length + 1;
    if (candidate.chunk0.totalChunks !== total) return null;
    const byId = new Map(chunks.map((c) => [c.msgId, c]));
    if (byId.size !== chunks.length) return null;
    const ordered: ParsedIndexChunk[] = [candidate.chunk0];
    for (let i = 0; i < candidate.ids.length; i++) {
      const chunk = byId.get(candidate.ids[i]);
      if (!chunk) return null;
      if (chunk.chunkIndex !== i + 1) return null;
      if (chunk.totalChunks !== total) return null;
      ordered.push(chunk);
    }
    return ordered;
  };

  const evaluate = async (): Promise<DiscoveryResult | null> => {
    const parsed = collectIndexChunks(Array.from(messagesById.values()), texts);
    const candidates = collectCandidates(parsed);
    const legacy = candidates.find((c): c is LegacyCandidate => c.kind === "legacy");
    if (legacy && candidates[0] === legacy) {
      return readyFromChunks(legacy.chunks, texts, legacy.format);
    }

    const manifests = candidates.filter(
      (c): c is ManifestCandidate => c.kind === "manifest"
    );
    let partialManifestAt = -Infinity;

    for (const candidate of manifests.slice(0, MAX_MANIFEST_ATTEMPTS)) {
      const missing = candidate.ids.filter((id) => !messagesById.has(id));
      if (missing.length > 0) {
        const rounds = fetchedManifestRounds.get(candidate.chunk0.msgId) ?? 0;
        if (rounds < 2) {
          fetchedManifestRounds.set(candidate.chunk0.msgId, rounds + 1);
          await fetchChunkMessages(candidate.ids);
        }
      }

      const parsedNow = collectIndexChunks(Array.from(messagesById.values()), texts);
      const chunkById = new Map(parsedNow.map((c) => [c.msgId, c]));
      const named = candidate.ids
        .map((id) => chunkById.get(id))
        .filter((c): c is ParsedIndexChunk => Boolean(c));
      const ordered = validateManifest(candidate, named);
      if (ordered) {
        const effective = epochTimestamp(ordered);
        if (legacy && legacy.timestamp > effective) {
          return readyFromChunks(legacy.chunks, texts, legacy.format);
        }
        return readyFromChunks(ordered, texts, 2);
      }
      partialManifestAt = Math.max(partialManifestAt, candidate.timestamp);
    }

    if (legacy && legacy.timestamp > partialManifestAt) {
      return readyFromChunks(legacy.chunks, texts, legacy.format);
    }
    return null;
  };

  let result = await evaluate();
  if (result) return result;

  // Search is an accelerator. Correctness comes from paginated history below.
  const searchDeadline = Date.now() + SEARCH_BUDGET_MS;
  let searchOffset = 0;
  for (let page = 0; page < SEARCH_MAX_PAGES && Date.now() < searchDeadline; page++) {
    let pageMessages: any[] = [];
    try {
      pageMessages = await withTimeout(
        client.getMessages(peer, {
          search: "teledrive_index",
          limit: 100,
          ...(searchOffset > 0 ? { offsetId: searchOffset } : {}),
        }),
        INITIAL_FETCH_TIMEOUT_MS,
        "client.getMessages(search)"
      );
    } catch (err: any) {
      if (String(err?.message ?? err).includes("Timeout")) timedOut = true;
      console.warn("[metadataStore] discoverIndex: search failed:", err);
      break;
    }
    if (!Array.isArray(pageMessages) || pageMessages.length === 0) break;
    const before = messagesById.size;
    addMessages(pageMessages);
    const ids = pageMessages
      .map((m: any) => Number(m?.id))
      .filter((id: number) => Number.isFinite(id) && id > 0);
    if (ids.length === 0) break;
    const nextOffset = Math.min(...ids);
    if (messagesById.size === before && nextOffset >= searchOffset && searchOffset > 0) break;
    searchOffset = nextOffset;

    result = await evaluate();
    if (result) return result;
  }
  if (Date.now() >= searchDeadline) timedOut = true;

  // Deterministic fallback: walk history backwards until a complete epoch is
  // found or the budget is exhausted.
  const historyDeadline = Date.now() + HISTORY_BUDGET_MS;
  let historyOffset =
    recent.length > 0
      ? Math.min(
          ...recent
            .map((m: any) => Number(m?.id))
            .filter((id: number) => Number.isFinite(id) && id > 0)
        )
      : 0;
  let scanned = messagesById.size;

  while (scanned < HISTORY_MAX_MESSAGES && Date.now() < historyDeadline) {
    let pageMessages: any[] = [];
    try {
      pageMessages = await withTimeout(
        client.getMessages(peer, {
          limit: 100,
          ...(historyOffset > 0 ? { offsetId: historyOffset } : {}),
        }),
        INITIAL_FETCH_TIMEOUT_MS,
        "client.getMessages(history)"
      );
    } catch (err: any) {
      if (String(err?.message ?? err).includes("Timeout")) timedOut = true;
      console.warn("[metadataStore] discoverIndex: history page failed:", err);
      break;
    }
    if (!Array.isArray(pageMessages) || pageMessages.length === 0) break;

    const fresh = pageMessages.filter((m: any) => {
      const id = Number(m?.id);
      return Number.isFinite(id) && id > 0 && !messagesById.has(id);
    });
    if (fresh.length === 0) break;
    addMessages(fresh);
    scanned += fresh.length;

    const ids = fresh
      .map((m: any) => Number(m?.id))
      .filter((id: number) => Number.isFinite(id) && id > 0);
    const nextOffset = Math.min(...ids);
    if (historyOffset > 0 && nextOffset >= historyOffset) break;
    historyOffset = nextOffset;

    result = await evaluate();
    if (result) return result;
  }
  if (Date.now() >= historyDeadline) timedOut = true;

  result = await evaluate();
  if (result) return result;

  const manifestWasSeen = collectCandidates(
    collectIndexChunks(Array.from(messagesById.values()), texts)
  ).some((c) => c.kind === "manifest");
  if (manifestWasSeen) {
    return { status: "incomplete", reason: "partial_manifest" };
  }

  const channelIsEmpty =
    fetchSucceeded &&
    !fetchFailed &&
    recent.length === 0 &&
    pinned.length === 0 &&
    !sawIndexMarker &&
    useFileStore.getState().files.length === 0;
  if (channelIsEmpty) {
    return {
      status: "ready",
      files: [],
      ids: [],
      texts: [],
      savedAt: 0,
      format: 2,
      chunks: [],
    };
  }

  if (!fetchSucceeded) {
    return { status: "incomplete", reason: "network" };
  }
  if (timedOut) {
    return { status: "incomplete", reason: "timeout" };
  }
  return { status: "incomplete", reason: "not_found" };
}

export type IndexLoadOutcome =
  | { status: "ready"; files: TeleFile[]; savedAt: number }
  | {
      status: "incomplete";
      reason: DiscoveryIncompleteReason;
      files: TeleFile[];
    };

/**
 * Loads the index and records discovery status in the store.
 *
 * Ready: seeds the writer cache (ids + original texts), advances
 * `lastIndexMsgId`, marks the store ready *before* healing (so the healing save
 * passes the write gate), then heals/dedupes.
 *
 * Incomplete: keeps the cached files untouched, marks the store incomplete, and
 * never calls heal/save. Only `replaceIndexFromRecovery` may write in this state.
 */
export async function loadIndexOutcome(
  channelId: string,
  options: { preserveReadyOnIncomplete?: boolean } = {},
): Promise<IndexLoadOutcome> {
  const result = await discoverIndex(channelId);
  const store = useFileStore.getState();

  if (result.status !== "ready") {
    // A remote-sync refresh must not downgrade a previously healthy index
    // because of one transient network failure — that would gate every local
    // write until a later retry succeeds.
    const preserveReady =
      options.preserveReadyOnIncomplete === true &&
      store.indexLoadState === "ready";
    if (!preserveReady) {
      store.setIndexLoadState("incomplete", result.reason);
    }
    console.warn(
      `INDEX_DISCOVERY_INCOMPLETE reason=${result.reason}; keeping cached files and skipping heal/save.`
    );
    return { status: "incomplete", reason: result.reason, files: store.files };
  }

  store.setIndexLoadState("ready", null);
  console.log(
    `INDEX_DISCOVERY_OK chunks=${result.ids.length} files=${result.files.length}`
  );

  if (result.ids.length > 0) {
    const maxChosenMsgId = result.ids.reduce((max, id) => Math.max(max, id), 0);
    if (maxChosenMsgId > 0) {
      store.setLastIndexMsgId(maxChosenMsgId);
    }
    getIndexQueue(channelId).setKnownIndex(result.ids, result.texts, result.chunks);
  }

  const visibleFiles = filterDeletedMessages(channelId, result.files);
  const files = await healAndSave(
    channelId,
    collapseDuplicateFolders(dedupeByContentKey(dedupeByMessageId(visibleFiles)))
  );
  return { status: "ready", files, savedAt: result.savedAt };
}

/**
 * Loads the virtual file metadata index from the Telegram channel.
 *
 * Uses `discoverIndex` (manifest → legacy → search → paginated history) so the
 * result no longer depends on the last-100-messages window. Only a ready
 * discovery is healed/saved; an incomplete discovery returns the cached files
 * unchanged and never writes a partial state.
 */
export async function loadIndex(channelId: string): Promise<TeleFile[]> {
  const outcome = await loadIndexOutcome(channelId);
  return outcome.files;
}

/**
 * Detect in-place edits to the live index chunks.
 *
 * Fast index saves edit existing Telegram messages, so a `minId` cursor never
 * sees them. Comparing the cached chunk text (or savedAt for legacy chunks)
 * against one `getMessages({ ids })` call lets remote sync reload the
 * authoritative snapshot when another device renames, trashes, or deletes.
 */
export async function hasIndexRevisionChanged(
  channelId: string,
): Promise<boolean> {
  const known = getIndexQueue(channelId).getKnownIndexMeta();
  if (!known || known.ids.length === 0) return false;

  const client = getClient();
  let peer: any;
  try {
    peer = await resolveChannelInputPeer(channelId);
  } catch (err) {
    console.warn("[metadataStore] index revision: resolve failed:", err);
    return false;
  }

  let messages: any[] = [];
  try {
    messages = await withTimeout(
      client.getMessages(peer, { ids: known.ids }),
      5000,
      "client.getMessages(index revision)",
    );
  } catch (err) {
    console.warn("[metadataStore] index revision: getMessages failed:", err);
    return false;
  }

  const byId = new Map<number, any>();
  for (const msg of messages ?? []) {
    const id = Number(msg?.id);
    if (Number.isFinite(id) && id > 0) byId.set(id, msg);
  }

  for (let i = 0; i < known.ids.length; i++) {
    const msg = byId.get(known.ids[i]);
    if (!msg) return true; // chunk deleted / replaced by a newer epoch
    const text = msg.text ?? msg.message;
    const knownText = known.texts[i];
    if (typeof knownText === "string" && knownText.length > 0) {
      if (text !== knownText) return true;
      continue;
    }
    const parsed = parseIndexMessage(msg);
    if (!parsed) return true;
    if (parsed.savedAt !== known.savedAt[i]) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// loadIndexIncremental — used by the multi-device sync poller.
// ---------------------------------------------------------------------------
//
// Fetches only messages newer than `sinceMsgId` (exclusive), parses any
// index chunks in that slice, and returns the merged TeleFile delta
// (deduplicated by messageId via dedupeByMessageId). Does NOT trigger
// `healAndSave` — the caller (RemoteSyncOrchestrator) merges the delta
// into the in-memory store via setRemoteDelta, which is read-only.
//
// Returns { files, highestMsgId } so the caller can update its
// high-water mark for the next poll. When `sinceMsgId` is 0 (a brand-new
// or empty drive), this scans recent messages so an index created by
// another device can still be discovered.
//
// Cost: 1x getMessages(peer, { minId }) per poll = 5s timeout. At the
// default 30s poll cadence that's well under Telegram's FLOOD_WAIT
// thresholds for history reads.

export interface IncrementalIndexResult {
  /** New or updated files found in messages after `sinceMsgId`. May be empty. */
  files: TeleFile[];
  /** Highest message id observed in the fetched slice. 0 if nothing was fetched. */
  highestMsgId: number;
}

/**
 * Pull new index chunks from Telegram since the last known high-water mark.
 *
 * On Telegram GramJS, `minId: sinceMsgId` returns messages with id STRICTLY
 * GREATER than sinceMsgId (the docs say "lower (older) ID or equal" is
 * excluded). We verify the cutoff in code as a defensive guard against any
 * future change in semantics.
 */
export async function loadIndexIncremental(
  channelId: string,
  sinceMsgId: number
): Promise<IncrementalIndexResult> {
  const client = getClient();
  let peer: any;
  try {
    peer = await resolveChannelInputPeer(channelId);
  } catch (err) {
    console.warn("[metadataStore] loadIndexIncremental: resolve failed:", err);
    return { files: [], highestMsgId: sinceMsgId };
  }

  let msgs: any[] = [];
  try {
    msgs = await withTimeout(
      client.getMessages(peer, {
        minId: sinceMsgId,
        limit: 200,
      }),
      5000,
      "client.getMessages(minId)"
    );
  } catch (err) {
    console.warn("[metadataStore] loadIndexIncremental: getMessages failed:", err);
    return { files: [], highestMsgId: sinceMsgId };
  }

  // Defensive filter in case GramJS ever ships a semantics change.
  const fresh = msgs.filter((m: any) => typeof m?.id === "number" && m.id > sinceMsgId);

  if (fresh.length === 0) {
    return { files: [], highestMsgId: sinceMsgId };
  }

  // Track the high-water mark across this slice.
  const highestMsgId = fresh.reduce((m: number, x: any) => Math.max(m, x.id), sinceMsgId);

  const chosenSet = pickCoherentIndexSet(fresh);
  if (!chosenSet) {
    // No coherent epoch in the new slice — could be a partial save. The
    // caller will re-poll; we don't try to reconstruct. Returning an empty
    // file list keeps the caller out of any partial-state territory.
    return { files: [], highestMsgId };
  }

  const byId = new Map<string, TeleFile>();
  for (const c of chosenSet) {
    for (const f of c.files) byId.set(f.id, f);
  }
  // Dedupe by messageId so any overlapping entries across the slice collapse.
  // We do NOT collapse folders here (folders have messageId=0) — folder
  // uniqueness is enforced at the bootstrap / healAndSave layer.
  return {
    files: dedupeByMessageId(Array.from(byId.values())),
    highestMsgId,
  };
}

// ---------------------------------------------------------------------------
// saveIndex — thin wrapper that delegates to the per-channel IndexQueue.
// ---------------------------------------------------------------------------
//
// All Telegram persistence of the index goes through `enqueueSave` which:
//   - coalesces many enqueues into one Telegram edit (no FLOOD_WAIT cascade)
//   - serializes per-channel writes (single writer rule)
//   - waits on FLOOD_WAIT_X and retries automatically
//   - surfaces queue state to the fileStore for the topbar pill
//
// This function is kept as a public API for callers that don't care about
// the queue mechanics (mostly legacy callers). It simply routes through the
// queue.
//
// Note: the old implementation used a Mutex + `activeSavePromise` chain which
// double-serialized every save and frequently timed out at 15 s, producing
// cascading FLOOD_WAIT errors (see src-tauri/vault_state.log). That whole
// serialization layer has been removed; the queue is the serializer now.

export function saveIndex(channelId: string, files: TeleFile[]): Promise<void> {
  return enqueueSave(channelId, files);
}

/**
 * Saves the index directly — same as `saveIndex`, kept as a named export
 * for upload-manager compat. The queue is already the single writer for
 * the channel, so there's no need to bypass anything.
 */
export const saveIndexDirect = saveIndex;

// ---------------------------------------------------------------------------
// Public CRUD helpers — all deduplicate by id before writing
// ---------------------------------------------------------------------------

/** Adds a file entry to the index (replaces if same id already exists). */
export async function addFile(channelId: string, file: TeleFile): Promise<TeleFile[]> {
  return runExclusive(async () => {
    const files = useFileStore.getState().files;
    // Replace existing entry with same id, or append
    const updatedFiles = [...files.filter((f) => f.id !== file.id), file];
    await saveIndex(channelId, updatedFiles);
    return updatedFiles;
  });
}

/** Removes a file entry from the index by id. */
export async function removeFile(channelId: string, fileId: string): Promise<TeleFile[]> {
  return runExclusive(async () => {
    const files = useFileStore.getState().files;
    const file = files.find((f) => f.id === fileId);
    const updatedFiles = files.filter((f) => f.id !== fileId);
    await saveIndex(channelId, updatedFiles);

    // Also delete the actual Telegram message if this was a real uploaded file
    // (folders have messageId=0 and live only in the index)
    if (file && file.messageId && file.messageId !== 0) {
      await deleteTelegramMessage(channelId, file.messageId).catch((err) => {
        console.warn(
          `[metadataStore] Could not delete Telegram message ${file.messageId} (non-fatal):`,
          err?.message || err
        );
      });
    }

    return updatedFiles;
  });
}

/**
 * Deletes a specific message from the Telegram storage channel.
 * Used when permanently deleting uploaded files — removes the file data from Telegram.
 * Non-fatal if the message was already deleted.
 */
export async function deleteTelegramMessage(
  channelId: string,
  messageId: number
): Promise<void> {
  if (!messageId || messageId === 0) return;
  const client = getClient();
  const peer = await resolveChannelInputPeer(channelId);
  await withTelegramRetry(
    () =>
      withTimeout(
        client.deleteMessages(peer, [messageId], { revoke: true }),
        10_000,
        "deleteMessages"
      ),
    "deleteMessages",
    3
  );
}

/**
 * Updates a file entry in the index.
 * Returns the updated file list but does NOT write to Telegram —
 * call saveIndex explicitly if you need to persist the update remotely.
 *
 * For non-critical updates (e.g. lastOpenedAt), use updateFileLocal to
 * avoid triggering a full Telegram round-trip on every preview open.
 */
export async function updateFile(
  channelId: string,
  fileId: string,
  patch: Partial<TeleFile>
): Promise<TeleFile[]> {
  return runExclusive(async () => {
    const files = useFileStore.getState().files;
    const updatedFiles = files.map((f) =>
      f.id === fileId ? { ...f, ...patch } : f
    );
    await saveIndex(channelId, updatedFiles);
    return updatedFiles;
  });
}

/**
 * Updates a file entry IN MEMORY ONLY — no Telegram write.
 * Use for non-critical metadata (e.g. lastOpenedAt) that should not
 * trigger a full index round-trip.
 * Returns the new file list so the caller can update the local store.
 */
export function updateFileLocal(
  files: TeleFile[],
  fileId: string,
  patch: Partial<TeleFile>
): TeleFile[] {
  return files.map((f) => (f.id === fileId ? { ...f, ...patch } : f));
}

/** Adds multiple file entries to the index in a single save round-trip. */
export async function addFilesBatch(channelId: string, newFiles: TeleFile[]): Promise<TeleFile[]> {
  return runExclusive(async () => {
    const files = useFileStore.getState().files;
    const byId = new Map<string, TeleFile>();
    for (const f of files) {
      byId.set(f.id, f);
    }
    for (const f of newFiles) {
      byId.set(f.id, f);
    }
    const updatedFiles = Array.from(byId.values());
    await saveIndex(channelId, updatedFiles);
    return updatedFiles;
  });
}
