import { create } from "zustand";
import { TeleFile, UploadItem } from "../lib/types";
import { filterJunkFiles } from "../lib/storage/fileSanitizer";
import { normalizeFolderPath } from "../lib/utils";

export type IndexQueueState =
  | "idle"
  | "saving"
  | "retrying"
  | "failed"
  /** Live remote sync is in progress (background poll pulling new messages). */
  | "syncing-remote"
  /** A backup snapshot send is currently in flight. */
  | "backup-running";

interface FileState {
  files: TeleFile[];
  currentFolder: string;
  selectedIds: string[];
  /** O(1) lookup mirror of selectedIds — always kept in sync */
  selectedIdsSet: Set<string>;
  /** IDs currently being drag-moved (set on dragstart, cleared on dragend/drop) */
  draggedItemIds: string[];
  isLoading: boolean;
  isSyncing: boolean;
  uploadQueue: UploadItem[];
  isOperating: boolean;
  /** Per-action file-array snapshots for rollback (ring buffer, max 10). */
  snapshots: TeleFile[][];
  /** Coarse state of the index-save queue, surfaced in the topbar pill. */
  indexQueueState: IndexQueueState;
  /** Seconds remaining for an in-progress retry wait (0 when not waiting). */
  indexQueueRetryInSec: number;
  /** Human-readable detail of the last hard failure (null when healthy). */
  indexQueueError: string | null;
  /**
   * True once the initial loadIndex + setFiles has completed.
   * Stays true for the rest of the session. Used to suppress user actions
   * from triggering index writes BEFORE bootstrap finishes — otherwise an
   * action that fires during the orphan-scan window can race the bootstrap
   * resave and create a third index message set.
   */
  bootstrapComplete: boolean;
  /**
   * Highest Telegram message id observed during the most recent index load
   * (cold start or sync poll). Used by the multi-device sync poller as the
   * `minId` cursor for `client.getMessages` so we only fetch new messages.
   * 0 = never observed (sync has not run yet, or no messages exist).
   */
  lastIndexMsgId: number;
  /** Unix ms timestamp of the last successful remote-sync poll (null = never). */
  lastRemoteSyncAt: number | null;
  /** Unix ms timestamp of the last completed backup snapshot (null = never). */
  lastBackupAt: number | null;
  setFiles: (files: TeleFile[]) => void;
  setSyncing: (isSyncing: boolean) => void;
  setFolder: (path: string) => void;
  toggleSelect: (id: string) => void;
  setSelectedIds: (ids: string[]) => void;
  clearSelection: () => void;
  setDraggedItemIds: (ids: string[]) => void;
  clearDraggedItemIds: () => void;
  addToQueue: (item: UploadItem) => void;
  updateQueueItem: (id: string, patch: Partial<UploadItem>) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
  setLoading: (loading: boolean) => void;
  setIsOperating: (isOperating: boolean) => void;
  /** Push a snapshot of the current files array onto the rollback ring. */
  pushSnapshot: () => void;
  /** Pop and return the most recent snapshot (FIFO). */
  popSnapshot: () => TeleFile[] | null;
  /** Clear all snapshots — call after a successful batch commit. */
  clearSnapshots: () => void;
  setIndexQueueState: (state: IndexQueueState) => void;
  setIndexQueueRetryInSec: (secs: number) => void;
  setIndexQueueError: (err: string | null) => void;
  /** Mark initial bootstrap (loadIndex → setFiles) as complete. */
  setBootstrapComplete: (v: boolean) => void;
  /**
   * Merge remote deltas (multi-device sync) into the in-memory file list
   * WITHOUT triggering a Telegram index write. Resolves when the merge
   * has settled. See implementation for the lazy-import reason.
   */
  setRemoteDelta: (remoteFiles: TeleFile[]) => Promise<void>;
  /** Update the high-water mark for the multi-device sync cursor. */
  setLastIndexMsgId: (msgId: number) => void;
  /** Record the timestamp of a backup snapshot. */
  setLastBackupAt: (ms: number) => void;
}

const getInitialFiles = (): TeleFile[] => {
  if (typeof localStorage === "undefined") return [];
  try {
    const cached = localStorage.getItem("teledrive_cached_files");
    if (!cached) return [];
    const parsed = JSON.parse(cached);
    if (!Array.isArray(parsed)) return [];
    return filterJunkFiles(parsed).map((f) => ({
      ...f,
      folderPath: normalizeFolderPath(f.folderPath),
    }));
  } catch (err) {
    console.warn("[fileStore] Failed to load cached files from localStorage:", err);
    return [];
  }
};

let cacheTimeout: ReturnType<typeof setTimeout> | null = null;
const debouncedCacheFiles = (files: TeleFile[]) => {
  if (typeof localStorage === "undefined") return;
  if (cacheTimeout) clearTimeout(cacheTimeout);
  cacheTimeout = setTimeout(() => {
    try {
      localStorage.setItem("teledrive_cached_files", JSON.stringify(files));
    } catch (err) {
      console.warn("[fileStore] Failed to cache files to localStorage:", err);
    }
  }, 300);
};

const SNAPSHOT_RING_LIMIT = 3;

const initialFiles = getInitialFiles();
const wasBootstrapCompleted =
  typeof sessionStorage !== "undefined" &&
  sessionStorage.getItem("teledrive_bootstrap_done") === "true";

export const useFileStore = create<FileState>((set, get) => ({
  files: initialFiles,
  currentFolder: "/",
  selectedIds: [],
  selectedIdsSet: new Set<string>(),
  draggedItemIds: [],
  isLoading: false,
  isSyncing: false,
  uploadQueue: [],
  isOperating: false,
  snapshots: [],
  indexQueueState: "idle",
  indexQueueRetryInSec: 0,
  indexQueueError: null,
  bootstrapComplete: initialFiles.length > 0 || wasBootstrapCompleted,
  lastIndexMsgId: 0,
  lastRemoteSyncAt: null,
  lastBackupAt: null,
  setFiles: (rawFiles) => {
    const files = filterJunkFiles(rawFiles).map((f) => ({
      ...f,
      folderPath: normalizeFolderPath(f.folderPath),
    }));
    debouncedCacheFiles(files);
    set({ files });
  },
  setSyncing: (isSyncing) => set({ isSyncing }),
  setFolder: (currentFolder) =>
    set({
      currentFolder: normalizeFolderPath(currentFolder),
      selectedIds: [],
      selectedIdsSet: new Set(),
    }),
  toggleSelect: (id) =>
    set((state) => {
      const next = new Set(state.selectedIdsSet);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedIds: Array.from(next), selectedIdsSet: next };
    }),
  setSelectedIds: (selectedIds) =>
    set({ selectedIds, selectedIdsSet: new Set(selectedIds) }),
  clearSelection: () => set({ selectedIds: [], selectedIdsSet: new Set() }),
  setDraggedItemIds: (draggedItemIds) => set({ draggedItemIds }),
  clearDraggedItemIds: () => set({ draggedItemIds: [] }),
  addToQueue: (item) =>
    set((state) => ({ uploadQueue: [...state.uploadQueue, item] })),
  updateQueueItem: (id, patch) =>
    set((state) => ({
      uploadQueue: state.uploadQueue.map((item) =>
        item.id === id ? { ...item, ...patch } : item
      ),
    })),
  removeFromQueue: (id) =>
    set((state) => ({
      uploadQueue: state.uploadQueue.filter((item) => item.id !== id),
    })),
  clearQueue: () => set({ uploadQueue: [] }),
  setLoading: (isLoading) => set({ isLoading }),
  setIsOperating: (isOperating) => set({ isOperating }),
  pushSnapshot: () =>
    set((state) => {
      const next = [...state.snapshots, state.files];
      // Trim oldest if we exceed the ring limit so memory stays bounded.
      while (next.length > SNAPSHOT_RING_LIMIT) next.shift();
      return { snapshots: next };
    }),
  popSnapshot: () => {
    const cur = get().snapshots;
    if (cur.length === 0) return null;
    const last = cur[cur.length - 1];
    set({ snapshots: cur.slice(0, -1) });
    return last;
  },
  clearSnapshots: () => set({ snapshots: [] }),
  setIndexQueueState: (indexQueueState) => set({ indexQueueState }),
  setIndexQueueRetryInSec: (indexQueueRetryInSec) =>
    set({ indexQueueRetryInSec }),
  setIndexQueueError: (indexQueueError) => set({ indexQueueError }),
  setBootstrapComplete: (bootstrapComplete) => {
    if (bootstrapComplete && typeof sessionStorage !== "undefined") {
      sessionStorage.setItem("teledrive_bootstrap_done", "true");
    }
    set({ bootstrapComplete });
  },
  /**
   * Merge new files arriving from another device's sync poll (or any other
   * read-only delta source) into the in-memory file list WITHOUT triggering
   * a Telegram index write. Lazy-imports dedupeByMessageId to avoid the
   * circular module dependency on metadataStore.
   *
   * Idempotent: if no new ids arrive, this is a no-op (we don't even touch
   * the `files` array reference, so React subscribers don't re-render).
   *
   * Returns a Promise so the caller can await the merge (useful for the
   * sync orchestrator that wants to know when the store settled). The
   * implementation is still synchronous after the dynamic import resolves,
   * so callers don't need to handle any queueing.
   */
  setRemoteDelta: async (remoteFiles: TeleFile[]) => {
    const cleanRemote = filterJunkFiles(remoteFiles);
    if (cleanRemote.length === 0) return;
    const { dedupeByMessageId, collapseDuplicateFolders, reconstructMissingFolders } = await import(
      "../lib/storage/metadataStore"
    );
    set((state) => {
      const merged = filterJunkFiles(collapseDuplicateFolders(dedupeByMessageId([...state.files, ...cleanRemote])));
      const channelId = state.files[0]?.channelId || remoteFiles[0]?.channelId || "";
      const { healedFiles } = reconstructMissingFolders(merged, channelId);
      if (healedFiles.length === state.files.length) return state;
      debouncedCacheFiles(healedFiles);
      return {
        files: healedFiles,
        lastRemoteSyncAt: Date.now(),
      };
    });
  },
  setLastIndexMsgId: (msgId) => set({ lastIndexMsgId: msgId }),
  setLastBackupAt: (ms) => set({ lastBackupAt: ms }),
}));
