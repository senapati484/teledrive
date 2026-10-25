# Index Durability — Design

Date: 2026-10-25
Status: proposed
Scope: the Telegram-backed file index only. Multi-device edit propagation, backup
throughput, bundle size, preview streaming, and filesystem security are follow-ups.

## Intent and why

TeleDrive stores its whole virtual drive — names, folder paths, stars, trash,
archive state — in a JSON index split across ordinary messages in the user's
private Telegram channel. Every user action rewrites that index.

Today the index can silently come back smaller than it was, and the loss can be
made permanent by the next user action. That is unacceptable for a drive, and it
gets worse as the channel fills with file and backup messages.

The user's requirement:

- Fix the index so it is durable in all normal conditions.
- Keep the existing architecture: chunked index messages in the channel, pinned
  chunk 0, one writer queue. No server, no database, no new storage system.
- Existing users must keep their files. Data already stranded in older index
  chunks must be recoverable.

## Goals

1. A cold start never accepts a partial index, and never writes from one.
2. A save is atomic. A failed, timed-out, cancelled, or crashed save leaves the
   previous complete index live.
3. Index discovery is independent of the last-100-messages window and of channel
   traffic.
4. Existing index chunks written by v0.1.2 and earlier still load; the format
   upgrades on the next save without user action.
5. Users whose index was already damaged by the old path can find and restore
   their files from channel history.
6. The hot path stays cheap: a star, rename, or trash of one file still costs one
   Telegram edit, not a rewrite of the whole index.
7. The queue never drops the newest save, and logout/shutdown does not lose a
   committed-to-UI action.

## Non-goals

- Propagating edits and deletions to other devices in near real time. That is the
  next project. This design only avoids making it harder.
- Encrypting the index. The README claims an encrypted catalog; it is not, and
  fixing that is separate.
- Changing the backup runner, preview pipeline, bundle layout, Rust commands, or
  the vault.
- Changing the user-visible folder/file model.

## Anti-goals

- A best-effort merge that "heals" a partial load. That is the current failure.
- Preferring the largest epoch over the newest valid one. That resurrects
  intentionally deleted files.
- Pinning every chunk (Telegram pin limits) or adding a second storage service.
- Silently discarding a local pending action because Telegram was unreachable.

## Constraints

- Telegram message text limit is 4096 characters. The current writer targets
  ~3400 characters per chunk and caps at 25 files.
- Telegram message edits are atomic per message and do not change the message id.
- `getMessages` returns pinned messages, the most recent 100 by default, messages
  by id (`ids`), and supports server-side `search` plus `offsetId` pagination.
- Telegram search is tokenised, not exact-substring. Correctness must not depend
  on search succeeding; pagination is the deterministic fallback.
- The channel also contains file documents and backup snapshots. Index messages
  are not in a dedicated chat.
- All index writes must keep going through one per-channel writer.
- Old app versions may read an index written by the new code. Unknown JSON fields
  are ignored by the current parser, so extra fields are safe.

## Approaches considered

### A. Discovery-only repair

Extend the load path with search and paginated history until a complete epoch is
found; refuse to heal or save from an incomplete load; fix the queue.

- Pros: smallest diff, no format change.
- Cons: writes still mutate chunks in place. A save that fails after editing some
  chunks but before others leaves a mixed state that can look complete. Does not
  meet goal 2.

### B. Discovery plus an atomic manifest (chosen)

Everything in A, plus:

- Chunk 0 carries the identity of every other chunk in the set, so the set is
  discoverable and verifiable by itself.
- Structural saves write changed chunks as new messages first, then commit by
  editing chunk 0 last, then delete superseded chunks.
- A single-chunk metadata save is still edited in place, which is atomic by
  itself.
- Legacy chunk 0s without the manifest load through the A path and upgrade on the
  next save.

- Pros: fixes discovery and write atomicity without a new message type, a new
  pin, or a new storage system. The manifest also gives the later multi-device
  work a cheap version to watch.
- Cons: more code, a size budget on chunk 0, and one extra edit on structural
  saves.

### Rejected

- Pin every chunk: capped by Telegram's pinned-message limit and adds pin flood
  risk.
- A separate pinned pointer message: a new message type for no extra safety over
  the manifest, and one more thing to migrate.
- Full index resend on every save: atomic but far too many Telegram calls at real
  file counts.

## Design

### 1. Index format, version 2

Every chunk written by the new code adds:

```json
{
  "teledrive_index": true,
  "version": 2,
  "chunkIndex": 0,
  "totalChunks": 3,
  "savedAt": 1761350400000,
  "chunkMsgIds": [123456, 123457],
  "files": []
}
```

- `savedAt`: Unix ms when that chunk text was last written. Only chunks written
  by a save receive the new value; unchanged chunks keep their existing
  `savedAt`. The epoch's effective timestamp is the **maximum** `savedAt` across
  its loaded chunks. Chunk 0's `savedAt` is the commit time on a structural save,
  which is what orders manifests. The fast path updates only the changed chunk;
  the epoch's effective timestamp still advances via the max. `baseSavedAt` for
  the pending marker (section 5) is always the epoch's effective timestamp, not
  chunk 0's value.
- `chunkMsgIds`: present only on chunk 0. Contains the message ids of chunks
  1..totalChunks-1, in chunk order. A valid manifest has exactly
  `totalChunks - 1` entries.
- `version: 2` marks chunks written by this code. Legacy chunks are `version: 1`
  or absent.
- Chunk 0 keeps its file payload; it does not become a manifest-only message. The
  writer reserves room for the id list by packing chunk 0 with a smaller file
  budget.

Encoding of `chunkMsgIds`: emit the first id in base 36, then **signed** base-36
deltas from the previous id, comma separated. A leading `-` means the next id is
lower. Example: `"9f3k,1,1,-2,0"`. Signed deltas are required because a
structural save creates new ids for changed chunks while unchanged chunks keep
older ids, so the ordered list is not monotonic. This keeps a 400-chunk manifest
under roughly 1.6 KB.

Chunk 0 sizing:

- Let `manifestBudget = min(2400, 24 + 12 * totalChunks)` characters.
- Pack chunk 0 with at most `3400 - manifestBudget` characters of file JSON. Pack
  chunks 1..N with the existing ~3400-character budget.
- If even an empty chunk 0 cannot hold the manifest (very large libraries), omit
  `chunkMsgIds` from chunk 0 and use the discovery fallback in section 3. The
  index remains readable; only the atomic write path is unavailable for that
  save. Documented bound: roughly 15k-25k files depending on metadata size.

A chunk is valid if `teledrive_index` is true, `version` is 1 or 2,
`chunkIndex`/`totalChunks` are coherent, and `files` is an array. Legacy chunks
remain valid with no changes.

### 2. Writer: atomic commit

The writer keeps the cached set: `cachedExistingMsgIds` (ordered, chunk 0 first)
and `cachedChunkTexts`.

Given the new state:

1. Chunk the files, reserving the chunk-0 budget above.
2. Serialize all chunk texts (without the manifest for now; chunk 0 is built
   after the other ids are known).
3. Diff against `cachedChunkTexts` to get the changed indices. Also record
   whether `totalChunks` changed.

**Fast path — exactly one changed chunk and the chunk count is unchanged.**

- Edit that chunk in place and stop.
- This is safe: Telegram edits are atomic, the id does not change, `totalChunks`
  does not change, and the manifest (if the changed chunk is not chunk 0) still
  names the same ids. If the changed chunk is chunk 0, its manifest is unchanged
  because no ids changed.
- A failed edit leaves the old content live. Retry the same edit; if the content
  is already there, treat `MESSAGE_NOT_MODIFIED` as success.

**Structural path — multiple changed chunks or a chunk-count change.**

1. Send each changed chunk with index > 0 as a new message. Keep unchanged
   chunks' existing ids.
2. Build the final ordered id list.
3. Build chunk 0 text with the final `chunkMsgIds`, `savedAt`, and its file
   payload. Edit the existing chunk 0 message in place. This edit is the commit
   point.
4. On success, update the cache and fire-and-forget delete of old chunk messages
   that are no longer referenced (never chunk 0).
5. On failure before step 3, abort. The old chunk 0 still names only old ids,
   all of which still exist because nothing was edited. New messages are
   unreferenced orphans and are harmless.
6. On failure at step 3, the old chunk 0 content remains (edit is atomic). The
   old epoch is still live; the new chunks are orphans. Retry.
7. A process crash at any point has the same outcome as 5 or 6.

Special cases:

- No cached chunk 0 (cache miss, first save, or fallback): discover first
  (section 3). If there is still no chunk 0, send all chunks as new messages,
  then pin chunk 0 exactly as today. This is the only path that moves the pin.
- Index shrinks: structural path, then delete the now-unreferenced trailing
  messages after the commit.
- A hard error (`MSG_ID_INVALID`, `MESSAGE_ID_INVALID`, `CHANNEL_INVALID`,
  `CHAT_WRITE_FORBIDDEN`, auth errors): invalidate the cache, re-discover once,
  and retry. If the chunk 0 message is genuinely gone, fall back to sending all
  chunks and repinning. Do not treat a timeout like a deleted message.
- Timeouts: retry the same RPC. Never run delete-everything on the first timeout.
  Orphans are safe now, so a timeout cannot corrupt the live index.

**Legacy upgrade.** When the cached set has no manifest, the first save after a
successful legacy load adds one. If the only change is one chunk and the count is
unchanged, edit that chunk in place (atomic), then edit chunk 0 to add
`chunkMsgIds` and a fresh `savedAt`. If the chunk 0 edit fails, the legacy index
still loads and the upgrade is retried on the next save. Do not reserialize
unchanged chunks just to upgrade them. This means a legacy index never stays
manifest-less after its first save.

**Above the manifest bound.** Do not fall back to a no-manifest structural write;
that reintroduces mixed epochs. If `chunkMsgIds` cannot fit, use full
copy-on-write: send every chunk as a new message (chunk 0 last), then delete the
old set and repin chunk 0 best-effort. Discovery for that epoch uses the
search/pagination path because there is no manifest. This is expensive, but it is
correct and only applies beyond roughly 15k-25k files.

Invariant: the manifest is the only source of truth about which chunk messages
belong to the live index. A chunk not named by a valid chunk 0 is never part of
the index, even if it parses. An epoch with no manifest is valid only if the
loader found it through the legacy/search path and it is internally complete.

### 3. Discovery

Add `discoverIndex(channelId): Promise<DiscoveryResult>` in the storage layer.
`loadIndex` and the writer's cache-miss path both use it.

Order:

1. Fetch pinned messages (limit 100) and the latest 100 messages in parallel, as
   today.
2. Parse. Build two candidate lists from what was fetched:
   - **Manifest candidates:** chunk 0 messages with a structurally valid
     manifest (`totalChunks === chunkMsgIds.length + 1`, all ids positive, no
     duplicates). Effective timestamp = chunk 0 `savedAt`.
   - **Legacy candidates:** complete epochs from `pickCoherentIndexSet`.
     Effective timestamp = the maximum across its chunks of `savedAt` when
     present, otherwise `editDate ?? date` in ms.

   Rank both lists by `(effectiveTimestamp, maxMsgId)`; newest wins. This single
   ordering is what prevents a surviving orphan v2 manifest from beating a newer
   legacy save written by an older app version.
3. Take the highest-ranked manifest candidate and fetch its named ids in batches
   of at most 100 (`getMessages(peer, { ids })`). Validate:
   - every id resolved,
   - each message parses as an index chunk,
   - `chunkIndex` matches its position, `totalChunks` matches the manifest,
   - chunk 0 is the same message the manifest came from.
   If valid and it outranks the best legacy candidate, use it. If invalid, drop
   it and try the next manifest candidate (at most 3 attempts).
4. If a legacy candidate wins, use it as-is. Seed the writer cache with the
   ordered ids and texts, seed `lastIndexMsgId`, return ready.
5. Still nothing: server-side search for `teledrive_index`, paginated with
   `offsetId`, up to 20 pages of 100, 15 seconds, bounded by the abort signal.
   Parse everything found and repeat the same two-list ranking, including
   fetching manifest ids when a manifest candidate wins.
6. Still nothing: walk history backwards with `offsetId` in 100-message pages,
   up to 10,000 messages or 30 seconds, stopping as soon as a ranked complete
   epoch is found.
7. Nothing found:
   - If the channel has **zero messages**, there is no local cache, and no index
     marker was ever seen, this is a brand-new drive: return ready with zero
     files and one empty chunk. (The storage channel is dedicated to TeleDrive.)
   - Otherwise return `{ status: "incomplete", reason }`. A non-empty channel
     with no complete index is damaged or unreadable, never "empty".

`DiscoveryResult`:

```ts
type DiscoveryResult =
  | { status: "ready"; files: TeleFile[]; ids: number[]; texts: string[]; savedAt: number; format: 1 | 2 }
  | { status: "incomplete"; reason: "not_found" | "partial_manifest" | "timeout" | "network" };
```

Rules:

- Never call `healAndSave`, `enqueueSave`, or mutate the store from an
  `incomplete` result.
- `partial_manifest` means a manifest was found but one or more named chunks were
  missing. Retry the fetch once (transient loss), then treat as incomplete. Do
  not fall back to an older epoch automatically on the first miss; the user may
  have just saved and Telegram can be briefly inconsistent.
- Legitimately empty drives return ready with zero files and one empty chunk.
- If a complete epoch is found but its effective timestamp is older than the
  local pending snapshot (section 5), the pending snapshot wins until it is
  saved.
- A validated pending snapshot may be replayed only after discovery is ready.
  While discovery is incomplete, keep the snapshot and retry; never write it
  against an unknown base.
- If a manifest's named chunk is permanently missing, do not leave the drive
  read-only forever. After the retries and the one-time recovery scan, the user
  can restore a complete candidate set through the recovery path (section 6),
  which writes a fresh v2 generation. This is the only write allowed while
  discovery is incomplete, and it requires an explicit confirmation.

The invariant is enforced at the writer, not just in the UI: `enqueueSave` rejects
with a typed `IndexNotReadyError` whenever `indexLoadState !== "ready"`, except
for the explicit recovery-replace path. Uploads and backups call a shared
`waitForIndexReady()` (replacing the current `waitForBootstrap` files-length
check) and pause instead of writing against a partial index. This closes the
upload/backup/heal paths that currently call `enqueueSave` directly.

Discovery cost:

- Normal launch: one pinned fetch + one recent fetch + one or two id fetches.
  Independent of channel traffic.
- First launch after upgrade or a damaged cache: the search/pagination path, once,
  then the next save writes a v2 manifest.

### 4. Bootstrap gate and UI state

Add to `fileStore`:

```ts
indexLoadState: "loading" | "ready" | "incomplete";
indexLoadError: string | null;
retryIndexLoad: () => void; // or an exported function in bootstrap
```

- `bootstrapComplete` now means "the initial discovery attempt has finished", so
  the shell can render. It no longer implies writability. `indexLoadState`
  (`ready`) is the single authority for every write path.
- Remote sync starts only when `indexLoadState === "ready"`.
- On `incomplete` with a cache: keep the cached files, set the state, block
  mutations, show a persistent banner: "Couldn't safely load your drive index.
  Showing cached files. Changes are disabled until reconnected." plus Retry.
- On `incomplete` with no cache: show a blocking screen with Retry and the
  reason. Never present an empty drive as if it were the user's drive.
- Retry discovery with backoff (5s, 15s, 30s, 60s, then every 60s) while the app
  is open, and on window focus/online.
- `applyOptimistic` gate changes from
  `!bootstrapComplete && files.length === 0` to
  `indexLoadState !== "ready"` unless a validated pending snapshot is being
  replayed (section 5). This closes the "cached files present, so writes are
  allowed before the authoritative index loads" hole.
- Uploads, the upload manager, and the backup runner call `waitForIndexReady()`
  before saving and pause (with the existing status UI) while incomplete. They
  do not write, and they do not need new retry logic of their own.
- Keep the existing pre-bootstrap toast and rollback behavior for user actions
  attempted during loading.

New i18n keys under `messages:indexLoad` and `files:actions` in English. Other
locales fall back through i18next until translated.

### 5. Queue and local pending safety

The queue is part of durability. Changes in `ChannelQueue`:

1. **Newest state wins.** `drain` prefers `pending` over `retryingEntry`. If both
   exist, resolve `retryingEntry` (superseded) and commit `pending`. No promise
   is ever left unresolved. Resolve the superseded entry when `enqueue` replaces
   it, including when the superseded entry is `retryingEntry`.
2. **One retry per failed state.** A failed commit of S1 with a newer S2 pending
   commits S2, not S1. S1's caller resolves as superseded.
3. **`flush` commits.** `flush` cancels timers, drips the latest state through
   `commitOnce` with a bounded timeout (15s), and only then resolves. It does not
   clear the cache on failure. Logout awaits `flushAllQueues()`; if it fails,
   logout proceeds but warns and leaves a pending snapshot.
4. **No blind full rewrite on timeout.** Only re-discover and fall back on
   missing-message errors. Timeouts retry the same RPC.
5. **Hard error with a newer state pending.** Reject only the failing caller. If
   `pending` exists, continue with it. `applyOptimistic` rolls back only when the
   store's `files` array is still the exact array that action applied (reference
   equality). If a newer action superseded it, do not roll back; only toast. This
   prevents an older failure from clobbering a newer optimistic state.
6. **Transient retries exhausted.** Do not discard the newest state. Move it to a
   `stuckEntry`, set the queue to `failed`, and keep retrying every 60s and on
   manual Retry. Reject the caller with a typed `IndexRetryExhaustedError`;
   `applyOptimistic` treats that error as non-rollback (the action is valid, only
   Telegram is unavailable) and leaves the optimistic UI in place. A new enqueue
   supersedes `stuckEntry` normally. FLOOD_WAIT retries remain effectively
   indefinite.

Local pending snapshot:

- On every `enqueue`, synchronously write a small marker to localStorage:
  `{ channelId, baseSavedAt, at }`, where `baseSavedAt` is the **effective
  timestamp** of the index the in-memory state is based on, and flush the
  debounced file cache immediately so the files are on disk.
- On successful commit, clear the marker.
- On bootstrap, if the marker exists and `baseSavedAt >= loaded effective
  timestamp`, the cached files are newer or equal. Use the cached files, do not
  overwrite them with the loaded index, and enqueue one save after discovery is
  ready. If the loaded effective timestamp is greater, another save won, so
  discard the marker.
- For a legacy loaded epoch, the effective timestamp is the max
  `editDate ?? date` across its chunks. If that is unavailable, treat it as 0 and
  apply the conservative merge rule below.
- If `baseSavedAt` is 0 or unknown, treat the local cache as pending
  (same-device crash) only if the cache has file ids the loaded index does not.
  Merging uses the loaded index as the base and adds missing cache entries; it
  never removes a file from the loaded index. Otherwise discard the marker.
- Logout: await flush; keep the marker on failure so the next launch retries.

This closes the "action taken, app closed, bootstrap replaces cache with the old
index" loss path.

### 6. Recovery of already-damaged libraries

A read-only scan, never automatic writes:

`scanIndexHistory(channelId, signal): Promise<RecoveryReport>`

- Discover all `teledrive_index` messages via search plus paginated history, up
  to a bound (5,000 chunk messages or 60 seconds, cancellable).
- Group into epochs: valid v2 manifest sets; legacy coherent epochs; and
  incomplete orphan groups.
- Build the union of files by id and by content key.
- Compare with the current index. Produce `recoverable`: files present in an
  epoch but absent from the current index, grouped by epoch `savedAt`, with
  counts. Do not include files already in the current index.
- The report is read-only. Nothing is deleted, edited, or saved.

UI:

- One-time background scan after the first successful bootstrap on this channel
  (marker in localStorage per channel). If it finds recoverable files, show a
  dialog: count, epoch dates, and a "Review & restore" action.
- Also available in Settings → Storage → "Recover files from channel history".
- Review screen lists files grouped by old index version, with select-all per
  group. When discovery is ready, restoring merges the selected entries into the
  current state through the normal `applyOptimistic` path, so the save is atomic.
- When discovery is incomplete, restoring uses an explicit
  `replaceIndexFromRecovery` path: the scan must have produced a complete
  candidate set, the user confirms that this becomes the new index, and the
  writer emits a fresh v2 generation. This is the only write allowed while
  `indexLoadState` is `incomplete`; afterwards the normal ready gate resumes.
- Never auto-restore. Older epochs may represent intentional deletions; the user
  decides. Nothing is deleted during recovery.

Limitation: a file whose index entry and Telegram document were both deleted
before this fix cannot be recovered. The recovery scan covers index chunks, not
arbitrary file messages. The existing 400-message orphan scan is unchanged.

## Data model changes

`TeleFile` is unchanged.

`ParsedIndexChunk` gains `savedAt?: number` and `chunkMsgIds?: number[]`.

New types: `DiscoveryResult`, `RecoveryReport`, `RecoverableFile`.

No vault or Telegram schema migration. The index is self-describing.

## Compatibility and migration

- v2 chunks are additive JSON. The v0.1.2 parser ignores unknown fields, so a
  user who downgrades still loads the index.
- If an old version saves after a v2 write, it rewrites chunk 0 without a
  manifest. The new version falls back to legacy discovery and upgrades again on
  its next save.
- First launch after upgrade may take longer (search/pagination) and performs no
  write until a complete epoch is found.
- Old chunks are not deleted by the loader. Superseded chunks are deleted only
  after a successful v2 commit.

## Failure behaviour summary

| Failure | Result |
| --- | --- |
| Network down at launch | cached files shown, writes blocked, retries; nothing overwritten |
| Pinned chunk 0 stale/missing | search/pagination finds the newest complete epoch |
| Chunk id fetch partially fails | retry once, then incomplete; no write |
| Save fails after sending new chunks | old chunk 0 still live; new chunks are orphans |
| Save fails on the chunk 0 commit edit | old chunk 0 still live; retry |
| App crashes mid-save | old complete epoch live; orphans ignored |
| Timeout on a chunk edit | retry the edit; no destructive fallback |
| Old app overwrites chunk 0 | new version detects no manifest, uses legacy path |
| Logout during a pending save | flush attempted, pending marker kept, replay next launch |
| Very large library exceeds manifest budget | full copy-on-write; no manifest for that save; search/pagination discovery |
| Index incomplete and the user restores from history | only via explicit recovery-replace with a complete candidate set |

## Testing

Unit tests (Vitest, mocked Telegram client with fixture messages):

1. Manifest happy path: chunk 0 + ids resolve while >100 non-index messages sit
   after the chunks; discovery is ready.
2. Missing named chunk: retry once, then `incomplete`; assert no save call and no
   store overwrite.
3. Legacy epoch outside the 100-message window: found via search or pagination.
4. Search unavailable: pagination path finds the epoch.
5. Incomplete everywhere: `incomplete`, cache preserved, writes blocked.
6. Fast path: star/rename in one non-zero chunk edits exactly one message and
   does not edit chunk 0.
7. Structural path: chunk count change sends new chunks, edits chunk 0 last,
   deletes superseded ids after success.
8. Structural failure injection at each step: old epoch remains loadable without
   any mixed state.
9. Legacy cache upgrade: first structural save adds the manifest.
10. Manifest encode/decode round-trip, delta/base36 edge cases, size budget,
    omit-and-fallback above the bound.
11. Queue: enqueue during retry commits the newest state; no unresolved promise;
    `flush` commits; hard error rejects and rolls back.
12. Pending snapshot: enqueue, simulate crash, bootstrap replays newer cache;
    newer remote `savedAt` discards it.
13. Recovery scan: multiple epochs, current files excluded, nothing written,
    cancelled scan returns partial=false and no writes.
14. Guard: `healAndSave`/`enqueueSave` never invoked from `incomplete`.

Existing tests must keep passing: `floodWaitAndUploadCoalesce`,
`folderAndOrphanRecovery`, `loginFlow`, `futureAuth`, `vault`,
`starPromptLogic`.

Manual/integration:

- Save an index, upload 150 files, restart: every file present.
- Kill the app between the new chunk sends and the chunk 0 edit: restart shows the
  previous index, not a partial one.
- Strip `chunkMsgIds` from chunk 0 to simulate v0.1.2: app loads and upgrades.
- Restore a file from an older epoch via the recovery UI; next cold start keeps
  it.

## Rollout

- No remote flag. The format is additive and self-healing.
- Log distinct, bounded codes: `INDEX_DISCOVERY_START/OK/INCOMPLETE`,
  `INDEX_MANIFEST_OK/OMITTED`, `INDEX_COMMIT_FAST/STRUCTURAL/OK/FAIL`, and
  recovery scan counts.
- Keep logs bounded in size; the existing unbounded `vault_state.log` is a known
  issue and is not addressed here.

## Decisions left to the builder

- Exact search query/tokenisation check against a real channel; pagination is the
  correctness path, search is the accelerator.
- Batch size for `getMessages({ ids })` (Telegram caps message fetch batches;
  start at 100 and back off on `FLOOD_WAIT`).
- Precise chunk-0 packing loop and the omit threshold.
- Where the recovery review UI lives and its visual treatment.
- Whether the one-time recovery scan runs automatically after bootstrap or only
  from Settings. The design assumes automatic detection with a user-confirmed
  restore.
- Retry cadence and banner copy.

## Calls made after the builder review

These were open or ambiguous in the first draft and are now settled:

- `savedAt` is per chunk; the epoch timestamp is the maximum across loaded
  chunks, so the fast path stays one edit.
- Manifest deltas are signed, because a structural save can mix new and old ids
  in chunk order.
- An empty channel is a new drive; a non-empty channel with no complete index is
  damaged and must never render as an empty drive.
- The write gate lives in `enqueueSave`/`waitForIndexReady`, not only in
  `applyOptimistic`, so uploads, backups, and heal paths cannot write a partial
  index.
- A pending local snapshot is never replayed while discovery is incomplete;
  recovery-replace is the single, explicitly confirmed exception.
- A legacy index gets its manifest on the first save, without reserializing
  unchanged chunks.
- Above the manifest bound, use full copy-on-write; never a no-manifest
  structural write.
- A hard error rejects only its own caller; rollback happens only if that action
  is still the current store state.
- Exhausted transient retries keep the newest state and surface `failed`; they do
  not silently lose the action.
- Manifest and legacy epochs share one ordering by effective timestamp, so a
  newer legacy save beats an orphan manifest after a downgrade.

## Files expected to change

- `src/lib/storage/indexQueue.ts` — manifest, atomic commit, queue semantics.
- `src/lib/storage/metadataStore.ts` — discovery, validation, recovery scan.
- `src/lib/storage/indexFormat.ts` — new: encode/decode, chunking with chunk-0
  budget, types.
- `src/lib/storage/__tests__/indexDurability.test.ts` — new.
- `src/stores/fileStore.ts` — load state, pending snapshot marker.
- `src/lib/telegram/bootstrap.ts` — gate, incomplete handling, retry loop.
- `src/hooks/useFileActions.ts` — write gate, flush/logout integration.
- `src/components/layout/DriveLayout.tsx` — incomplete banner.
- `src/components/settings/StorageSection.tsx` + a recovery dialog component.
- `src/i18n/locales/en/messages.json` and `files.json` (other locales fall back).
