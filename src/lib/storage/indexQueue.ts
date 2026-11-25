/**
 * IndexQueue — per-channel async FIFO queue that owns ALL index persistence
 * to Telegram. This is the single writer rule for the index per channelId.
 *
 * Design goals:
 *   1. Coalesce: many rapid `enqueue(state)` calls collapse into ONE Telegram
 *      write (latest state wins). This is what eliminates the FLOOD_WAIT
 *      cascade — 50 user actions in 5s become 1 edit, not 50 sends.
 *   2. Serialize: only one Telegram index write happens at a time per channel,
 *      so we never produce overlapping duplicate index messages.
 *   3. FLOOD_WAIT-aware: when Telegram asks us to wait X seconds, we wait
 *      (capped) and then retry, instead of failing and re-queueing.
 *   4. Hybrid rollback: transient errors (FLOOD_WAIT, timeout, network) keep
 *      the optimistic UI and retry indefinitely. Hard errors propagate so the
 *      caller can roll back the optimistic state.
 *   5. Observable: surfaces queue state (`idle|saving|retrying|failed`) plus a
 *      retry countdown to the fileStore so the topbar can show accurate
 *      "Syncing / Retrying in 12s / Failed — Retry" feedback.
 *   6. High Performance Caching: Caches the message IDs and serialized chunk
 *      payloads of the active index on Telegram. Single-file updates (e.g. starring,
 *      renaming) only edit the single modified chunk in-place (<200ms), avoiding
 *      costly 300-message Telegram scans, deletes, and multi-chunk flood waits.
 *
 * The queue is keyed by channelId so multiple accounts (future-proofing)
 * don't share state.
 */

import { Api } from "telegram";
import { getClient } from "../telegram/client";
import { canonicalChannelId } from "../telegram/peerId";
import { withTimeout, discoverIndex } from "./metadataStore";
import {
  packChunks,
  serializeChunk,
  isValidManifest,
  parseIndexMessage,
  epochTimestamp,
  TELEGRAM_TEXT_LIMIT,
  type ParsedIndexChunk,
} from "./indexFormat";
import { useFileStore } from "../../stores/fileStore";
import {
  computeRetryDelay,
  isHardError,
  parseFloodWaitSeconds,
  FLOOD_WAIT_CAP_SECONDS,
} from "../telegram/rateLimit";
import i18n from "@/i18n";
import { IndexNotReadyError, isIndexReady } from "../telegram/indexReadiness";
import { logVaultState } from "../runtime/bridge";
import { compactBackupCatalog } from "../backup/catalog";
import { filterDeletedMessages } from "./tombstones";
import { canReplaceLocalState } from "../sync/localState";
import { normalizeFolderPath } from "../files/pathUtils";

export { IndexNotReadyError } from "../telegram/indexReadiness";

export class IndexRetryExhaustedError extends Error {
  readonly code = "INDEX_RETRY_EXHAUSTED";

  constructor(message: string) {
    super(message);
    this.name = "IndexRetryExhaustedError";
  }
}

/**
 * The live index on Telegram changed since this writer last read it. The queue
 * reloads the authoritative snapshot and re-applies the pending mutation at
 * most once; if that still conflicts the caller must retry the user action
 * against the refreshed drive. `transient` means the guard could not read the
 * revision (timeout/network), so a mount client may retry shortly.
 */
export class IndexConflictError extends Error {
  readonly code = "INDEX_CONFLICT";
  readonly transient: boolean;
  readonly originalError?: unknown;

  constructor(message: string, transient = false, originalError?: unknown) {
    super(message);
    this.name = "IndexConflictError";
    this.transient = transient;
    this.originalError = originalError;
  }
}

/** Conservative metadata edit cadence for Telegram channel edits. */
export const DEFAULT_METADATA_EDIT_INTERVAL_MS = 5_000;
/** Adaptive cap after a FLOOD_WAIT; never balloon to Telegram's 300 s. */
export const METADATA_EDIT_INTERVAL_CAP_MS = 30_000;
const EDIT_INTERVAL_STORAGE_PREFIX = "teledrive_index_edit_interval:";

export const INDEX_CONFLICT_MESSAGE =
  "Another device changed the drive; refreshed - retry.";
export const INDEX_REVISION_UNAVAILABLE_MESSAGE =
  "Could not verify the latest drive revision; retry shortly.";

/** Total commit attempts after a conflict: one normal pass plus one recovery. */
const MAX_CONFLICT_ATTEMPTS = 2;
const REVISION_CHECK_TIMEOUT_MS = 5_000;

import type { RemoteVaultMetadata, TeleFile } from "../types";
import {
  writePendingMarker,
  clearPendingMarker,
} from "./pendingIndex";

/**
 * Splits state into chunks under Telegram's 4096-char message limit.
 * Instead of hardcoding 10 files per chunk (which created 10 chunks for 91 files),
 * dynamically pack up to ~3200 characters or max 25 files per chunk.
 * This yields 2-4 chunks instead of 10+, cutting Telegram MTProto calls by 60-70%.
 */
export function chunkFiles(files: TeleFile[]): TeleFile[][] {
  if (files.length === 0) return [[]];
  const chunks: TeleFile[][] = [];
  let currentChunk: TeleFile[] = [];
  let currentChars = 120; // wrapper JSON overhead

  for (const file of files) {
    const fileJsonLen = JSON.stringify(file).length + 2;
    if (
      currentChunk.length > 0 &&
      (currentChars + fileJsonLen > 3400 || currentChunk.length >= 25)
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentChars = 120;
    }
    currentChunk.push(file);
    currentChars += fileJsonLen;
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  return chunks;
}

/**
 * Stable re-chunking: when we already have `existingCount` chunks on Telegram,
 * distribute `files` into exactly `existingCount` chunks (as long as none overflows
 * Telegram's 4096-char limit). This ensures starring, renaming, etc. always
 * produces the same chunk count as what's stored, so we can use the fast
 * in-place editMessage path and avoid the expensive delete+resend fallback.
 *
 * Falls back to `chunkFiles()` if stable distribution would overflow any chunk.
 */
export function chunkFilesStable(files: TeleFile[], existingCount: number): TeleFile[][] {
  if (existingCount <= 1 || files.length === 0) return chunkFiles(files);

  // Distribute round-robin by index, like we're splitting an array into N slices
  const perChunk = Math.ceil(files.length / existingCount);
  const chunks: TeleFile[][] = [];
  for (let i = 0; i < existingCount; i++) {
    const slice = files.slice(i * perChunk, (i + 1) * perChunk);
    if (slice.length > 0) chunks.push(slice);
  }

  // Safety: verify no chunk exceeds Telegram's message limit (~3900 chars with wrapper JSON)
  const LIMIT = 3900;
  const OVERHEAD = 120;
  for (const chunk of chunks) {
    let chars = OVERHEAD;
    for (const f of chunk) chars += JSON.stringify(f).length + 2;
    if (chars > LIMIT) {
      // Overflow — fall back to dynamic chunking (will change chunk count)
      return chunkFiles(files);
    }
  }

  // Pad to exactly existingCount if some trailing slices were empty
  while (chunks.length < existingCount) chunks.push([]);
  return chunks;
}

/** Legacy constant kept for external imports if any. */
export const CHUNK_SIZE = 25;

/** Per-RPC edit/send timeout (ms). */
const EDIT_TIMEOUT_MS = 5000;
/**
 * Telegram floods a channel after ~20 messages in a burst. A 460-file index
 * used to send 47 chunks back-to-back and immediately enter a 5-minute
 * FLOOD_WAIT. One second between chunks keeps structural writes under the
 * limit without meaningfully slowing normal 1-3 chunk saves.
 */
const CHUNK_SEND_DELAY_MS =
  import.meta.env.MODE === "test" ? 0 : 1_100;

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
}

/**
 * Cap on transient (FLOOD_WAIT / timeout / network) retries before the
 * queue gives up and surfaces a hard error.
 */
const MAX_TRANSIENT_RETRIES = 5;

interface QueueEntry {
  state: TeleFile[];
  /**
   * Canonical catalog this mutation was built on. Used to re-apply the same
   * change after a conflicting writer is discovered. `null` means the base is
   * unknown and a conflict must fail closed instead of guessing.
   */
  base: TeleFile[] | null;
  /** Resolve handler for the caller of `enqueue`. */
  resolve: () => void;
  reject: (err: any) => void;
  /** Whether this entry owns the pending-index marker. */
  recordPending: boolean;
  /**
   * WebDAV: do not resolve when a newer snapshot supersedes this one — wait
   * until the state that includes this mutation is actually committed.
   */
  durable?: boolean;
  /** Pace this write through the metadata edit token bucket. */
  rateLimited?: boolean;
  /** Durable callers carried over from superseded entries. */
  followers?: Array<{ resolve: () => void; reject: (err: any) => void }>;
}

function resolveQueueEntry(entry: QueueEntry): void {
  entry.resolve();
  for (const follower of entry.followers ?? []) follower.resolve();
}

function rejectQueueEntry(entry: QueueEntry, err: any): void {
  entry.reject(err);
  for (const follower of entry.followers ?? []) follower.reject(err);
}

interface EnqueueOptions {
  /**
   * Write the pending marker + flush the file cache. Internal maintenance
   * writes (healing) pass false so they never masquerade as a user action.
   */
  recordPending?: boolean;
  /**
   * Resolve only after the state containing this mutation is durably
   * committed, even when a newer snapshot supersedes it.
   */
  durable?: boolean;
  /** Pace this write through the metadata edit token bucket. */
  rateLimited?: boolean;
}

/**
 * The writer's view of the live index on Telegram.
 * `texts` are the exact payloads on Telegram, aligned with `ids` (chunk 0
 * first), so unchanged chunks can be reused verbatim on a structural save.
 */
interface KnownIndex {
  ids: number[];
  texts: string[];
  savedAt: number[];
  epoch: number;
  hasManifest: boolean;
}

class ChannelQueue {
  private pending: QueueEntry | null = null;
  private retryingEntry: QueueEntry | null = null;
  /**
   * Latest state that exhausted transient retries. It stays here (and is
   * retried every 60s / on manual Retry) instead of being dropped. The caller
   * was already rejected, but the optimistic UI is kept by useFileActions.
   */
  private stuckEntry: QueueEntry | null = null;
  private inflight: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCountdownTimer: ReturnType<typeof setInterval> | null = null;
  private stuckTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private lastError: any = null;
  private successCount = 0;
  /** Deadlines backing `remainingBackoffMs` (0 = no timer). */
  private retryDeadlineAt = 0;
  private stuckDeadlineAt = 0;
  /** Token bucket pacing Telegram channel edits. */
  private metadataEditIntervalMs: number;
  private metadataTokens = 1;
  private metadataTokensAt = Date.now();
  private metadataEditChain: Promise<void> = Promise.resolve();
  private commitOverride: ((state: TeleFile[]) => Promise<void>) | null = null;
  private readonly channelId: string;
  private serverRetryAt = 0;

  /**
   * Cached ids/texts of the live index on Telegram. Lets saves diff chunks and
   * only rewrite what actually changed, without querying Telegram first.
   */
  private known: KnownIndex | null = null;
  /** Old epoch retained across a hard-error recovery so COW can clean it up. */
  private recoveryOld: KnownIndex | null = null;
  /** Synced per-account vault metadata persisted on chunk 0 when present. */
  private vaultMetadata: RemoteVaultMetadata | undefined = undefined;
  /**
   * Last catalog state believed to be canonical on Telegram (or loaded from
   * the live chunks). Captured as the base of queued mutations so a conflict
   * can replay only the local change on top of the refreshed snapshot.
   */
  private committedState: TeleFile[] | null = null;
  /** State currently being written, used as the base for newer enqueues. */
  private inflightState: TeleFile[] | null = null;
  /**
   * When conflict recovery succeeds, the store still holds the stale
   * optimistic list. Remember what to replace and only do so if no newer local
   * action landed meanwhile.
   */
  private recoveryStoreUpdate: { expected: TeleFile[]; files: TeleFile[] } | null = null;

  constructor(channelId: string) {
    this.channelId = channelId;
    this.metadataEditIntervalMs = DEFAULT_METADATA_EDIT_INTERVAL_MS;
    try {
      const deadline = Number(localStorage.getItem(this.retryStorageKey()));
      if (Number.isFinite(deadline) && deadline > Date.now()) this.serverRetryAt = deadline;
      const interval = Number(localStorage.getItem(this.editIntervalStorageKey()));
      if (Number.isFinite(interval) && interval > 0) {
        this.metadataEditIntervalMs = Math.min(
          METADATA_EDIT_INTERVAL_CAP_MS,
          Math.max(DEFAULT_METADATA_EDIT_INTERVAL_MS, interval),
        );
      }
    } catch {
      // The in-memory queue still respects Telegram's cooldown.
    }
  }

  private editIntervalStorageKey(): string {
    return `${EDIT_INTERVAL_STORAGE_PREFIX}${this.channelId}`;
  }

  private refillMetadataTokens(now = Date.now()): void {
    const elapsed = Math.max(0, now - this.metadataTokensAt);
    this.metadataTokens = Math.min(
      1,
      this.metadataTokens + elapsed / this.metadataEditIntervalMs,
    );
    this.metadataTokensAt = now;
  }

  /** Milliseconds until the next metadata edit token (0 = available). */
  nextMetadataEditSlotMs(now = Date.now()): number {
    this.refillMetadataTokens(now);
    return this.metadataTokens >= 1
      ? 0
      : Math.ceil((1 - this.metadataTokens) * this.metadataEditIntervalMs);
  }

  getMetadataEditIntervalMs(): number {
    return this.metadataEditIntervalMs;
  }

  private rememberHigherEditInterval(floodSeconds: number): void {
    if (!Number.isFinite(floodSeconds) || floodSeconds <= 0) return;
    const next = Math.min(
      METADATA_EDIT_INTERVAL_CAP_MS,
      Math.max(this.metadataEditIntervalMs, floodSeconds * 1000),
    );
    if (next <= this.metadataEditIntervalMs) return;
    this.metadataEditIntervalMs = next;
    try {
      localStorage.setItem(this.editIntervalStorageKey(), String(next));
    } catch {
      // In-memory pacing still applies for this session.
    }
  }

  private acquireMetadataEditSlot(): Promise<void> {
    const run = this.metadataEditChain.then(async () => {
      for (;;) {
        const wait = this.nextMetadataEditSlotMs();
        if (wait <= 0) {
          this.metadataTokens = Math.max(0, this.metadataTokens - 1);
          this.metadataTokensAt = Date.now();
          return;
        }
        await sleep(wait);
      }
    });
    this.metadataEditChain = run.catch(() => {});
    return run;
  }

  private retryStorageKey(): string {
    return `teledrive_index_flood_until:${this.channelId}`;
  }

  setVaultMetadata(meta: RemoteVaultMetadata | undefined): void {
    this.vaultMetadata = meta;
  }

  getVaultMetadata(): RemoteVaultMetadata | undefined {
    return this.vaultMetadata;
  }

  /**
   * Seeds the queue with known index message IDs and chunk payloads.
   * Called by loadIndexOutcome/bootstrap when reading the index from Telegram.
   */
  setKnownIndex(
    msgIds: number[],
    chunkTexts?: string[],
    chunks?: ParsedIndexChunk[]
  ): void {
    if (msgIds.length === 0) return;
    const texts =
      chunkTexts && chunkTexts.length === msgIds.length ? [...chunkTexts] : [];
    const parsedById = new Map<number, ParsedIndexChunk>();
    for (const chunk of chunks ?? []) parsedById.set(chunk.msgId, chunk);
    if (texts.length > 0) {
      for (let i = 0; i < texts.length; i++) {
        const parsed = parseIndexMessage({ id: msgIds[i], text: texts[i] });
        if (parsed) parsedById.set(msgIds[i], parsed);
      }
    }
    const savedAt = msgIds.map((id) => parsedById.get(id)?.savedAt ?? 0);
    const zero = parsedById.get(msgIds[0]);
    if (this.vaultMetadata === undefined && zero?.e2ee) {
      this.vaultMetadata = zero.e2ee;
    }
    this.known = {
      ids: [...msgIds],
      texts,
      savedAt,
      epoch:
        chunks && chunks.length > 0
          ? Math.max(0, epochTimestamp(chunks))
          : Math.max(0, ...savedAt),
      hasManifest: zero ? isValidManifest(zero) : false,
    };
    const byId = new Map<string, TeleFile>();
    for (const id of msgIds) {
      for (const file of parsedById.get(id)?.files ?? []) {
        byId.set(file.id, file);
      }
    }
    if (byId.size > 0 || msgIds.length > 0) {
      this.committedState = Array.from(byId.values());
    }
  }

  isRateLimited(): boolean {
    return this.retryTimer != null || this.stuckTimer != null;
  }

  /** Milliseconds until the queue can retry, for WebDAV Retry-After. */
  remainingBackoffMs(): number {
    const now = Date.now();
    return Math.max(
      0,
      this.serverRetryAt - now,
      this.retryDeadlineAt - now,
      this.stuckDeadlineAt - now,
    );
  }

  getKnownIndexMsgIds(): number[] | null {
    return this.known ? [...this.known.ids] : null;
  }

  /**
   * Snapshot of the writer's cached epoch, used by remote sync to detect
   * in-place edits (which do not create a new Telegram message id).
   */
  getKnownIndexMeta(): {
    ids: number[];
    texts: string[];
    savedAt: number[];
  } | null {
    if (!this.known) return null;
    return {
      ids: [...this.known.ids],
      texts: [...this.known.texts],
      savedAt: [...this.known.savedAt],
    };
  }

  /** Test-only seam so queue integrity can be tested without Telegram. */
  setCommitImplForTests(impl: ((state: TeleFile[]) => Promise<void>) | null): void {
    this.commitOverride = impl;
  }

  private commit(state: TeleFile[], base: TeleFile[] | null): Promise<void> {
    return this.commitOverride
      ? this.commitOverride(state)
      : this.commitOnce(state, base);
  }

  enqueue(state: TeleFile[], options: EnqueueOptions = {}): Promise<void> {
    // Record the uncommitted state before anything async can fail. The file
    // cache is flushed synchronously so a crash between here and the Telegram
    // commit still leaves a complete optimistic snapshot on disk.
    const recordPending = options.recordPending ?? true;
    const durable = options.durable ?? false;
    if (recordPending) {
      writePendingMarker({
        channelId: this.channelId,
        baseSavedAt: this.known?.epoch ?? 0,
        at: Date.now(),
      });
      useFileStore.getState().flushFileCacheNow();
    }

    // Coalesce: replace any pending entry with the new state. If something is
    // currently inflight (or waiting out a FLOOD_WAIT), this becomes the next
    // state to write.
    return new Promise<void>((resolve, reject) => {
      // The oldest uncommitted snapshot is the correct diff base: newer
      // enqueues already contain the previous pending mutation.
      const base =
        this.pending?.base ?? this.inflightState ?? this.committedState;
      // Resolve superseded pending and retrying entries: their callers were
      // waiting on a snapshot that has been replaced, and leaving them
      // unresolved leaks every action that overlaps a retry.
      const followers: Array<{ resolve: () => void; reject: (err: any) => void }> = [];
      const absorb = (entry: QueueEntry | null) => {
        if (!entry) return;
        followers.push(...(entry.followers ?? []));
        if (entry.durable) {
          followers.push({ resolve: entry.resolve, reject: entry.reject });
        } else {
          entry.resolve();
        }
      };
      absorb(this.pending);
      absorb(this.retryingEntry);
      this.pending = null;
      this.retryingEntry = null;

      // A fresh action is a fresh attempt: drop a stuck state so the newest
      // snapshot wins instead of waiting for the 60s retry timer.
      if (this.stuckEntry) {
        this.stuckEntry = null;
        if (this.stuckTimer) {
          clearTimeout(this.stuckTimer);
          this.stuckTimer = null;
        }
        this.stuckDeadlineAt = 0;
        this.retryAttempt = 0;
        this.lastError = null;
      }

      this.pending = {
        state,
        base,
        resolve,
        reject,
        recordPending,
        durable,
        rateLimited: options.rateLimited ?? false,
        followers,
      };
      // Mirror the latest pending state to the store snapshot too — this is
      // what surfaces in the topbar's "Retrying" pill.
      this.updateStoreState();

      // Respect an active FLOOD_WAIT/backoff window: the timer will drain the
      // latest pending state when it fires instead of hammering Telegram now.
      if (this.retryTimer || this.inflight) return;
      if (this.serverRetryAt > Date.now()) {
        this.waitBeforeRetry(this.serverRetryAt - Date.now());
        return;
      }
      void this.drain();
    });
  }

  /**
   * Force the latest state out, bounded at 15s. Used on logout/shutdown.
   * Failed flushes keep the state in `stuckEntry` (and keep the cached
   * Telegram ids/texts) so a later manual retry can still commit it.
   */
  async flush(): Promise<{ status: "committed" | "empty" | "failed"; error?: any }> {
    if (this.serverRetryAt > Date.now()) {
      return { status: "failed", error: new Error("Telegram catalog cooldown is still active") };
    }
    this.clearTimers();
    const before = this.successCount;
    if (this.inflight) {
      try {
        await this.inflight;
      } catch {
        // Drain handles its own errors; ignore.
      }
    }

    const entry =
      this.pending ?? this.retryingEntry ?? this.stuckEntry;
    this.pending = null;
    this.retryingEntry = null;
    this.stuckEntry = null;
    if (!entry) {
      this.updateStoreState();
      // The inflight drain may have committed the captured state already.
      return { status: this.successCount > before ? "committed" : "empty" };
    }

    try {
      this.inflightState = entry.state;
      if (entry.rateLimited) await this.acquireMetadataEditSlot();
      await withTimeout(
        this.commit(entry.state, entry.base),
        15_000,
        "indexQueue.flush",
      );
      this.committedState = entry.state;
      this.finishRecoveryStoreUpdate(entry.state);
      entry.resolve();
      this.successCount++;
      this.retryAttempt = 0;
      this.lastError = null;
      this.clearMarkerIfSettled(entry);
      this.updateStoreState();
      return { status: "committed" };
    } catch (err) {
      this.lastError = err;
      if (err instanceof IndexConflictError) {
        // Never keep retrying a stale snapshot: the next user action must be
        // built on the refreshed drive instead.
        this.recoveryStoreUpdate = null;
        rejectQueueEntry(entry, err);
      } else {
        this.stuckEntry = entry;
        rejectQueueEntry(entry, err);
      }
      this.updateStoreState();
      return { status: "failed", error: err };
    } finally {
      this.inflightState = null;
    }
  }

  private clearMarkerIfSettled(entry: QueueEntry): void {
    if (!entry.recordPending) return;
    if (this.pending || this.retryingEntry || this.stuckEntry) return;
    clearPendingMarker(this.channelId);
  }

  private clearTimers(): void {
    this.retryDeadlineAt = 0;
    this.stuckDeadlineAt = 0;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.retryCountdownTimer) {
      clearInterval(this.retryCountdownTimer);
      this.retryCountdownTimer = null;
    }
    if (this.stuckTimer) {
      clearTimeout(this.stuckTimer);
      this.stuckTimer = null;
    }
  }

  private updateStoreState(): void {
    const store = useFileStore.getState();
    if (this.stuckEntry) {
      store.setIndexQueueState("failed");
      store.setIndexQueueError(
        typeof this.lastError === "string"
          ? this.lastError
          : this.lastError?.message ?? String(this.lastError)
      );
      store.setIndexQueueRetryInSec(0);
    } else if (this.lastError && this.retryTimer == null) {
      store.setIndexQueueState("failed");
      store.setIndexQueueError(
        typeof this.lastError === "string"
          ? this.lastError
          : this.lastError?.message ?? String(this.lastError)
      );
      store.setIndexQueueRetryInSec(0);
    } else if (this.retryTimer != null || this.stuckTimer != null) {
      store.setIndexQueueState("retrying");
      // Error message stays so users can see *why* we're retrying.
      if (this.lastError) {
        store.setIndexQueueError(
          parseFloodWaitSeconds(this.lastError) != null
            ? i18n.t("messages:indexQueue.rateLimitRetrying")
            : this.lastError?.message ?? String(this.lastError)
        );
      }
    } else if (this.pending) {
      store.setIndexQueueState("saving");
      store.setIndexQueueError(null);
      store.setIndexQueueRetryInSec(0);
    } else {
      store.setIndexQueueState("idle");
      store.setIndexQueueError(null);
      store.setIndexQueueRetryInSec(0);
    }
  }

  private async drain(): Promise<void> {
    // If already draining or waiting out a backoff, return — the pending entry
    // will be picked up by the timer/loop.
    if (this.inflight || this.retryTimer) return;
    this.inflight = (async () => {
      try {
        // Drain loop: keep committing while there's something to commit.
        // Pending always wins: it is the newest snapshot. A retrying entry is
        // superseded by it (and resolved so its caller doesn't hang).
        while (this.pending || this.retryingEntry) {
          if (this.pending && this.retryingEntry) {
            // Followers always belong to durable callers from earlier
            // snapshots; carry them even if this entry itself is non-durable.
            this.pending.followers = [
              ...(this.pending.followers ?? []),
              ...(this.retryingEntry.followers ?? []),
            ];
            if (this.retryingEntry.durable) {
              this.pending.followers.push({
                resolve: this.retryingEntry.resolve,
                reject: this.retryingEntry.reject,
              });
            } else {
              this.retryingEntry.resolve();
            }
            this.retryingEntry = null;
          }
          let entry = this.pending ?? this.retryingEntry;
          if (!entry) break;
          if (entry.rateLimited) {
            // Wait before taking the entry so newer mutations can coalesce
            // into the same edit instead of queueing a second one.
            await this.acquireMetadataEditSlot();
            if (this.pending && this.retryingEntry) {
              this.pending.followers = [
                ...(this.pending.followers ?? []),
                ...(this.retryingEntry.followers ?? []),
              ];
              if (this.retryingEntry.durable) {
                this.pending.followers.push({
                  resolve: this.retryingEntry.resolve,
                  reject: this.retryingEntry.reject,
                });
              } else {
                this.retryingEntry.resolve();
              }
              this.retryingEntry = null;
            }
            entry = this.pending ?? this.retryingEntry;
            if (!entry) break;
          }
          this.pending = null;
          this.retryingEntry = null;
          this.lastError = null;
          this.updateStoreState();

          try {
            this.inflightState = entry.state;
            await this.commit(entry.state, entry.base);
            this.committedState = entry.state;
            this.finishRecoveryStoreUpdate(entry.state);
            resolveQueueEntry(entry);
            this.successCount++;
            this.retryAttempt = 0;
            this.clearMarkerIfSettled(entry);
          } catch (err: any) {
            this.lastError = err;
            if (err instanceof IndexConflictError) {
              // Bounded recovery already happened inside commitOnce. Do not
              // schedule the stale snapshot for another automatic attempt.
              this.recoveryStoreUpdate = null;
              rejectQueueEntry(entry, err);
              this.retryAttempt = 0;
              this.updateStoreState();
              continue;
            }
            if (isHardError(err)) {
              // Reject only this caller; a newer pending snapshot (if any)
              // still gets its turn.
              rejectQueueEntry(entry, err);
              this.retryAttempt = 0;
              this.updateStoreState();
              continue;
            }
            this.retryingEntry = entry;
            this.scheduleRetry(err);
            return;
          } finally {
            this.inflightState = null;
          }
        }
      } finally {
        this.inflight = null;
        this.updateStoreState();
      }
    })();
  }

  retryNow(fallback: TeleFile[]): void {
    const state =
      this.stuckEntry?.state ??
      this.pending?.state ??
      this.retryingEntry?.state ??
      fallback;
    if (this.stuckTimer) {
      clearTimeout(this.stuckTimer);
      this.stuckTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retryDeadlineAt = 0;
    this.stuckDeadlineAt = 0;
    this.retryAttempt = 0;
    this.lastError = null;
    void this.enqueue(state);
  }

  private scheduleRetry(err: any): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.retryCountdownTimer) {
      clearInterval(this.retryCountdownTimer);
      this.retryCountdownTimer = null;
    }

    const floodSeconds = parseFloodWaitSeconds(err);
    if (floodSeconds !== null) {
      this.rememberHigherEditInterval(floodSeconds);
    }
    // Non-flood errors (timeouts, network drops) count against MAX_TRANSIENT_RETRIES.
    // For FLOOD_WAIT, Telegram explicitly dictates the wait duration. Waiting out
    // Telegram's cooldown should not burn through retries unless it repeatedly exceeds
    // the max cap (FLOOD_WAIT_CAP_SECONDS).
    if (floodSeconds == null || floodSeconds > FLOOD_WAIT_CAP_SECONDS) {
      this.retryAttempt++;
    }

    if (this.retryAttempt > MAX_TRANSIENT_RETRIES) {
      const wrapped = new IndexRetryExhaustedError(
        `Index save failed after ${MAX_TRANSIENT_RETRIES} transient retries: ${
          err?.message ?? String(err)
        }`
      );
      void logVaultState(
        `INDEX_QUEUE_GIVE_UP retries=${MAX_TRANSIENT_RETRIES} last_err=${
          err?.message ?? String(err)
        }`
      );
      if (this.retryingEntry) {
        // Keep the newest state instead of dropping it. The caller is
        // rejected so uploads/backups can pause, but the UI keeps the
        // optimistic state and a 60s/manual retry can still commit it.
        this.stuckEntry = this.retryingEntry;
        this.retryingEntry = null;
        rejectQueueEntry(this.stuckEntry, wrapped);
      }
      this.retryAttempt = 0;
      this.lastError = wrapped;
      this.scheduleStuckRetry();
      this.updateStoreState();
      return;
    }

    const delayMs = computeRetryDelay(this.retryAttempt, err);
    if (floodSeconds !== null) {
      this.serverRetryAt = Date.now() + delayMs;
      try {
        localStorage.setItem(this.retryStorageKey(), String(this.serverRetryAt));
      } catch {
        // Keeping the deadline in memory is sufficient until the app is closed.
      }
    }
    this.waitBeforeRetry(delayMs);
  }

  private waitBeforeRetry(delayMs: number): void {
    const deadline = Date.now() + delayMs;
    this.retryDeadlineAt = deadline;

    useFileStore.getState().setIndexQueueRetryInSec(Math.ceil(delayMs / 1000));
    this.retryCountdownTimer = setInterval(() => {
      const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      useFileStore.getState().setIndexQueueRetryInSec(secs);
      if (secs <= 0 && this.retryCountdownTimer) {
        clearInterval(this.retryCountdownTimer);
        this.retryCountdownTimer = null;
      }
    }, 500);

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryDeadlineAt = 0;
      if (this.retryCountdownTimer) {
        clearInterval(this.retryCountdownTimer);
        this.retryCountdownTimer = null;
      }
      void this.drain();
    }, delayMs);

    this.updateStoreState();
  }

  /**
   * Exhausted transient retries: keep the newest state and try again every
   * 60s, in addition to the manual Retry button. Never silently drop it.
   */
  private scheduleStuckRetry(): void {
    if (this.stuckTimer) {
      clearTimeout(this.stuckTimer);
      this.stuckTimer = null;
    }
    if (!this.stuckEntry) return;
    this.stuckDeadlineAt = Date.now() + 60_000;
    this.stuckTimer = setTimeout(() => {
      this.stuckTimer = null;
      this.stuckDeadlineAt = 0;
      if (!this.stuckEntry) {
        this.updateStoreState();
        return;
      }
      if (this.pending) {
        // A newer snapshot already won; the stuck one is obsolete.
        this.stuckEntry = null;
        this.updateStoreState();
        void this.drain();
        return;
      }
      this.retryingEntry = this.stuckEntry;
      this.stuckEntry = null;
      this.retryAttempt = 0;
      this.lastError = null;
      void this.drain();
      this.updateStoreState();
    }, 60_000);
  }

  /**
   * Writes the index atomically.
   *
   * Fast path: one changed chunk, stable chunk count -> one in-place edit
   * (Telegram edits are atomic and keep the id).
   *
   * Structural path: every changed non-zero chunk is sent as a NEW message,
   * then chunk 0 is edited last (the commit point). Old messages are deleted
   * only after that edit succeeds, so a failure at any point leaves the old
   * epoch fully readable.
   *
   * Hard errors invalidate the cache, re-discover once, and retry; a genuinely
   * missing chunk 0 falls back to a full copy-on-write + repin. Timeouts retry
   * the same RPC instead of deleting/resending the whole index.
   */
  private async commitOnce(
    state: TeleFile[],
    base: TeleFile[] | null,
  ): Promise<void> {
    // Startup replay can contain an old optimistic snapshot. Compact at
    // the writer, so both replay and ordinary saves respect the same rule.
    let current = compactBackupCatalog(state);
    let currentBase = base ?? this.committedState;
    let conflictAttempts = 0;

    const recoverOrThrow = async (cause: IndexConflictError) => {
      if (conflictAttempts >= MAX_CONFLICT_ATTEMPTS - 1) throw cause;
      conflictAttempts++;
      return this.recoverFromConflict(current, currentBase, cause);
    };

    for (;;) {
      try {
        await this.commitAttempt(current);
        this.committedState = current;
        this.finishRecoveryStoreUpdate(current);
        return;
      } catch (err: any) {
        if (err instanceof IndexConflictError) {
          const recovered = await recoverOrThrow(err);
          current = recovered.state;
          currentBase = recovered.base;
          continue;
        }
        await this.log(
          `INDEX_COMMIT_FAIL hard=${isHardError(err) ? 1 : 0} reason=${errMsg(err)}`
        );
        if (!isHardError(err) || !isMissingMessageError(err)) throw err;
        await this.log(
          `INDEX_COMMIT_HARD_ERR rediscover=1 reason=${errMsg(err)}`
        );
        this.recoveryOld = this.known;
        this.known = null;
        const result = await discoverIndex(this.channelId).catch(() => null);
        if (result && result.status === "ready" && result.ids.length > 0) {
          this.recoveryOld = null;
          this.setKnownIndex(result.ids, result.texts, result.chunks);
          // The re-discovered epoch may belong to another device. Replay the
          // local mutation instead of overwriting it wholesale.
          if (!currentBase) {
            throw new IndexConflictError(INDEX_CONFLICT_MESSAGE, false);
          }
          const recovered = await this.recoverWithSnapshot(
            current,
            currentBase,
            result,
            new IndexConflictError(INDEX_CONFLICT_MESSAGE, false),
          );
          current = recovered.state;
          currentBase = recovered.base;
          continue;
        }
        // With no live chunk 0 (or discovery unavailable) the retry sends a
        // complete new set and moves the pin.
        try {
          await this.commitAttempt(current, false);
          this.committedState = current;
          this.finishRecoveryStoreUpdate(current);
          return;
        } catch (retryErr: any) {
          if (!(retryErr instanceof IndexConflictError)) throw retryErr;
          const recovered = await recoverOrThrow(retryErr);
          current = recovered.state;
          currentBase = recovered.base;
          continue;
        }
      }
    }
  }

  /**
   * Re-loads the authoritative snapshot after a conflict and re-applies the
   * local mutation (base -> intended state) on top of it. Throws when the
   * mutation no longer has a valid target/name/parent.
   */
  private async recoverFromConflict(
    state: TeleFile[],
    base: TeleFile[] | null,
    cause: IndexConflictError,
  ): Promise<{ state: TeleFile[]; base: TeleFile[] }> {
    if (!base) {
      // No base snapshot means the local mutation cannot be replayed, but a
      // transient read failure still deserves a retryable status.
      throw new IndexConflictError(cause.message, cause.transient, cause);
    }
    if (!canReplaceLocalState({ allowQueueSaving: true })) {
      throw new IndexConflictError(INDEX_CONFLICT_MESSAGE, false, cause);
    }

    let result;
    try {
      result = await discoverIndex(this.channelId);
    } catch (err) {
      throw new IndexConflictError(INDEX_CONFLICT_MESSAGE, true, err);
    }
    return this.recoverWithSnapshot(state, base, result, cause);
  }

  private async recoverWithSnapshot(
    state: TeleFile[],
    base: TeleFile[],
    result: Awaited<ReturnType<typeof discoverIndex>>,
    cause: IndexConflictError,
  ): Promise<{ state: TeleFile[]; base: TeleFile[] }> {
    if (result.status !== "ready") {
      const transient =
        result.reason === "timeout" || result.reason === "network";
      throw new IndexConflictError(
        transient ? INDEX_REVISION_UNAVAILABLE_MESSAGE : INDEX_CONFLICT_MESSAGE,
        transient,
        cause,
      );
    }

    if (result.ids.length > 0) {
      this.setKnownIndex(result.ids, result.texts, result.chunks);
      const maxId = result.ids.reduce((max, id) => Math.max(max, id), 0);
      if (maxId > 0) useFileStore.getState().setLastIndexMsgId(maxId);
    } else {
      this.known = null;
      this.committedState = [];
    }
    const zero = result.chunks.find((chunk) => chunk.chunkIndex === 0);
    if (zero?.e2ee) this.vaultMetadata = zero.e2ee;

    const authoritative = filterDeletedMessages(
      this.channelId,
      result.files,
    );
    const mutation = this.buildMutation(base, state);
    const storeBeforeApply = useFileStore.getState().files;
    let merged: TeleFile[];
    try {
      merged = this.applyMutation(authoritative, mutation);
    } catch (err) {
      // The mutation is no longer applicable. Refresh the UI anyway so the
      // next action is built on the authoritative catalog instead of stale
      // local entries.
      const store = useFileStore.getState();
      if (
        store.files === storeBeforeApply &&
        canReplaceLocalState({ allowQueueSaving: true })
      ) {
        store.setFiles(authoritative);
      }
      throw err;
    }

    // A local action may have started while discovery was in flight.
    if (!canReplaceLocalState({ allowQueueSaving: true })) {
      throw new IndexConflictError(INDEX_CONFLICT_MESSAGE, false, cause);
    }
    this.recoveryStoreUpdate = {
      expected: useFileStore.getState().files,
      files: merged,
    };
    await this.log(
      `INDEX_CONFLICT_RECOVERED added=${mutation.added.length} removed=${mutation.removed.size} modified=${mutation.modified.length}`,
    );
    return { state: merged, base: authoritative };
  }

  /** Replaces the stale optimistic store list only if nothing newer landed. */
  private finishRecoveryStoreUpdate(committed: TeleFile[]): void {
    const update = this.recoveryStoreUpdate;
    this.recoveryStoreUpdate = null;
    if (!update) return;
    const store = useFileStore.getState();
    if (store.files === update.expected) {
      store.setFiles(committed);
    }
    const maxId = (this.known?.ids ?? []).reduce(
      (max, id) => Math.max(max, id),
      0,
    );
    if (maxId > 0) store.setLastIndexMsgId(maxId);
  }

  private buildMutation(
    base: TeleFile[],
    next: TeleFile[],
  ): {
    base: Map<string, TeleFile>;
    removed: Set<string>;
    added: TeleFile[];
    modified: Array<{ before: TeleFile; after: TeleFile }>;
  } {
    const baseById = new Map(base.map((file) => [file.id, file]));
    const nextById = new Map(next.map((file) => [file.id, file]));
    const removed = new Set<string>();
    for (const id of baseById.keys()) {
      if (!nextById.has(id)) removed.add(id);
    }
    const added: TeleFile[] = [];
    for (const [id, file] of nextById) {
      if (!baseById.has(id)) added.push(file);
    }
    const modified: Array<{ before: TeleFile; after: TeleFile }> = [];
    for (const [id, after] of nextById) {
      const before = baseById.get(id);
      if (!before) continue;
      if (canonicalJson(before) !== canonicalJson(after)) {
        modified.push({ before, after });
      }
    }
    return { base: baseById, removed, added, modified };
  }

  private applyMutation(
    authoritative: TeleFile[],
    mutation: ReturnType<ChannelQueue["buildMutation"]>,
  ): TeleFile[] {
    const byId = new Map<string, TeleFile>();
    for (const file of authoritative) {
      if (mutation.removed.has(file.id)) continue;
      byId.set(file.id, file);
    }

    for (const { before, after } of mutation.modified) {
      const existing = byId.get(after.id);
      if (!existing) {
        throw new IndexConflictError(INDEX_CONFLICT_MESSAGE, false);
      }
      const merged: TeleFile = { ...existing };
      // Field-level patch keeps unrelated remote updates (e.g. a star from
      // the other device) instead of replacing the whole entry.
      const target = merged as unknown as Record<string, unknown>;
      for (const key of Object.keys(after) as Array<keyof TeleFile>) {
        if (canonicalJson(before[key]) !== canonicalJson(after[key])) {
          target[key as string] = after[key];
        }
      }
      for (const key of Object.keys(before) as Array<keyof TeleFile>) {
        if (!(key in after)) delete target[key as string];
      }
      byId.set(after.id, merged);
    }

    for (const file of mutation.added) {
      const existing = byId.get(file.id);
      if (!existing) {
        byId.set(file.id, file);
        continue;
      }
      if (canonicalJson(existing) === canonicalJson(file)) continue;
      // Deterministic folder ids collide when both devices create the same
      // folder path; that is the same collection, not a lost update.
      if (
        isIndexFolder(existing) &&
        isIndexFolder(file) &&
        indexPathOf(existing) === indexPathOf(file)
      ) {
        continue;
      }
      throw new IndexConflictError(INDEX_CONFLICT_MESSAGE, false);
    }

    const merged = Array.from(byId.values());
    this.validateMutationPaths(merged, mutation);
    return merged;
  }

  private validateMutationPaths(
    merged: TeleFile[],
    mutation: ReturnType<ChannelQueue["buildMutation"]>,
  ): void {
    const byId = new Map(merged.map((file) => [file.id, file]));
    const touched: Array<{ id: string; pathChanged: boolean }> = [];
    for (const file of mutation.added) {
      touched.push({ id: file.id, pathChanged: true });
    }
    for (const { before, after } of mutation.modified) {
      touched.push({
        id: after.id,
        pathChanged:
          normalizeFolderPath(before.folderPath) !==
            normalizeFolderPath(after.folderPath) ||
          before.name !== after.name,
      });
    }

    for (const { id, pathChanged } of touched) {
      const entry = byId.get(id);
      if (!entry) continue;
      const path = indexPathOf(entry);
      const parent = indexPathParent(path);
      if (parent !== "/" && !indexFolderExists(merged, parent)) {
        throw new IndexConflictError(INDEX_CONFLICT_MESSAGE, false);
      }
      if (!pathChanged) continue;
      for (const other of merged) {
        if (other.id === id) continue;
        if (indexPathOf(other) !== path) continue;
        const baseOther = mutation.base.get(other.id);
        // A duplicate that already existed locally is allowed; a path that
        // appeared or moved on the remote side is a real conflict.
        if (!baseOther || indexPathOf(baseOther) !== path) {
          throw new IndexConflictError(INDEX_CONFLICT_MESSAGE, false);
        }
      }
    }
  }

  /** Live chunk texts for `ids`; throws so callers decide fail-closed semantics. */
  private async fetchLiveTexts(
    client: any,
    peer: any,
    ids: number[],
  ): Promise<Map<number, string>> {
    const messages = await withTimeout(
      client.getMessages(peer, { ids }),
      REVISION_CHECK_TIMEOUT_MS,
      "client.getMessages(index revision guard)",
    );
    if (!Array.isArray(messages)) {
      throw new Error("Index revision check returned no message list");
    }
    const live = new Map<number, string>();
    for (const message of messages) {
      const id = Number(message?.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      const text = message?.text ?? message?.message;
      live.set(id, typeof text === "string" ? text : "");
    }
    return live;
  }

  private revisionMatches(
    known: KnownIndex,
    live: Map<number, string>,
  ): boolean {
    for (let i = 0; i < known.ids.length; i++) {
      const text = live.get(known.ids[i]);
      if (text === undefined) return false;
      const knownText = known.texts[i];
      if (typeof knownText === "string" && knownText.length > 0) {
        if (text !== knownText) return false;
        continue;
      }
      const parsed = parseIndexMessage({ id: known.ids[i], text });
      if (!parsed || parsed.savedAt !== known.savedAt[i]) return false;
    }
    return true;
  }

  private async probeLiveRevision(
    client: any,
    peer: any,
  ): Promise<"current" | "stale" | "unavailable"> {
    const known = this.known;
    if (!known || known.ids.length === 0) return "current";
    try {
      const live = await this.fetchLiveTexts(client, peer, known.ids);
      return this.revisionMatches(known, live) ? "current" : "stale";
    } catch {
      return "unavailable";
    }
  }

  /**
   * Commit-time guard. Fails closed: a revision that cannot be read is treated
   * as a conflict, never as "unchanged".
   */
  private async assertLiveRevision(client: any, peer: any): Promise<void> {
    const verdict = await this.probeLiveRevision(client, peer);
    if (verdict === "current") return;
    throw new IndexConflictError(
      INDEX_CONFLICT_MESSAGE,
      verdict === "unavailable",
    );
  }

  /** Detects a remote write that landed after our pre-check but before/at ours. */
  private async assertWriteLanded(
    client: any,
    peer: any,
    id: number,
    text: string,
  ): Promise<void> {
    let live: Map<number, string>;
    try {
      live = await this.fetchLiveTexts(client, peer, [id]);
    } catch (err) {
      throw new IndexConflictError(INDEX_REVISION_UNAVAILABLE_MESSAGE, true, err);
    }
    if (live.get(id) !== text) {
      throw new IndexConflictError(INDEX_CONFLICT_MESSAGE, false);
    }
  }

  /**
   * WebDAV pre-write check: probe the live revision and, if another device
   * committed, refresh the authoritative snapshot before any bytes move.
   */
  async ensureFreshForWrite(): Promise<"current" | "refreshed"> {
    const client = getClient();
    const peer = await resolvePeerWithTimeout(client, this.channelId);
    const verdict = await this.probeLiveRevision(client, peer);
    if (verdict === "current") return "current";
    if (verdict === "unavailable") {
      throw new IndexConflictError(INDEX_REVISION_UNAVAILABLE_MESSAGE, true);
    }
    if (!canReplaceLocalState()) {
      throw new IndexConflictError(INDEX_CONFLICT_MESSAGE, false);
    }

    let result;
    try {
      result = await discoverIndex(this.channelId);
    } catch (err) {
      throw new IndexConflictError(INDEX_REVISION_UNAVAILABLE_MESSAGE, true, err);
    }
    if (result.status !== "ready") {
      const transient =
        result.reason === "timeout" || result.reason === "network";
      throw new IndexConflictError(
        transient ? INDEX_REVISION_UNAVAILABLE_MESSAGE : INDEX_CONFLICT_MESSAGE,
        transient,
      );
    }
    if (result.ids.length > 0) {
      this.setKnownIndex(result.ids, result.texts, result.chunks);
      const maxId = result.ids.reduce((max, id) => Math.max(max, id), 0);
      if (maxId > 0) useFileStore.getState().setLastIndexMsgId(maxId);
    } else {
      this.known = null;
      this.committedState = [];
    }
    const authoritative = filterDeletedMessages(
      this.channelId,
      result.files,
    );
    const store = useFileStore.getState();
    const before = store.files;
    if (!catalogsEqual(authoritative, before)) {
      if (store.files !== before) {
        // Another optimistic action won the race; never let the WebDAV caller
        // build its mutation on the pre-refresh list.
        throw new IndexConflictError(INDEX_CONFLICT_MESSAGE, false);
      }
      store.setFiles(authoritative);
    }
    await this.log("INDEX_CONFLICT_PRECHECK_REFRESHED");
    return "refreshed";
  }

  private async commitAttempt(
    state: TeleFile[],
    allowDiscover = true
  ): Promise<void> {
    const client = getClient();
    const peer = await resolvePeerWithTimeout(client, this.channelId);

    if (!this.known && allowDiscover) {
      const result = await discoverIndex(this.channelId).catch(() => null);
      if (!result) {
        throw new IndexConflictError(INDEX_REVISION_UNAVAILABLE_MESSAGE, true);
      }
      if (result.status === "ready" && result.ids.length > 0) {
        this.setKnownIndex(result.ids, result.texts, result.chunks);
        // A live epoch existed before this writer's snapshot was built. Never
        // write the stale state over it; refresh the UI so the next action is
        // built on the authoritative catalog, then surface the conflict.
        const authoritative = filterDeletedMessages(
          this.channelId,
          result.files,
        );
        if (canReplaceLocalState({ allowQueueSaving: true })) {
          useFileStore.getState().setFiles(authoritative);
        }
        throw new IndexConflictError(INDEX_CONFLICT_MESSAGE, false);
      }
      if (
        result.status === "incomplete" &&
        (result.reason === "timeout" ||
          result.reason === "network" ||
          result.reason === "partial_manifest")
      ) {
        // The channel could not be read or its manifest was truncated. Do
        // not create a competing epoch from an unverified snapshot.
        throw new IndexConflictError(INDEX_REVISION_UNAVAILABLE_MESSAGE, true);
      }
    }

    const prevChunks = this.known?.texts.map((text, idx) =>
      text
        ? parseIndexMessage({ id: this.known!.ids[idx] || idx + 1, text })
            ?.files ?? []
        : []
    );
    const vaultBudget = this.vaultMetadata
      ? JSON.stringify(this.vaultMetadata).length
      : 0;
    const { chunks, manifestOmitted } =
      vaultBudget > 0
        ? packChunks(state, prevChunks, vaultBudget)
        : packChunks(state, prevChunks);
    const totalChunks = chunks.length;
    if (manifestOmitted) {
      await this.log(
        `INDEX_MANIFEST_OMITTED chunks=${totalChunks} files=${state.length}`
      );
    }
    const cache = this.known;
    const nextSavedAt = Math.max(Date.now(), (cache?.epoch ?? 0) + 1);

    if (!cache) {
      await this.sendAllNew(
        client,
        peer,
        chunks,
        nextSavedAt,
        manifestOmitted,
        state.length,
        this.recoveryOld
      );
      this.recoveryOld = null;
      return;
    }

    const sameCount = cache.ids.length === totalChunks;
    const changed = this.changedChunks(cache, chunks, totalChunks);

    // Nothing changed and a manifest is already present: no write needed.
    if (sameCount && changed.length === 0 && cache.hasManifest) return;

    // Fast path: exactly one changed chunk, stable count, manifest present.
    if (sameCount && cache.hasManifest && !manifestOmitted) {
      if (changed.length === 0) return;
      if (changed.length === 1) {
        const i = changed[0];
        const text =
          i === 0
            ? this.buildZeroText(
                chunks[0],
                totalChunks,
                nextSavedAt,
                cache.ids
              )
            : serializeChunk(
                chunkPayload(chunks[i], i, totalChunks, nextSavedAt)
              );
        if (text !== null) {
          await this.editChunk(
            client,
            peer,
            cache.ids[i],
            text,
            `fast chunk ${i}`
          );
          cache.texts[i] = text;
          cache.savedAt[i] = nextSavedAt;
          cache.epoch = Math.max(cache.epoch, nextSavedAt);
          await this.log(`INDEX_COMMIT_FAST chunk=${i} files=${state.length}`);
          return;
        }
        // Manifest unexpectedly no longer fits: fall through to COW.
      }
    }

    // Legacy/partial cache with at most one changed chunk: update the content
    // atomically, then edit chunk 0 to add the manifest. Unchanged chunks are
    // reused verbatim (never reserialized just to upgrade).
    if (sameCount && !cache.hasManifest && changed.length <= 1) {
      const idx = changed[0];
      if (idx !== undefined && idx !== 0) {
        const text = serializeChunk(
          chunkPayload(chunks[idx], idx, totalChunks, nextSavedAt)
        );
        await this.editChunk(
          client,
          peer,
          cache.ids[idx],
          text,
          `legacy chunk ${idx}`
        );
        cache.texts[idx] = text;
        cache.savedAt[idx] = nextSavedAt;
        cache.epoch = Math.max(cache.epoch, nextSavedAt);
      }
      const zeroText = this.buildZeroText(
        chunks[0],
        totalChunks,
        nextSavedAt,
        cache.ids
      );
      if (zeroText !== null) {
        try {
          await this.editChunk(
            client,
            peer,
            cache.ids[0],
            zeroText,
            "legacy manifest"
          );
        } catch (err) {
          // The content edit (if any) is coherent as a legacy epoch; retry
          // the upgrade on the next save.
          await this.log(`INDEX_MANIFEST_UPGRADE_FAIL reason=${errMsg(err)}`);
          throw err;
        }
        cache.texts[0] = zeroText;
        cache.savedAt[0] = nextSavedAt;
        cache.epoch = Math.max(cache.epoch, nextSavedAt);
        cache.hasManifest = true;
        await this.log(
          `INDEX_MANIFEST_OK chunks=${totalChunks} files=${state.length}`
        );
        return;
      }
      // Manifest cannot fit: full COW without a manifest (below).
    }

    await this.structuralCommit(
      client,
      peer,
      chunks,
      nextSavedAt,
      manifestOmitted,
      state.length
    );
  }

  private changedChunks(
    cache: KnownIndex,
    chunks: TeleFile[][],
    totalChunks: number
  ): number[] {
    const changed: number[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const text = cache.texts[i];
      if (!text || cache.ids[i] == null) {
        changed.push(i);
        continue;
      }
      const parsed = parseIndexMessage({ id: cache.ids[i], text });
      if (
        !parsed ||
        parsed.chunkIndex !== i ||
        parsed.totalChunks !== totalChunks ||
        canonicalJson(parsed.files) !== canonicalJson(chunks[i]) ||
        (i === 0 &&
          canonicalJson(parsed.e2ee ?? null) !==
            canonicalJson(this.vaultMetadata ?? null))
      ) {
        changed.push(i);
      }
    }
    return changed;
  }

  private buildZeroText(
    files: TeleFile[],
    totalChunks: number,
    savedAt: number,
    ids: number[]
  ): string | null {
    if (ids.length !== totalChunks) return null;
    const text = serializeChunk({
      ...chunkPayload(files, 0, totalChunks, savedAt, this.vaultMetadata),
      chunkMsgIds: ids.slice(1),
    });
    if (text.length > TELEGRAM_TEXT_LIMIT) return null;
    return text;
  }

  private async structuralCommit(
    client: any,
    peer: any,
    chunks: TeleFile[][],
    savedAt: number,
    manifestOmitted: boolean,
    fileCount: number
  ): Promise<void> {
    await this.log(
      `INDEX_COMMIT_STRUCTURAL chunks=${chunks.length} files=${fileCount} manifest=${manifestOmitted ? 0 : 1}`
    );
    const cache = this.known;
    if (!cache) {
      await this.sendAllNew(
        client,
        peer,
        chunks,
        savedAt,
        manifestOmitted,
        fileCount,
        null
      );
      return;
    }

    const totalChunks = chunks.length;
    const sameCount = cache.ids.length === totalChunks;
    const changed = this.changedChunks(cache, chunks, totalChunks);

    // Above the manifest bound a partial write would reintroduce mixed epochs.
    if (manifestOmitted) {
      await this.sendAllNew(
        client,
        peer,
        chunks,
        savedAt,
        true,
        fileCount,
        cache
      );
      return;
    }

    const ids: number[] = [cache.ids[0]];
    const texts: string[] = Array.from({ length: totalChunks });
    const savedAts: number[] = Array.from({ length: totalChunks }, () => 0);
    texts[0] = cache.texts[0] ?? "";
    savedAts[0] = cache.savedAt[0] ?? 0;
    const orphans: number[] = [];

    for (let i = 1; i < totalChunks; i++) {
      const reuse =
        sameCount && cache.ids[i] != null && !changed.includes(i);
      if (reuse) {
        ids.push(cache.ids[i]);
        texts[i] = cache.texts[i];
        savedAts[i] = cache.savedAt[i];
        continue;
      }
      const text = serializeChunk(
        chunkPayload(chunks[i], i, totalChunks, savedAt)
      );
      await sleep(CHUNK_SEND_DELAY_MS);
      try {
        const id = await this.sendChunk(client, peer, text, `new chunk ${i}`);
        ids.push(id);
        orphans.push(id);
        texts[i] = text;
        savedAts[i] = savedAt;
      } catch (err) {
        await this.logOrphans(orphans);
        throw err;
      }
    }

    const zeroText = this.buildZeroText(chunks[0], totalChunks, savedAt, ids);
    if (zeroText === null) {
      // The manifest outgrew its budget: send a complete new set instead of
      // writing a no-manifest structural epoch.
      await this.logOrphans(orphans);
      await this.sendAllNew(
        client,
        peer,
        chunks,
        savedAt,
        true,
        fileCount,
        cache
      );
      return;
    }

    try {
      await this.editChunk(
        client,
        peer,
        cache.ids[0],
        zeroText,
        "chunk 0 commit"
      );
    } catch (err) {
      // Old chunk 0 is intact; new chunks are harmless orphans.
      await this.logOrphans(orphans);
      throw err;
    }

    // Commit point passed. Cache the new epoch, then clean up what it replaced.
    const oldIds = cache.ids;
    texts[0] = zeroText;
    savedAts[0] = savedAt;
    this.known = {
      ids,
      texts,
      savedAt: savedAts,
      epoch: Math.max(cache.epoch, savedAt),
      hasManifest: true,
    };
    this.deleteUnreferenced(client, peer, oldIds, ids);
    await this.log(
      `INDEX_COMMIT_STRUCTURAL_OK chunks=${totalChunks} files=${fileCount} new=${orphans.length}`
    );
  }

  /**
   * Full copy-on-write: send every chunk as a new message (chunk 0 last),
   * delete the old set after the new chunk 0 exists, and repin best-effort.
   * This is the no-cache path and the above-manifest-bound path.
   */
  private async sendAllNew(
    client: any,
    peer: any,
    chunks: TeleFile[][],
    savedAt: number,
    manifestOmitted: boolean,
    fileCount: number,
    old: KnownIndex | null
  ): Promise<void> {
    const totalChunks = chunks.length;
    const ids: number[] = Array.from({ length: totalChunks }, () => 0);
    const texts: string[] = Array.from({ length: totalChunks });
    const savedAts: number[] = Array.from({ length: totalChunks }, () => savedAt);
    const orphans: number[] = [];

    for (let i = 1; i < totalChunks; i++) {
      const text = serializeChunk(
        chunkPayload(chunks[i], i, totalChunks, savedAt)
      );
      if (i > 1) await sleep(CHUNK_SEND_DELAY_MS);
      try {
        const id = await this.sendChunk(client, peer, text, `chunk ${i}`);
        ids[i] = id;
        texts[i] = text;
        orphans.push(id);
      } catch (err) {
        await this.logOrphans(orphans);
        throw err;
      }
    }

    let zeroText: string | null = null;
    let hasManifest = false;
    if (!manifestOmitted) {
      zeroText = this.buildZeroText(chunks[0], totalChunks, savedAt, ids);
      hasManifest = zeroText !== null;
    }
    if (zeroText === null) {
      zeroText = serializeChunk(
        chunkPayload(chunks[0], 0, totalChunks, savedAt, this.vaultMetadata)
      );
      if (zeroText.length > TELEGRAM_TEXT_LIMIT) {
        await this.logOrphans(orphans);
        throw new Error("Index chunk 0 exceeds Telegram's text limit");
      }
    }

    if (totalChunks > 1) await sleep(CHUNK_SEND_DELAY_MS);
    try {
      ids[0] = await this.sendChunk(client, peer, zeroText, "chunk 0");
      texts[0] = zeroText;
    } catch (err) {
      await this.logOrphans(orphans);
      throw err;
    }

    this.known = {
      ids,
      texts,
      savedAt: savedAts,
      epoch: Math.max(0, savedAt),
      hasManifest,
    };
    this.pinChunk(client, peer, ids[0]);
    if (old) this.deleteUnreferenced(client, peer, old.ids, ids);
    this.recoveryOld = null;
    await this.log(
      `INDEX_COMMIT_COW_OK chunks=${totalChunks} files=${fileCount} manifest=${hasManifest ? 1 : 0}`
    );
  }

  /** Fire-and-forget delete of messages no longer part of the live epoch. */
  private deleteUnreferenced(
    client: any,
    peer: any,
    oldIds: number[],
    newIds: number[]
  ): void {
    const keep = new Set(newIds);
    const toDelete = oldIds.filter((id) => !keep.has(id));
    if (toDelete.length === 0) return;
    client
      .deleteMessages(peer, toDelete, { revoke: true })
      .then(() =>
        this.log(`INDEX_DELETE_OLD_OK count=${toDelete.length}`)
      )
      .catch((err: any) =>
        this.log(`INDEX_DELETE_OLD_FAIL reason=${errMsg(err)}`)
      );
  }

  private pinChunk(client: any, peer: any, id: number): void {
    client
      .invoke(
        new Api.messages.UpdatePinnedMessage({
          peer,
          id,
          unpin: false,
          silent: true,
        })
      )
      .catch((err: any) => this.log(`INDEX_PIN_FAIL reason=${errMsg(err)}`));
  }

  private async logOrphans(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.log(`INDEX_ORPHANS ids=[${ids.join(",")}]`);
  }

  /**
   * Retry the SAME RPC once on a timeout. Never trigger a delete/resend here:
   * a timed-out send may still have landed, so a retry can at worst create a
   * harmless orphan, never a corrupted epoch.
   */
  private async rpc<T>(fn: () => Promise<T>, label: string): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      if (!isTimeoutError(err)) throw err;
      await this.log(`INDEX_RPC_TIMEOUT_RETRY label=${label}`);
      return await fn();
    }
  }

  private async editChunk(
    client: any,
    peer: any,
    id: number,
    text: string,
    label: string
  ): Promise<void> {
    await this.assertLiveRevision(client, peer);
    try {
      await this.rpc(
        () =>
          withTimeout(
            client.editMessage(peer, { message: id, text }),
            EDIT_TIMEOUT_MS,
            `editMessage(${label})`
          ),
        label
      );
    } catch (err: any) {
      if (!/MESSAGE_NOT_MODIFIED/i.test(errMsg(err))) throw err;
    }
    await this.assertWriteLanded(client, peer, id, text);
  }

  private async sendChunk(
    client: any,
    peer: any,
    text: string,
    label: string
  ): Promise<number> {
    await this.assertLiveRevision(client, peer);
    const result = await this.rpc(
      () =>
        withTimeout(
          client.sendMessage(peer, { message: text }),
          EDIT_TIMEOUT_MS,
          `sendMessage(${label})`
        ),
      label
    );
    const id = Number((result as any).id);
    await this.assertWriteLanded(client, peer, id, text);
    return id;
  }

  private async log(state: string): Promise<void> {
    await logVaultState(state);
  }
}

function errMsg(err: any): string {
  return typeof err === "string" ? err : err?.message ?? String(err);
}

function isTimeoutError(err: any): boolean {
  return /Timeout of .* exceeded/i.test(errMsg(err));
}

function isMissingMessageError(err: any): boolean {
  return /MSG_ID_INVALID|MESSAGE_ID_INVALID|MESSAGE_NOT_FOUND|MESSAGE_EMPTY|MESSAGE_DELETE/i.test(
    errMsg(err)
  );
}

function catalogsEqual(a: TeleFile[], b: TeleFile[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const bById = new Map(b.map((file) => [file.id, file]));
  for (const file of a) {
    const other = bById.get(file.id);
    if (!other || canonicalJson(file) !== canonicalJson(other)) return false;
  }
  return true;
}

function isIndexFolder(file: Pick<TeleFile, "mime">): boolean {
  return file.mime === "inode/directory" || file.mime === "application/x-directory";
}

function indexPathOf(file: Pick<TeleFile, "folderPath" | "name">): string {
  const parent = normalizeFolderPath(file.folderPath);
  return parent === "/" ? `/${file.name}` : `${parent}/${file.name}`;
}

function indexPathParent(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index <= 0 ? "/" : trimmed.slice(0, index);
}

/** Treats implicit folders (a path that only exists via descendants) as present. */
function indexFolderExists(files: TeleFile[], path: string): boolean {
  const normalized = normalizeFolderPath(path);
  if (normalized === "/") return true;
  for (const file of files) {
    const fullPath = indexPathOf(file);
    if (fullPath === normalized && isIndexFolder(file)) return true;
    if (fullPath.startsWith(`${normalized}/`)) return true;
  }
  return false;
}

function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function chunkPayload(
  files: TeleFile[],
  chunkIndex: number,
  totalChunks: number,
  savedAt: number,
  e2ee?: RemoteVaultMetadata
) {
  return {
    teledrive_index: true as const,
    version: 3,
    chunkIndex,
    totalChunks,
    savedAt,
    ...(chunkIndex === 0 && e2ee ? { e2ee } : {}),
    files,
  };
}

async function resolvePeerWithTimeout(client: any, channelId: string): Promise<any> {
  const id = canonicalChannelId(channelId);
  try {
    return await client.getInputEntity(id);
  } catch {
    return await withTimeout(
      client.getEntity(id),
      5000,
      "client.getEntity"
    );
  }
}

const queues: Map<string, ChannelQueue> = new Map();

/**
 * Returns the queue for the given channel, creating it on first use.
 */
export function getIndexQueue(channelId: string): ChannelQueue {
  let q = queues.get(channelId);
  if (!q) {
    q = new ChannelQueue(channelId);
    queues.set(channelId, q);
  }
  return q;
}

/**
 * Public API used by useFileActions and uploadManager.
 *
 * Resolves once the state has been durably written to Telegram.
 * Rejects with the original error if the write failed terminally (hard error).
 */
export function enqueueSave(
  channelId: string,
  state: TeleFile[],
  options: EnqueueOptions = {}
): Promise<void> {
  if (!isIndexReady()) {
    return Promise.reject(new IndexNotReadyError());
  }
  return getIndexQueue(channelId).enqueue(state, options);
}

/**
 * WebDAV mutations: resolve only after the state containing this change is
 * committed, even if a newer snapshot supersedes this entry.
 */
export function enqueueSaveDurable(
  channelId: string,
  state: TeleFile[],
  options: Omit<EnqueueOptions, "durable"> = {},
): Promise<void> {
  return enqueueSave(channelId, state, { ...options, durable: true });
}

/**
 * The only write allowed while discovery is incomplete. Used exclusively by
 * the explicit recovery-replace path (a complete candidate set chosen by the
 * user), never by normal user actions.
 */
export function enqueueSaveDuringRecovery(channelId: string, state: TeleFile[]): Promise<void> {
  return getIndexQueue(channelId).enqueue(state, { recordPending: false });
}

/**
 * Flush all queues (used on logout). Commits the latest state of each queue
 * with a 15s bound before clearing them; failures are returned for logging.
 */
export async function flushAllQueues(): Promise<
  Array<{ channelId: string; status: "committed" | "empty" | "failed"; error?: any }>
> {
  const results = await Promise.all(
    Array.from(queues.entries()).map(async ([channelId, q]) => ({
      channelId,
      ...(await q.flush()),
    }))
  );
  // Keep failed queues (and their stuck state) alive so a manual retry in the
  // same session can still commit them. Successful/empty ones are done.
  for (const result of results) {
    if (result.status !== "failed") queues.delete(result.channelId);
  }
  return results;
}

/**
 * WebDAV pre-write hook: verifies the live revision and refreshes the local
 * snapshot when another device committed first. Throws IndexConflictError
 * when that is impossible or unsafe; callers map it to 409/503.
 */
export async function ensureFreshIndexForWrite(
  channelId: string,
): Promise<"current" | "refreshed"> {
  if (!isIndexReady()) throw new IndexNotReadyError();
  return getIndexQueue(channelId).ensureFreshForWrite();
}

/** Milliseconds the channel queue is backing off (0 = writable now). */
export function getIndexBackoffMs(channelId: string): number {
  const queue = queues.get(channelId);
  return queue ? queue.remainingBackoffMs() : 0;
}

/** Force an immediate retry on a currently-failed/stuck queue. */
export function retryQueue(channelId: string): void {
  const q = queues.get(channelId);
  if (!q || !isIndexReady()) return;
  q.retryNow(useFileStore.getState().files);
}

/** Returns true if the channel's index queue is actively cooling down from a rate limit / retry. */
export function isChannelQueueRateLimited(channelId: string): boolean {
  const q = queues.get(channelId);
  return q ? q.isRateLimited() : false;
}

/** Test-only: inject a commit implementation for a channel. */
export function setCommitImplForTests(
  channelId: string,
  impl: ((state: TeleFile[]) => Promise<void>) | null
): void {
  getIndexQueue(channelId).setCommitImplForTests(impl);
}

/** Test-only: forget all channel queues. */
export function resetQueuesForTests(): void {
  queues.clear();
}
