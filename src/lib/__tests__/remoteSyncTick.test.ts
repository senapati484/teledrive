import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTeleFile } from "../backup/__tests__/helpers";
import { useFileStore } from "../../stores/fileStore";
import { useBackupProgressStore } from "../../stores/backupProgressStore";

const h = vi.hoisted(() => ({
  revision: false,
  outcome: { status: "ready" as const, files: [] as any[], savedAt: 0 },
  incremental: { files: [] as any[], highestMsgId: 0 },
  revisionCalls: 0,
  incrementalCalls: 0,
  outcomeOptions: [] as any[],
}));

vi.mock("../storage/metadataStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/metadataStore")>();
  return {
    ...actual,
    hasIndexRevisionChanged: async () => {
      h.revisionCalls++;
      return h.revision;
    },
    loadIndexOutcome: async (_channelId: string, options?: any) => {
      h.outcomeOptions.push(options);
      return h.outcome;
    },
    loadIndexIncremental: async () => {
      h.incrementalCalls++;
      return h.incremental;
    },
  };
});

const { runSyncTickOnce, startRemoteSync, stopRemoteSync } = await import(
  "../sync/remoteSync"
);

const CHANNEL = "chan_tick";

beforeEach(() => {
  stopRemoteSync();
  h.revision = false;
  h.outcome = { status: "ready", files: [], savedAt: 0 };
  h.incremental = { files: [], highestMsgId: 0 };
  h.revisionCalls = 0;
  h.incrementalCalls = 0;
  h.outcomeOptions = [];
  useBackupProgressStore.setState({ active: false, status: "idle" });
  useFileStore.setState({
    files: [],
    indexLoadState: "ready",
    indexLoadError: null,
    bootstrapComplete: true,
    indexQueueState: "idle",
    lastIndexMsgId: 5,
  });
});

describe("remote sync tick", () => {
  it("starts a polling loop for an empty drive with no cursor", async () => {
    vi.useFakeTimers();
    try {
      useFileStore.setState({ lastIndexMsgId: 0 });
      startRemoteSync(CHANNEL);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(h.revisionCalls).toBe(1);
    } finally {
      stopRemoteSync();
      vi.useRealTimers();
    }
  });

  it("polls an empty ready index instead of waiting for a cursor", async () => {
    useFileStore.setState({ lastIndexMsgId: 0 });

    await expect(runSyncTickOnce(CHANNEL)).resolves.toBe(false);

    expect(h.revisionCalls).toBe(1);
    expect(h.incrementalCalls).toBe(1);
  });

  it("reloads the authoritative snapshot when an index chunk changed", async () => {
    const remote = makeTeleFile("remote", {
      messageId: 70,
      channelId: CHANNEL,
      folderPath: "/Docs",
    });
    h.revision = true;
    h.outcome = { status: "ready", files: [remote], savedAt: 1 };

    await expect(runSyncTickOnce(CHANNEL)).resolves.toBe(true);

    expect(useFileStore.getState().files.map((f) => f.id)).toContain("remote");
    expect(h.incrementalCalls).toBe(0);
    expect(h.outcomeOptions[0]).toEqual({ preserveReadyOnIncomplete: true });
  });

  it("replaces (not merges) when a new index epoch appears", async () => {
    const stale = makeTeleFile("stale", {
      messageId: 60,
      channelId: CHANNEL,
      folderPath: "/Docs",
    });
    const fresh = makeTeleFile("fresh", {
      messageId: 70,
      channelId: CHANNEL,
      folderPath: "/Docs",
    });
    useFileStore.setState({ files: [stale] });
    h.incremental = { files: [fresh], highestMsgId: 70 };
    h.outcome = { status: "ready", files: [fresh], savedAt: 2 };

    await expect(runSyncTickOnce(CHANNEL)).resolves.toBe(true);

    const ids = useFileStore.getState().files.map((f) => f.id);
    expect(ids).toContain("fresh");
    expect(ids).not.toContain("stale");
    expect(useFileStore.getState().lastIndexMsgId).toBe(70);
  });

  it("never overwrites local state while a backup run is active", async () => {
    useBackupProgressStore.setState({ active: true, status: "uploading" });
    h.revision = true;
    h.outcome = {
      status: "ready",
      files: [makeTeleFile("remote", { messageId: 70, channelId: CHANNEL })],
      savedAt: 3,
    };

    await expect(runSyncTickOnce(CHANNEL)).resolves.toBe(false);
    expect(useFileStore.getState().files).toEqual([]);
  });

  it("never overwrites local state while an upload is active", async () => {
    useFileStore.setState({
      uploadQueue: [
        {
          id: "u1",
          name: "pending.txt",
          size: 1,
          progress: 0,
          status: "pending",
        },
      ],
    });
    h.revision = true;
    h.outcome = {
      status: "ready",
      files: [makeTeleFile("remote", { messageId: 70, channelId: CHANNEL })],
      savedAt: 3,
    };

    await expect(runSyncTickOnce(CHANNEL)).resolves.toBe(false);
    expect(useFileStore.getState().files).toEqual([]);
  });

  it("never overwrites local state while a save is pending", async () => {
    const local = makeTeleFile("local", {
      messageId: 60,
      channelId: CHANNEL,
      folderPath: "/Docs",
    });
    useFileStore.setState({ files: [local], indexQueueState: "saving" });
    h.revision = true;
    h.outcome = {
      status: "ready",
      files: [makeTeleFile("remote", { messageId: 70, channelId: CHANNEL })],
      savedAt: 3,
    };

    await expect(runSyncTickOnce(CHANNEL)).resolves.toBe(false);
    expect(useFileStore.getState().files.map((f) => f.id)).toEqual(["local"]);
  });
});
