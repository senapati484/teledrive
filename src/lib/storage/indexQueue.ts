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
 *
 * The queue is keyed by channelId so multiple accounts (future-proofing)
 * don't share state.
 */

import { Api } from "telegram";
import { getClient } from "../telegram/client";
import {
  withTimeout,
  pickCoherentIndexSet,
  type ParsedIndexChunk,
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

/** CHUNK_SIZE must stay under Telegram's 4096-char message limit. */
const CHUNK_SIZE = 10;
/** Fetch + edit + pin timeouts (ms). */
const FETCH_TIMEOUT_MS = 5000;
const EDIT_TIMEOUT_MS = 8000;
const PIN_TIMEOUT_MS = 4000;
const DELETE_TIMEOUT_MS = 5000;

/**
 * Cap on transient (FLOOD_WAIT / timeout / network) retries before the
 * queue gives up and surfaces a hard error. The previous design retried
 * forever, which manifested as a stuck "Retrying in 30s" pill on the
 * topbar during FLOOD_WAIT storms and silently held the user's
 * optimistic state without ever confirming persistence. With this cap,
 * after 5 transient failures the queue rejects the entry — `useFileActions`
 * rolls back the optimistic state, the topbar shows "Save failed", and
 * the user can hit the manual retry button to try again with a fresh
 * budget.
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
   * Message ids we just sent via the fallback path, with their expiry
   * timestamps (ms since epoch). Telegram temp-restricts edits on a
   * message for some window after `sendMessage` — calling `editMessage`
   * on such a message returns `406: EDIT_MESSAGE_TEMP_RESTRICTED` and
   * burns ~8s of timeout. We track recent sends so `commitOnce` knows
   * to skip the edit attempt and go straight to fallback (delete + send
   * fresh), which breaks the temp-restricted death-spiral.
   */
  private recentSentMessageIds: Map<number, number> = new Map();

  constructor(channelId: string) {
    this.channelId = channelId;
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
    this.recentSentMessageIds.clear();
    this.updateStoreState();
  }

  /**
   * Records that `messageId` was just produced by a fallback `sendMessage`.
   * `commitOnce` will refuse to edit it for the next `windowMs` milliseconds.
   */
  private markRecentlySent(messageId: number, windowMs: number = 60_000): void {
    const expiresAt = Date.now() + windowMs;
    this.recentSentMessageIds.set(messageId, expiresAt);
  }

  /**
   * Drops expired entries from recentSentMessageIds.
   * Called at the top of every `commitOnce` so the map doesn't grow forever.
   */
  private pruneRecentlySent(): void {
    const now = Date.now();
    for (const [id, expiresAt] of this.recentSentMessageIds) {
      if (expiresAt <= now) this.recentSentMessageIds.delete(id);
    }
  }

  /**
   * Returns true if ANY of the given message ids is still in the
   * recently-sent window. If true, `commitOnce` should skip the edit
   * path and go straight to fallback (delete + send fresh).
   */
  private hasRecentlySent(messageIds: number[]): boolean {
    if (messageIds.length === 0) return false;
    this.pruneRecentlySent();
    for (const id of messageIds) {
      if (this.recentSentMessageIds.has(id)) return true;
    }
    return false;
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
        // This handles the retrying-entry + newly-enqueued entries flow.
        while (this.retryingEntry || this.pending) {
          // The entry to commit is whichever is "older" — the retrying one
          // first (we promised to retry it), then any newly enqueued ones.
          // In practice the retrying entry has a slightly older snapshot, but
          // both are equivalent for index semantics: the latest state wins on
          // the next operation anyway.
          const entry = this.retryingEntry ?? this.pending!;
          this.retryingEntry = null;
          this.pending = null;
          // NOTE: retryAttempt is intentionally NOT reset here. It must
          // accumulate across transient failures so the cap below actually
          // fires. The previous code reset it to 0 on every drain iteration,
          // which made the cap unreachable and let a stuck queue retry
          // forever. Reset only on success (line 218) or hard error.
          this.lastError = null;
          this.updateStoreState();

          try {
            await this.commitOnce(entry.state);
            entry.resolve();
            // Reset retry counter on success — fresh attempt budget for the
            // next entry.
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
            // Transient: scheduleRetry increments retryAttempt internally
            // and may itself trigger a drain when the timer fires. We do
            // NOT increment here — that would double-count. The cap is
            // checked inside scheduleRetry so we surface "Save failed"
            // before firing yet another doomed retry.
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

    // Increment BEFORE computing the delay so the cap is correct.
    this.retryAttempt++;

    // If we've burned the retry budget, give up. Surface a hard error to
    // the caller so the optimistic state rolls back (if any) and the UI
    // shows "Save failed" with a manual retry button — instead of an
    // invisible infinite-loop retry the user can't act on.
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
      // Reject the entry that was being retried. Caller's `applyOptimistic`
      // catches this and rolls back the optimistic state — the user sees
      // their action "fail" cleanly instead of silently bouncing back.
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
    // Update countdown every 500ms so the UI can show "Retrying in 12s".
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
      throw err; // Already classified upstream as transient or hard.
    }

    const chunks: TeleFile[][] = [];
    for (let i = 0; i < state.length; i += CHUNK_SIZE) {
      chunks.push(state.slice(i, i + CHUNK_SIZE));
    }
    if (chunks.length === 0) chunks.push([]);

    // 1. Find the "current" existing index set — the messages we should edit
    //    or delete. This must use the SAME coherent-set selection logic as
    //    loadIndex, otherwise the queue will:
    //
    //      a) Edit OLDER index messages from a previous epoch while leaving
    //         the NEWER messages untouched, creating a Frankenstein channel
    //         where loadIndex on next restart has to pick between them
    //         (typically the older one wins if it's still pinned).
    //      b) Miss the current index entirely if it was unpinned (FLOOD_WAIT
    //         blocked the pin) but exists in the recent message stream,
    //         causing the queue to send a fresh duplicate set on top.
    //
    //    The fix: combine pinned + recent (BOTH, not either), then let
    //    pickCoherentIndexSet pick the same set loadIndex would pick.
    let allMsgs: any[] = [];
    try {
      const pinned = await withTimeout(
        client.getMessages(peer, {
          filter: new Api.InputMessagesFilterPinned(),
          limit: 100,
        }),
        FETCH_TIMEOUT_MS,
        "client.getMessages(pinned)"
      );
      allMsgs = allMsgs.concat(pinned);
    } catch (err) {
      // Fetch failed — treat as transient so we retry.
      throw err;
    }

    try {
      const recent = await withTimeout(
        client.getMessages(peer, { limit: 200 }),
        FETCH_TIMEOUT_MS,
        "client.getMessages(recent)"
      );
      allMsgs = allMsgs.concat(recent);
    } catch (err: any) {
      await invoke("log_vault_state", {
        state: `INDEX_FETCH_RECENT_FAIL reason=${err?.message ?? err}`,
      }).catch(() => {});
      // Non-fatal: we still have the pinned set above.
    }

    // Pick the coherent set of chunks that represents the current state of
    // the index. These are the message ids we'll edit or delete.
    const coherentSet: ParsedIndexChunk[] | null = pickCoherentIndexSet(allMsgs);

    // Build the `existing` list keyed off the coherent set's message ids.
    // Map back from msgId → original Telegram message object so we can
    // call client.editMessage / client.deleteMessages with the full message.
    const existingById = new Map<number, any>();
    for (const m of allMsgs) {
      if (m?.id != null) existingById.set(Number(m.id), m);
    }
    const existing: any[] = coherentSet
      ? coherentSet
          .map((c) => existingById.get(c.msgId))
          .filter((m): m is any => Boolean(m))
      : [];

    if (existing.length > 0) {
      await invoke("log_vault_state", {
        state: `INDEX_EXISTING_FOUND count=${existing.length} msgIds=[${existing.map((m: any) => m.id).join(",")}]`,
      }).catch(() => {});
    } else {
      await invoke("log_vault_state", {
        state: `INDEX_EXISTING_NONE scannedMsgs=${allMsgs.length}`,
      }).catch(() => {});
    }

    // 2. If we have existing messages, edit them in place. This is the
    //    happy path and consumes no extra SendMessage / pin quota.
    //
    //    Smart-skip: if ANY of the existing messages was sent by us in
    //    the last 60 seconds (the temp-restricted window), skip the edit
    //    entirely and go straight to fallback. Trying to edit such a
    //    message returns `406: EDIT_MESSAGE_TEMP_RESTRICTED` after the
    //    full 8-second timeout, which dominates the save latency and
    //    burns a Telegram round-trip per chunk. Falling back to
    //    delete+send is one round-trip per chunk and converges to a
    //    usable state immediately.
    if (existing.length > 0) {
      const existingIds = existing.map((m: any) => Number(m.id));
      if (this.hasRecentlySent(existingIds)) {
        await invoke("log_vault_state", {
          state: `INDEX_EDIT_SKIP reason=recently_sent ids=${existingIds.join(",")}`,
        }).catch(() => {});
        await invoke("log_vault_state", {
          state: "INDEX_FALLBACK_SEND reason=recently_sent",
        }).catch(() => {});
        // Fall through to fallback path below.
      } else if (existing.length !== chunks.length) {
        // Mismatched chunk count (e.g. the previous coherent set had 3 chunks
        // but the new state needs 4, or vice versa). We can't safely edit in
        // place — fall through to atomic delete+send.
        await invoke("log_vault_state", {
          state: `INDEX_FALLBACK_SEND reason=chunk_count_mismatch existing=${existing.length} new=${chunks.length}`,
        }).catch(() => {});
      } else {
        let allEditsOk = true;
        for (let i = 0; i < chunks.length; i++) {
          const payload = {
            teledrive_index: true,
            version: 1,
            chunkIndex: i,
            totalChunks: chunks.length,
            files: chunks[i],
          };
          const text = JSON.stringify(payload);

          try {
            await withTimeout(
              client.editMessage(peer, {
                message: existing[i]?.id,
                text,
              }),
              EDIT_TIMEOUT_MS,
              `editMessage(chunk ${i})`
            );
          } catch (err: any) {
            // Single edit failure: bail to fallback send for *all* chunks.
            allEditsOk = false;
            await invoke("log_vault_state", {
              state: `INDEX_EDIT_FAIL chunk=${i} reason=${err?.message ?? err}`,
            }).catch(() => {});
            break;
          }
        }

        if (allEditsOk) {
          // Delete extras if the new index shrank.
          if (existing.length > chunks.length) {
            const extraIds = existing.slice(chunks.length).map((m: any) => m.id);
            try {
              await withTimeout(
                client.deleteMessages(peer, extraIds, { revoke: true }),
                DELETE_TIMEOUT_MS,
                "deleteMessages(extra chunks)"
              );
            } catch (err: any) {
              // Non-fatal — extras will get cleaned up on next save or load.
              await invoke("log_vault_state", {
                state: `INDEX_DELETE_EXTRAS_FAIL reason=${err?.message ?? err}`,
              }).catch(() => {});
            }
          }
          await invoke("log_vault_state", {
            state: `INDEX_EDIT_OK chunks=${chunks.length} files=${state.length}`,
          }).catch(() => {});
          return;
        }

        // Edits failed mid-way → fall through to full re-send below.
        await invoke("log_vault_state", {
          state: "INDEX_FALLBACK_SEND reason=edit_failed",
        }).catch(() => {});
      }
    } else {
      await invoke("log_vault_state", {
        state: "INDEX_FALLBACK_SEND reason=no_existing_index",
      }).catch(() => {});
    }

    // 3. Fallback path: ATOMIC delete-old, then send-fresh. Pin is best-effort.
    //
    //    Why atomic: previously we sent fresh messages FIRST, then deleted
    //    old ones best-effort. If delete failed (FLOOD_WAIT), the old
    //    pinned messages stayed around, AND the new sends were not pinned.
    //    On the next restart, loadIndex would read the old pinned set and
    //    return the OLD (pre-move) state — silently losing the user's
    //    recent actions.
    //
    //    Now: delete old first (synchronous, with retry; surface failures
    //    as transient so the queue retries), THEN send fresh. Pin is
    //    truly optional because loadIndex no longer depends on pin status
    //    (it picks the newest coherent set by message id).
    const oldIds = existing.map((m: any) => Number(m.id));
    if (oldIds.length > 0) {
      let deleteOk = false;
      let lastDeleteErr: any = null;
      for (let attempt = 1; attempt <= 3 && !deleteOk; attempt++) {
        try {
          await withTimeout(
            client.deleteMessages(peer, oldIds, { revoke: true }),
            DELETE_TIMEOUT_MS,
            `deleteMessages(legacy attempt=${attempt})`
          );
          deleteOk = true;
        } catch (err: any) {
          lastDeleteErr = err;
          await invoke("log_vault_state", {
            state: `INDEX_DELETE_OLD_FAIL attempt=${attempt} reason=${err?.message ?? err}`,
          }).catch(() => {});
          // Flood-wait: let the queue handle retry via the standard
          // transient-error path. Anything else: back off and retry once.
          const flood = parseFloodWaitSeconds(err);
          if (flood != null) {
            throw err; // transient → outer queue retry
          }
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 500 * attempt));
          }
        }
      }
      if (!deleteOk) {
        await invoke("log_vault_state", {
          state: `INDEX_DELETE_OLD_GIVE_UP err=${lastDeleteErr?.message ?? lastDeleteErr}`,
        }).catch(() => {});
        // We cannot guarantee freshness if old messages are still there.
        // Bubble up as transient so the queue retries with backoff;
        // the user's optimistic state stays and we keep trying.
        throw lastDeleteErr;
      }
      await invoke("log_vault_state", {
        state: `INDEX_DELETE_OLD_OK count=${oldIds.length}`,
      }).catch(() => {});
    }

    const newMsgIds: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const payload = {
        teledrive_index: true,
        version: 1,
        chunkIndex: i,
        totalChunks: chunks.length,
        files: chunks[i],
      };
      const text = JSON.stringify(payload);

      let msgId: number;
      try {
        const result = await withTimeout(
          client.sendMessage(peer, { message: text }),
          EDIT_TIMEOUT_MS,
          `sendMessage(chunk ${i})`
        );
        msgId = Number((result as any).id);
        newMsgIds.push(msgId);
        // Mark as recently-sent so the next commit skips edits on these.
        this.markRecentlySent(msgId);
      } catch (err) {
        throw err;
      }

      // Pin is truly best-effort now. Pin failures NEVER cause a retry
      // because loadIndex picks by message id, not pin status. The pin
      // is only a fast-path hint to find the index quickly; if it's
      // missing, the scan-on-load path still finds the right messages.
      try {
        await withTimeout(
          client.invoke(
            new Api.messages.UpdatePinnedMessage({
              peer,
              id: msgId,
              unpin: false,
              silent: true,
            })
          ),
          PIN_TIMEOUT_MS,
          `UpdatePinnedMessage(chunk ${i})`
        );
      } catch (err: any) {
        await invoke("log_vault_state", {
          state: `INDEX_PIN_FAIL chunk=${i} reason=${err?.message ?? err}`,
        }).catch(() => {});
      }
    }

    await invoke("log_vault_state", {
      state: `INDEX_FALLBACK_OK chunks=${chunks.length} files=${state.length} msgIds=[${newMsgIds.join(",")}]`,
    }).catch(() => {});
  }
}

async function resolvePeerWithTimeout(client: any, channelId: string): Promise<any> {
  // Mirrors resolveChannelInputPeer in metadataStore.ts but is local so the
  // queue is self-contained and doesn't depend on a circular import.
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
 * For transient errors, the queue swallows the rejection and retries; the
 * returned promise stays pending until success or hard failure. This matches
 * the user's "hybrid rollback" choice — callers should roll back ONLY if this
 * promise rejects.
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
  // enqueue with the current store state to force a retry attempt.
  const cur = useFileStore.getState().files;
  void q.enqueue(cur);
}