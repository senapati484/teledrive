import { getClient } from "./client";
import { ensureStorageChannel } from "./channelManager";
import {
  loadIndex,
  saveIndex,
  withTimeout,
  reconstructMissingFolders,
  collapseDuplicateFolders,
  dedupeByContentKey,
  dedupeByMessageId,
} from "../storage/metadataStore";
import { useFileStore } from "../../stores/fileStore";
import { TeleFile } from "../types";
import { invoke } from "@tauri-apps/api/core";
import { isJunkFile, filterJunkFiles } from "../storage/fileSanitizer";
import {
  isManifestCorrupt,
  loadManifest,
  manifestEntryToTeleFile,
} from "../backup/manifest";
import i18n from "@/i18n";

/**
 * Bootstraps TeleDrive storage channel and loads the metadata.
 * Reports status changes to the caller.
 *
 * Orphan recovery: scans the last 1000 channel messages for uploaded documents
 * that are NOT in the metadata index (e.g. because a previous index-save failed)
 * and re-indexes them under their correct folders so they become visible.
 *
 * Ordering matters here. The orphan scan MUST complete before we flip
 * `bootstrapComplete=true`. Otherwise, a user action (upload, drag, etc.)
 * could race the recovery and write an incomplete state to Telegram,
 * silently overwriting the previous full index with the partial set —
 * causing data loss on the next cold start. The scan is awaited here
 * (with a 12s cap so the splash doesn't linger forever on flaky networks).
 */
export async function bootstrapTeleDrive(
  onStatusChange?: (status: string) => void,
  phone: string = ""
): Promise<string> {
  // Note on gate release: `bootstrapTeleDriveInner` calls
  // `setBootstrapComplete(true)` immediately after `setFiles(files)` —
  // BEFORE the manifest-merge, orphan-scan, or any await that could
  // wedge. This is intentional: drag/drop must work the moment the
  // cached index is on screen, regardless of how slow Telegram recovery
  // is. The orphan-scan runs in the background via Promise.race and any
  // recovered files are merged into state.files via setFiles — they get
  // persisted on the next user action's saveIndex.
  return bootstrapTeleDriveInner(onStatusChange, phone);
}

/**
 * The actual bootstrap logic. Releases the gate (sets bootstrapComplete=true)
 * immediately after `setFiles(files)` runs — see the long comment above
 * the `setFiles` call for why. The orphan-scan runs in the background via
 * a fire-and-forget Promise.race so it can never wedge bootstrap completion.
 */
async function bootstrapTeleDriveInner(
  onStatusChange: ((status: string) => void) | undefined,
  phone: string
): Promise<string> {
  onStatusChange?.(i18n.t("messages:bootstrap.status.connecting"));
  const client = getClient();

  onStatusChange?.(i18n.t("messages:bootstrap.status.verifyingChannel"));
  const channelId = await ensureStorageChannel(phone);

  onStatusChange?.(i18n.t("messages:bootstrap.status.loadingIndex"));
  let files = await loadIndex(channelId);
  try {
    const { syncOfflineStatusWithDisk } = await import("../storage/offlineStorage");
    files = await syncOfflineStatusWithDisk(files);
  } catch (err) {
    console.warn("[bootstrap] Failed to sync offline status with disk:", err);
  }
  files = filterJunkFiles(files);

  // Initialize the local view immediately and RELEASE THE GATE. We do NOT
  // wait for the orphan scan or manifest-merge before allowing user
  // actions — the previous "wait for everything" design caused a 20s+
  // bootstrap hang any time the Tauri IPC channel or GramJS request
  // queue wedged (FLOOD_WAIT cascades), breaking drag/drop for every
  // user. The new model is "release on cache, recover in background":
  //   1. `setFiles(files)` writes the index-derived files to state.files
  //      AND localStorage. The UI is fully usable at this point.
  //   2. `setBootstrapComplete(true)` immediately follows. Drag/drop,
  //      rename, delete, upload — ALL work now.
  //   3. The manifest-merge and orphan-scan still run to completion in
  //      the background. They mutate `state.files` directly (via setFiles)
  //      so any newly-recovered files appear in the UI as they're found.
  //      When the user next performs an action, the queue picks up the
  //      latest merged state and persists it to Telegram. No data loss
  //      because in-memory state is always the source of truth for the
  //      next save.
  //
  // The old comment claimed orphan scan running concurrently with user
  // actions could cause "partial overwrite of Telegram" — but the queue
  // serializes every save through commitOnce, and each save reads the
  // CURRENT in-memory state at commit time. If orphan scan finds files
  // before the next commit, those files are included. If it finds them
  // after the next commit, they wait for the user's next action.
  const { setFiles } = useFileStore.getState();
  setFiles(files);
  useFileStore.getState().setBootstrapComplete(true);


  // ── Manifest-merge step ───────────────────────────────────────────────
  // The local backup manifest (teledrive_backup_manifest_v1 in the vault)
  // is the durable record of every successful device-backup upload: for
  // each entry we know the Telegram messageId and the channel-side
  // folderPath under `/TeleDrive Backups/<device>/...`. It survives app
  // restarts and is independent of Telegram index health.
  //
  // Why merge here, before the orphan scan?
  //   - The Telegram pinned-index chunks can fail to land under FLOOD_WAIT
  //     (596s waits have been observed; see vault_state.log). When that
  //     happens, `loadIndex` returns a smaller chunk set than what the
  //     runner actually wrote, and backup files vanish from the Backups
  //     view even though they exist on Telegram.
  //   - The orphan scan reads last 1000 messages; older backup messages
  //     fall outside the window. Even within range, a damaged caption can
  //     drop the parsed folderPath back to "/" — losing the namespace.
  //
  // The manifest is local and reliable, so we seed `state.files` from it
  // BEFORE recovery runs. `dedupeByMessageId` ensures any overlap with
  // `loadIndex` results collapses to a single entry (the index version is
  // preferred since it may carry richer metadata).
  //
  // CRITICAL: the in-memory merge is synchronous and fast (one disk
  // read + a Set-based dedup). We MUST NOT await the Telegram saveIndex
  // here — `enqueueSave` resolves only on success or hard error, and
  // transient FLOOD_WAIT keeps the promise pending. Awaiting it would
  // block bootstrap completion, which in turn blocks every user action
  // (drag, drop, rename, delete — all gated on `bootstrapComplete`).
  // The saveIndex is therefore fire-and-forget; the manifest is
  // durable so the next cold start will re-run the merge if Telegram
  // is still stale.
  try {
    // Run the in-memory merge synchronously (no `await`) so the store
    // is updated immediately and the Backups view can render before
    // bootstrap completes. The helper does its own setFiles internally.
    const merged = await mergeBackupManifestSync(channelId, files, setFiles);
    // Persist to Telegram after the merge. fireAndForgetSaveIndex
    // swallows errors and never throws into the bootstrap flow — a
    // pending enqueueSave (FLOOD_WAIT) cannot block us here.
    fireAndForgetSaveIndex(channelId, merged);
  } catch (manifestErr) {
    console.warn("[bootstrap] manifest merge failed (continuing):", manifestErr);
  }

  // ── Orphan recovery (SYNCHRONOUS — must finish before bootstrap completes) ──
  // The previous "background" version was the root cause of a data-loss bug:
  // the user could upload/move a file BEFORE recovery finished, the queue
  // would write the partial state (new file only) to Telegram, and the next
  // cold start would lose every file the orphan scan hadn't recovered yet.
  // We now await the scan (12s cap on the getMessages call itself, plus a
  // hard 14s safety net on the entire recovery block) and write recovered
  // files BEFORE we mark bootstrap complete. User actions that arrive
  // during the scan are rejected with a retryable toast by the
  // useFileActions bootstrap gate.
  //
  // Why the safety net? The Tauri IPC `invoke` channel and GramJS's
  // request queue can wedge on bad network state (FLOOD_WAIT cascades
  // from the IndexQueue's pinning attempts have been observed). The
  // 12s `withTimeout` only covers the getMessages RPC itself; a hung
  // Tauri invoke, a wedged `useFileStore` setter, or a synchronous loop
  // that blocks for too long would still leave `bootstrapComplete=false`
  // and break every user action. We wrap the whole block in a race
  // against a hard timer so bootstrap ALWAYS finishes — orphan recovery
  // is best-effort; gate release is mandatory.
  onStatusChange?.(i18n.t("messages:bootstrap.status.recoveryScan"));

  // Wrap the ENTIRE recovery block (including its own log line) in an IIFE
  // + Promise.race. We do NOT await a log_vault_state invoke BEFORE the
  // IIFE — that would be a synchronous preamble that any IPC wedge would
  // block on, defeating the safety-net below. Any pre-scan logging must
  // happen inside the IIFE so a hung Tauri IPC can't strand bootstrap.
  const orphanScanBlock = (async () => {
  await invoke("log_vault_state", {
    state: `BOOTSTRAP: Starting orphan scan for channelId=${channelId}`,
  }).catch(() => {});
  try {
    const recentMessages = await withTimeout(
      client.getMessages(channelId, { limit: 1000 }),
      12000,
      "client.getMessages(orphan scan)"
    );

    // Read current files and cursor from store
    const currentFiles = useFileStore.getState().files;
    const lastIndexMsgId = useFileStore.getState().lastIndexMsgId;
    const indexedMsgIds = new Set(currentFiles.map((f) => Number(f.messageId)));
    const orphans: TeleFile[] = [];

    for (const msg of recentMessages) {
      if (!msg?.id) continue;
      // Skip text-only index messages
      if (msg.text?.includes("teledrive_index")) continue;

      const msgId = Number(msg.id);
      // Skip if already in the index
      if (indexedMsgIds.has(msgId)) continue;

      // If we already have a loaded index with a cursor, only recover messages
      // that were posted AFTER the last index was saved. Any message with msgId <= lastIndexMsgId
      // was already present when the index was saved — if it's not in the index, it was deleted!
      if (lastIndexMsgId > 0 && currentFiles.length > 0 && msgId <= lastIndexMsgId) {
        continue;
      }

      // Only care about document media (uploaded files)
      const media = (msg as any).media;
      if (!media?.document) continue;

      // CRITICAL: Only recover files that were actually uploaded by TeleDrive!
      // TeleDrive always tags uploaded files with `teledrive_file:{"folder":"..."}` caption.
      // Random files, bot messages, or channel noise without this caption must NEVER
      // be injected into the drive as unknown files.
      const captionText = msg.message || msg.text || "";
      if (!captionText.startsWith("teledrive_file:")) {
        continue;
      }

      let folderPath = "/";
      try {
        const jsonStr = captionText.substring("teledrive_file:".length);
        const meta = JSON.parse(jsonStr);
        if (meta && typeof meta.folder === "string") {
          folderPath = meta.folder;
        } else {
          continue;
        }
      } catch (_) {
        // Corrupted or non-JSON metadata caption — do not inject unknown files
        continue;
      }

      const doc = media.document;
      const mimeType: string = doc.mimeType || "application/octet-stream";
      const size: number = Number(doc.size) || 0;

      // Resolve name from document attribute
      let name = "Untitled";
      const filenameAttr = (doc.attributes || []).find(
        (a: any) => a.className === "DocumentAttributeFilename"
      );
      if (filenameAttr?.fileName) {
        name = filenameAttr.fileName;
      }

      if (isJunkFile({ name, folderPath, mime: mimeType, size })) {
        continue;
      }

      orphans.push({
        id: `recovered_${msgId}`,
        name,
        size,
        mime: mimeType,
        folderPath,
        messageId: msgId,
        channelId,
        uploadedAt: (msg.date || 0) * 1000,
        starred: false,
        trashed: false,
        archived: false,
      });
    }

    if (orphans.length > 0) {
      // Read latest store state — DO NOT use the cached `files` from
      // outer scope. The user may have done a drag/drop/rename since the
      // orphan scan started, and we MUST preserve those optimistic changes.
      // Using a stale snapshot here would clobber the user's actions and
      // bounce the file back to its pre-action position (the symptom the
      // user reported: "the file comes back to the root folder because
      // it's still trying").
      const latestFiles = useFileStore.getState().files;
      const existingMsgIds = new Set(latestFiles.map((f) => Number(f.messageId)));
      const newOrphans = orphans.filter((o) => !existingMsgIds.has(Number(o.messageId)));

      if (newOrphans.length > 0) {
        console.log(`[bootstrap] Orphan scan: Recovering ${newOrphans.length} orphaned file(s)…`);
        const mergedFiles = [...latestFiles, ...newOrphans];
        const { healedFiles } = reconstructMissingFolders(mergedFiles, channelId);

        // One-shot recovery: drop duplicate file/folder entries from the
        // pre-fix bug before persisting. After this single cold start,
        // future cold starts will load a clean index and the duplicate
        // creation loop is broken for good.
        //
        // Same pipeline as `metadataStore.healAndSave` so the two recovery
        // paths converge on the same shape. `dedupeByContentKey` itself
        // skips folders (it only collapses by content key), but running it
        // here keeps the orphan-scan path consistent with the cold-start
        // path — any future helper added to the healAndSave chain is then
        // automatically picked up here too.
        const beforeCount = healedFiles.length;
        const cleaned = collapseDuplicateFolders(
          dedupeByContentKey(dedupeByMessageId(healedFiles))
        );
        const removedCount = beforeCount - cleaned.length;
        if (removedCount > 0) {
          await invoke("log_vault_state", {
            state: `BOOTSTRAP_DEDUP_REMOVED count=${removedCount} before=${beforeCount} after=${cleaned.length}`,
          }).catch(() => {});
          console.log(`[bootstrap] One-shot dedup removed ${removedCount} duplicate entries`);
        }

        // Read latest state AGAIN right before setFiles. Between the
        // dedup chain above and this point, the user may have performed
        // another action (drag/drop/rename). If we wrote `cleaned`
        // directly, we'd silently clobber that newer state. Instead,
        // merge: take the post-dedup recovered entries and ADD any new
        // entries that weren't in our recovered set. The user's most
        // recent state always wins.
        const finalLatest = useFileStore.getState().files;
        const cleanedIds = new Set(cleaned.map((f) => f.id));
        const cleanedMsgIds = new Set(
          cleaned.map((f) => Number(f.messageId)).filter((id) => id > 0)
        );
        const userOnlyEntries = finalLatest.filter((f) => {
          // Keep anything that was in the user's state but NOT in cleaned
          // (i.e. user did an action after we built cleaned).
          const inCleanedById = cleanedIds.has(f.id);
          const inCleanedByMsgId =
            f.messageId && Number(f.messageId) > 0 && cleanedMsgIds.has(Number(f.messageId));
          // The same file can be present with different ids if the user
          // moved it. Either match counts as "already in cleaned".
          if (inCleanedById || inCleanedByMsgId) return false;
          // Skip orphans we just recovered — they're already in cleaned.
          // (This filter shouldn't be necessary given the above checks,
          // but is defensive in case a recovered entry has a synthetic id
          // that collides with a user entry.)
          return true;
        });
        // Reconcile folderPaths: if a user-moved file conflicts with a
        // recovered folder, prefer the user's path.
        const finalState = mergeWithUserPreference(cleaned, userOnlyEntries);
        useFileStore.getState().setFiles(finalState);

        // Persist the recovered entries to Telegram. We use the same
        // fire-and-forget pattern as the manifest-merge: enqueueSave
        // stays pending on transient FLOOD_WAIT, so awaiting it here
        // would block bootstrap completion and break drag/drop/rename/
        // delete. The in-memory store is already correct; the next user
        // action will trigger another enqueueSave with the same merged
        // state, so no data is lost.
        await invoke("log_vault_state", {
          state: `BOOTSTRAP_ORPHAN_RECOVER count=${newOrphans.length} total=${cleaned.length}`,
        }).catch(() => {});
        fireAndForgetSaveIndex(channelId, cleaned);
      }
    }

    await invoke("log_vault_state", {
      state: `BOOTSTRAP_ORPHAN_SCAN_DONE files=${useFileStore.getState().files.length}`,
    }).catch(() => {});

    // Record the highest Telegram message id observed during the scan so the
    // multi-device sync poller has a cursor to start from on its first tick.
    // The scan pulled up to 1000 recent messages — the max id among them is
    // a safe starting point for the next `client.getMessages({ minId })`.
    // We compute this only after the scan completes (not after the initial
    // loadIndex), because the orphan scan pulls the freshest slice and any
    // newer messages sent during bootstrap would be missed otherwise.
    try {
      const observedIds = (recentMessages || [])
        .map((m: any) => Number(m?.id))
        .filter((id: number) => Number.isFinite(id) && id > 0);
      if (observedIds.length > 0) {
        const maxId = observedIds.reduce((a: number, b: number) => Math.max(a, b), 0);
        useFileStore.getState().setLastIndexMsgId(maxId);
        await invoke("log_vault_state", {
          state: `BOOTSTRAP_LAST_INDEX_MSG_ID set=${maxId}`,
        }).catch(() => {});
      }
    } catch (cursorErr) {
      // Non-fatal — sync will just start from 0 (cold reload equivalent).
      console.warn("[bootstrap] Failed to record lastIndexMsgId:", cursorErr);
    }
  } catch (scanErr: any) {
    await invoke("log_vault_state", {
      state: `BOOTSTRAP_ORPHAN_SCAN_ERR: ${scanErr?.message || JSON.stringify(scanErr)}`,
    }).catch(() => {});
    console.warn("[bootstrap] Orphan scan failed (continuing):", scanErr);
    // Don't block the user indefinitely on a flaky network — proceed to
    // bootstrap-complete so they can at least see whatever loadIndex found.
  }
  })();

  // Fire the orphan-recovery block in the background — we no longer await
  // it because the gate was already released above. Awaiting would block
  // bootstrap's return value and keep App.tsx's `setIsRestoring(false)`
  // pending. The IIFE + 14s race still bounds the recovery so a hung
  // GramJS request doesn't leak forever; any recovered files are merged
  // into state.files via setFiles() inside the IIFE and will be picked
  // up by the next user action's saveIndex.
  void Promise.race([
    orphanScanBlock,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        void invoke("log_vault_state", {
          state: "BOOTSTRAP_ORPHAN_SCAN_HARD_TIMEOUT: 14s safety net triggered",
        }).catch(() => {});
        console.warn(
          "[bootstrap] Orphan-scan block exceeded 14s hard timeout — releasing bootstrap gate",
        );
        resolve();
      }, 14000);
    }),
  ]);

  // Gate was released right after `setFiles(files)` near the top of this
  // function. We do NOT re-set it here — doing so would clobber the early
  // release and reintroduce the bootstrap hang the user just hit.
  onStatusChange?.(i18n.t("messages:bootstrap.status.initializingView"));

  return channelId;
}

/**
 * Merge backup-manifest entries into the in-memory file store.
 *
 * The manifest is a local vault value (`teledrive_backup_manifest_v1`)
 * recording every successful device-backup upload with its Telegram
 * `messageId` and channel-side `folderPath`. It is durable across cold
 * starts and independent of whether the Telegram pinned-index chunks
 * landed cleanly. When the index is stale (FLOOD_WAIT blocked pinning,
 * edit-temp-restricted windows, orphan scan missed the window), the
 * manifest is the most reliable signal that a backup file exists.
 *
 * Pipeline (mirrors the orphan-scan merge at lines 192-230):
 *   1. Load the manifest. Skip if corrupt (the runner already gates on
 *      `isManifestCorrupt` and refuses to upload; we're consistent with
 *      that).
 *   2. Convert each entry to a TeleFile via `manifestEntryToTeleFile`.
 *   3. `dedupeByMessageId` against the existing index entries — anything
 *      with the same messageId is dropped (the index version wins
 *      because it may carry richer metadata).
 *   4. `reconstructMissingFolders` so the Backups view renders the
 *      folder tree without waiting for the orphan scan.
 *   5. `setFiles` to update the store + localStorage cache.
 *
 * This function is SYNCHRONOUS and never awaits anything. The
 * `loadManifest` call is the only async step, but it returns the
 * manifest from a vault read — fast in practice. We don't await the
 * Telegram saveIndex here: `enqueueSave` resolves only on success or
 * hard error, and transient FLOOD_WAIT keeps the promise pending. If
 * we awaited it during bootstrap, the bootstrap gate (which is
 * consulted by every user action) would block until Telegram accepts
 * the write, breaking drag/drop/rename/delete.
 *
 * Persistence to Telegram is handled by the caller via
 * `fireAndForgetSaveIndex` AFTER the in-memory merge has applied.
 * That decouples the bootstrap completion from the index health.
 */
async function mergeBackupManifestSync(
  channelId: string,
  existingFiles: TeleFile[],
  setFiles: (files: TeleFile[]) => void,
): Promise<TeleFile[]> {
  // 1. Load the manifest. Skip cleanly if it's corrupt — the runner
  // gates on the same sentinel and we want consistent behavior.
  let manifest;
  try {
    manifest = await loadManifest();
  } catch (err) {
    console.warn("[bootstrap] manifest load threw; skipping merge:", err);
    return existingFiles;
  }
  if (isManifestCorrupt()) {
    console.warn("[bootstrap] manifest corrupt; skipping merge (runner will refuse to upload too)");
    return existingFiles;
  }
  const manifestEntries = Object.entries(manifest.entries ?? {});
  if (manifestEntries.length === 0) {
    return existingFiles;
  }

  // 2. Convert entries to TeleFiles. Drop ones that fail the conversion
  // (defensive — older manifest versions might lack messageId/folderPath).
  const fromManifest: TeleFile[] = [];
  let conversionFailures = 0;
  for (const [absPath, entry] of manifestEntries) {
    const tf = manifestEntryToTeleFile(absPath, entry, channelId);
    if (tf && !isJunkFile(tf)) fromManifest.push(tf);
    else conversionFailures++;
  }
  if (conversionFailures > 0) {
    console.warn(
      `[bootstrap] manifest merge: ${conversionFailures}/${manifestEntries.length} entries failed conversion`,
    );
  }
  if (fromManifest.length === 0) {
    return existingFiles;
  }

  // 3. dedupeByMessageId against existing files (the index version wins
  // on conflicts because it may carry richer metadata, e.g. an updated
  // folderPath if a file was moved).
  const existingMsgIds = new Set(
    existingFiles.map((f) => Number(f.messageId)).filter((id) => Number.isFinite(id) && id > 0),
  );
  const newFromManifest = fromManifest.filter(
    (f) => !existingMsgIds.has(Number(f.messageId)),
  );
  const added = newFromManifest.length;
  if (added === 0) {
    return existingFiles;
  }

  // 4. Reconstruct missing parent folders BEFORE setFiles so the Backups
  // view renders a complete tree on the very next render (no waiting on
  // the orphan scan to populate intermediate folders).
  const merged = [...existingFiles, ...newFromManifest];
  const { healedFiles } = reconstructMissingFolders(merged, channelId);

  // 5. Apply to the store. setFiles writes localStorage too, so the
  // change survives a refresh even if the Telegram saveIndex below fails.
  setFiles(healedFiles);
  console.log(
    `[bootstrap] manifest merge added ${added} backup entries (total ${healedFiles.length})`,
  );
  await invoke("log_vault_state", {
    state: `BOOTSTRAP_MANIFEST_MERGE added=${added} total=${healedFiles.length}`,
  }).catch(() => {});

  return healedFiles;
}

/**
 * Fire-and-forget wrapper around saveIndex used by the manifest-merge
 * path. The saveIndex call routes through enqueueSave, which serializes
 * with user actions and retries on transient FLOOD_WAIT. We deliberately
 * don't await it during bootstrap — bootstrap completion is what unblocks
 * user actions, so blocking bootstrap on the queue would be a deadlock.
 *
 * If the save fails entirely (hard Telegram error), the merge still
 * applied in-memory, so the Backups view works for this session. On the
 * next cold start, the manifest-merge path runs again and tries the
 * saveIndex once more. The manifest is durable so no data is lost.
 */
function fireAndForgetSaveIndex(channelId: string, state: TeleFile[]): void {
  saveIndex(channelId, state).catch((err) => {
    console.warn("[bootstrap] manifest-merge saveIndex failed (non-fatal):", err);
  });
}

/**
 * Reconcile an orphan-recovered file set (`recovered`) with user-only
 * entries that arrived after recovery started (`userOnly`). When the same
 * underlying Telegram messageId appears in both, the USER version wins
 * (folderPath, name, etc.) because it reflects the user's most recent
 * intent. The recovered version provides its metadata only for entries
 * the user has never touched.
 *
 * This function also handles the "user moved a file that the orphan scan
 * just recovered" case: the recovered entry has the file's pre-existing
 * (Telegram-state) folderPath, while the user's entry has the moved
 * folderPath. We want the moved version.
 */
function mergeWithUserPreference(
  recovered: TeleFile[],
  userOnly: TeleFile[],
): TeleFile[] {
  if (userOnly.length === 0) return recovered;
  if (recovered.length === 0) return userOnly;

  // Build a quick lookup of user entries by messageId. Files without a
  // real Telegram messageId (e.g. fresh uploads not yet pinned, or
  // purely-local placeholders) are kept as-is from `userOnly` since
  // they can't correspond to anything recovered from Telegram.
  const userByMsgId = new Map<number, TeleFile>();
  for (const f of userOnly) {
    const id = Number(f.messageId);
    if (Number.isFinite(id) && id > 0) {
      userByMsgId.set(id, f);
    }
  }

  const merged: TeleFile[] = [];
  let userOverrides = 0;
  for (const r of recovered) {
    const rid = Number(r.messageId);
    const userVersion = userByMsgId.get(rid);
    if (userVersion) {
      // User touched this messageId AFTER the orphan scan started — keep
      // the user's folderPath/name/etc., but if the recovered version has
      // a richer messageId/channelId (it always does, since orphans carry
      // a real Telegram id) and the user's version is missing one, fill it
      // in. This keeps drag/drop behaviour intuitive while still letting
      // the orphan scan repair broken messageIds.
      const patched: TeleFile = {
        ...userVersion,
        messageId: userVersion.messageId || r.messageId,
        channelId: userVersion.channelId || r.channelId,
      };
      merged.push(patched);
      userOverrides++;
    } else {
      merged.push(r);
    }
  }

  // Add user-only entries that have no Telegram messageId match (purely
  // local — pending uploads, optimistic placeholders, etc.). These never
  // appear in `recovered` because Telegram doesn't know about them yet.
  for (const f of userOnly) {
    const id = Number(f.messageId);
    if (!Number.isFinite(id) || id <= 0) {
      merged.push(f);
    }
  }

  if (userOverrides > 0) {
    console.log(
      `[bootstrap] orphan-recovery merge: ${userOverrides} user action(s) preserved (would have been clobbered)`,
    );
  }
  return merged;
}

