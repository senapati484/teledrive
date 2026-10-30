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

import { invoke } from "@tauri-apps/api/core";
import {
  isHashedUploadResult,
  uploadFileToTelegram,
} from "../telegram/uploader";
import { useFileStore } from "@/stores/fileStore";
import { useLicenseStore } from "@/stores/licenseStore";
import { useAuthStore } from "@/stores/authStore";
import { useBackupProgressStore } from "@/stores/backupProgressStore";
import { getClient } from "../telegram/client";
import { getSecret, VAULT_KEY_CHANNEL_ID, channelIdKey } from "../secure/vault";
import { logEvent } from "../events";
import {
  appendManifestEntry,
  diffAgainstManifest,
  emptyManifest,
  ensureManifest,
  guessMimeFromName,
  isManifestCorrupt,
  saveManifest,
  updateEntryStats,
  type BackupManifestV2,
  type ManifestEntryV2,
  type BackupRunSummary,
} from "./manifest";
import { sanitizeFolderSegment, walkSourceFolders } from "./walker";
import { detectOS, getDeviceName } from "../secure/deviceInfo";
import { isHardError } from "../telegram/rateLimit";
import { isIndexReady, waitForIndexReady } from "../telegram/indexReadiness";
import { reconstructMissingFolders } from "../storage/metadataStore";
import { flushBackupIndexSave, queueBackupIndexSave } from "./indexSave";
import { deleteMessages } from "./telegramOps";
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
 * Files above this size are never read locally just to compare a hash.
 * A touch on a 2 GiB+ file uploads on mtime/size change instead. Callers
 * can override this with `RunBackupOptions.hashSizeCapBytes`.
 */
export const DEFAULT_HASH_SIZE_CAP_BYTES = 2 * 1024 * 1024 * 1024;

async function hashLocalFile(absPath: string): Promise<string> {
  return invoke<string>("hash_file", { path: absPath });
}

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
  status: BackupRunSummary["status"];
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
  /** Skip local hashing above this size. Defaults to 2 GiB. */
  hashSizeCapBytes?: number;
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
      return await getSecret(channelIdKey(phoneNumber));
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

  if (!folders.paths || folders.paths.length === 0) {
    return {
      ...baseResult,
      error: i18n.t("messages:backup.errors.noFolders"),
      status: "failed",
      durationMs: Date.now() - startedAt,
      finishedAt: Date.now(),
    };
  }

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

  try {
    const client = getClient();
    if (!client.connected) await client.connect();
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

  const walk = await walkSourceFolders(folders, { signal: opts.signal });
  if (opts.signal?.aborted || walk.cancelled) {
    return {
      ...baseResult,
      totalFound: walk.files.length,
      status: "cancelled",
      error: i18n.t("messages:backup.errors.cancelled"),
      durationMs: Date.now() - startedAt,
      finishedAt: Date.now(),
    };
  }

  const missingFolders = [
    ...new Set(
      walk.roots
        .filter(
          (r) =>
            r.status === "missing" ||
            r.status === "unreadable" ||
            r.status === "truncated",
        )
        .map((r) => r.path),
    ),
  ];
  const walkHealthy =
    walk.complete &&
    !walk.roots.some(
      (r) =>
        r.status === "missing" ||
        r.status === "unreadable" ||
        r.status === "truncated",
    );

  const verifyMessageIds = async (ids: number[]): Promise<Set<number>> => {
    const client = getClient();
    const messages = await client.getMessages(channelId, { ids });
    const live = new Set<number>();
    for (const message of messages ?? []) {
      const id = Number((message as { id?: unknown })?.id);
      if (Number.isFinite(id) && id > 0) live.add(id);
    }
    return live;
  };

  let manifest: BackupManifestV2 = await ensureManifest(channelId, verifyMessageIds);
  if (isManifestCorrupt(channelId)) {
    return {
      ...baseResult,
      totalFound: walk.files.length,
      missingFolders,
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

  const hashSizeCap = opts.hashSizeCapBytes ?? DEFAULT_HASH_SIZE_CAP_BYTES;
  const diff = diffAgainstManifest(manifest, walk.files);
  const totalToUpload = diff.toUpload.length;
  let filesUploaded = 0;
  let filesSkipped = diff.unchanged.length;
  let filesFailed = 0;
  let firstError: string | null = null;
  let indexPaused = false;

  const indexReady = await waitForIndexReady(8000);
  if (!indexReady) {
    indexPaused = true;
    firstError = i18n.t("messages:indexLoad.changesPaused");
  }

  for (let i = 0; indexReady && i < diff.toUpload.length; i++) {
    if (opts.signal?.aborted) {
      firstError ??= i18n.t("messages:backup.errors.cancelled");
      break;
    }
    if (!isIndexReady()) {
      indexPaused = true;
      firstError ??= i18n.t("messages:indexLoad.changesPaused");
      break;
    }

    const file = diff.toUpload[i];
    let target: { fileName: string; folderPath: string };
    try {
      target = computeUploadTarget(
        file,
        folders.paths,
        rootDisplayBasename,
        baseResult.deviceRoot,
      );
    } catch (err) {
      filesFailed++;
      firstError ??= err instanceof Error ? err.message : String(err);
      continue;
    }

    const prior = manifest.entries[file.absPath];

    if (prior?.hash && file.size <= hashSizeCap) {
      try {
        const localHash = await hashLocalFile(file.absPath);
        if (localHash === prior.hash) {
          const touched = updateEntryStats(prior, {
            mtimeMs: file.mtimeMs,
            size: file.size,
          });
          await appendManifestEntry(
            channelId,
            manifest.generation,
            file.absPath,
            touched,
          );
          manifest = {
            ...manifest,
            entries: { ...manifest.entries, [file.absPath]: touched },
          };
          filesSkipped++;
          continue;
        }
      } catch (err) {
        console.warn(
          `[backup.runner] hash comparison failed for ${target.fileName}; uploading:`,
          err,
        );
      }
    }

    if (!prior) {
      const adopted = await adoptExistingUpload(
        channelId,
        target.folderPath,
        target.fileName,
        file.size,
        manifest,
      );
      if (adopted) {
        try {
          await appendManifestEntry(
            channelId,
            manifest.generation,
            file.absPath,
            adopted,
          );
          manifest = {
            ...manifest,
            entries: { ...manifest.entries, [file.absPath]: adopted },
          };
          filesSkipped++;
          continue;
        } catch (err) {
          filesFailed++;
          firstError ??= err instanceof Error ? err.message : String(err);
          continue;
        }
      }
    }

    if (file.size === 0) {
      // Empty files cannot be transferred over Telegram MTProto document uploads.
      // Skip safely to avoid infinite retry loops.
      filesSkipped++;
      continue;
    }

    const hashUpload = file.size <= hashSizeCap;
    try {
      const upload = await uploadFileToTelegram(
        channelId,
        target.fileName,
        file.size,
        file.absPath,
        target.folderPath,
        undefined,
        (e) => {
          useBackupProgressStore.getState().setRetry({
            attempt: e.attempt,
            maxAttempts: e.maxAttempts,
            waitMs: e.waitMs,
            floodSeconds: e.floodSeconds,
          });
        },
        hashUpload,
      );
      const hashed = hashUpload && isHashedUploadResult(upload) ? upload : null;
      const message = hashed ? hashed.message : upload;
      const contentHash = hashed?.hash ?? null;
      const messageId = Number((message as { id?: unknown })?.id);
      if (!Number.isFinite(messageId) || messageId <= 0) {
        throw new Error(
          `upload returned no usable message id: ${JSON.stringify(message).slice(0, 120)}`,
        );
      }

      const previousMessageIds = prior
        ? [
            prior.messageId,
            ...(prior.previousMessageIds ?? []),
          ].filter((id, index, list) => list.indexOf(id) === index && id !== messageId)
        : undefined;
      const entry: ManifestEntryV2 = {
        mtimeMs: file.mtimeMs,
        size: file.size,
        messageId,
        folderPath: target.folderPath,
        uploadedAt: new Date().toISOString(),
        ...(contentHash ? { hash: contentHash } : {}),
        ...(previousMessageIds && previousMessageIds.length > 0
          ? { previousMessageIds }
          : {}),
      };
      await appendManifestEntry(
        channelId,
        manifest.generation,
        file.absPath,
        entry,
      );
      manifest = {
        ...manifest,
        lastAttemptAt: Date.now(),
        entries: { ...manifest.entries, [file.absPath]: entry },
      };

      const newTeleFile: TeleFile = {
        id: `backup_${messageId}`,
        name: target.fileName,
        size: file.size,
        mime: guessMimeFromName(target.fileName),
        folderPath: target.folderPath,
        messageId,
        channelId,
        uploadedAt: Date.now(),
        ...(contentHash ? { hash: contentHash } : {}),
        starred: false,
        trashed: false,
      };
      const replacedIds = new Set(previousMessageIds ?? []);
      const existingFiles = useFileStore.getState().files;
      const kept = existingFiles.filter(
        (f) =>
          !replacedIds.has(Number(f.messageId)) &&
          f.id !== newTeleFile.id &&
          !(f.messageId === messageId && f.channelId === channelId),
      );
      const { healedFiles } = reconstructMissingFolders(
        [...kept, newTeleFile],
        channelId,
      );
      useFileStore.getState().setFiles(healedFiles);
      queueBackupIndexSave(channelId, healedFiles);

      filesUploaded++;
      opts.onProgress?.({
        uploaded: filesUploaded + filesFailed,
        total: totalToUpload,
        currentFile: target.fileName,
      });

      if (
        filesUploaded > 0 &&
        filesUploaded % BACKUP_BATCH_SIZE === 0 &&
        i < diff.toUpload.length - 1
      ) {
        await interruptibleSleep(BACKUP_BREATHER_MS, opts.signal);
      }
    } catch (err) {
      filesFailed++;
      const msg = err instanceof Error ? err.message : String(err);
      firstError ??= msg;
      console.warn(
        `[backup.runner] failed to upload ${target.fileName}:`,
        msg,
      );
      opts.onProgress?.({
        uploaded: filesUploaded + filesFailed,
        total: totalToUpload,
        currentFile: target.fileName,
      });
      if (isHardError(err)) {
        filesFailed += diff.toUpload.length - i - 1;
        firstError ??= i18n.t("messages:backup.errors.sessionExpired");
        break;
      }
    }
  }

  const cancelled = Boolean(opts.signal?.aborted);
  let status: BackupRunResult["status"];
  if (cancelled) status = "cancelled";
  else if (filesUploaded > 0 && filesFailed > 0) status = "partial";
  else if (filesFailed > 0 || indexPaused) status = "failed";
  else if (!walkHealthy) status = walk.files.length === 0 ? "failed" : "partial";
  else status = "success";

  if (walkHealthy && !cancelled) {
    const seen = new Set(walk.files.map((f) => f.absPath));
    for (const [absPath, entry] of Object.entries(manifest.entries)) {
      const missing = !seen.has(absPath);
      if (entry.sourceMissing !== missing) {
        manifest.entries[absPath] = { ...entry, sourceMissing: missing };
      }
    }
  }

  const finishedAt = Date.now();
  const lastSuccessAt =
    status === "success" || status === "partial"
      ? finishedAt
      : manifest.lastSuccessAt;
  manifest = {
    ...manifest,
    lastAttemptAt: finishedAt,
    lastSuccessAt,
    lastResult: {
      status,
      uploaded: filesUploaded,
      skipped: filesSkipped,
      failed: filesFailed,
      missingRoots: missingFolders,
    },
  };
  try {
    manifest.generation = await saveManifest(channelId, manifest);
  } catch (err) {
    console.warn("[backup.runner] manifest save failed:", err);
  }

  const flush = await flushBackupIndexSave(channelId);
  if (flush.ok && status !== "cancelled") {
    await sweepGarbage(channelId, manifest);
  }

  if (lastSuccessAt) {
    useFileStore.getState().setLastBackupAt(lastSuccessAt);
  }

  try {
    logEvent({
      type: status === "failed" ? "backup.failed" : "backup.completed",
      payload: {
        uploaded: filesUploaded,
        skipped: filesSkipped,
        failed: filesFailed,
        cancelled: status === "cancelled",
      },
    });
  } catch {
    // logEvent is fire-and-forget.
  }

  return {
    triggeredBy: opts.triggeredBy,
    deviceRoot: baseResult.deviceRoot,
    totalFound: walk.files.length,
    filesUploaded,
    filesSkipped,
    filesFailed,
    missingFolders,
    auditJobId: null,
    status,
    error: firstError,
    durationMs: Date.now() - startedAt,
    finishedAt: Date.now(),
  };
}

function computeUploadTarget(
  file: { absPath: string; relPath: string; size: number; mtimeMs: number },
  roots: string[],
  displayNames: Map<string, string>,
  deviceRoot: string,
): { fileName: string; folderPath: string } {
  const sourceRoot = pickSourceRoot(file.absPath, roots);
  if (!sourceRoot) {
    throw new Error(
      `walker produced a file outside every configured source folder ` +
        `(${file.relPath}); refusing to flatten it under the device root.`,
    );
  }
  const relUnderSource = stripPrefix(file.absPath, sourceRoot);
  const sourceBasename = displayNames.get(sourceRoot) ?? "";
  const relClean = relUnderSource.replace(/^\/+/, "");
  const relSegments = relClean.split("/").filter(Boolean);
  const fileName =
    relSegments.pop() ?? file.absPath.split(/[\\/]/).pop() ?? file.absPath;
  const channelFolderSegments = [sourceBasename, ...relSegments].filter(Boolean);
  const folderPath =
    channelFolderSegments.length > 0
      ? `${deviceRoot}/${channelFolderSegments.join("/")}`
      : deviceRoot;
  if (folderPath.length > FOLDER_PATH_MAX_LENGTH) {
    throw new Error(
      `folder path exceeds ${FOLDER_PATH_MAX_LENGTH} chars (source tree too deep); ` +
        `add an exclude pattern or shorten the source tree.`,
    );
  }
  return { fileName, folderPath };
}

async function adoptExistingUpload(
  channelId: string,
  folderPath: string,
  fileName: string,
  size: number,
  manifest: BackupManifestV2,
): Promise<ManifestEntryV2 | null> {
  const since = manifest.lastAttemptAt ?? Date.now() - 60 * 60 * 1000;
  const candidate = useFileStore.getState().files.find(
    (f) =>
      f.channelId === channelId &&
      f.folderPath === folderPath &&
      f.name === fileName &&
      f.size === size &&
      f.uploadedAt >= since &&
      typeof f.messageId === "number" &&
      f.messageId > 0,
  );
  if (!candidate) return null;
  return {
    mtimeMs: manifest.lastAttemptAt ?? Date.now(),
    size,
    messageId: candidate.messageId,
    folderPath,
    uploadedAt: new Date(candidate.uploadedAt).toISOString(),
  };
}

async function sweepGarbage(
  channelId: string,
  manifest: BackupManifestV2,
): Promise<void> {
  const ids = new Set<number>();
  for (const entry of Object.values(manifest.entries)) {
    for (const id of entry.previousMessageIds ?? []) ids.add(id);
  }
  for (const item of manifest.garbage) ids.add(item.messageId);
  if (ids.size === 0) return;

  const referenced = new Set(
    useFileStore
      .getState()
      .files.map((f) => Number(f.messageId))
      .filter((id) => Number.isFinite(id)),
  );
  const deletable = [...ids].filter((id) => !referenced.has(id));
  if (deletable.length > 0) {
    try {
      await deleteMessages(channelId, deletable);
    } catch (err) {
      console.warn(
        `[backup.runner] old-message cleanup failed (${deletable.length} ids):`,
        err,
      );
      return;
    }
  }

  for (const entry of Object.values(manifest.entries)) {
    if (entry.previousMessageIds) delete entry.previousMessageIds;
  }
  manifest.garbage = [];
  try {
    manifest.generation = await saveManifest(channelId, manifest);
  } catch (err) {
    console.warn("[backup.runner] manifest save after cleanup failed:", err);
  }
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
export type { BackupManifestV2 as BackupManifest };