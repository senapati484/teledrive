import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useFileStore } from "../../../stores/fileStore";
import type { TeleFile } from "../../types";
import {
  writePendingMarker,
  readPendingMarker,
  clearPendingMarker,
  resolvePendingIndex,
  type PendingIndexMarker,
} from "../pendingIndex";
import {
  enqueueSave,
  enqueueSaveDuringRecovery,
  flushAllQueues,
  getIndexQueue,
  resetQueuesForTests,
  setCommitImplForTests,
} from "../indexQueue";

const CHANNEL = "chan_pending_test";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

function file(id: string, overrides: Partial<TeleFile> = {}): TeleFile {
  return {
    id,
    name: `${id}.mp4`,
    size: 1,
    mime: "video/mp4",
    folderPath: "/",
    messageId: 1,
    channelId: CHANNEL,
    uploadedAt: 1,
    starred: false,
    trashed: false,
    ...overrides,
  };
}

function marker(overrides: Partial<PendingIndexMarker> = {}): PendingIndexMarker {
  return {
    channelId: CHANNEL,
    baseSavedAt: 1000,
    at: 123,
    ...overrides,
  };
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage();
  resetQueuesForTests();
  useFileStore.setState({
    files: [],
    indexLoadState: "ready",
    indexLoadError: null,
    indexQueueState: "idle",
    indexQueueError: null,
    indexQueueRetryInSec: 0,
    bootstrapComplete: true,
  });
});

afterEach(() => {
  resetQueuesForTests();
  delete (globalThis as any).localStorage;
});

describe("pending index marker", () => {
  it("round-trips and isolates markers per channel", () => {
    writePendingMarker(marker({ channelId: "a", baseSavedAt: 10 }));
    writePendingMarker(marker({ channelId: "b", baseSavedAt: 20 }));

    expect(readPendingMarker("a")?.baseSavedAt).toBe(10);
    expect(readPendingMarker("b")?.baseSavedAt).toBe(20);
    expect(readPendingMarker("missing")).toBeNull();

    clearPendingMarker("a");
    expect(readPendingMarker("a")).toBeNull();
    expect(readPendingMarker("b")?.baseSavedAt).toBe(20);
  });

  it("ignores malformed markers", () => {
    localStorage.setItem(`teledrive_pending_index:${CHANNEL}`, "{not json");
    expect(readPendingMarker(CHANNEL)).toBeNull();
    localStorage.setItem(
      `teledrive_pending_index:${CHANNEL}`,
      JSON.stringify({ channelId: CHANNEL, baseSavedAt: -1, at: 1 })
    );
    expect(readPendingMarker(CHANNEL)).toBeNull();
  });

  it("keeps the cache when the marker base is newer than the loaded epoch", () => {
    const cached = [file("local")];
    const loaded = [file("remote")];
    const result = resolvePendingIndex(marker({ baseSavedAt: 5000 }), cached, loaded, 4000);
    expect(result).toMatchObject({ kind: "keep-cache", replay: true });
    expect(result.files).toBe(cached);
  });

  it("discards the marker when the loaded epoch is newer", () => {
    const cached = [file("local")];
    const loaded = [file("remote")];
    const result = resolvePendingIndex(marker({ baseSavedAt: 1000 }), cached, loaded, 2000);
    expect(result).toMatchObject({ kind: "discard", replay: false });
    expect(result.files).toBe(loaded);
  });

  it("additively merges when the base timestamp is unknown", () => {
    const cached = [file("local")];
    const loaded = [file("remote")];
    const result = resolvePendingIndex(marker({ baseSavedAt: 0 }), cached, loaded, 9000);
    expect(result.kind).toBe("merge");
    expect(result.replay).toBe(true);
    expect(result.files.map((f) => f.id)).toEqual(["local", "remote"]);
  });

  it("discards an unknown-base marker when the cache has no extra ids", () => {
    const cached = [file("same")];
    const loaded = [file("same"), file("remote")];
    const result = resolvePendingIndex(marker({ baseSavedAt: 0 }), cached, loaded, 9000);
    expect(result.kind).toBe("discard");
    expect(result.replay).toBe(false);
    expect(result.files.map((f) => f.id)).toEqual(["same", "remote"]);
  });
});

describe("queue pending-marker integration", () => {
  beforeEach(() => {
    const text = JSON.stringify({
      teledrive_index: true,
      version: 2,
      chunkIndex: 0,
      totalChunks: 1,
      savedAt: 1000,
      chunkMsgIds: [],
      files: [],
    });
    getIndexQueue(CHANNEL).setKnownIndex([1], [text]);
  });

  it("writes the marker on enqueue (with the flushed cache) and clears it after commit", async () => {
    const files = [file("local")];
    useFileStore.setState({ files });
    setCommitImplForTests(CHANNEL, async () => {});

    const saving = enqueueSave(CHANNEL, files);
    const written = readPendingMarker(CHANNEL);
    expect(written?.baseSavedAt).toBe(1000);
    expect(written?.at).toBeGreaterThan(0);
    expect(localStorage.getItem("teledrive_cached_files")).toContain("local");

    await saving;
    expect(readPendingMarker(CHANNEL)).toBeNull();
  });

  it("keeps the marker after a failed commit", async () => {
    const files = [file("local")];
    useFileStore.setState({ files });
    setCommitImplForTests(CHANNEL, async () => {
      throw new Error("CHANNEL_PRIVATE");
    });

    await expect(enqueueSave(CHANNEL, files)).rejects.toThrow();
    expect(readPendingMarker(CHANNEL)).not.toBeNull();
  });

  it("keeps the marker when a logout flush fails", async () => {
    const files = [file("local")];
    useFileStore.setState({ files });
    setCommitImplForTests(CHANNEL, async () => {
      throw new Error("network timeout");
    });

    const saving = enqueueSave(CHANNEL, files).catch((err) => err);
    const results = await flushAllQueues();
    expect(results[0].status).toBe("failed");
    await saving;
    expect(readPendingMarker(CHANNEL)).not.toBeNull();
  });

  it("recovery writes never create a pending marker", async () => {
    useFileStore.getState().setIndexLoadState("incomplete", "partial_manifest");
    setCommitImplForTests(CHANNEL, async () => {});
    await enqueueSaveDuringRecovery(CHANNEL, [file("recovered")]);
    expect(readPendingMarker(CHANNEL)).toBeNull();
  });
});
