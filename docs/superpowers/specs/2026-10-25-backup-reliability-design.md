# Device Backup Reliability — Design

Date: 2026-10-25
Status: Draft for approval
Related: `docs/superpowers/plans/2026-10-25-backup-reliability-plan.md`

## Intent

Device backup currently works on the happy path: it walks configured local
folders, diffs a local manifest, uploads new/changed files, and merges each
result into the Telegram index. It is not yet safe to call a backup:

- One bad path can abort an entire run.
- Replaced files leave stale index entries and duplicate Telegram messages.
- The manifest is shared by every Telegram account on the install.
- The manifest and "last backup" state are not crash-safe or durable.
- Scheduled runs do not catch up after the app was closed and cannot be
  cancelled.
- The walker uploads children of user-excluded directories and follows
  symlinks.

The goal is a backup that a user can trust: it runs when due, resumes safely,
never duplicates a file silently, never loses index state, and tells the truth
about missing folders and failures.

## Goals

1. Correct incremental semantics: a changed local file produces exactly one
   live backup entry, and the previous copy is removed only after the new index
   state is committed.
2. Per-account/per-channel manifest isolation, with safe migration from the
   existing global manifest.
3. Crash-safe manifest writes and durable `lastAttemptAt` / `lastSuccessAt` /
   `lastResult`.
4. Per-file failure containment: a bad file/path is reported and skipped; only
   auth/session and index-unavailable errors stop the run.
5. Accurate run status: `success`, `partial`, `failed`, `cancelled`, including
   missing source roots.
6. Scheduled backups catch up after sleep/launch, never overlap, and can be
   cancelled from the overlay or Settings.
7. Excludes prune subtrees; symlinks and non-regular files are never uploaded.
8. The app's own data directory and other sensitive app state are never backed
   up by accident.
9. Tests cover every failure mode above without a real Telegram account.

## Non-goals

- Point-in-time version restore or a version browser. Old copies are kept only
  as a safety window and then deleted; the recovery UI planned separately
  handles index recovery, not file version restore.
- End-to-end encryption or client-side encryption of backups.
- Cross-device manifest replication. Each device keeps its own manifest; the
  Telegram index remains the cross-device view.
- Changing backup throughput targets (chunk size, parallel uploads, Rust
  streaming protocol).
- Redesigning the Backups browser or My Drive visibility rules.
- Removing the legacy snapshot/activity code in this pass.

## Decisions

### Backup semantics: mirror-on-change with a safety window

- New file: upload and add one index entry.
- Changed file: upload the new content, replace the old index entry, then
  best-effort delete the old Telegram message after the run's index state has
  committed. If deletion fails, the message id goes into a retryable garbage
  list.
- File deleted locally: keep the Telegram copy and mark the manifest entry
  `sourceMissing`. Do not delete it automatically.
- Source root missing/unreadable: warn, do not treat its files as deleted, and
  report `partial` (or `failed` if nothing could be read).
- If a run fails or is cancelled before the index commit, old copies stay.

### Manifest: per-channel, version 2, separate file, atomic writes

Manifest file path: app data dir / `backup_manifests/<channelId>.json`. The
channel id must be resolved per account: do not fall back to the legacy global
channel key when the signed-in phone has no per-phone channel id. The existing
vault key is read only for migration.

```ts
interface BackupManifestV2 {
  version: 2;
  generation: number;
  channelId: string;
  deviceName: string;
  deviceOs: string;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastResult: {
    status: "success" | "partial" | "failed" | "cancelled";
    uploaded: number;
    skipped: number;
    failed: number;
    missingRoots: string[];
  } | null;
  entries: Record<string, ManifestEntryV2>;
  garbage: { messageId: number; folderPath: string; since: number }[];
}

interface ManifestEntryV2 {
  size: number;
  mtimeMs: number;
  messageId: number;
  folderPath: string;
  uploadedAt: string;
  hash?: string; // sha256 hex, computed only when mtime/size changed
  sourceMissing?: boolean;
  previousMessageIds?: number[]; // replacements awaiting index commit + GC
}
```

Writes are serialized per channel and atomic (temp file + fsync + rename, old
file retained on failure). Each successful upload is appended to a journal
(`<channelId>.journal.jsonl`) with the base `generation`; load returns the base
and journal under one lock, and replay ignores lines from an older generation.
`save` atomically writes `generation + 1` and then truncates the journal, so a
crash between the rename and truncate cannot resurrect superseded ids. The
no-op run still writes `lastAttemptAt/lastSuccessAt`.

The shared vault commands are made atomic and mutex-serialized as part of the
migration work; migrating/quarantining the legacy key must never risk truncated
session data.

### Manifest migration

On load, if `<channelId>.json` is absent and the legacy vault key exists:

1. Sample up to 5 entry message ids.
2. Verify them in the current channel (`getMessages({ids})`).
3. Adopt the entries only if **every** sampled id is live; write v2, then
   quarantine the legacy key so another account cannot adopt it.
4. If verification fails, times out, or any sample is missing, quarantine the
   legacy value and start empty. Re-uploading is safe; adopting partial or
   another account's entries is not.

### Hashing (P1 — do not block the reliability release)

Use `mtimeMs + size` as the fast change detector. When either changes, compute
an incremental SHA-256 and compare it with the manifest. Equal hash: update
mtime/size and skip the upload (a touched but unchanged file). Different hash:
upload and store the new hash.

Compute the hash from the chunks the uploader already reads (an incremental
JS SHA-256 from `@noble/hashes`), so every uploaded file gets a hash with no
extra disk read. If hashing fails, upload normally and leave the hash empty.
Same-mtime/same-size content changes are not detected in this pass; an optional
"verify contents" mode can be added later.

### Scheduling

Rust remains the interval timer, but JS owns due calculation:

- Persist `lastSuccessAt` and `lastAttemptAt` in the manifest.
- On launch (after bootstrap is ready), on window focus/visibility resume, and
  on a 5-minute check, run if
  `now - max(lastSuccessAt, scheduleEnabledAt) >= interval` and no run is
  active.
- The Rust interval tick is only a hint: it calls the same due check rather than
  running unconditionally.
- Never run while the index is not ready or no folders are configured; retry on
  the next check.
- A failed or cancelled attempt does not advance `lastSuccessAt`; add a retry
  guard (30 minutes) so a broken configuration does not re-walk a large tree
  every few minutes.
- A run paused before any upload because the index is not ready reports
  `failed` without advancing `lastSuccessAt`; a run paused after some uploads
  reports `partial`.
- Enabling/changing a schedule sets `scheduleEnabledAt = now` so the first run
  waits one full interval.

### One run controller

All entry points (manual button, scheduler tick, catch-up) call one controller.
It owns the single `AbortController`, the run promise, and progress-store
updates. Cancelling stops the walker and prevents further file uploads; an
in-flight chunk or index commit is allowed to finish because neither the
uploader nor the index queue supports mid-RPC abort. The overlay shows Cancel
for manual and automatic runs.

### Index integration

- The runner updates the store per file, but index persistence is coalesced:
  fire-and-forget `enqueueSave` after a change (2s debounce) and one final
  awaited `enqueueSave` at the end. This avoids one full index commit per file.
- Before adding the new entry, remove all store entries whose messageId is in
  `previousMessageIds`.
- The manifest merge on bootstrap drops entries whose messageId is superseded
  and, inside the backup namespace, resolves same-path duplicates in favour of
  the manifest's current messageId.
- After the final index commit, sweep **every** entry's `previousMessageIds`
  and `garbage`: delete only ids not referenced by the final file set, with
  bounded retries. Clear ids that were deleted or are still referenced;
  failures stay in `garbage` for the next run. Do not delete anything unless
  the final index save reports success.
- Bootstrap reconciliation happens **after** the orphan scan, not before, so
  the scan cannot re-add superseded ids. Build a superseded set from all
  entries and `garbage`, then drop those ids from the final file list before
  the save.

### Crash reconciliation

A crash between a successful upload and its journal append leaves an uploaded
message with no manifest entry. At the start of a run, before uploading a file
that has no manifest entry, adopt a matching store entry from the backup
namespace (`folderPath`, `name`, `size`, `uploadedAt` within the last hour and
after the previous attempt started) into the manifest instead of uploading a
duplicate. Bootstrap applies the same adoption after the orphan scan. This
narrows the unavoidable crash window to messages the orphan scan cannot see; no
pre-upload intent record is required.

### Walker

`walkSourceFolders` returns:

```ts
interface WalkResult {
  files: WalkedFile[];
  roots: {
    path: string;
    status: "ok" | "empty" | "missing" | "unreadable" | "truncated";
    skipped?: number;
  }[];
  cancelled: boolean;
  complete: boolean;
  errors: { path: string; code: string }[];
}
```

Fixes:

- Track excluded directory prefixes and skip every file under them (fixes
  `build` excluding the directory entry but not its children).
- Skip symlinks and non-regular files in Rust. The current code calls
  `symlink_metadata` but never checks the file type, so symlinks/FIFOs are
  listed as files and followed on read.
- Never include the app data directory; if a source root contains it, prune
  that prefix and warn.
- Surface every root state instead of silently returning success, and report
  unreadable subdirectories via `errors`/`complete: false`.
- Make the Rust walk cancellable (per-run cancel flag polled between entries)
  and report `complete: false` when cancellation or an unreadable subdirectory
  truncated the tree.
- Cap each root at 250,000 entries; report `truncated` rather than returning a
  silently partial tree.
- Mark manifest entries `sourceMissing` only when the walk is complete, no root
  is missing/unreadable/truncated, and a healthy root no longer contains them.

## Approaches considered

1. **Bug-fix patch.** Move the throwing checks, fix the stale entry, skip
   symlinks. Fast, but leaves account mixing, lost last-run state, duplicate
   per-file index commits, no catch-up, and no tests.
2. **Reliability rewrite (chosen).** Add manifest v2 with account scoping and
   atomic writes, a run controller, catch-up scheduling, walker fixes, index
   reconciliation, and tests. Existing folder tree, UI, and Telegram format are
   preserved.
3. **Cross-device durable backup.** Mirror the manifest to Telegram, add content
   addressing, version retention, and restore. Larger scope and a product
   decision; defer.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Replacing index entries leaves old copies if a crash happens between upload and commit | Persist `previousMessageIds` before the index write; bootstrap drops them and keeps old messages until the new index is confirmed |
| Deleting old messages breaks a concurrent reader | Delete only after the new index commit; failed deletes remain in a retry list |
| Manifest migration adopts the wrong account's data | Verify sampled message ids in the current channel; otherwise start empty and quarantine |
| Atomic rename semantics differ on Windows | Write temp, fsync, replace with a fallback that never destroys the old file before the new one is durable |
| Catch-up runs surprise the user | Wait for bootstrap + index ready, one run per due period, 30-minute failure guard, cancellable |
| Hashing large trees is expensive | Hash only files whose mtime/size changed; no full-tree hash in fast mode |
| Per-file index commits flood Telegram | Debounced coalesced saves + one final commit |

## Out of scope for this design

- File version restore UI and retention policy.
- Backup deletion/cleanup UI for files removed locally.
- Cross-device manifest sync.
- Encryption.
- Multi-account simultaneous sessions.
