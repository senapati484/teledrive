# Index Durability — Implementation Plan

Design: `docs/superpowers/specs/2026-10-25-index-durability-design.md`
Date: 2026-10-25
Scope: the Telegram-backed index only. Do not touch backup throughput, preview
streaming, bundle size, multi-device edit propagation, or filesystem security in
this plan.

## Execution rules

- Tests come with each task, not at the end. A task is done only when its tests
  and the full suite pass.
- Keep each task shippable. Tasks 1-3 are backward compatible reads and a write
  gate; task 4 changes the write path.
- Never commit unless the user asks.
- After each task run `npm test` and `npm run build`. Run
  `cargo check --manifest-path src-tauri/Cargo.toml` after any Rust-adjacent
  change (none expected).
- Verify with fixtures that look like real v0.1.2 chunks, not only v2 chunks.
- Do not add comments that restate the code. Keep the existing comment style
  where it explains a non-obvious invariant.

## Task 0 — Baseline

1. Record current state:
   ```bash
   npm test
   npm run build
   ```
2. Save the current dist entry sizes for comparison (`dist/assets`).
3. Read `src/lib/__tests__/folderAndOrphanRecovery.test.ts` and mirror its fixture
   style in new tests.

Acceptance: baseline test/build results recorded in the working notes (not the
repo).

## Task 1 — Index format module

New file: `src/lib/storage/indexFormat.ts`
Tests: `src/lib/storage/__tests__/indexFormat.test.ts`

API:

```ts
export const INDEX_VERSION = 2;
export const TELEGRAM_TEXT_LIMIT = 4096;
export const CHUNK_TEXT_TARGET = 3400;
export const CHUNK_FILE_CAP = 25;

export interface IndexChunkPayload {
  teledrive_index: true;
  version: number;
  chunkIndex: number;
  totalChunks: number;
  savedAt?: number;
  chunkMsgIds?: number[];
  files: TeleFile[];
}

export interface ParsedIndexChunk {
  msgId: number;
  version: number;
  chunkIndex: number;
  totalChunks: number;
  savedAt?: number;
  chunkMsgIds?: number[];
  files: TeleFile[];
  editedAt: number;
}

export function encodeChunkIds(ids: number[]): string;
export function decodeChunkIds(encoded: string): number[]; // throws on malformed input
export function isValidManifest(chunk: ParsedIndexChunk): boolean;
export function serializeChunk(chunk: IndexChunkPayload): string;
export function parseIndexMessage(msg: any): ParsedIndexChunk | null;
export function packChunks(files: TeleFile[]): {
  chunks: TeleFile[][];
  manifestOmitted: boolean;
};
export function epochTimestamp(chunks: ParsedIndexChunk[]): number;
```

Rules:

- `encodeChunkIds`: first id absolute in base 36, then signed deltas. Use `-` for
  negative deltas. Comma-separated. Round-trip exactly.
- `packChunks`: chunk 0 uses a smaller file budget reserved for the manifest:
  `manifestBudget = min(2400, 24 + 12 * totalChunks)`. Chunks 1..N use
  `CHUNK_TEXT_TARGET`, max 25 files. Always keep every serialized chunk under
  `TELEGRAM_TEXT_LIMIT`; a single oversized file entry must be rejected at upload
  time, not here.
- If `totalChunks` makes the manifest exceed the budget even with zero files in
  chunk 0, return `manifestOmitted: true` and pack normally. The caller uses the
  search/pagination discovery path for that save.
- `epochTimestamp` = max `savedAt` across chunks; if none, max `editedAt`.
- `parseIndexMessage` accepts `msg.text` and `msg.message`, normalizes folder
  paths, and reads `msg.editDate ?? msg.date`. Malformed JSON, wrong
  `totalChunks`, or an out-of-range `chunkIndex` returns null. Do not throw.

Tests:

1. Round-trip ids: `[101]`, `[101, 102, 103]`, `[101, 50, 9000]` (negative
   delta), very large ids, and a 400-id list.
2. Malformed encodings throw in `decodeChunkIds` and are ignored by
   `parseIndexMessage`.
3. `packChunks` for 0, 1, 24, 25, 26, 1000 files: every chunk under 4096,
   chunk 0 under its budget, deterministic across two calls.
4. A manifest with 400 ids fits; above the bound returns `manifestOmitted`.
5. `parseIndexMessage` handles v1 chunks without `savedAt`/`chunkMsgIds`, v2
   chunks, `message` vs `text`, and `editDate`.
6. `isValidManifest` rejects missing/extra ids, duplicates, and
   `totalChunks` mismatch.
7. `epochTimestamp` prefers `savedAt` and falls back to `editedAt`.

Keep `chunkFiles` and `chunkFilesStable` exported from `indexQueue.ts` for the
existing test and any callers; implement them on top of `packChunks` or re-export.

Acceptance: new tests pass; existing `floodWaitAndUploadCoalesce` chunk tests
still pass.

## Task 2 — Discovery

Files: `src/lib/storage/metadataStore.ts`
Tests: `src/lib/storage/__tests__/discovery.test.ts`

Add:

```ts
export type DiscoveryResult =
  | {
      status: "ready";
      files: TeleFile[];
      ids: number[];
      texts: string[];
      savedAt: number;
      format: 1 | 2;
    }
  | {
      status: "incomplete";
      reason: "not_found" | "partial_manifest" | "timeout" | "network";
    };

export async function discoverIndex(
  channelId: string,
  opts?: { signal?: AbortSignal; client?: any }
): Promise<DiscoveryResult>;
```

Implementation:

1. Export a testable `discoverIndexWithClient(client, channelId, opts)`; the public
   function resolves the client and peer.
2. Fetch pinned (limit 100) and recent (limit 100) in parallel with the existing
   5s `withTimeout`. Keep the existing error tolerance.
3. Parse with `parseIndexMessage`. Build two ranked candidate lists:
   - manifest candidates (valid `chunkMsgIds`, `totalChunks === ids.length + 1`);
   - complete legacy sets from `findMostRecentCoherentEpoch`.
   Rank by `(epochTimestamp, maxMsgId)`.
4. Fetch manifest ids in batches of `min(100, ids.length)` with
   `client.getMessages(peer, { ids })`. Validate presence, order by the manifest
   (not the response), `chunkIndex`, `totalChunks`, and that chunk 0 is the
   candidate message. Try at most 3 manifest candidates.
5. If a legacy candidate wins the ranking, use it. Seed the queue with the actual
   message texts, not re-serialized JSON.
6. Search fallback: `client.getMessages(peer, { search: "teledrive_index",
   limit: 100 })`, then page with `offsetId` (or `addOffset` for search) up to
   20 pages / 15s, honoring `signal`. Repeat the ranked selection on the union.
7. History fallback: page backwards with `offsetId` in 100-message pages up to
   10,000 messages / 30s, stopping at the first ranked complete epoch.
8. Empty rule: zero messages and no index seen → ready with `[]`, one empty
   chunk, `savedAt: 0`. A non-empty channel with no complete index →
   `incomplete: not_found`.
9. On ready: set `lastIndexMsgId`, `setKnownIndex(ids, texts)`, and return the
   deduped/sorted files. Run `healAndSave` only here.
10. On incomplete: no `setKnownIndex`, no `healAndSave`, no store mutation.

Refactor `loadIndex` to call `discoverIndex` and return `result.status === "ready"
? result.files : []`. Do not change its public signature; bootstrap uses
`discoverIndex` directly. `StorageSection` and `uploadManager` keep working.

Remove the existing best-effort union branch entirely.

Tests (mock client, fixture messages):

1. Manifest chunks are outside the recent window (>100 non-index messages after
   them) but pinned; ids fetched; ready.
2. Manifest plus recent traffic; chunk 0 not pinned; found in recent; ready.
3. One named chunk missing: retry once, then incomplete; assert `healAndSave` and
   `enqueueSave` were not called (spy).
4. Legacy v1 epoch outside the window; found via search; ready.
5. Legacy v1 epoch with search disabled/throwing; found via pagination.
6. Both a stale manifest and a newer legacy epoch; legacy wins by timestamp.
7. Empty channel → ready empty.
8. Non-empty channel (a file document) with no index → incomplete.
9. `getMessages` timeout → incomplete, no writes.
10. Chunk 0 present, manifest names 3 chunks, only 1 found → incomplete.

Acceptance: discovery tests pass; the old best-effort path is gone.

## Task 3 — Store state, bootstrap gate, write gate

Files:
- `src/stores/fileStore.ts`
- `src/lib/telegram/bootstrap.ts`
- `src/lib/telegram/indexReadiness.ts` (new, small)
- `src/hooks/useFileActions.ts`
- `src/lib/upload/uploadManager.ts`
- `src/lib/backup/runner.ts`
- `src/lib/sync/remoteSync.ts`
- `src/components/layout/DriveLayout.tsx`
- `src/i18n/locales/en/messages.json`, `files.json`
Tests: `src/lib/__tests__/indexGate.test.ts`

Store additions:

```ts
indexLoadState: "loading" | "ready" | "incomplete";
indexLoadError: string | null;
setIndexLoadState(state, error?: string | null): void;
```

Initialize to `"loading"`. `setBootstrapComplete` becomes "load attempt finished"
and no longer implies writability.

`indexReadiness.ts`:

- `isIndexReady()`.
- `waitForIndexReady(timeoutMs): Promise<boolean>`.
- `assertIndexReady()` throws `IndexNotReadyError`.

Enforce at the writer in `enqueueSave`:

- If `indexLoadState !== "ready"`, reject with `IndexNotReadyError`.
- Add an internal `allowDuringRecovery` option used only by recovery-replace
  (task 7). Do not expose it broadly.
- Set `indexLoadState = "ready"` before `healAndSave` (task 2) so the healing
  save is allowed.

Bootstrap:

1. Call `discoverIndex`.
2. Ready: `setFiles`, `setIndexLoadState("ready")`, `setBootstrapComplete(true)`,
   then the existing manifest merge and orphan scan. Keep their saves
   fire-and-forget; the queue now handles them safely.
3. Incomplete: do not overwrite the store. If cached files exist, keep them;
   otherwise empty. Set `indexLoadState("incomplete")` and `indexLoadError`.
   Set `bootstrapComplete(true)` so the shell renders. Skip manifest merge and
   orphan scan on incomplete. Schedule retries with 5s/15s/30s/60s/60s backoff,
   honoring online/focus events. Clear the error and run the ready path on
   success.
4. Do not start remote sync unless ready.

`applyOptimistic`:

- Replace `!bootstrapComplete && files.length === 0` with
  `indexLoadState !== "ready"`.
- Add the typed-error handling from task 4 (reference-equality rollback).
- Keep the existing toast key for now.

Uploads/backup:

- Replace both local `waitForBootstrap` helpers with `waitForIndexReady`.
- Upload: if not ready after the wait, leave the queue item pending and retry
  when ready rather than writing.
- Backup runner: pause at the file boundary; do not write per-file when the index
  is not ready. Do not restructure the runner.

Remote sync: gate on `indexLoadState === "ready"`.

UI:

- Add a persistent banner in `DriveLayout` when incomplete: "Couldn't safely load
  your drive index. Showing cached files. Changes are disabled until
  reconnected." with a Retry button and an aria-live region.
- If there is no cache, the FileBrowser empty state becomes an error state with
  Retry, not an empty drive.
- Keep the splash visible until the first discovery attempt finishes.

i18n: add `messages:indexLoad.*` and use `files:actions.bootstrapPending` for
blocked writes. English only; other locales fall back.

Tests:

1. Ready: gate opens, write allowed.
2. Incomplete with cache: cached files preserved, write rejected, banner state
   set.
3. Incomplete without cache: empty error state, not "empty drive".
4. Retry succeeds: state flips to ready and the pending healing save runs.
5. `waitForIndexReady` resolves on ready and times out otherwise.
6. `applyOptimistic` rejects while incomplete.
7. Upload and backup paths do not call `enqueueSave` while incomplete.
8. Remote sync does not start while incomplete.

Acceptance: no write path can reach Telegram while incomplete except recovery.

## Task 4 — Queue integrity

File: `src/lib/storage/indexQueue.ts`
Tests: `src/lib/storage/__tests__/indexQueueDurability.test.ts`

Add errors:

```ts
export class IndexNotReadyError extends Error {}
export class IndexRetryExhaustedError extends Error {}
```

Add a test seam: constructor or module-level `setCommitImplForTests(fn)` so the
queue can be exercised without Telegram. Do not ship a public test API in the UI
bundle path.

Changes:

1. `enqueue`: resolve a superseded `retryingEntry` as well as `pending`.
2. `drain`: prefer `pending`; if both exist, resolve the retrying entry as
   superseded and commit pending. Never leave a promise unresolved.
3. Transient exhaustion: move the newest state to `stuckEntry`, set `failed`,
   reject with `IndexRetryExhaustedError`, retry every 60s and on manual Retry.
4. Hard error with a newer pending: reject the failing caller, continue with
   pending.
5. `flush`: cancel timers, commit the latest state with a 15s bound, do not clear
   the cache on failure. Return a result; callers can log it.
6. `flushAllQueues` awaits, does not clear queues before the flush.
7. `retryQueue` prefers `stuckEntry` if present, then the current store.
8. Only re-discover/fallback on missing-message errors; timeouts retry the same
   RPC.
9. Log distinct codes, not full payloads.

`useFileActions`:

- Roll back only when `useFileStore.getState().files === nextFiles` (reference
  equality).
- Do not roll back on `IndexRetryExhaustedError`; keep the optimistic state and
  show a retry message.

Logout (`SettingsPage`, `TelegramAccountSection`): `await flushAllQueues()`
before clearing; log failure; keep the pending marker.

Tests:

1. A in-flight retry, B enqueued, retry fires: B commits, A resolves superseded,
   no unresolved promise.
2. Hard error for A while B pending: A rejects, B commits.
3. Retry exhaustion: state retained in `stuckEntry`, failed pill, manual retry
   commits it.
4. `flush` commits the latest state.
5. `flush` failure leaves the cache intact.
6. Timeout does not trigger a full rewrite.
7. Rollback only for the current action.
8. `enqueueSave` rejects with `IndexNotReadyError` while not ready.
9. FLOOD_WAIT retries do not burn the transient counter.

Acceptance: queue tests pass; no lost promises under overlapping actions.

## Task 5 — Atomic writer

File: `src/lib/storage/indexQueue.ts` (with `indexFormat.ts`)
Tests: `src/lib/storage/__tests__/indexQueueCommit.test.ts`

Rewrite `commitOnce` around the cached set `{ ids, texts, savedAt }`.

1. Chunk with `packChunks`; serialize non-chunk-0 texts.
2. Diff against the cached texts.
3. If exactly one chunk changed and `totalChunks` is unchanged: edit that message
   in place. `MESSAGE_NOT_MODIFIED` is success. No manifest update.
4. Structural path:
   - send every changed chunk with index > 0 as a new message;
   - keep unchanged ids;
   - build the ordered id list;
   - build chunk 0 text with `chunkMsgIds`, fresh `savedAt`, and its files;
   - edit the cached chunk 0 message last (commit point);
   - after success, update the cache and delete unreferenced old ids
     (fire-and-forget).
5. Failure before the chunk 0 edit: leave the old set; record orphan ids for
   logging. Do not delete anything.
6. Failure on the chunk 0 edit: retry; the old message is intact.
7. Legacy upgrade: if the cache has no manifest, add one. Fast path may still
   edit one chunk in place; then edit chunk 0 to add `chunkMsgIds` and `savedAt`.
   If the chunk 0 edit fails, the legacy index still loads and retries next time.
8. Above the bound (`manifestOmitted`): full copy-on-write. Send every chunk as a
   new message, chunk 0 last, then delete the old set and repin chunk 0
   best-effort. No manifest; discovery uses search/pagination.
9. No cached chunk 0: discover. If still none, send all chunks and pin chunk 0
   (the only pin move).
10. Hard missing-message errors: invalidate the cache, rediscover once, retry.
    If chunk 0 is gone, full COW + repin.
11. Timeouts: retry the same RPC. Never delete-and-resend on the first timeout.
12. Cache the actual texts written, including the manifest, so the next diff is
    accurate.

Tests (fake client recording calls; assert order and call count):

1. Fast path: one changed non-zero chunk → exactly one edit; chunk 0 untouched.
2. Fast path on chunk 0 → one edit; manifest unchanged.
3. Structural grow: new trailing chunks sent, chunk 0 edited last, old ids
   deleted only after.
4. Structural shuffle: boundaries shift; unchanged chunks reused; changed ones
   re-sent; manifest matches.
5. Shrink: extras deleted after the commit.
6. Failure on a new chunk send → chunk 0 never edited; the old set still loads.
7. Failure on the chunk 0 edit → old set still loads; retry succeeds.
8. Crash after the chunk 0 edit but before deletes → new set loads; orphans are
   ignored.
9. Legacy cache upgrade adds the manifest with one chunk 0 edit.
10. Above the bound uses full COW and repins.
11. Timeout on a chunk edit retries the same message id.
12. `MSG_ID_INVALID` triggers exactly one rediscovery, then a full COW.
13. `savedAt` advances on the changed chunk and `epochTimestamp` increases.

Acceptance: no sequence of injected failures can produce a mixed epoch where the
old index is unreadable.

## Task 6 — Pending local snapshot

Files:
- `src/lib/storage/pendingIndex.ts` (new)
- `src/stores/fileStore.ts`
- `src/lib/storage/indexQueue.ts`
- `src/lib/telegram/bootstrap.ts`

API:

```ts
export interface PendingIndexMarker {
  channelId: string;
  baseSavedAt: number;
  at: number;
}
export function writePendingMarker(marker: PendingIndexMarker): void;
export function readPendingMarker(channelId: string): PendingIndexMarker | null;
export function clearPendingMarker(channelId: string): void;
```

- `enqueue` writes the marker synchronously and calls `flushFileCacheNow()`.
- Successful commit clears the marker.
- Bootstrap, after ready:
  - if marker exists and `baseSavedAt >= loaded.savedAt`, keep the cached files,
    do not overwrite with the loaded index, and enqueue one save once ready;
  - if the loaded timestamp is greater, clear the marker;
  - unknown/0 base: merge only if the cache has ids the loaded index lacks
    (additive merge, never remove).
- Logout keeps the marker on flush failure.

Tests:

1. Marker round-trip and per-channel isolation.
2. Commit clears it.
3. Crash simulation: newer cache + marker wins on bootstrap and is saved.
4. Newer remote timestamp discards the marker.
5. Legacy/unknown base additive merge keeps loaded files.
6. Logout failure keeps the marker.

Acceptance: no action is lost across a crash or logout when the cache is newer.

## Task 7 — Recovery

Files:
- `src/lib/storage/recovery.ts` (new)
- `src/lib/storage/__tests__/recovery.test.ts`
- `src/components/settings/RecoveryDialog.tsx` (new)
- `src/components/settings/StorageSection.tsx`
- `src/lib/telegram/bootstrap.ts`
- `src/i18n/locales/en/settings.json`, `messages.json`

API:

```ts
export interface RecoverableFile {
  file: TeleFile;
  epochAt: number;
  epochMsgIds: number[];
}
export interface RecoveryReport {
  scannedEpochs: number;
  scannedChunks: number;
  recoverable: RecoverableFile[];
  cancelled: boolean;
}
export async function scanIndexHistory(
  channelId: string,
  signal?: AbortSignal
): Promise<RecoveryReport>;
export async function replaceIndexFromRecovery(
  channelId: string,
  files: TeleFile[]
): Promise<void>;
```

- Scan uses search + pagination, bounded at 5,000 chunk messages / 60s,
  cancellable. Parse with the shared parser. Group into epoch candidates
  (manifest and legacy).
- Union files by id and content key; exclude ids already in the current index.
- Read-only. No writes, no deletes.
- `replaceIndexFromRecovery` is the only writer allowed while incomplete. It
  writes a fresh v2 generation through the queue with `allowDuringRecovery`,
  then sets `indexLoadState` ready.
- One-time auto detection after the first ready bootstrap per channel (localStorage
  marker). If candidates exist, open the dialog. Never auto-restore.
- Settings → Storage → "Recover files from channel history".
- Review dialog: grouped by epoch timestamp, select-all per group, count, and a
  clear warning that older versions may include files the user deleted.
- Verify every selected file still has a live Telegram message before restore;
  skip and report missing ones.

Tests:

1. Multiple epochs; current files excluded.
2. Cancellation returns `cancelled: true` and zero writes.
3. Duplicate content across epochs merges once.
4. Restore path writes a v2 generation and flips ready.
5. Missing Telegram message is skipped, not restored.
6. The scan never calls `enqueueSave`/`saveIndex`.

Acceptance: an existing damaged library can be reviewed and restored without any
automatic write.

## Task 8 — Copy, banner, and logging polish

- English keys for the incomplete banner, retry, recovery dialog, and retry
  exhausted.
- aria-live on the banner and recovery status; button labels, not icon-only.
- Log codes: `INDEX_DISCOVERY_START/OK/INCOMPLETE`, `INDEX_MANIFEST_OK/OMITTED`,
  `INDEX_COMMIT_FAST/STRUCTURAL/OK/FAIL`, `INDEX_RECOVERY_SCAN`.
- Ensure logs do not include file names, absolute paths, or file contents.

Acceptance: `npm run build` passes with the new strings; no missing key warnings
in English.

## Task 9 — Verification

Automated:

```bash
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Manual scenarios:

1. Index with 3+ chunks, then upload 150 files. Cold start shows every file.
2. Kill the app between new chunk sends and the chunk 0 edit. Restart shows the
   previous index, not a partial one.
3. Strip `chunkMsgIds` from chunk 0 (simulate v0.1.2). App loads; the next star
   upgrades it; restart still loads.
4. Simulate a missing named chunk. App shows cached files read-only with Retry;
   it never writes.
5. Recover files from an older epoch; confirm; cold start keeps them.
6. Star, rename, trash, move: each triggers one edit in the fast path (inspect
   logs) and survives a restart.
7. Logout immediately after an action; relaunch; the action is present.
8. Two chunks of 50 files: add one file; only trailing chunks change; the index
   remains loadable at every step.
9. Kill the network during a save; the UI stays optimistic; reconnect completes
   it.

Release notes: add a short entry describing the index durability fix and the
one-time recovery scan. Do not claim anything about encryption or multi-device
edits.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Telegram search tokenisation differs | Pagination is the correctness path; test both |
| `getMessages({ids})` flood limits at scale | Batch 100, back off on FLOOD_WAIT, cap 3 manifest attempts |
| Chunk 0 manifest size | Reserve budget; full COW above the bound |
| Old app writes after upgrade | Unified timestamp ranking; legacy path still loads |
| Rewriting `commitOnce` breaks upload/backup saves | Test each failure injection; keep the queue's public API |
| Double writes during bootstrap | Gate at `enqueueSave`; recovery is the only bypass |
| Blocking writes annoys users on flaky networks | Retry with backoff; cached files remain browsable; clear banner |

## Out of scope (explicit)

- Multi-device edit/delete propagation.
- Backup O(N²) writes and manifest batching.
- Preview streaming, virtualization, bundle splitting.
- Encryption, Stronghold, filesystem command scoping.
- Any UI redesign beyond the banner and recovery dialog.
