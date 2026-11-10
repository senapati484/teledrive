import { afterEach, describe, expect, it } from "vitest";
import type { TeleFile } from "../../types";
import {
  clearCachedFilesSnapshot,
  hasCachedFilesHint,
  loadCachedFilesSnapshot,
  saveCachedFilesSnapshot,
  syncSmallCacheFallback,
} from "../localIndexCache";

function makeFile(i: number): TeleFile {
  return {
    id: `f_${i}`,
    name: `item-${i}.bin`,
    size: 1024 + i,
    mime: "application/octet-stream",
    folderPath: i % 2 === 0 ? "/Docs" : "/Media",
    messageId: 100 + i,
    channelId: "-100123",
    uploadedAt: 1700000000000 + i,
  };
}

class MemoryStorage {
  private map = new Map<string, string>();
  public throwOnSet = false;
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    if (this.throwOnSet) {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    }
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

function createFakeIndexedDb() {
  const stores = new Map<string, Map<string, unknown>>();

  const makeReq = <T,>(runner: () => T) => {
    const req: any = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    queueMicrotask(() => {
      try {
        req.result = runner();
        req.onsuccess?.({ target: req });
      } catch (err) {
        req.error = err;
        req.onerror?.({ target: req });
      }
    });
    return req;
  };

  const makeDb = () => ({
    objectStoreNames: {
      contains: (name: string) => stores.has(name),
    },
    createObjectStore: (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      return {};
    },
    transaction: (storeName: string) => {
      if (!stores.has(storeName)) stores.set(storeName, new Map());
      const map = stores.get(storeName)!;
      const tx: any = {
        oncomplete: null,
        onerror: null,
        objectStore: () => ({
          get: (key: string) => makeReq(() => map.get(key) ?? null),
          put: (value: unknown, key: string) =>
            makeReq(() => {
              map.set(key, value);
              queueMicrotask(() => tx.oncomplete?.({}));
              return key;
            }),
          delete: (key: string) =>
            makeReq(() => {
              map.delete(key);
              queueMicrotask(() => tx.oncomplete?.({}));
              return undefined;
            }),
        }),
      };
      return tx;
    },
    close: () => {},
  });

  const factory: any = {
    open: () => {
      const req: any = {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        const db = makeDb();
        req.result = db;
        if (!stores.has("snapshots")) {
          req.onupgradeneeded?.({ target: req });
        }
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };

  return { factory, stores };
}

const origLocalStorage = (globalThis as any).localStorage;
const origIndexedDb = (globalThis as any).indexedDB;

afterEach(() => {
  if (origLocalStorage === undefined) delete (globalThis as any).localStorage;
  else (globalThis as any).localStorage = origLocalStorage;

  if (origIndexedDb === undefined) delete (globalThis as any).indexedDB;
  else (globalThis as any).indexedDB = origIndexedDb;
});

describe("localIndexCache", () => {
  it("stores and reloads large snapshots via IndexedDB even past localStorage quota limits", async () => {
    const ls = new MemoryStorage();
    ls.throwOnSet = true;
    (globalThis as any).localStorage = ls;
    const { factory } = createFakeIndexedDb();
    (globalThis as any).indexedDB = factory;

    const files = Array.from({ length: 2000 }, (_, i) => makeFile(i));
    await saveCachedFilesSnapshot(files);

    const loaded = await loadCachedFilesSnapshot();
    expect(loaded).toHaveLength(2000);
    expect(loaded[1999].id).toBe("f_1999");

    await clearCachedFilesSnapshot();
    expect(await loadCachedFilesSnapshot()).toEqual([]);
  });

  it("migrates legacy localStorage teledrive_cached_files into IndexedDB cleanly", async () => {
    const ls = new MemoryStorage();
    const legacyFiles = [makeFile(1), makeFile(2)];
    ls.setItem("teledrive_cached_files", JSON.stringify(legacyFiles));
    (globalThis as any).localStorage = ls;
    const { factory } = createFakeIndexedDb();
    (globalThis as any).indexedDB = factory;

    expect(hasCachedFilesHint()).toBe(true);
    const loaded = await loadCachedFilesSnapshot();
    expect(loaded.map((f) => f.id)).toEqual(["f_1", "f_2"]);
    expect(ls.getItem("teledrive_has_cached_index")).toBe("1");
    expect(ls.getItem("teledrive_cached_files")).toBeNull();
  });

  it("falls back to localStorage cleanly when IndexedDB is unavailable and clears stale large mirrors on quota", () => {
    const ls = new MemoryStorage();
    (globalThis as any).localStorage = ls;
    delete (globalThis as any).indexedDB;

    const small = [makeFile(1)];
    syncSmallCacheFallback(small);
    expect(hasCachedFilesHint()).toBe(true);
    expect(ls.getItem("teledrive_cached_files")).toContain("f_1");

    // Stale small mirror is removed if localStorage throws on large write
    ls.throwOnSet = true;
    syncSmallCacheFallback([makeFile(2)]);
    expect(ls.getItem("teledrive_cached_files")).toBeNull();
  });
});

