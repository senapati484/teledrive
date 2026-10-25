import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useFileStore } from "../../../stores/fileStore";
import {
  enqueueSave,
  retryQueue,
  resetQueuesForTests,
  setCommitImplForTests,
  flushAllQueues,
  IndexRetryExhaustedError,
  IndexNotReadyError,
} from "../indexQueue";
import { isCurrentOptimisticState } from "../../../hooks/useFileActions";
import type { TeleFile } from "../../types";

const CHANNEL = "chan_queue_test";

function makeFile(id: string): TeleFile {
  return {
    id,
    name: `${id}.mp4`,
    size: 1024,
    mime: "video/mp4",
    folderPath: "/",
    messageId: 1,
    channelId: CHANNEL,
    uploadedAt: 1,
    starred: false,
    trashed: false,
  };
}

const A = makeFile("a");
const B = makeFile("b");

function committedStates(calls: TeleFile[][]): string[][] {
  return calls.map((files) => files.map((f) => f.id));
}

beforeEach(() => {
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
  vi.clearAllTimers();
  vi.useRealTimers();
  resetQueuesForTests();
});

describe("IndexQueue integrity", () => {
  it("resolves a superseded retrying entry and commits the newer pending state", async () => {
    vi.useFakeTimers();
    const calls: TeleFile[][] = [];
    let failOnce = true;
    setCommitImplForTests(CHANNEL, async (state) => {
      calls.push(state);
      if (failOnce) {
        failOnce = false;
        throw new Error("network timeout");
      }
    });

    const a = enqueueSave(CHANNEL, [A]);
    // Let the first attempt fail and schedule its retry.
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);

    const b = enqueueSave(CHANNEL, [B]);
    // The retry timer fires and commits B; A was superseded when B arrived.
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(a).resolves.toBeUndefined();
    await expect(b).resolves.toBeUndefined();
    expect(committedStates(calls)).toEqual([["a"], ["b"]]);
  });

  it("rejects only the failing caller on a hard error and still commits a newer pending state", async () => {
    const calls: TeleFile[][] = [];
    let rejectFirst!: (err: any) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((r) => (markStarted = r));

    setCommitImplForTests(CHANNEL, async (state) => {
      calls.push(state);
      if (calls.length === 1) {
        markStarted();
        await new Promise<void>((_, reject) => {
          rejectFirst = reject;
        });
      }
    });

    const a = enqueueSave(CHANNEL, [A]);
    const aOutcome = a.catch((err) => err as Error);
    await started;

    const b = enqueueSave(CHANNEL, [B]);
    rejectFirst(new Error("CHANNEL_PRIVATE"));

    await expect(aOutcome).resolves.toBeInstanceOf(Error);
    await expect(aOutcome).resolves.toMatchObject({ message: "CHANNEL_PRIVATE" });
    await expect(b).resolves.toBeUndefined();
    expect(committedStates(calls)).toEqual([["a"], ["b"]]);
  });

  it("keeps the newest state in stuckEntry after retry exhaustion and commits it on manual retry", async () => {
    vi.useFakeTimers();
    const calls: TeleFile[][] = [];
    let fail = true;
    setCommitImplForTests(CHANNEL, async (state) => {
      calls.push(state);
      if (fail) throw new Error("network timeout");
    });

    const a = enqueueSave(CHANNEL, [A]);
    const aOutcome = a.catch((err) => err as Error);
    await vi.advanceTimersByTimeAsync(120_000);

    await expect(aOutcome).resolves.toBeInstanceOf(IndexRetryExhaustedError);
    expect(useFileStore.getState().indexQueueState).toBe("failed");
    expect(calls.length).toBeGreaterThanOrEqual(6);

    fail = false;
    const before = calls.length;
    retryQueue(CHANNEL);
    await vi.advanceTimersByTimeAsync(0);

    expect(calls.length).toBe(before + 1);
    expect(committedStates(calls)[calls.length - 1]).toEqual(["a"]);
    expect(useFileStore.getState().indexQueueState).toBe("idle");
  });

  it("flush commits the latest coalesced state", async () => {
    const calls: TeleFile[][] = [];
    setCommitImplForTests(CHANNEL, async (state) => {
      calls.push(state);
    });

    const a = enqueueSave(CHANNEL, [A]);
    const b = enqueueSave(CHANNEL, [B]);
    const results = await flushAllQueues();
    await expect(a).resolves.toBeUndefined();
    await expect(b).resolves.toBeUndefined();
    expect(results[0].status).toBe("committed");
    expect(committedStates(calls)[calls.length - 1]).toEqual(["b"]);
  });

  it("flush failure keeps the latest state for a later retry", async () => {
    vi.useFakeTimers();
    let fail = true;
    const calls: TeleFile[][] = [];
    setCommitImplForTests(CHANNEL, async (state) => {
      calls.push(state);
      if (fail) throw new Error("network timeout");
    });

    const a = enqueueSave(CHANNEL, [A]);
    const aOutcome = a.catch((err) => err as Error);
    const result = await flushWithFakeTimers();
    expect(result.status).toBe("failed");
    await expect(aOutcome).resolves.toBeInstanceOf(Error);

    fail = false;
    const before = calls.length;
    retryQueue(CHANNEL);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBe(before + 1);
    expect(committedStates(calls)[calls.length - 1]).toEqual(["a"]);
  });

  it("does not burn the transient counter for FLOOD_WAIT retries", async () => {
    vi.useFakeTimers();
    const calls: TeleFile[][] = [];
    let floods = 6;
    setCommitImplForTests(CHANNEL, async (state) => {
      calls.push(state);
      if (floods > 0) {
        floods--;
        throw new Error("FLOOD_WAIT_1");
      }
    });

    const a = enqueueSave(CHANNEL, [A]);
    for (let i = 0; i < 7; i++) {
      await vi.advanceTimersByTimeAsync(2_000);
    }
    await expect(a).resolves.toBeUndefined();
    expect(calls.length).toBe(7);
  });

  it("rejects enqueueSave with IndexNotReadyError while the index is not ready", async () => {
    useFileStore.getState().setIndexLoadState("incomplete", "partial_manifest");
    await expect(enqueueSave(CHANNEL, [A])).rejects.toBeInstanceOf(IndexNotReadyError);
  });

  it("only rolls back the action that still owns the current files reference", () => {
    const applied = [A];
    useFileStore.setState({ files: applied });
    expect(isCurrentOptimisticState(applied)).toBe(true);

    useFileStore.setState({ files: [B] });
    expect(isCurrentOptimisticState(applied)).toBe(false);
  });

  async function flushWithFakeTimers() {
    return (await flushAllQueues())[0];
  }
});
