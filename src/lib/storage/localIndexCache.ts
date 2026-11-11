import type { TeleFile } from "../types";
import { normalizeFolderPath } from "../utils";

export const LEGACY_CACHE_KEY = "teledrive_cached_files";
export const CACHE_HINT_KEY = "teledrive_has_cached_index";
const IDB_NAME = "teledrive_cache_v1";
const IDB_STORE = "snapshots";
const IDB_KEY = "files_snapshot";
const SMALL_SYNC_CAP = 1500;

function hasIndexedDb(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { indexedDB?: IDBFactory }).indexedDB?.open === "function"
  );
}

function setHintSafe(hasFiles: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (hasFiles) {
      localStorage.setItem(CACHE_HINT_KEY, "1");
    } else {
      localStorage.removeItem(CACHE_HINT_KEY);
    }
  } catch {
    // Ignore restricted/full localStorage when writing the 1-byte hint.
  }
}

function normalizeEntries(entries: unknown): TeleFile[] {
  if (!Array.isArray(entries)) return [];
  return entries.map((f: any) => ({
    ...f,
    folderPath: normalizeFolderPath(f?.folderPath),
  }));
}

function readLegacyLocalStorage(): TeleFile[] | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LEGACY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeEntries(parsed) : null;
  } catch {
    return null;
  }
}

async function withIdbStore<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const factory = (globalThis as { indexedDB: IDBFactory }).indexedDB;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(IDB_STORE)) {
        database.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });

  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode);
      const store = tx.objectStore(IDB_STORE);
      const req = op(store);
      let settledValue: T;
      let hasResult = false;
      req.onsuccess = () => {
        settledValue = req.result;
        hasResult = true;
        if (mode === "readonly") resolve(settledValue);
      };
      req.onerror = () =>
        reject(req.error ?? new Error("IndexedDB request failed"));
      tx.oncomplete = () => {
        if (mode !== "readonly") {
          resolve(hasResult ? settledValue : (undefined as T));
        }
      };
      tx.onerror = () =>
        reject(tx.error ?? new Error("IndexedDB transaction failed"));
    });
  } finally {
    try {
      db.close();
    } catch {
      // Ignore double-close errors in environments with partial IDB mocks.
    }
  }
}

/**
 * Synchronous startup hint indicating whether a non-empty local snapshot is
 * expected on disk (IndexedDB or legacy localStorage).
 */
export function hasCachedFilesHint(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    if (localStorage.getItem(CACHE_HINT_KEY) === "1") return true;
    const legacy = readLegacyLocalStorage();
    return Boolean(legacy && legacy.length > 0);
  } catch {
    return false;
  }
}

/**
 * Synchronously mirrors small snapshots to localStorage for immediate boot /
 * crash-pending-marker recovery when quota allows; drops stale large mirrors
 * cleanly if quota is exceeded so IndexedDB remains authoritative.
 */
export function syncSmallCacheFallback(files: TeleFile[]): void {
  if (typeof localStorage === "undefined") return;
  setHintSafe(files.length > 0);

  if (hasIndexedDb() && files.length > SMALL_SYNC_CAP) {
    try {
      localStorage.removeItem(LEGACY_CACHE_KEY);
    } catch {
      // Ignore cleanup errors
    }
    return;
  }

  try {
    localStorage.setItem(LEGACY_CACHE_KEY, JSON.stringify(files));
  } catch {
    try {
      localStorage.removeItem(LEGACY_CACHE_KEY);
    } catch {
      // Ignore cleanup errors
    }
  }
}

export async function saveCachedFilesSnapshot(files: TeleFile[]): Promise<void> {
  syncSmallCacheFallback(files);
  if (!hasIndexedDb()) return;
  try {
    await withIdbStore("readwrite", (store) => store.put(files, IDB_KEY));
  } catch (err) {
    console.warn("[localIndexCache] Failed to save snapshot to IndexedDB:", err);
  }
}

export async function loadCachedFilesSnapshot(): Promise<TeleFile[]> {
  if (hasIndexedDb()) {
    try {
      const stored = await withIdbStore<unknown>("readonly", (store) =>
        store.get(IDB_KEY)
      );
      if (Array.isArray(stored)) {
        return normalizeEntries(stored);
      }
    } catch (err) {
      console.warn(
        "[localIndexCache] Failed to load snapshot from IndexedDB:",
        err
      );
    }
  }

  const legacy = readLegacyLocalStorage();
  if (!legacy) return [];

  if (hasIndexedDb()) {
    try {
      await withIdbStore("readwrite", (store) => store.put(legacy, IDB_KEY));
      setHintSafe(legacy.length > 0);
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(LEGACY_CACHE_KEY);
      }
    } catch {
      // Keep legacy copy intact if migration write fails.
    }
  }
  return legacy;
}

export async function clearCachedFilesSnapshot(): Promise<void> {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(CACHE_HINT_KEY);
      localStorage.removeItem(LEGACY_CACHE_KEY);
    } catch {
      // Ignore localStorage cleanup errors
    }
  }
  if (!hasIndexedDb()) return;
  try {
    await withIdbStore("readwrite", (store) => store.delete(IDB_KEY));
  } catch (err) {
    console.warn(
      "[localIndexCache] Failed to clear snapshot from IndexedDB:",
      err
    );
  }
}

