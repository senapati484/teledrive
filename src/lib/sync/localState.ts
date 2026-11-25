import { useFileStore } from "../../stores/fileStore";
import { useBackupProgressStore } from "../../stores/backupProgressStore";

/**
 * Whether the authoritative remote snapshot may replace the in-memory file
 * list. Callers own reads/writes, so replacing while a local mutation is
 * optimistic would make those files disappear until the next successful save.
 *
 * `allowQueueSaving` is only for the index writer itself: during a conflict
 * recovery the queue intentionally holds `indexQueueState = "saving"` while it
 * replaces its own stale optimistic state with the merged snapshot.
 */
export function canReplaceLocalState(
  options: { allowQueueSaving?: boolean } = {},
): boolean {
  const store = useFileStore.getState();
  if (store.isSyncing) return false;
  // The backup runner writes its file list before the debounced index save
  // starts, so honor the run-level flag rather than only queue state.
  if (useBackupProgressStore.getState().active) return false;
  if (
    store.uploadQueue.some(
      (item) => item.status === "pending" || item.status === "uploading",
    )
  ) {
    return false;
  }
  const queueState = store.indexQueueState;
  if (options.allowQueueSaving && queueState === "saving") return true;
  return queueState === "idle" || queueState === "syncing-remote";
}
