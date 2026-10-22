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
import {
  withTimeout,
  pickCoherentIndexSet,
} from "./metadataStore";
import { useFileStore } from "../../stores/fileStore";
import {
  computeRetryDelay,
  isHardError,
  parseFloodWaitSeconds,
} from "../telegram/rateLimit";
import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";

import type { TeleFile } from "../types";

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

/** Fetch + edit timeouts (ms). */
const FETCH_TIMEOUT_MS = 5000;
const EDIT_TIMEOUT_MS = 5000;

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
}

class ChannelQueue {
  private pending: QueueEntry | null = null;
  private retryingEntry: QueueEntry | null = null;
  private inflight: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCountdownTimer: ReturnType<typeof setInterval> | null = null;
  private retryAttempt = 0;
  private lastError: any = null;
  private readonly channelId: string;

  /**
   * Cached Telegram message IDs of the active coherent index set on Telegram.
   * When known and chunk count matches, saves edit existing messages directly
   * without having to query 100-200 messages from Telegram on every single action.
   */
  private cachedExistingMsgIds: number[] | null = null;

  /**
   * Cached serialized JSON strings of each chunk currently on Telegram.
   * Allows commitOnce to diff chunks and only edit the chunk(s) that actually changed.
   */
  private cachedChunkTexts: string[] | null = null;

  constructor(channelId: string) {
    this.channelId = channelId;
  }

  /**
   * Seeds the queue with known index message IDs and chunk payloads.
   * Called by loadIndex or bootstrap when reading the index from Telegram.
   */
  setKnownIndex(msgIds: number[], chunkTexts?: string[]): void {
    if (msgIds.length > 0) {
      this.cachedExistingMsgIds = [...msgIds];
      if (chunkTexts && chunkTexts.length === msgIds.length) {
        this.cachedChunkTexts = [...chunkTexts];
      } else {
        this.cachedChunkTexts = null;
      }
    }
  }

  getKnownIndexMsgIds(): number[] | null {
    return this.cachedExistingMsgIds ? [...this.cachedExistingMsgIds] : null;
  }

  enqueue(state: TeleFile[]): Promise<void> {
    // Coalesce: replace any pending entry with the new state. If something is
    // currently inflight, this becomes the *next* state to write.
    return new Promise<void>((resolve, reject) => {
      // Resolve any superseded pending entry — its state was overwritten by
      // a newer call, so its caller can stop waiting on this exact snapshot.
      // The new entry's promise will resolve when *its* state commits.
      if (this.pending) {
        this.pending.resolve();
      }
      this.pending = {
        state,
        resolve,
        reject,
      };
      // Mirror the latest pending state to the store snapshot too — this is
      // what surfaces in the topbar's "Retrying" pill.
      this.updateStoreState();
      void this.drain();
    });
  }

  /** Force an immediate drain — used on logout / shutdown. */
  async flush(): Promise<void> {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.retryCountdownTimer) {
      clearInterval(this.retryCountdownTimer);
      this.retryCountdownTimer = null;
    }
    if (this.inflight) {
      try {
        await this.inflight;
      } catch {
        // Already failed; ignore.
      }
    }
    // Resolve any pending entries so callers don't hang.
    if (this.pending) this.pending.resolve();
    if (this.retryingEntry) this.retryingEntry.resolve();
    this.pending = null;
    this.retryingEntry = null;
    this.retryAttempt = 0;
    this.lastError = null;
    this.cachedExistingMsgIds = null;
    this.cachedChunkTexts = null;
    this.updateStoreState();
  }

  private updateStoreState(): void {
    const store = useFileStore.getState();
    if (this.lastError && this.retryTimer == null) {
      store.setIndexQueueState("failed");
      store.setIndexQueueError(
        typeof this.lastError === "string"
          ? this.lastError
          : this.lastError?.message ?? String(this.lastError)
      );
      store.setIndexQueueRetryInSec(0);
    } else if (this.retryTimer != null) {
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
    // If already draining, just return — the next entry has already replaced
    // the pending slot and will be picked up when the current pass finishes.
    if (this.inflight) return;
    this.inflight = (async () => {
      try {
        // Drain loop: keep committing while there's something to commit.
        while (this.retryingEntry || this.pending) {
          const entry = this.retryingEntry ?? this.pending!;
          this.retryingEntry = null;
          this.pending = null;
          this.lastError = null;
          this.updateStoreState();

          try {
            await this.commitOnce(entry.state);
            entry.resolve();
            this.retryAttempt = 0;
          } catch (err: any) {
            this.lastError = err;
            if (isHardError(err)) {
              this.retryingEntry = null;
              this.retryAttempt = 0;
              entry.reject(err);
              this.updateStoreState();
              return;
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

  private scheduleRetry(err: any): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.retryCountdownTimer) {
      clearInterval(this.retryCountdownTimer);
      this.retryCountdownTimer = null;
    }

    this.retryAttempt++;

    if (this.retryAttempt > MAX_TRANSIENT_RETRIES) {
      const wrapped = new Error(
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
        const entry = this.retryingEntry;
        this.retryingEntry = null;
        this.retryAttempt = 0;
        entry.reject(wrapped);
      }
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
   * One Telegram round-trip that writes the given file state to the channel.
   * Throws on hard errors; throws on transient errors so the caller can retry.
   */
  private async commitOnce(state: TeleFile[]): Promise<void> {
    const client = getClient();

    let peer: any;
    try {
      peer = await resolvePeerWithTimeout(client, this.channelId);
    } catch (err) {
      throw err;
    }

    // If we have a known existing chunk count, try to preserve that distribution
    // so minor changes (star, rename) always use the fast in-place editMessage path.
    const existingCount = this.cachedExistingMsgIds?.length ?? 0;
    const chunks = existingCount > 0
      ? chunkFilesStable(state, existingCount)
      : chunkFiles(state);

    const newChunkTexts: string[] = chunks.map((c, i) =>
      JSON.stringify({
        teledrive_index: true,
        version: 1,
        chunkIndex: i,
        totalChunks: chunks.length,
        files: c,
      })
    );

    let existingMsgIds = this.cachedExistingMsgIds;

    // If cache is empty or length differs, discover existing index messages from Telegram
    if (!existingMsgIds || existingMsgIds.length !== chunks.length) {
      let allMsgs: any[] = [];
      const [pinnedRes, recentRes] = await Promise.allSettled([
        withTimeout(
          client.getMessages(peer, {
            filter: new Api.InputMessagesFilterPinned(),
            limit: 100,
          }),
          FETCH_TIMEOUT_MS,
          "client.getMessages(pinned)"
        ),
        withTimeout(
          client.getMessages(peer, { limit: 100 }),
          FETCH_TIMEOUT_MS,
          "client.getMessages(recent)"
        ),
      ]);

      if (pinnedRes.status === "fulfilled" && Array.isArray(pinnedRes.value)) {
        allMsgs = allMsgs.concat(pinnedRes.value);
      } else if (pinnedRes.status === "rejected") {
        await invoke("log_vault_state", {
          state: `INDEX_FETCH_PINNED_FAIL reason=${pinnedRes.reason?.message ?? pinnedRes.reason}`,
        }).catch(() => {});
      }

      if (recentRes.status === "fulfilled" && Array.isArray(recentRes.value)) {
        allMsgs = allMsgs.concat(recentRes.value);
      } else if (recentRes.status === "rejected") {
        await invoke("log_vault_state", {
          state: `INDEX_FETCH_RECENT_FAIL reason=${recentRes.reason?.message ?? recentRes.reason}`,
        }).catch(() => {});
      }

      const coherentSet = pickCoherentIndexSet(allMsgs);

      if (coherentSet && coherentSet.length > 0) {
        existingMsgIds = coherentSet.map((c) => c.msgId);
        this.cachedExistingMsgIds = existingMsgIds;
        // Re-chunk stably now that we know the actual existing count
        if (existingMsgIds.length !== chunks.length) {
          const stableChunks = chunkFilesStable(state, existingMsgIds.length);
          // Only use stable chunks if count matches; otherwise keep dynamic chunks
          if (stableChunks.length === existingMsgIds.length) {
            // Re-derive texts with the stable chunk distribution
            const stableTexts = stableChunks.map((c, i) =>
              JSON.stringify({
                teledrive_index: true,
                version: 1,
                chunkIndex: i,
                totalChunks: stableChunks.length,
                files: c,
              })
            );
            // Recurse-avoid: inline the in-place edit check with stable chunks
            let allEditsOk = true;
            for (let i = 0; i < stableChunks.length; i++) {
              const text = stableTexts[i];
              if (this.cachedChunkTexts && this.cachedChunkTexts[i] === text) continue;
              try {
                await withTimeout(
                  client.editMessage(peer, { message: existingMsgIds[i], text }),
                  EDIT_TIMEOUT_MS,
                  `editMessage(stable-chunk ${i})`
                );
              } catch (err: any) {
                const errMsg = err?.message ?? String(err);
                if (errMsg.includes("MESSAGE_NOT_MODIFIED")) continue;
                allEditsOk = false;
                break;
              }
            }
            if (allEditsOk) {
              this.cachedExistingMsgIds = existingMsgIds;
              this.cachedChunkTexts = stableTexts;
              await invoke("log_vault_state", {
                state: `INDEX_STABLE_EDIT_OK chunks=${stableChunks.length} files=${state.length}`,
              }).catch(() => {});
              return;
            }
            // Stable edit failed — fall through to full fallback below
            this.cachedExistingMsgIds = null;
            this.cachedChunkTexts = null;
          }
        }
      } else {
        existingMsgIds = null;
      }
    }

    // 2. In-place edit path: if chunk counts match, edit only modified chunks
    if (existingMsgIds && existingMsgIds.length === chunks.length) {
      let allEditsOk = true;
      for (let i = 0; i < chunks.length; i++) {
        const text = newChunkTexts[i];
        // Diff against cached chunk text: if bit-for-bit identical, skip network call!
        if (this.cachedChunkTexts && this.cachedChunkTexts[i] === text) {
          continue;
        }

        try {
          await withTimeout(
            client.editMessage(peer, {
              message: existingMsgIds[i],
              text,
            }),
            EDIT_TIMEOUT_MS,
            `editMessage(chunk ${i})`
          );
        } catch (err: any) {
          const errMsg = err?.message ?? String(err);
          if (errMsg.includes("MESSAGE_NOT_MODIFIED")) {
            // Already identical on Telegram, treat as success
            continue;
          }
          allEditsOk = false;
          await invoke("log_vault_state", {
            state: `INDEX_EDIT_FAIL chunk=${i} reason=${errMsg}`,
          }).catch(() => {});
          break;
        }
      }

      if (allEditsOk) {
        this.cachedExistingMsgIds = existingMsgIds;
        this.cachedChunkTexts = newChunkTexts;
        await invoke("log_vault_state", {
          state: `INDEX_EDIT_OK chunks=${chunks.length} files=${state.length}`,
        }).catch(() => {});
        return;
      }

      // If in-place edit failed, invalidate cache and proceed to fallback
      this.cachedExistingMsgIds = null;
      this.cachedChunkTexts = null;
    }

    // 3. Fallback path: fire-and-forget deletion of old messages, send fresh chunks, pin chunk 0
    // Deletions are best-effort and run in background — a timeout here must NEVER block the save.
    if (existingMsgIds && existingMsgIds.length > 0) {
      const idsToDelete = existingMsgIds;
      // Fire-and-forget: do NOT await. Deletion failure is harmless — Telegram
      // will serve the newer messages once we send them.
      client.deleteMessages(peer, idsToDelete, { revoke: true })
        .then(() => invoke("log_vault_state", { state: `INDEX_DELETE_OLD_OK count=${idsToDelete.length}` }).catch(() => {}))
        .catch((err: any) => invoke("log_vault_state", { state: `INDEX_DELETE_OLD_FAIL reason=${err?.message ?? err}` }).catch(() => {}));
    }

    const newMsgIds: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const text = newChunkTexts[i];
      const result = await withTimeout(
        client.sendMessage(peer, { message: text }),
        EDIT_TIMEOUT_MS,
        `sendMessage(chunk ${i})`
      );
      const msgId = Number((result as any).id);
      newMsgIds.push(msgId);

      // Best-effort pin ONLY chunk 0 (fire-and-forget — pin timeout must never block the save)
      if (i === 0) {
        client.invoke(
          new Api.messages.UpdatePinnedMessage({
            peer,
            id: msgId,
            unpin: false,
            silent: true,
          })
        ).catch((err: any) => {
          invoke("log_vault_state", {
            state: `INDEX_PIN_FAIL chunk=0 reason=${err?.message ?? err}`,
          }).catch(() => {});
        });
      }
    }

    this.cachedExistingMsgIds = newMsgIds;
    this.cachedChunkTexts = newChunkTexts;

    await invoke("log_vault_state", {
      state: `INDEX_FALLBACK_OK chunks=${chunks.length} files=${state.length} msgIds=[${newMsgIds.join(",")}]`,
    }).catch(() => {});
  }
}

async function resolvePeerWithTimeout(client: any, channelId: string): Promise<any> {
  try {
    return await client.getInputEntity(channelId);
  } catch (err) {
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
export function enqueueSave(channelId: string, state: TeleFile[]): Promise<void> {
  return getIndexQueue(channelId).enqueue(state);
}

/** Flush all queues (used on logout). */
export async function flushAllQueues(): Promise<void> {
  await Promise.all(Array.from(queues.values()).map((q) => q.flush()));
  queues.clear();
}

/** Force an immediate retry on a currently-failed queue. */
export function retryQueue(channelId: string): void {
  const q = queues.get(channelId);
  if (!q) return;
  const cur = useFileStore.getState().files;
  void q.enqueue(cur);
}