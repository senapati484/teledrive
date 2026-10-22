import { Api } from "telegram";
import { getClient } from "../telegram/client";
import { TeleFile } from "../types";
import { useFileStore } from "../../stores/fileStore";
import { enqueueSave, getIndexQueue } from "./indexQueue";
import { filterJunkFiles } from "./fileSanitizer";
import { normalizeFolderPath } from "../utils";

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
  // btoa is available in WebView; full Unicode → percent-encode first.
  const encoded = btoa(
    encodeURIComponent(normalized).replace(/%([0-9A-F]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    )
  );
  return `folder_${encoded.slice(0, 48)}`;
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
export function dedupeByContentKey(files: TeleFile[]): TeleFile[] {
  const byContentKey = new Map<string, TeleFile>();
  const folders: TeleFile[] = [];
  for (const f of files) {
    if (!f.messageId || f.messageId === 0 || isFolderMime(f.mime)) {
      folders.push(f);
      continue;
    }
    // Use the FOLDER PATH the file lives in (not getFolderFullPath — that's
    // for folders). Two files in the same folder with the same name and size
    // are still considered duplicates here: this collapses backup retries
    // and concurrent uploads of the same source file.
    const parent = !f.folderPath || f.folderPath === "/" ? "" : f.folderPath.replace(/\/+$/, "");
    const key = `${parent}::${f.name}::${f.size}`;
    const existing = byContentKey.get(key);
    if (!existing) {
      byContentKey.set(key, f);
      continue;
    }
    // Last-write-wins; tie-break by larger messageId (newer Telegram msg).
    const newer =
      f.uploadedAt > existing.uploadedAt
        ? f
        : f.uploadedAt < existing.uploadedAt
        ? existing
        : f.messageId > existing.messageId
        ? f
        : existing;
    byContentKey.set(key, newer);
  }
  return [...folders, ...byContentKey.values()];
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
    // Try local session cache first (fast, non-blocking)
    return await client.getInputEntity(channelId);
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
  // First, strip all system and git junk (.DS_Store, git objects, hooks, refs, etc.)
  const cleanSource = filterJunkFiles(files);
  const hadJunk = cleanSource.length !== files.length;

  // Reconstruct first (so folder entries exist for any folderPath references),
  // THEN dedupe. Order matters: reconstructMissingFolders creates folder
  // entries with deterministic ids, and dedupeByMessageId / collapseDuplicateFolders
  // would otherwise drop folder duplicates that have the same id but different
  // random metadata. Doing it this way means duplicate folders from previous
  // cold starts collapse to one canonical entry before they hit the queue.
  const { healedFiles, changed } = reconstructMissingFolders(cleanSource, channelId);
  // Order: dedupeByMessageId → dedupeByContentKey → collapseDuplicateFolders.
  // - dedupeByMessageId handles single-message races (same Telegram message
  //   represented twice).
  // - dedupeByContentKey handles retry pairs (two distinct Telegram messages
  //   for the same logical file — see T1.3 in the Tier 1 plan).
  // - collapseDuplicateFolders finally handles folder-entry duplicates by
  //   full path.
  const cleaned = collapseDuplicateFolders(dedupeByContentKey(dedupeByMessageId(healedFiles)));
  if (changed || hadJunk || cleaned.length !== files.length) {
    console.log(
      `[metadataStore] Healed ${hadJunk ? `(removed ${files.length - cleanSource.length} junk) ` : ""}${
        changed ? "folders" : ""
      }${changed && cleaned.length !== cleanSource.length ? " + " : ""}${
        cleaned.length !== cleanSource.length ? `dedup removed ${cleanSource.length - cleaned.length}` : ""
      }. Saving updated index to Telegram...`
    );
    enqueueSave(channelId, cleaned).catch((err) => {
      console.error("[metadataStore] Failed to save healed index to Telegram:", err);
    });
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// loadIndex
// ---------------------------------------------------------------------------

/**
 * Loads the virtual file metadata index from the Telegram channel.
 *
 * Reads ALL pinned messages that look like teledrive_index entries,
 * merges their file arrays, then deduplicates by `id` (keeping the latest
 * entry per id) so that duplicate/stale pinned messages never show ghost files.
 *
 * Falls back to scanning the last 200 messages if no pinned index is found
 * (handles the case where the pin was blocked by Telegram's new-channel lock).
 */
export interface ParsedIndexChunk {
  msgId: number;
  chunkIndex: number;
  totalChunks: number;
  files: TeleFile[];
}

/**
 * Parses a list of Telegram messages into ParsedIndexChunk records.
 * Filters out non-index messages and malformed chunks.
 */
function parseIndexMessages(messages: any[]): ParsedIndexChunk[] {
  const indexMsgs = messages
    .filter((m: any) => {
      const txt = m?.text || m?.message;
      return typeof txt === "string" && txt.includes("teledrive_index");
    })
    .sort((a: any, b: any) => a.id - b.id);
  const parsed: ParsedIndexChunk[] = [];
  for (const msg of indexMsgs) {
    try {
      const txt = msg.text || msg.message || "";
      const data = JSON.parse(txt);
      if (
        data &&
        Array.isArray(data.files) &&
        typeof data.chunkIndex === "number" &&
        typeof data.totalChunks === "number" &&
        data.totalChunks > 0 &&
        data.chunkIndex >= 0 &&
        data.chunkIndex < data.totalChunks
      ) {
        const files = (data.files as TeleFile[])
          .filter((f) => f?.id)
          .map((f) => ({ ...f, folderPath: normalizeFolderPath(f.folderPath) }));
        parsed.push({
          msgId: Number(msg.id),
          chunkIndex: data.chunkIndex,
          totalChunks: data.totalChunks,
          files,
        });
      }
    } catch (e) {
      // Skip malformed chunks; they're a normal consequence of partial saves.
    }
  }
  return parsed;
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
    const epoch = epochs[i];
    const total = epoch[0]?.totalChunks;
    if (!total) continue;
    const present = new Set(epoch.map((c) => c.chunkIndex));
    let complete = true;
    for (let k = 0; k < total; k++) {
      if (!present.has(k)) {
        complete = false;
        break;
      }
    }
    if (complete) return [...epoch].sort((a, b) => a.chunkIndex - b.chunkIndex);
  }
  return null;
}

/**
 * Picks the most-recent fully-coherent set of index chunks from a list of
 * Telegram messages. Groups by totalChunks, finds the latest complete
 * epoch in each group, then picks the set with the LARGEST totalChunks
 * (tie-break by highest minimum message id).
 *
 * Returns the chosen set's ParsedIndexChunks (sorted by chunkIndex),
 * or null if no coherent set exists.
 *
 * Exported so the IndexQueue's commitOnce can reuse the same selection
 * logic to identify the current "live" index for edit/delete targets.
 */
export function pickCoherentIndexSet(
  messages: any[]
): ParsedIndexChunk[] | null {
  const parsed = parseIndexMessages(messages);
  if (parsed.length === 0) return null;

  const byTotal = new Map<number, ParsedIndexChunk[]>();
  for (const p of parsed) {
    const list = byTotal.get(p.totalChunks);
    if (list) list.push(p);
    else byTotal.set(p.totalChunks, [p]);
  }

  // Selection rule:
  // An epoch's freshness in Telegram is strictly determined by its message IDs.
  // Because Telegram message IDs are strictly monotonic and sequential, the complete
  // epoch with the HIGHEST maxMsgId represents the latest successful index save.
  // We must not prefer larger totalChunks over recency, because doing so breaks
  // deletions, file organization, and cleanups when an index shrinks in chunk count.
  let best: ParsedIndexChunk[] | null = null;
  let bestMaxId = -Infinity;
  let bestMinId = -Infinity;
  for (const [, chunks] of byTotal) {
    const coherent = findMostRecentCoherentEpoch(chunks);
    if (!coherent) continue;
    const maxId = coherent.reduce(
      (m, c) => Math.max(m, c.msgId),
      -Infinity
    );
    const minId = coherent.reduce(
      (m, c) => Math.min(m, c.msgId),
      Infinity
    );
    if (maxId > bestMaxId || (maxId === bestMaxId && minId > bestMinId)) {
      best = coherent;
      bestMaxId = maxId;
      bestMinId = minId;
    }
  }
  return best;
}

/**
 * Loads the virtual file metadata index from the Telegram channel.
 *
 * Reads ALL pinned messages that look like teledrive_index entries AND
 * the last 200 recent messages, then picks the most-recent coherent
 * chunk-set across both sources. This is robust against:
 *   - pin failures (FLOOD_WAIT): unpinned-but-sent chunks are still found
 *     via the recent scan, and their higher message ids make them win
 *     over any older pinned set.
 *   - partial saves: an epoch with a missing chunk (e.g. chunk=3 dropped)
 *     is skipped in favor of the latest COMPLETE epoch.
 *   - mixed-version channels: Frankenstein-merging across epochs is
 *     avoided — only fully-coherent sets are considered.
 */
export async function loadIndex(channelId: string): Promise<TeleFile[]> {
  const client = getClient();
  let peer: any;

  try {
    peer = await resolveChannelInputPeer(channelId);
  } catch (err) {
    console.error("[metadataStore] Failed to resolve channel entity:", err);
    throw err;
  }

  // Fetch both pinned messages AND recent messages in parallel.
  // Pinned messages may contain a stale epoch if Telegram rate-limited UpdatePinnedMessage (FLOOD_WAIT),
  // while recent messages contain the newly posted chunks with higher message IDs.
  // Querying both concurrently guarantees pickCoherentIndexSet selects the freshest coherent epoch.
  let allMsgs: any[] = [];
  const [pinnedRes, recentRes] = await Promise.allSettled([
    withTimeout(
      client.getMessages(peer, {
        filter: new Api.InputMessagesFilterPinned(),
        limit: 100,
      }),
      5000,
      "client.getMessages(pinned)"
    ),
    withTimeout(
      client.getMessages(peer, { limit: 100 }),
      5000,
      "client.getMessages(recent)"
    ),
  ]);

  if (pinnedRes.status === "fulfilled" && Array.isArray(pinnedRes.value)) {
    allMsgs = allMsgs.concat(pinnedRes.value);
  } else if (pinnedRes.status === "rejected") {
    console.warn("[metadataStore] Failed to load pinned messages:", pinnedRes.reason);
  }

  if (recentRes.status === "fulfilled" && Array.isArray(recentRes.value)) {
    allMsgs = allMsgs.concat(recentRes.value);
  } else if (recentRes.status === "rejected") {
    console.warn("[metadataStore] Failed to scan recent messages:", recentRes.reason);
  }

  let chosenSet = pickCoherentIndexSet(allMsgs);

  if (allMsgs.length === 0) {
    console.error("[metadataStore] No messages loaded from channel");
    return [];
  }

  if (!chosenSet) {
    console.warn(
      `[metadataStore] No coherent index set found across ${allMsgs.length} message(s); falling back to best-effort merge.`
    );
    // Best-effort: dedup by file id across ALL parsed chunks.
    const allParsed = parseIndexMessages(allMsgs);
    const byId = new Map<string, TeleFile>();
    for (const c of allParsed) {
      for (const f of c.files) byId.set(f.id, f);
    }
    return healAndSave(
      channelId,
      collapseDuplicateFolders(dedupeByContentKey(dedupeByMessageId(Array.from(byId.values()))))
    );
  }

  const maxChosenMsgId = chosenSet.reduce((max, c) => Math.max(max, c.msgId), 0);
  if (maxChosenMsgId > 0) {
    useFileStore.getState().setLastIndexMsgId(maxChosenMsgId);
  }

  // Register coherent set with indexQueue so subsequent user actions (like starring)
  // have the message IDs in memory and don't need to query Telegram!
  const chosenMsgIds = chosenSet.map((c) => c.msgId);
  const chosenPayloads = chosenSet.map((c) =>
    JSON.stringify({
      teledrive_index: true,
      version: 1,
      chunkIndex: c.chunkIndex,
      totalChunks: c.totalChunks,
      files: c.files,
    })
  );
  getIndexQueue(channelId).setKnownIndex(chosenMsgIds, chosenPayloads);

  // Merge chosen set into a single TeleFile list, deduping by id.
  const byId = new Map<string, TeleFile>();
  for (const c of chosenSet) {
    for (const f of c.files) {
      byId.set(f.id, f);
    }
  }
  return healAndSave(
    channelId,
    collapseDuplicateFolders(dedupeByContentKey(dedupeByMessageId(Array.from(byId.values()))))
  );
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
// high-water mark for the next poll. When `sinceMsgId` is 0 (e.g. first
// sync poll after bootstrap), this is equivalent to a recent-messages
// scan; the caller should only invoke it after the bootstrap has set
// lastIndexMsgId to a non-zero value.
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
  await withTimeout(
    client.deleteMessages(peer, [messageId], { revoke: true }),
    5000,
    "deleteMessages"
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
