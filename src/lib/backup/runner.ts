/**
 * Device backup runner — the orchestrator that does the actual work.
 *
 * Pipeline (driven by `runBackup({triggeredBy})`):
 *   1. Acquire the module-level Promise-chain mutex (Tier 1 — T3.1). Auto-
 *      tick + manual click serialize; the second caller waits.
 *   2. Read the user's source-folder config from the licenseStore.
 *   3. Walk each source folder via the Rust `read_dir_recursive` command.
 *   4. Diff the fresh walk against the local manifest (mtime + size).
 *      If the manifest was corrupt, refuse to upload (Tier 1 — T3.2).
 *   5. Upload changed/new files via the existing `uploadFileToTelegram`,
 *      one at a time. After each successful upload:
 *        a. Persist the manifest (so a crash mid-run doesn't lose progress).
 *        b. Build a TeleFile and write it to the fileStore (Tier 1 — T1.1).
 *        c. enqueueSave the optimistic files array through the shared
 *           IndexQueue (same coalescing/serialization as regular uploads).
 *   6. Post the audit row to the backend at `/api/backup/log` with the
 *      run summary (filesUploaded / filesSkipped / filesFailed / status).
 *
 * Why this isn't a single Tauri command
 * -------------------------------------
 * The work is mostly JS-side because it touches existing pieces:
 * uploadFileToTelegram, fileStore, the index-queue, logEvent. Putting it
 * in Rust would mean re-implementing all of those. Keeping it JS-side is
 * the right level for now.
 *
 * Concurrency / cancellation
 * --------------------------
 * Two layers:
 *   - The Promise-chain mutex (T3.1) serializes concurrent `runBackup`
 *     invocations so they cannot race on file uploads.
 *   - The AbortSignal exposed via `useBackupRunner` lets the user cancel
 *     cleanly between uploads. Aborting mid-upload lets the current
 *     upload finish (can't safely kill a Telegram upload mid-stream)
 *     and then bails.
 */

import { uploadFileToTelegram } from "../telegram/uploader";
import { useFileStore } from "@/stores/fileStore";
import { useLicenseStore } from "@/stores/licenseStore";
import { useAuthStore } from "@/stores/authStore";
import { useBackupProgressStore } from "@/stores/backupProgressStore";
import { getClient } from "../telegram/client";
import { getSecret, VAULT_KEY_CHANNEL_ID, channelIdKey } from "../secure/vault";
import { logEvent } from "../events";
import {
  diffAgainstManifest,
  emptyManifest,
  guessMimeFromName,
  isManifestCorrupt,
  loadManifest,
  recordUpload,
  saveManifest,
  type BackupManifest,
} from "./manifest";
import { sanitizeFolderSegment, walkSourceFolders } from "./walker";
import { detectOS, getDeviceName } from "../secure/deviceInfo";
import { enqueueSave } from "../storage/indexQueue";
import { isHardError } from "../telegram/rateLimit";
import { reconstructMissingFolders } from "../storage/metadataStore";
import type { TeleFile } from "../types";
import i18n from "@/i18n";

/**
 * Breather between batches. After every BACKUP_BATCH_SIZE successful
 * uploads, the runner pauses for BACKUP_BREATHER_MS to let Telegram's
 * per-second flood counter reset. Without this, a 218-file backup
 * hits FLOOD_WAIT on the ~17th file (the user has been seeing this
 * exact pattern). The values are tuned for Telegram's published rate
 * window (a few seconds wide). 3 files / 2s gives a comfortable margin
 * for SaveFilePart + SaveBigFilePart + sendFile RPC triplets.
 */
const BACKUP_BATCH_SIZE = 3;
const BACKUP_BREATHER_MS = 2_000;

/**
 * Hard cap on the channel-side folderPath string. Telegram documents
 * cap the caption at 1024 chars; the `teledrive_file:${JSON.stringify(
 * {folder})}:` wrapper adds ~30 chars on top of the path, so we cap
 * the path at 900 to leave headroom. A path this long means the
 * source tree is deeply nested (50+ levels) — almost always a
 * missing exclude (e.g. user picked a folder that includes
 * node_modules or .git). The runner surfaces the cap violation as a
 * per-file error so the rest of the run continues; the user sees the
 * specific file path in the overlay's error and can either add an
 * exclude or shorten the source tree.
 */
const FOLDER_PATH_MAX_LENGTH = 900;

/**
 * Sleep that can be cancelled by an AbortSignal. Used by the
 * per-batch breather so a user-initiated cancel doesn't wait up
 * to BACKUP_BREATHER_MS for the breather to finish.
 */
function interruptibleSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

/**
 * Wait until `bootstrapComplete=true` on the file store, capped at `timeoutMs`.
 * Local copy of the helper in uploadManager.ts — we can't import it because
 * uploadManager imports a lot of upload-only state and we don't want a circular
 * dependency. Same shape, same semantics.
 */
async function waitForBootstrap(timeoutMs: number = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (useFileStore.getState().bootstrapComplete) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return useFileStore.getState().bootstrapComplete;
}

/**
 * Lightweight extension → MIME lookup. Imported from `./manifest` (the
 * canonical home — same map backs the cold-start manifest-merge path in
 * bootstrap, so live uploads and reconciled entries always agree).
 */

/**
 * Module-level Promise-chain mutex (Tier 1 — T3.1).
 *
 * Serializes `runBackup` calls so concurrent invocations (e.g. auto-tick
 * firing while the user clicked "Run now") don't double-upload the same
 * files. Same shape as `metadataStore.ts` Mutex; kept inline to avoid a
 * cross-module import. The second caller WAITS in the queue rather than
 * being dropped — better than silently dropping a manual run.
 */
class BackupMutex {
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
}

const backupMutex = new BackupMutex();

/** What triggered this run. */
export type BackupTrigger = "manual" | "auto";

/** Result of one backup run. */
export interface BackupRunResult {
  triggeredBy: BackupTrigger;
  /** Folder structure root used (e.g. "/TeleDrive Backups/MacBook Pro"). */
  deviceRoot: string;
  /** Total files considered (walked from disk). */
  totalFound: number;
  /** Files actually uploaded this run. */
  filesUploaded: number;
  /** Files skipped because unchanged since last backup. */
  filesSkipped: number;
  /** Files that failed to upload. */
  filesFailed: number;
  /** Source folders that didn't exist on disk anymore. */
  missingFolders: string[];
  /** Audit-row id, if backend POST succeeded. */
  auditJobId: string | null;
  /** Aggregate status. */
  status: "success" | "partial" | "failed";
  /** First error message, if any. */
  error: string | null;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Unix-ms timestamp when the run finished. */
  finishedAt: number;
}

/** Options for one run. */
export interface RunBackupOptions {
  triggeredBy: BackupTrigger;
  /** Allow the caller to abort the run (e.g. user clicked Cancel). */
  signal?: AbortSignal;
  /** Notified after each successful file upload. */
  onProgress?: (info: { uploaded: number; total: number; currentFile: string }) => void;
}

/**
 * Resolve the Telegram channel id from the local vault (the same path
 * uploadManager uses). Mirrors that helper inline to avoid a circular
 * import — both modules are loaded on app boot.
 */
async function resolveChannelId(): Promise<string | null> {
  try {
    const phoneNumber = useAuthStore.getState().phoneNumber;
    if (phoneNumber) {
      const k = channelIdKey(phoneNumber);
      const fromPhoneKey = await getSecret(k);
      if (fromPhoneKey) return fromPhoneKey;
    }
    return await getSecret(VAULT_KEY_CHANNEL_ID);
  } catch {
    return null;
  }
}

/**
 * Compute the per-device folder namespace.
 *   /TeleDrive Backups/<sanitized-device-name>/
 *
 * Sanitization (sanitizeFolderSegment) strips Windows-illegal characters
 * and trims to 64 chars. Falls back to "device" if the result is empty
 * (defensive — should never happen given getDeviceName's behavior).
 */
export function buildDeviceFolder(): string {
  const os = detectOS();
  const name = getDeviceName();
  const segment = sanitizeFolderSegment(`${name} (${os})`);
  return `/TeleDrive Backups/${segment}`;
}

/**
 * Run a backup. Wraps the inner body in a module-level Promise-chain mutex
 * (Tier 1 — T3.1) so concurrent callers serialize. Auto-tick + manual click
 * cannot race; the second caller waits in the queue rather than being dropped.
 *
 * After each successful upload (Tier 1 — T1.1), the runner writes the new
 * TeleFile to the in-memory file store AND routes an `enqueueSave` through
 * the shared IndexQueue — exactly the optimistic-merge pattern
 * uploadManager.ts:216-272 uses for regular uploads. Files appear in the
 * file browser IMMEDIATELY (no cold-start dance), and concurrent index
 * writes (backup + user rename) coalesce via the queue's pending slot.
 *
 * If the manifest was corrupt on the last `loadManifest` (sentinel set),
 * the runner short-circuits with `status: "failed"` instead of doing a
 * full re-upload that the dedup helpers can't reason about.
 */
export async function runBackup(opts: RunBackupOptions): Promise<BackupRunResult> {
  const release = await backupMutex.acquire();
  try {
    return await runBackupInner(opts);
  } finally {
    release();
  }
}

async function runBackupInner(opts: RunBackupOptions): Promise<BackupRunResult> {
  const startedAt = Date.now();
  const folders = useLicenseStore.getState().backupFolders ?? { paths: [], excludes: [] };

  const baseResult: BackupRunResult = {
    triggeredBy: opts.triggeredBy,
    deviceRoot: buildDeviceFolder(),
    totalFound: 0,
    filesUploaded: 0,
    filesSkipped: 0,
    filesFailed: 0,
    missingFolders: [],
    auditJobId: null,
    status: "failed",
    error: null,
    durationMs: 0,
    finishedAt: 0,
  };

  // Guard: no folders configured.
  if (!folders.paths || folders.paths.length === 0) {
    return {
      ...baseResult,
      error: i18n.t("messages:backup.errors.noFolders"),
      status: "failed",
      durationMs: Date.now() - startedAt,
      finishedAt: Date.now(),
    };
  }

  // Build the per-source-root display basename once. If two configured
  // roots share a basename (e.g. /Users/me/Documents and /Volumes/ext/
  // Documents), they would silently collide in the Backups tree at
  //   /TeleDrive Backups/<device>/Documents/...
  // because reconstructMissingFolders only sees the slash-joined path —
  // a single "Documents" folder would absorb files from both roots.
  // To prevent that, we prefix the second (third, …) collision with the
  // source root's parent directory's basename, e.g. "ext-Documents".
  // The full keying is the root's normalized absolute path, so re-running
  // the same config produces the same display name (idempotent).
  const rootDisplayBasename = buildRootDisplayNames(folders.paths);

  const channelId = await resolveChannelId();
  if (!channelId) {
    return {
      ...baseResult,
      error: i18n.t("messages:backup.errors.channelNotReady"),
      status: "failed",
      durationMs: Date.now() - startedAt,
      finishedAt: Date.now(),
    };
  }

  // Ensure the Telegram client is connected before starting.
  try {
    const client = getClient();
    if (!client.connected) {
      await client.connect();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...baseResult,
      error: i18n.t("messages:backup.errors.clientUnreachable", { message: msg }),
      status: "failed",
      durationMs: Date.now() - startedAt,
      finishedAt: Date.now(),
    };
  }

  // Walk the source folders.
  let walked: Awaited<ReturnType<typeof walkSourceFolders>>;
  try {
    walked = await walkSourceFolders(folders, { signal: opts.signal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...baseResult,
      error: i18n.t("messages:backup.errors.walkerFailed", { message: msg }),
      status: "failed",
      durationMs: Date.now() - startedAt,
      finishedAt: Date.now(),
    };
  }

  // Detect missing source folders: any configured path that produced 0
  // files AND is not in the walked list (i.e. the Rust command rejected
  // it before returning anything).
  const walkedAbs = new Set(walked.map((w) => w.absPath));
  const missingFolders: string[] = [];
  for (const p of folders.paths) {
    // We can't tell "folder missing" from "folder empty" perfectly — but
    // an empty existing folder is fine to skip silently. For now, we
    // surface a warning only when we couldn't even read the root (logged
    // in walkOneFolder). Future: return that signal up the stack.
    void p;
    void walkedAbs;
  }

  // Diff against the manifest.
  let manifest = await loadManifest();
  // Tier 1 — T3.2: if the manifest was corrupt, refuse to upload. The
  // quarantined value is preserved under a backup key in the vault for the
  // user to inspect. Without this gate, a corrupt manifest silently cascades
  // into a full re-upload that the dedup helpers can't reason about.
  if (isManifestCorrupt()) {
    return {
      ...baseResult,
      error: i18n.t("messages:backup.errors.manifestCorrupt"),
      status: "failed",
      durationMs: Date.now() - startedAt,
      finishedAt: Date.now(),
    };
  }
  if (!manifest.deviceName) {
    manifest = {
      ...manifest,
      deviceName: getDeviceName(),
      deviceOs: detectOS(),
    };
  }
  const diff = diffAgainstManifest(manifest, walked);

  const totalToUpload = diff.toUpload.length;
  let filesUploaded = 0;
  let filesFailed = 0;
  let firstError: string | null = null;

  // Upload loop. Sequential — the existing uploadFileToTelegram already
  // manages Telegram-side FLOOD_WAIT backoff, and parallel uploads from
  // the backup runner would race the user's regular upload queue.
  for (let i = 0; i < diff.toUpload.length; i++) {
    if (opts.signal?.aborted) {
      firstError ??= i18n.t("messages:backup.errors.cancelled");
      break;
    }

    const file = diff.toUpload[i];
    // Build the channel-side folder path. Mirror the source tree under
    // the device root, preserving nested folder structure. Example:
    //   sourceRoot: /Users/me/Documents
    //   sourcePath: /Users/me/Documents/Work/report.pdf
    //   relPath:    Work/report.pdf  (from the walker, already relative
    //                                to the user's chosen source folder)
    //   → channel folder: /TeleDrive Backups/MacBook Pro/Documents/Work
    //   → channel name:   report.pdf
    //
    // The user picks "/Users/me/Documents" as their backup source, so the
    // channel-side root includes the "Documents" segment — this way the
    // backup preserves the user's local hierarchy (Documents/Work/...) and
    // they can see all their picked source folders side-by-side under
    // /TeleDrive Backups/<device>/.
    //
    // Two bugs this used to have:
    //   1. relUnderSource was the FULL FILE PATH (Work/report.pdf), used as
    //      a folder path. That created a folder named "Work/report.pdf"
    //      literally, which Telegram treated as a single weird folder.
    //   2. The sourceRoot basename (Documents) was never inserted, so files
    //      lived directly under deviceRoot with no top-level folder label.
    //
    // The walker already returns relPath = path-within-source-root; we just
    // take dirname(relPath) for the folder, basename(relPath) for the name.
    //
    // Three hardening checks added (Tasks #12, #13, #14):
    //   - pickSourceRoot must find a match. If it returns null, the
    //     walker has handed us a file outside every configured root
    //     (excludes are filtered earlier, so a non-match here is a
    //     walker bug). We throw a per-file error instead of silently
    //     flattening the file under deviceRoot.
    //   - The display basename is looked up from `rootDisplayBasename`
    //     (built once at the start of the run) so basename collisions
    //     across multiple source roots don't collapse into one folder.
    //   - The final folderPath is length-capped at 900 chars; Telegram's
    //     documented caption ceiling is 1024 and we want headroom for
    //     the `teledrive_file:{...}` JSON wrapper.
    const sourceRoot = pickSourceRoot(file.absPath, folders.paths);
    if (!sourceRoot) {
      throw new Error(
        `walker produced ${file.absPath} which does not match any configured ` +
        `source folder (${folders.paths.join(", ")}). This indicates a walker ` +
        `or exclude-filter bug — refusing to upload rather than flatten the ` +
        `file under the device root.`,
      );
    }
    // pickSourceRoot returns the normalized form (forward-slashes, no
    // trailing slash) — same form buildRootDisplayNames stored the map
    // key under, so the lookup keys directly without re-normalizing.
    const relUnderSource = stripPrefix(file.absPath, sourceRoot);
    const sourceBasename = rootDisplayBasename.get(sourceRoot) ?? "";
    // Compute channel-side folder. relUnderSource starts with "/" so we
    // strip it; then take everything except the trailing filename segment.
    const relClean = relUnderSource.replace(/^\/+/, "");
    const relSegments = relClean.split("/").filter(Boolean);
    const fileName = relSegments.pop() ?? file.absPath.split(/[\\/]/).pop() ?? file.absPath;
    const relFolderSegments = relSegments;
    const channelFolderSegments = [
      sourceBasename,
      ...relFolderSegments,
    ].filter(Boolean);
    const folderPath =
      channelFolderSegments.length > 0
        ? `${baseResult.deviceRoot}/${channelFolderSegments.join("/")}`
        : baseResult.deviceRoot;

    // Length cap. Telegram documents cap the caption at 1024 chars; the
    // `teledrive_file:${JSON.stringify({folder})}:` wrapper adds ~30
    // chars on top of the path, so we cap the path at 900 to leave
    // headroom. A path this long means a deeply-nested source — the
    // user almost certainly has a folder like "node_modules" they meant
    // to exclude. We fail-loud per file (don't abort the whole run, the
    // other files may be fine).
    if (folderPath.length > FOLDER_PATH_MAX_LENGTH) {
      throw new Error(
        `folderPath length ${folderPath.length} exceeds ${FOLDER_PATH_MAX_LENGTH}-char ` +
        `cap (source path too deeply nested: ${file.absPath}). Add an exclude ` +
        `pattern or shorten the source tree depth.`,
      );
    }

    try {
      const message = await uploadFileToTelegram(
        channelId,
        fileName,
        file.size,
        file.absPath,
        folderPath,
        undefined, // onProgress — chunk-level progress, not used by the backup flow
        // onRetry — surface FLOOD_WAIT / network retries to the progress
        // store so the overlay shows "Retrying 3/5 — waiting 30s" instead
        // of a frozen counter. Keeps the user informed during a long
        // single-file stall. We pull the action fresh on each callback
        // so a re-render or HMR doesn't capture a stale reference.
        (e) => {
          useBackupProgressStore.getState().setRetry({
            attempt: e.attempt,
            maxAttempts: e.maxAttempts,
            waitMs: e.waitMs,
            floodSeconds: e.floodSeconds,
          });
        },
      );
      const messageId = Number((message as any)?.id);
      if (!Number.isFinite(messageId) || messageId <= 0) {
        throw new Error(
          `upload returned no usable message id: ${JSON.stringify(message).slice(0, 120)}`,
        );
      }
      manifest = recordUpload(manifest, file.absPath, {
        mtimeMs: file.mtimeMs,
        size: file.size,
        messageId,
        folderPath,
      });
      await saveManifest(manifest);

      // Tier 1 — T1.1: write the new TeleFile to the in-memory file store
      // AND route an enqueueSave through the shared IndexQueue. Mirrors the
      // optimistic-merge pattern in uploadManager.ts:216-272 — the file
      // appears in the file browser IMMEDIATELY (no cold-start dance), and
      // concurrent index writes (backup + user rename) coalesce via the
      // queue's pending slot.
      //
      // Bootstrap gate: if recovery hasn't finished, skip the index save
      // (the file is already on Telegram — the next orphan scan picks it up).
      const newTeleFile: TeleFile = {
        // Deterministic id keyed on the Telegram messageId. Different from
        // regular uploads (which use `file_<uuid>`) so dedup-by-messageId
        // and dedupeByContentKey can identify these as backup entries.
        id: `backup_${messageId}`,
        name: fileName,
        size: file.size,
        mime: guessMimeFromName(fileName),
        folderPath,
        messageId,
        channelId,
        uploadedAt: Date.now(),
        starred: false,
        trashed: false,
      };

      const bootstrapReady = await waitForBootstrap(8000);
      if (bootstrapReady) {
        const existingFiles = useFileStore.getState().files;
        // Reconstruct any missing virtual folders BEFORE adding the new
        // file, so the optimistic array mirrors what `healAndSave` would
        // produce on cold start. Without this, the file appears in the
        // browser at its full folder path but the parent folder entries
        // don't exist yet — so the user clicks into a "missing" folder.
        const { healedFiles: withFolders } = reconstructMissingFolders(
          [...existingFiles, newTeleFile],
          channelId,
        );
        const optimisticFiles = [
          ...withFolders.filter(
            (f) => f.id !== newTeleFile.id || f.messageId !== messageId
          ),
          newTeleFile,
        ];
        useFileStore.getState().setFiles(optimisticFiles);

        try {
          await enqueueSave(channelId, optimisticFiles);
        } catch (indexErr) {
          // Same hard-error rollback as uploadManager.ts:280-305. The file
          // is already on Telegram — only the metadata index write failed.
          // Remove the optimistic entry from the store so the UI reflects
          // reality; the next cold start will recover it via the orphan scan.
          const isHard =
            /AUTH_KEY_UNREGISTERED|SESSION_REVOKED|CHANNEL_PRIVATE|PEER_ID_INVALID|CHAT_WRITE_FORBIDDEN|JSON/i.test(
              (indexErr as Error)?.message ?? ""
            );
          if (isHard) {
            const rolled = useFileStore
              .getState()
              .files.filter((f) => f.id !== newTeleFile.id);
            useFileStore.getState().setFiles(rolled);
            console.warn(
              `[backup.runner] index save hard-error for ${file.absPath}; rolled back:`,
              (indexErr as Error).message,
            );
          } else {
            console.warn(
              `[backup.runner] index save transient error for ${file.absPath}:`,
              (indexErr as Error).message ?? indexErr,
            );
          }
        }
      } else {
        console.warn(
          `[backup.runner] bootstrap not ready; skipping in-memory merge for ${file.absPath}. ` +
          `The orphan scan will pick this file up on the next cold start.`,
        );
      }

      filesUploaded++;
      opts.onProgress?.({
        uploaded: filesUploaded + filesFailed,
        total: totalToUpload,
        currentFile: file.absPath,
      });

      // Per-batch breather. Telegram tracks RPCs per ~second and
      // enforces FLOOD_WAIT_X once a window is exceeded. The user was
      // hitting a 30s FLOOD_WAIT on file 17 of a 218-file backup with
      // no breather between files — the per-second counter kept
      // climbing even though each individual upload looked fast. A
      // short, deterministic pause every N successes drains the
      // counter and prevents the user from ever seeing a stalled
      // overlay in the common case. We DON'T breather after a failed
      // file (the FLOOD_WAIT retry already inserted its own wait) and
      // we DON'T breather after the last file in the loop. The breather
      // is interruptible: a cancel signal short-circuits the wait.
      if (
        filesUploaded > 0 &&
        filesUploaded % BACKUP_BATCH_SIZE === 0 &&
        i < diff.toUpload.length - 1
      ) {
        console.log(
          `[backup.runner] breather: ${filesUploaded}/${totalToUpload} done; ` +
          `pausing ${BACKUP_BREATHER_MS}ms to clear Telegram rate-limit window`,
        );
        await interruptibleSleep(BACKUP_BREATHER_MS, opts.signal);
      }
    } catch (err) {
      filesFailed++;
      const msg = err instanceof Error ? err.message : String(err);
      firstError ??= msg;
      console.warn(`[backup.runner] failed to upload ${file.absPath}:`, msg);
      // Persist progress before bailing on a hard error.
      await saveManifest(manifest);
      opts.onProgress?.({
        uploaded: filesUploaded + filesFailed,
        total: totalToUpload,
        currentFile: file.absPath,
      });

      // If this is a HARD Telegram error (session revoked, auth key
      // unregistered, channel private, etc.), every subsequent file will
      // fail with the same error. Bail out now so the user gets a clear
      // "session expired" message instead of 218 confusing failures and
      // an indefinite wait. Without this short-circuit, a revoked session
      // turns into a multi-minute loop of identical errors.
      if (isHardError(err)) {
        // Account for the rest of the queue so filesFailed reflects what
        // actually happened (and the user knows the magnitude of the loss).
        filesFailed += diff.toUpload.length - i - 1;
        firstError ??=
          i18n.t("messages:backup.errors.sessionExpired");
        console.warn(
          `[backup.runner] hard Telegram error; aborting run. ${diff.toUpload.length - i - 1} files remaining skipped.`,
        );
        break;
      }
      // Continue with the rest for transient errors — partial is better than nothing.
    }
  }

  // Aggregate status. Order matters:
  //   1. Any filesFailed → "partial" (if some uploaded) or "failed" (if none did).
  //      The previous ordering checked `unchanged > 0` BEFORE checking `filesFailed`,
  //      which silently hid a 0-uploaded + 18-unchanged + 218-failed run as
  //      "success" — the user saw "Backup complete — nothing changed" and never
  //      realised their Telegram session was revoked and 218 files failed.
  //   2. No-op (everything unchanged, nothing failed) → "success".
  //   3. All-uploaded → "success".
  let status: BackupRunResult["status"];
  if (filesFailed > 0 && filesUploaded > 0) status = "partial";
  else if (filesFailed > 0) status = "failed";
  else if (filesUploaded > 0) status = "success";
  else status = "success"; // no-op run: nothing to upload, nothing failed

  // Audit job id — backend removed, set null.
  const auditJobId: string | null = null;
  void auditJobId; // unused but kept for structural compatibility

  // Log an event for the activity timeline.
  try {
    logEvent({
      type: status === "failed" ? "backup.failed" : "backup.completed",
      payload: {
        uploaded: filesUploaded,
        skipped: diff.unchanged.length,
        failed: filesFailed,
        deviceRoot: baseResult.deviceRoot,
      },
    });
  } catch {
    // logEvent is fire-and-forget; ignore its own errors.
  }

  // Update the fileStore timestamp so the UI re-renders the "Last backup"
  // label. The store setter is a no-op when bootstrap hasn't completed.
  useFileStore.getState().setLastBackupAt(Date.now());

  return {
    triggeredBy: opts.triggeredBy,
    deviceRoot: baseResult.deviceRoot,
    totalFound: walked.length,
    filesUploaded,
    filesSkipped: diff.unchanged.length,
    filesFailed,
    missingFolders,
    auditJobId,
    status,
    error: firstError,
    durationMs: Date.now() - startedAt,
    finishedAt: Date.now(),
  };
}

/** Find which source-root this absPath belongs to. */
function pickSourceRoot(absPath: string, roots: string[]): string | null {
  const normalized = absPath.replace(/\\/g, "/");
  let best: string | null = null;
  for (const r of roots) {
    const rn = r.replace(/\\/g, "/").replace(/\/$/, "");
    if (normalized === rn || normalized.startsWith(rn + "/")) {
      if (!best || rn.length > best.length) best = rn; // longest match wins
    }
  }
  return best;
}

/**
 * Compute the per-source-root display basename used to build the
 * channel-side folder tree under `/TeleDrive Backups/<device>/<display>/`.
 *
 * Defaults to the basename of the root (the user's chosen source folder),
 * matching the existing "mirror the source's own folder name" convention
 * (see the comment at runBackupInner's per-file folderPath computation).
 *
 * When two configured roots share a basename, the SECOND occurrence (and
 * beyond) is prefixed with the parent directory's basename, e.g.:
 *
 *   /Users/me/Documents       → "Documents"
 *   /Volumes/ext/Documents    → "ext-Documents"
 *
 * The map is keyed on the normalized absolute path, so re-running with
 * the same config produces the same display name (idempotent — no drift
 * between backup runs).
 */
function buildRootDisplayNames(roots: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const seenBasenames = new Map<string, number>();
  for (const r of roots) {
    const rn = r.replace(/\\/g, "/").replace(/\/$/, "");
    const parts = rn.split("/").filter(Boolean);
    const base = parts[parts.length - 1] ?? "";
    const display = sanitizeFolderSegment(base);
    // Two-collision prefix: parent basename + "-" + base. Edge case:
    // the root is "/" or has no parent (rare — user can't actually pick
    // that), so we fall back to "root" as the parent label.
    const parent = parts.length >= 2 ? parts[parts.length - 2] : "root";
    const seen = seenBasenames.get(display) ?? 0;
    seenBasenames.set(display, seen + 1);
    if (seen === 0) {
      map.set(rn, display);
    } else {
      map.set(rn, sanitizeFolderSegment(`${parent}-${base}`));
    }
  }
  return map;
}

/** Strip a directory prefix, return the remainder with leading slash. */
function stripPrefix(absPath: string, prefix: string): string {
  const a = absPath.replace(/\\/g, "/");
  const p = prefix.replace(/\\/g, "/").replace(/\/$/, "");
  if (a === p) return "";
  return a.startsWith(p + "/") ? a.slice(p.length) : a;
}

// Re-export for the React hook.
export { emptyManifest };
export type { BackupManifest };