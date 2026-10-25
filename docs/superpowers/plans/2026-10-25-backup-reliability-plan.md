# Device Backup Reliability — Implementation Plan

Design: `docs/superpowers/specs/2026-10-25-backup-reliability-design.md`
Date: 2026-10-25
Status: Draft for approval — do not implement until the design is approved.

Scope: `src/lib/backup/*`, the backup UI, the backup commands in
`src-tauri/src/lib.rs`, and the bootstrap manifest merge. Do not change index
format/durability, preview streaming, encryption, or the regular upload queue.

## Execution rules

- Tests ship with each task. A task is done only when its tests and the full
  suite pass.
- Keep each task shippable. Task 1 includes the runner/bootstrap call-site
  updates needed to keep the app compiling; Tasks 2 and 3 land together.
- The old vault manifest must remain readable until Task 1's migration has
  shipped.
- Never commit unless the user asks.
- After each task: `npm test && npm run build`. After Rust changes:
  `cargo check --manifest-path src-tauri/Cargo.toml` and
  `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets`.
- No new comments that restate code. Keep comments for invariants only.
- Do not log absolute paths or file names in new code; log counts, ids, and
  error codes.
- English i18n keys are required; other locales fall back. Do not claim
  encryption or cross-device version restore in release notes.

## Task 0 — Baseline and test scaffolding

1. Run and record baseline:
   ```bash
   npm test
   npm run build
   cargo check --manifest-path src-tauri/Cargo.toml
   ```
2. Confirm there are no backup tests today (`find src -path '*backup*test*'`).
3. Add test helpers under `src/lib/backup/__tests__/helpers.ts`:
   - in-memory `invoke` mock for manifest/journal commands;
   - fake uploader returning incrementing message ids;
   - fake `TeleFile` factory and fresh `useFileStore` reset.
4. Do not change runtime behavior.

Acceptance: baseline recorded; helpers compile; suite unchanged.

## Task 1 — Manifest v2, per-channel storage, journal, migration

Files:
- `src/lib/backup/manifest.ts` (rewrite storage layer; keep pure helpers)
- `src-tauri/src/lib.rs` (new commands)
- `src/lib/backup/__tests__/manifest.test.ts` (new)
- `src-tauri/src/lib.rs` Rust tests (atomic write, journal replay)

Rust commands (register in `invoke_handler`):

```rust
#[derive(serde::Serialize)]
struct BackupManifestLoad {
    base: Option<String>,
    generation: u64,
    journal: Vec<String>,
}

#[tauri::command]
fn load_backup_manifest(app: AppHandle, channel_id: String)
    -> Result<BackupManifestLoad, String>;

#[tauri::command]
fn save_backup_manifest(app: AppHandle, channel_id: String, value: String, generation: u64)
    -> Result<u64, String>;

#[tauri::command]
fn append_backup_manifest_journal(app: AppHandle, channel_id: String, generation: u64, line: String)
    -> Result<(), String>;

#[tauri::command]
fn quarantine_backup_manifest(app: AppHandle, channel_id: String, suffix: String)
    -> Result<Option<String>, String>;
```

Rules:

- Path: `app_data_dir()/backup_manifests/<safe-channel-id>.json` and
  `<safe-channel-id>.journal.jsonl`. Sanitize the channel id and append a short
  hash to avoid collisions.
- `load_backup_manifest`: return base, generation, and journal in **one**
  mutexed read so a concurrent save cannot produce a stale/mixed pair. Missing
  base = `None`, generation 0, empty journal.
- `save_backup_manifest`: serialize with a static mutex; parse the supplied
  JSON, set `generation = input + 1`, write a temp file in the same directory;
  flush/sync; rename over the target; then truncate the journal. Return the new
  generation. On failure, leave the previous file and journal intact.
- `append_backup_manifest_journal`: single `OpenOptions::append`, one line
  prefixed with the caller's generation, then `sync_all`. Reject the append if
  the on-disk generation differs.
- Journal lines whose generation differs from the loaded base are ignored
  during replay. This makes `save`→`truncate` crash-safe.
- Harden the shared vault commands used by migration/quarantine
  (`save_vault_value`, `quarantine_vault_value`, `delete_vault_value`) with the
  same mutex + temp/sync/rename pattern. Do not rewrite a vault file
  non-atomically.
- `quarantine_backup_manifest`: copy the base file (and journal) to
  `<safe>-corrupt-<suffix>.json` / `.jsonl`, then remove the originals; return
  the base value for diagnostics.
- Never panic on malformed filenames; return an error string.

TypeScript API:

```ts
export interface ManifestEntryV2 {
  size: number;
  mtimeMs: number;
  messageId: number;
  folderPath: string;
  uploadedAt: string;
  hash?: string;
  sourceMissing?: boolean;
  previousMessageIds?: number[];
}

export interface BackupManifestV2 {
  version: 2;
  generation: number;
  channelId: string;
  deviceName: string;
  deviceOs: string;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastResult: BackupRunSummary | null;
  entries: Record<string, ManifestEntryV2>;
  garbage: { messageId: number; folderPath: string; since: number }[];
}

export interface BackupRunSummary {
  status: "success" | "partial" | "failed" | "cancelled";
  uploaded: number;
  skipped: number;
  failed: number;
  missingRoots: string[];
}

export async function loadManifest(channelId: string): Promise<BackupManifestV2>;
export async function saveManifest(
  channelId: string,
  manifest: BackupManifestV2
): Promise<number>;
export async function appendManifestEntry(
  channelId: string,
  generation: number,
  absPath: string,
  entry: ManifestEntryV2
): Promise<void>;
export async function migrateLegacyManifest(
  channelId: string,
  verifyMessageIds: (ids: number[]) => Promise<Set<number>>
): Promise<{ migrated: boolean; entries: number }>;
export function isManifestCorrupt(channelId: string): boolean;
export function resetManifestCorrupt(channelId: string): void;
```

- Keep the corruption sentinel/quarantine behavior; route new corruption to
  `quarantine_backup_manifest`.
- Journal replay: parse each non-empty line; ignore a trailing partial/corrupt
  line; ignore lines whose generation is not the base generation; last entry
  per `absPath` wins.
- Migration: read the legacy vault key `teledrive_backup_manifest_v1`; sample at
  most 5 message ids; call `verifyMessageIds`; adopt only when every sampled id
  is live. Save v2 first, then quarantine the legacy key via the atomic
  `quarantine_vault_value`. If verification fails, times out, or any sample is
  missing, quarantine and start empty. Never delete the legacy key before the
  v2 save succeeds.
- Call site: add `ensureManifest(channelId, verifyMessageIds)` that runs
  migration once per session (module-level `Set<string>`) and returns the v2
  manifest. `runner.ts` and `bootstrap.ts` both call it. A verifier is built
  from one `getMessages({ids})` batch via `resolveChannelInputPeer`; if that
  call fails, migration is skipped (empty manifest) and retried next session.
- Corruption is tracked per channel in a `Set<string>`; a valid load clears only
  that channel's sentinel.
- Channel resolution guard: resolve the per-phone channel id; when a phone is
  signed in and its per-phone key is absent, do not fall back to the legacy
  global channel key. Fail the backup with a clear "channel not ready" state
  instead of sharing another account's manifest.
- `emptyManifest(channelId)` includes device fields, generation 0, and empty
  garbage.
- Update `runner.ts` and `bootstrap.ts` in this task to use
  `ensureManifest`/`appendManifestEntry(new signature)`; keep behavior
  otherwise unchanged so the app still compiles and backs up between Tasks 1
  and 2.
- Keep `diffAgainstManifest`, `recordUpload`, `guessMimeFromName`,
  `manifestEntryToTeleFile`; update them to the v2 entry type.

Tests:

1. v2 round-trip survives save/load; corrupt base is quarantined and that
   channel's sentinel is set.
2. Journal replay: two appends for the same path, the later wins; a trailing
   half-written JSON line is ignored; a line from an older generation is
   ignored.
3. Atomic save failure leaves the previous manifest readable.
4. Migration adopts only when every sampled id is live; a single missing id
   refuses; quarantine happens exactly once.
5. Two channel ids never see each other's entries.
6. `lastResult`/`lastSuccessAt` round-trip.
7. Rust: combined load returns base+journal from one lock; append then load
   preserves order; save increments generation and truncates; crash between
   rename and truncate cannot resurrect an old line; rename failure does not
   remove the old file.
8. Legacy vault write/quarantine is atomic and leaves the old vault readable on
   failure.
9. Migration starts empty and quarantines the legacy key when
   `verifyMessageIds` rejects.

Acceptance: manifest v2 reads legacy data safely, writes atomically, and all
tests pass.

## Task 2 — Walker correctness and structured result

Files:
- `src/lib/backup/walker.ts`
- `src-tauri/src/lib.rs`
- `src/lib/backup/__tests__/walker.test.ts` (new)

API change:

```ts
export interface WalkRootStatus {
  path: string;
  status: "ok" | "empty" | "missing" | "unreadable" | "truncated";
  skipped?: number;
}
export interface WalkResult {
  files: WalkedFile[];
  roots: WalkRootStatus[];
  cancelled: boolean;
  complete: boolean;
  errors: { path: string; code: string }[];
}
export async function walkSourceFolders(
  folders: BackupSourceFolders,
  opts?: { signal?: AbortSignal; runId?: string }
): Promise<WalkResult>;
```

Rules:

- Track normalized absolute prefixes of directories excluded by the user and by
  defaults; skip any file under a pruned prefix. This fixes `build` excluding
  the entry but not `build/child.js`.
- Add the app data directory to the pruned prefixes and emit a warning if a
  source root contains it. New Rust command `get_app_data_dir() -> String`.
- Rust walker: skip symlinks and non-regular files using
  `symlink_metadata().file_type()`; do not follow links.
- Root status:
  - `ok` when the walk produced at least one file;
  - `empty` when the directory exists but contains no uploadable files;
  - `missing` when stat/read_dir says not found;
  - `unreadable` for permission/other IO errors;
  - `truncated` when the root exceeds the entry cap.
- `complete` is false when cancelled, truncated, or any subdirectory could not
  be read. Cancellation returns `cancelled: true` with partial files. Callers
  must not treat an incomplete walk as a complete scan (no `sourceMissing`).
- Cancellable Rust walk: pass a `run_id`; add `cancel_backup_walk(run_id)` that
  sets a shared flag. The walker checks it between entries and returns partial
  results with `cancelled: true`. Cancelling the JS `AbortSignal` calls this
  command.
- Unreadable subdirectories are recorded in `errors` and make the walk
  incomplete instead of being logged and silently ignored.
- Deduplicate files by absolute path across overlapping roots (longest root
  wins for display later, but one file entry only).
- Keep `sanitizeFolderSegment` unchanged.
- Add a per-root entry cap (default 250,000) with an explicit `truncated`
  warning; do not silently return a partial tree. Treat it as `partial`.
- P1: derive a `prune` list of literal directory prefixes from the excludes
  (`build`, `node_modules`, `.git`, the app data dir) and pass it to Rust so
  excluded trees are never traversed. JS filtering stays authoritative for
  files and complex globs.

Tests:

1. `build` exclude drops `build/child.js` and nested children.
2. Default excludes still drop `node_modules`, `.git`, `.DS_Store`.
3. Overlapping roots produce one entry per file.
4. Missing/unreadable/empty roots report the right status and do not throw.
5. Abort mid-walk returns `cancelled`, partial files, and `complete: false`.
6. App data directory under a selected home root is never returned.
7. Unreadable subdirectory sets `complete: false` and does not mark its files
   missing.
8. Rust: symlink, FIFO, and device files are skipped; regular files are
   returned; `cancel_backup_walk` stops a large walk promptly.

Acceptance: runner receives a truthful walk result; excluded subtrees cost no
uploads.

## Task 3 — Runner: containment, replacement, durable run state

Files:
- `src/lib/backup/runner.ts`
- `src/lib/backup/telegramOps.ts` (new: bounded message deletion)
- `src/lib/backup/__tests__/runner.test.ts` (new)
- `src/lib/backup/indexSave.ts` (new: coalesced index writer)

Runner rules:

- Move all per-file path derivation/validation (source root, folder segments,
  length cap) inside the per-file `try`. A per-file error increments
  `filesFailed`, records a capped error message, and continues.
- Run status:
  - `cancelled` when the signal aborted, regardless of prior uploads;
  - `failed` when no file uploaded and `filesFailed > 0` or all roots failed;
  - `partial` when some uploaded and some failed, or any root missing;
  - `success` otherwise.
- `missingFolders` comes from walker root statuses (`missing`/`unreadable`).
  A `truncated` root, an unreadable subdirectory, or `complete: false` also
  forces `partial` and surfaces a warning. Never treat those files as deleted.
- Before uploading a file with no manifest entry, adopt a matching store entry
  from the backup namespace (`folderPath`, `name`, `size`, `uploadedAt` within
  the last hour, and uploaded after the previous attempt started) into the
  manifest and count it skipped. This reconciles an upload that succeeded just
  before a crash; it does not adopt historical copies of same-name/size files.
- On a changed file:
  1. Re-read the prior manifest entry.
  2. Upload the new content.
  3. Append the new manifest entry with
     `previousMessageIds = [prior.messageId, ...(prior.previousMessageIds ?? [])]`
     via `appendManifestEntry(channelId, manifest.generation, absPath, entry)`
     (durable before the index move). If this append fails, count the file
     failed and leave the old manifest entry, store entry, and message
     untouched.
  4. Replace the store entry by removing every file whose `messageId` is in
     `previousMessageIds`, then add the new `TeleFile` (and reconstructed
     folders).
  5. Coalesced index save.
- New file: upload, append manifest entry, add store entry, coalesced save.
- Mark `sourceMissing = true` on manifest entries reported by `diff.missing`
  only when `walk.complete`, no root is missing/unreadable/truncated, and their
  source root is healthy; clear it when the file is seen again. Save at run
  end.
- Hoist one `waitForIndexReady` before the upload loop; per file only check the
  current readiness (no repeated 8s waits).
- Index persistence through `indexSave.ts`:
  - `queueBackupIndexSave(channelId, files)` debounces ~2s and never throws;
  - `flushBackupIndexSave(channelId)` awaits the final save and returns
    `{ ok: boolean; error?: string }`;
  - on hard error, log and keep the manifest (bootstrap merge will repair);
  - `saveManifest` returns the new generation; update the in-memory manifest's
    `generation` before any later append.
- At the end (including cancel/fatal):
  - set `lastAttemptAt`, `lastSuccessAt` only on `success`/`partial`,
    `lastResult`, and save the manifest (compaction);
  - set `setLastBackupAt` from `lastSuccessAt`.
- Garbage collection only when the final `flushBackupIndexSave` returns
  `ok: true`:
  - sweep **every** manifest entry's `previousMessageIds` plus `garbage`;
  - build `referenced` from the final file set and delete only ids not
    referenced;
  - delete via `deleteMessages(peer, ids)` in `telegramOps.ts` with bounded
    retry;
  - clear ids that were deleted or are still referenced; keep failures in
    `garbage` for the next run;
  - if the final save failed, move no ids and delete nothing.
- Do not count a cancelled run as a failure; keep `error` informative.
- Keep the per-batch breather and index-not-ready pause. Pause before any
  upload when the index is not ready:
  - zero uploads → `failed` with the "changes paused" error, so the catch-up
    check retries and `lastSuccessAt` does not advance;
  - some uploads → `partial`.
- Never throw out of `runBackup` for per-file errors; only unexpected
  programming errors may reject (and the controller catches them).

Tests (mock uploader/client/index save):

1. A path-length violation on file 2 of 3 does not abort; files 1 and 3 upload,
   status `partial`.
2. Hard auth error aborts after the first file; remaining counted failed; status
   `failed`/`partial` correctly.
3. Cancel after two uploads returns `cancelled`, keeps those two manifest
   entries, and does not delete old messages.
4. Changed file (different size) leaves exactly one store entry and one live
   message after GC; old message id is deleted.
5. Failed final index commit keeps `previousMessageIds` and does not delete old
   messages.
6. No-op run writes `lastAttemptAt`/`lastSuccessAt` and advances
   `lastBackupAt`.
7. Missing root returns `partial` with `missingFolders` and uploads files from
   the healthy root.
8. Index-not-ready before the first file uploads nothing and reports the paused
   state.
9. Crash after upload before journal append: restart plus orphan scan adopts the
   existing message and does not upload a duplicate.
10. Crash after journal append before final index save: the next run deletes
    the superseded message only after a successful commit; the committed index
    has no dangling reference.
11. `appendManifestEntry` failure (disk full) keeps the old store entry and old
    message, and reports the file failed.
12. An incomplete walk does not mark entries `sourceMissing`.

Acceptance: one bad file cannot lose a run; replacements never duplicate.

## Task 4 — Bootstrap merge and cross-restart reconciliation

Files:
- `src/lib/telegram/bootstrap.ts`
- `src/lib/backup/manifest.ts` (export helpers)
- `src/lib/__tests__/backupMerge.test.ts` (new)

Rules:

- `mergeBackupManifestSync(channelId, existingFiles, setFiles)` uses the
  channel-scoped v2 manifest.
- Run orphan-scan recovery first, then reconcile. Build
  `superseded = Set(previousMessageIds)` across entries and `garbage` ids and
  drop those ids from the combined file list **after** the orphan scan, before
  `setFiles`/save. Do not merge before the scan.
- Inside `/TeleDrive Backups`, if two entries share `(folderPath, name)`, keep
  the one whose messageId matches the manifest's current entry; else keep the
  newest `uploadedAt`/messageId.
- Adopt a matching recent orphan entry (`folderPath`, `name`, `size`,
  `uploadedAt` within one hour) into the manifest before filtering, so a crash
  window cannot re-upload it.
- Track a `changed` boolean for both additions and removals; save when it is
  true (never compare only `merged.length > files.length`).
- Restore `lastBackupAt` from `lastSuccessAt` on bootstrap (store + UI).
- A missing/corrupt manifest must not block bootstrap; log and continue.
- Do not verify every manifest message id at bootstrap; only superseded/garbage
  filtering. Verification stays lazy.
- Fire-and-forget index save only when entries were added or removed.

Tests:

1. Manifest entries from channel A are not merged when bootstrapping channel B.
2. A superseded old id is dropped even though it is present in the index.
3. Two same-path backup entries resolve to the manifest's current messageId.
4. `lastSuccessAt` populates `lastBackupAt`.
5. Corrupt/missing manifest leaves existing files unchanged.
6. Orphan scan re-adds a superseded id: it is dropped after the scan and the
   save fires even when the file count is unchanged.
7. A crash-window orphan with matching path/name/size is adopted, not
   duplicated.

Acceptance: a crashed replacement does not leave two visible copies after
restart.

## Task 5 — Single run controller, cancel, progress

Files:
- `src/lib/backup/controller.ts` (new)
- `src/lib/backup/scheduler.ts`
- `src/hooks/useBackupRunner.ts`
- `src/hooks/useBackupSchedule.ts`
- `src/components/backup/BackupProgressOverlay.tsx`
- `src/components/settings/BackupSection.tsx`
- `src/stores/backupProgressStore.ts`
- tests under `src/lib/backup/__tests__/controller.test.ts`

API:

```ts
export function startBackup(opts: {
  triggeredBy: "manual" | "auto";
  reason?: "manual" | "scheduled" | "catch-up";
  signal?: AbortSignal; // for tests/callers
}): Promise<BackupRunResult>;
export function cancelBackup(): boolean;
export function isBackupRunning(): boolean;
```

Rules:

- One active run; a second request while active returns the active promise
  (manual click during auto run shows the same progress) instead of queueing a
  duplicate.
- Controller owns the `AbortController`, `start/setProgress/finish/fail/cancel`
  transitions, and the `backup-running` file-store state.
- `cancelBackup` aborts the active run; the runner checks the signal between
  files and between upload chunks if the uploader accepts a signal, and calls
  `cancel_backup_walk`. An in-flight chunk/commit is allowed to finish; do not
  claim mid-RPC abort.
- Overlay shows a Cancel button while active for both manual and auto runs.
- Settings Cancel calls `cancelBackup` (not a hook-local controller).
- Remove the duplicate progress logic from `runBackupNow`/`useBackupRunner`.
- `useBackupRunner.runNow` delegates to the controller and mirrors store state
  for the button.

Tests:

1. Two `startBackup` calls result in one runner invocation.
2. Cancelling an auto run aborts it and reports `cancelled`.
3. Overlay state transitions: walking → uploading → done/failed/cancelled.
4. A second manual call during an active run does not start a second upload.

Acceptance: every run is visible and cancellable from anywhere.

## Task 6 — Scheduled catch-up and durability

Files:
- `src/lib/backup/schedule.ts` (new pure due calculation)
- `src/lib/backup/scheduler.ts`
- `src/components/RemoteSyncOrchestrator.tsx`
- `src/stores/licenseStore.ts` (persist `backupScheduleEnabledAt` per device)
- tests `src/lib/backup/__tests__/schedule.test.ts`

Rules:

- `isBackupDue({ now, lastSuccessAt, lastAttemptAt, lastResult, scheduleEnabledAt, intervalMinutes })`:
  - false if no interval or interval <= 0;
  - anchor = `max(lastSuccessAt ?? 0, scheduleEnabledAt)`;
  - due when `now - anchor >= interval`;
  - not due if `lastAttemptAt` is within the last 30 minutes and
    `lastResult?.status` is `failed` or `cancelled`;
  - one due decision per check; no loops.
- When the user enables/changes a schedule, set `scheduleEnabledAt = now`.
- Check due on:
  - after bootstrap is ready and folders exist;
  - `visibilitychange` → visible and window `focus`;
  - every 5 minutes while authenticated.
- Skip when a run is active or the index is not ready; leave the due state
  unchanged and retry on the next check.
- The Rust interval tick remains but is only a hint: its listener calls the
  same `isBackupDue` check instead of `runBackup` unconditionally. Both paths
  go through the controller, so no overlap.
- On successful manual/auto run, `lastSuccessAt` advances; failed/cancelled runs
  do not.

Tests:

1. First run waits one interval after enabling.
2. App launched 2 intervals later runs once.
3. Failed attempt is not retried within 30 minutes; retried after.
4. Index not ready does not consume the due window.
5. Interval change resets the due anchor via `scheduleEnabledAt`.
6. A Rust tick while a due run is active does not start a second run.

Acceptance: closing the app no longer stops daily backups permanently.

## Task 7 — Content hashing (P1, not part of the reliability release)

Files:
- `package.json` / `package-lock.json` (`@noble/hashes`)
- `src-tauri/Cargo.toml` (`sha2 = "0.10"`)
- `src-tauri/src/lib.rs` (`hash_file`)
- `src/lib/telegram/uploader.ts` (incremental hash over read chunks)
- `src/lib/backup/runner.ts`
- `src/lib/backup/manifest.ts`
- tests `src/lib/backup/__tests__/hashDiff.test.ts`

Rules:

- `hash_file(path) -> String` streams the file in 512 KiB chunks and returns
  lowercase hex SHA-256; errors return a string error.
- Diff fast path: if `(mtimeMs, size)` matches, skip.
- If they differ and the manifest entry has a hash, hash the local file; if
  equal, update `mtimeMs`/`size` in the manifest and count it as skipped (no
  upload).
- `uploadFileToTelegram` accepts an optional `hash?: boolean`; when enabled it
  feeds every read chunk into an incremental SHA-256 and resolves with the
  hash alongside the message. Regular uploads are unchanged.
- Store the hash for every uploaded file; if hashing fails, leave it empty and
  keep the upload.
- Cap hashing at a configurable size (default 2 GiB) to avoid pathological
  slowdowns; above the cap, upload on mtime/size change without a hash.
- Do not hash on every run; same-mtime/same-size changes remain undetected in
  fast mode and are documented.

Tests:

1. Touched file with identical content is skipped, mtime updated.
2. Changed content with same size but a new mtime is uploaded (hash differs).
3. Every successful upload records the streamed hash; a hash failure does not
   fail the upload.
4. Hash above the size cap is skipped for the comparison and the upload
   proceeds without a stored hash.
5. Rust hash matches a known vector and agrees with the JS incremental hash.

Acceptance: touch-only changes stop causing full re-uploads. This task can be
dropped without affecting Tasks 0-6, 8, and 9.

## Task 8 — UI, copy, and i18n

Files:
- `src/components/settings/BackupSection.tsx`
- `src/components/backup/BackupProgressOverlay.tsx`
- `src/pages/BackupsPage.tsx` (empty state copy only)
- `src/i18n/locales/en/settings.json`
- `src/i18n/locales/en/drive.json`
- `src/i18n/locales/en/messages.json`

Rules:

- Settings shows last **successful** backup and last attempt with status
  (`success|partial|failed|cancelled`); never show "never" after a completed
  run.
- Missing/unreadable roots: inline warning with the count and a link to edit
  folders. Do not show a success toast for a run with missing roots.
- Cancelled runs show "Cancelled — will resume next run", not an error.
- Overlay: Cancel button (text, not icon-only), phase label, current file
  basename (not the absolute path), and `aria-live="polite"`.
- All new keys in English; other locales fall back.
- Do not expose absolute paths in logs or analytics.

Acceptance: `npm run build` passes; no missing English keys; states are
distinguishable.

## Task 9 — Verification

Automated:

```bash
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --manifest-path src-tauri/Cargo.toml
```

Manual scenarios:

1. Back up in account A, log out, log in to account B: B's manifest is empty
   and A's entries are not merged.
2. Kill the app after 5 of 20 uploads; relaunch: the first 5 are skipped, the
   run resumes, and no duplicates appear.
3. Change a file's size and run: exactly one Backups entry remains; the old
   Telegram message is gone after success.
4. Delete a local file and run: the backup copy remains; no failure.
5. Unmount a source drive and run: warning, `partial`, other roots upload, no
   deletions.
6. Exclude `build`: `build/child.js` is not uploaded. A symlink is not
   uploaded.
7. Close the app across two daily intervals; launch: exactly one catch-up run.
8. Cancel an automatic run from the overlay mid-upload; resume later.
9. Make the index incomplete; start a backup: no files upload and the run says
   paused.
10. Touch a file without changing content (P1): it is skipped.
11. Kill the app between upload success and journal append, relaunch, run: the
    existing backup message is adopted and no duplicate appears.
12. Kill the app after journal append but before the index save, relaunch: the
    old copy is removed only after a successful commit and no dangling entry
    remains.

Release notes: one short entry covering reliable resume, per-account manifest,
catch-up scheduling, cancellation, and replacement cleanup. Do not claim
encryption or cross-device version restore.

## Dependencies and order

- Task 1 can ship independently; it updates call sites and preserves legacy
  reads.
- Tasks 2 and 3 land together (the walker result and runner are coupled).
- Task 4 depends on Tasks 1 and 3.
- Task 5 depends on Task 3.
- Task 6 depends on Task 5.
- Task 7 is P1 and should ship last or be deferred.
- Task 8 after Tasks 3-6.
- Task 9 after all chosen tasks (run it after P0 before starting P1).

## Risks

| Risk | Mitigation |
| --- | --- |
| Migration adopts wrong account | Per-phone channel resolution; every sampled id must be live in the current channel; otherwise start empty |
| Journal grows without bound | Compact on every successful `saveManifest`; corrupt trailing line is ignored |
| Old message deleted while still referenced | GC sweeps all entries only after a successful final index commit and skips ids still referenced; failures stay in `garbage` |
| Catch-up surprises the user | One run per due period, bootstrap/index-ready gates, cancellable |
| Rename not atomic on Windows | Temp write + sync + replace; never remove the old file before the temp is durable |
| Double uploads during a crash window | Adopt a matching recent backup entry before upload; journal append after each upload; bootstrap filters `previousMessageIds` after the orphan scan |
| Hash reads slow down backups | P1 only; hash only changed files; size cap; fast mode default |
