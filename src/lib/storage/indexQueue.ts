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
import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { IndexNotReadyError, isIndexReady } from "../telegram/indexReadiness";

export { IndexNotReadyError } from "../telegram/indexReadiness";

export class IndexRetryExhaustedError extends Error {
  readonly code = "INDEX_RETRY_EXHAUSTED";

  constructor(message: string) {
    super(message);
    this.name = "IndexRetryExhaustedError";
  }
}

import type { TeleFile } from "../types";
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
  /** Resolve handler for the caller of `enqueue`. */
  resolve: () => void;
  reject: (err: any) => void;
  /** Whether this entry owns the pending-index marker. */
  recordPending: boolean;
}

interface EnqueueOptions {
  /**
   * Write the pending marker + flush the file cache. Internal maintenance
   * writes (healing) pass false so they never masquerade as a user action.
   */
  recordPending?: boolean;
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
  private commitOverride: ((state: TeleFile[]) => Promise<void>) | null = null;
  private readonly channelId: string;

  /**
   * Cached ids/texts of the live index on Telegram. Lets saves diff chunks and
   * only rewrite what actually changed, without querying Telegram first.
   */
  private known: KnownIndex | null = null;
  /** Old epoch retained across a hard-error recovery so COW can clean it up. */
  private recoveryOld: KnownIndex | null = null;

  constructor(channelId: string) {
    this.channelId = channelId;
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

  private commit(state: TeleFile[]): Promise<void> {
    return this.commitOverride ? this.commitOverride(state) : this.commitOnce(state);
  }

  enqueue(state: TeleFile[], options: EnqueueOptions = {}): Promise<void> {
    // Record the uncommitted state before anything async can fail. The file
    // cache is flushed synchronously so a crash between here and the Telegram
    // commit still leaves a complete optimistic snapshot on disk.
    const recordPending = options.recordPending ?? true;
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
      // Resolve superseded pending and retrying entries: their callers were
      // waiting on a snapshot that has been replaced, and leaving them
      // unresolved leaks every action that overlaps a retry.
      if (this.pending) this.pending.resolve();
      if (this.retryingEntry) this.retryingEntry.resolve();
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
        this.retryAttempt = 0;
        this.lastError = null;
      }

      this.pending = {
        state,
        resolve,
        reject,
        recordPending,
      };
      // Mirror the latest pending state to the store snapshot too — this is
      // what surfaces in the topbar's "Retrying" pill.
      this.updateStoreState();

      // Respect an active FLOOD_WAIT/backoff window: the timer will drain the
      // latest pending state when it fires instead of hammering Telegram now.
      if (this.retryTimer || this.inflight) return;
      void this.drain();
    });
  }

  /**
   * Force the latest state out, bounded at 15s. Used on logout/shutdown.
   * Failed flushes keep the state in `stuckEntry` (and keep the cached
   * Telegram ids/texts) so a later manual retry can still commit it.
   */
  async flush(): Promise<{ status: "committed" | "empty" | "failed"; error?: any }> {
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
      await withTimeout(this.commit(entry.state), 15_000, "indexQueue.flush");
      entry.resolve();
      this.successCount++;
      this.retryAttempt = 0;
      this.lastError = null;
      this.clearMarkerIfSettled(entry);
      this.updateStoreState();
      return { status: "committed" };
    } catch (err) {
      this.lastError = err;
      this.stuckEntry = entry;
      entry.reject(err);
      this.updateStoreState();
      return { status: "failed", error: err };
    }
  }

  private clearMarkerIfSettled(entry: QueueEntry): void {
    if (!entry.recordPending) return;
    if (this.pending || this.retryingEntry || this.stuckEntry) return;
    clearPendingMarker(this.channelId);
  }

  private clearTimers(): void {
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
            this.retryingEntry.resolve();
            this.retryingEntry = null;
          }
          const entry = this.pending ?? this.retryingEntry;
          if (!entry) break;
          this.pending = null;
          this.retryingEntry = null;
          this.lastError = null;
          this.updateStoreState();

          try {
            await this.commit(entry.state);
            entry.resolve();
            this.successCount++;
            this.retryAttempt = 0;
            this.clearMarkerIfSettled(entry);
          } catch (err: any) {
            this.lastError = err;
            if (isHardError(err)) {
              // Reject only this caller; a newer pending snapshot (if any)
              // still gets its turn.
              entry.reject(err);
              this.retryAttempt = 0;
              this.updateStoreState();
              continue;
            }
            this.retryingEntry = entry;
            this.scheduleRetry(err);
            return;
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
      void invoke("log_vault_state", {
        state: `INDEX_QUEUE_GIVE_UP retries=${MAX_TRANSIENT_RETRIES} last_err=${
          err?.message ?? String(err)
        }`,
      }).catch(() => {});
      if (this.retryingEntry) {
        // Keep the newest state instead of dropping it. The caller is
        // rejected so uploads/backups can pause, but the UI keeps the
        // optimistic state and a 60s/manual retry can still commit it.
        this.stuckEntry = this.retryingEntry;
        this.retryingEntry = null;
        this.stuckEntry.reject(wrapped);
      }
      this.retryAttempt = 0;
      this.lastError = wrapped;
      this.scheduleStuckRetry();
      this.updateStoreState();
      return;
    }

    const delayMs = computeRetryDelay(this.retryAttempt, err);
    const deadline = Date.now() + delayMs;

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
    this.stuckTimer = setTimeout(() => {
      this.stuckTimer = null;
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
  private async commitOnce(state: TeleFile[]): Promise<void> {
    try {
      await this.commitAttempt(state);
    } catch (err: any) {
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
        await this.commitAttempt(state, false);
        return;
      }
      // No live chunk 0 (or discovery unavailable): send a complete new set
      // and move the pin. Skip a second discovery attempt.
      await this.commitAttempt(state, false);
    }
  }

  private async commitAttempt(
    state: TeleFile[],
    allowDiscover = true
  ): Promise<void> {
    const client = getClient();
    const peer = await resolvePeerWithTimeout(client, this.channelId);

    if (!this.known && allowDiscover) {
      const result = await discoverIndex(this.channelId).catch(() => null);
      if (result && result.status === "ready" && result.ids.length > 0) {
        this.setKnownIndex(result.ids, result.texts, result.chunks);
      }
    }

    const { chunks, manifestOmitted } = packChunks(state);
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
        canonicalJson(parsed.files) !== canonicalJson(chunks[i])
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
      ...chunkPayload(files, 0, totalChunks, savedAt),
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
      zeroText = serializeChunk(chunkPayload(chunks[0], 0, totalChunks, savedAt));
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
      if (/MESSAGE_NOT_MODIFIED/i.test(errMsg(err))) return;
      throw err;
    }
  }

  private async sendChunk(
    client: any,
    peer: any,
    text: string,
    label: string
  ): Promise<number> {
    const result = await this.rpc(
      () =>
        withTimeout(
          client.sendMessage(peer, { message: text }),
          EDIT_TIMEOUT_MS,
          `sendMessage(${label})`
        ),
      label
    );
    return Number((result as any).id);
  }

  private async log(state: string): Promise<void> {
    await invoke("log_vault_state", { state }).catch(() => {});
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
  savedAt: number
) {
  return {
    teledrive_index: true as const,
    version: 3,
    chunkIndex,
    totalChunks,
    savedAt,
    files,
  };
}

async function resolvePeerWithTimeout(client: any, channelId: string): Promise<any> {
  try {
    return await client.getInputEntity(channelId);
  } catch {
    return await withTimeout(
      client.getEntity(channelId),
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

/** Force an immediate retry on a currently-failed/stuck queue. */
export function retryQueue(channelId: string): void {
  const q = queues.get(channelId);
  if (!q || !isIndexReady()) return;
  q.retryNow(useFileStore.getState().files);
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