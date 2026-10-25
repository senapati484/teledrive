import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryBackend,
  makeTeleFile,
  resetBackupTestState,
  type MemoryBackend,
} from "./helpers";
import {
  appendManifestEntry,
  emptyManifest,
  ensureManifest,
  filterSupersededBackupFiles,
  isManifestCorrupt,
  loadManifest,
  recordUpload,
  saveManifest,
  type ManifestEntryV2,
} from "../manifest";

const h = vi.hoisted(() => ({ backend: null as MemoryBackend | null }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => h.backend!.invoke(...args),
}));

const CHANNEL = "chan_manifest_test";

function entry(messageId: number, overrides: Partial<ManifestEntryV2> = {}): ManifestEntryV2 {
  return {
    mtimeMs: 1000,
    size: 10,
    messageId,
    folderPath: "/TeleDrive Backups/Device",
    uploadedAt: new Date(1_000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  resetBackupTestState();
  h.backend = createMemoryBackend();
});

describe("manifest v2", () => {
  it("round-trips the base and replays journal entries", async () => {
    let manifest = emptyManifest(CHANNEL);
    manifest = recordUpload(manifest, "/a.txt", {
      mtimeMs: 1,
      size: 10,
      messageId: 100,
      folderPath: "/TeleDrive Backups/Device",
    });
    manifest.generation = await saveManifest(CHANNEL, manifest);
    await appendManifestEntry(CHANNEL, manifest.generation, "/b.txt", entry(101));

    const loaded = await loadManifest(CHANNEL);
    expect(loaded.generation).toBe(1);
    expect(loaded.entries["/a.txt"].messageId).toBe(100);
    expect(loaded.entries["/b.txt"].messageId).toBe(101);
  });

  it("last journal line wins and stale generations are ignored", async () => {
    let manifest = emptyManifest(CHANNEL);
    manifest.generation = await saveManifest(CHANNEL, manifest);
    await appendManifestEntry(CHANNEL, manifest.generation, "/a", entry(1));
    await appendManifestEntry(CHANNEL, manifest.generation, "/a", entry(2));

    const state = h.backend!.manifests.get(CHANNEL)!;
    state.journal.push(
      JSON.stringify({ generation: 0, absPath: "/stale", entry: entry(3) }),
    );

    const loaded = await loadManifest(CHANNEL);
    expect(loaded.entries["/a"].messageId).toBe(2);
    expect(loaded.entries["/stale"]).toBeUndefined();
  });

  it("quarantines a corrupt base and gates that channel", async () => {
    h.backend!.manifests.set(CHANNEL, {
      base: "{not json",
      generation: 3,
      journal: [],
    });

    const loaded = await loadManifest(CHANNEL);
    expect(loaded.entries).toEqual({});
    expect(isManifestCorrupt(CHANNEL)).toBe(true);
    expect(h.backend!.invoke).toHaveBeenCalledWith(
      "quarantine_backup_manifest",
      expect.objectContaining({ channelId: CHANNEL }),
    );
  });

  it("isolates channels", async () => {
    let a = emptyManifest(CHANNEL);
    a = recordUpload(a, "/a", {
      mtimeMs: 1,
      size: 1,
      messageId: 1,
      folderPath: "/x",
    });
    a.generation = await saveManifest(CHANNEL, a);

    const b = await loadManifest("chan_other");
    expect(b.entries).toEqual({});
  });
});

describe("legacy migration", () => {
  it("adopts v1 only when every sampled id is live", async () => {
    h.backend!.vault.set(
      "teledrive_backup_manifest_v1",
      JSON.stringify({
        version: 1,
        deviceName: "Mac",
        deviceOs: "macos",
        lastRunAt: 5000,
        entries: { "/a": entry(10), "/b": entry(11) },
      }),
    );

    const migrated = await ensureManifest(CHANNEL, async () => new Set([10, 11]));
    expect(Object.keys(migrated.entries)).toHaveLength(2);
    expect(migrated.lastSuccessAt).toBe(5000);
    expect(h.backend!.vault.has("teledrive_backup_manifest_v1")).toBe(false);
    expect(h.backend!.manifests.get(CHANNEL)?.base).toBeTruthy();
  });

  it("quarantines and starts empty when one sampled id is missing", async () => {
    h.backend!.vault.set(
      "teledrive_backup_manifest_v1",
      JSON.stringify({
        version: 1,
        entries: { "/a": entry(10), "/b": entry(11) },
      }),
    );

    const migrated = await ensureManifest(CHANNEL, async () => new Set([10]));
    expect(migrated.entries).toEqual({});
    expect(h.backend!.manifests.get(CHANNEL)?.base ?? null).toBeNull();
    expect(
      [...h.backend!.vault.keys()].some((key) =>
        key.startsWith("teledrive_backup_manifest_v1.migrated-"),
      ),
    ).toBe(true);
  });
});

describe("filterSupersededBackupFiles", () => {
  it("drops old ids, garbage, and duplicate same-path files but keeps the current entry", async () => {
    const manifest = {
      ...emptyManifest(CHANNEL),
      entries: {
        "/root/a.txt": {
          ...entry(20),
          previousMessageIds: [10],
        },
      },
      garbage: [{ messageId: 12, folderPath: "/root", since: 1 }],
    };
    const folder = "/TeleDrive Backups/Test Mac (macos)/root";
    const files = [
      makeTeleFile("old", { messageId: 10, name: "a.txt", folderPath: folder, uploadedAt: 5 }),
      makeTeleFile("garbage", { messageId: 12, name: "g.txt", folderPath: folder, uploadedAt: 5 }),
      makeTeleFile("current", { messageId: 20, name: "a.txt", folderPath: folder, uploadedAt: 6 }),
      makeTeleFile("dup", { messageId: 21, name: "a.txt", folderPath: folder, uploadedAt: 7 }),
      makeTeleFile("chat", { messageId: 99, name: "note.txt", folderPath: "/Notes", uploadedAt: 1 }),
    ];

    const result = filterSupersededBackupFiles(manifest, files);
    expect(result.changed).toBe(true);
    expect(result.files.map((f) => f.id)).toEqual(["chat", "current"]);
  });

  it("reports no change when everything is current", async () => {
    const manifest = emptyManifest(CHANNEL);
    const files = [makeTeleFile("chat", { folderPath: "/Notes" })];
    const result = filterSupersededBackupFiles(manifest, files);
    expect(result.changed).toBe(false);
    expect(result.files).toEqual(files);
  });
});
