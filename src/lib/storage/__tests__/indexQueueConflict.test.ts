import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useFileStore } from "../../../stores/fileStore";
import type { TeleFile } from "../../types";
import {
  packChunks,
  parseIndexMessage,
  serializeChunk,
  type ParsedIndexChunk,
} from "../indexFormat";
import {
  DEFAULT_METADATA_EDIT_INTERVAL_MS,
  enqueueSave,
  ensureFreshIndexForWrite,
  getIndexBackoffMs,
  getIndexQueue,
  IndexConflictError,
  resetQueuesForTests,
  setCommitImplForTests,
} from "../indexQueue";
import { discoverIndex } from "../metadataStore";
import { readPendingMarker } from "../pendingIndex";

const h = vi.hoisted(() => ({
  client: null as any,
  discovery: null as any,
}));

vi.mock("../../telegram/client", () => ({
  getClient: () => h.client,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

vi.mock("../metadataStore", () => ({
  withTimeout: <T,>(promise: Promise<T>, ms: number, label: string) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout of ${ms}ms exceeded for ${label}`)),
        ms,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    }),
  discoverIndex: vi.fn(
    async () => h.discovery ?? { status: "incomplete", reason: "not_found" },
  ),
}));

const CHANNEL = "chan_conflict_test";

class FakeClient {
  messages = new Map<number, string>();
  calls: Array<{ op: "edit" | "send"; id?: number; text?: string }> = [];
  nextId = 20_000;
  afterEdit: ((id: number) => void) | null = null;
  getMessagesImpl: ((ids: number[]) => Array<{ id: number; text: string }>) | null =
    null;

  async getInputEntity() {
    return { channelId: 1 };
  }

  async getMessages(_peer: any, { ids }: { ids: number[] }) {
    if (this.getMessagesImpl) return this.getMessagesImpl(ids);
    return ids
      .filter((id) => this.messages.has(id))
      .map((id) => ({ id, text: this.messages.get(id) }));
  }

  async editMessage(_peer: any, { message, text }: { message: number; text: string }) {
    this.calls.push({ op: "edit", id: message, text });
    this.messages.set(message, text);
    this.afterEdit?.(message);
    return {};
  }

  async sendMessage(_peer: any, { message }: { message: string }) {
    const id = this.nextId++;
    this.calls.push({ op: "send", id, text: message });
    this.messages.set(id, message);
    this.afterEdit?.(id);
    return { id };
  }

  async deleteMessages(_peer: any, _ids: number[]) {
    return [];
  }

  invoke() {
    return Promise.resolve();
  }
}

let fake: FakeClient;
let fileCounter = 0;

function makeFile(label: string): TeleFile {
  return {
    id: `file_${label}_${++fileCounter}`,
    name: `${label}.txt`,
    size: 10,
    mime: "text/plain",
    folderPath: "/",
    messageId: fileCounter,
    channelId: CHANNEL,
    uploadedAt: 1,
    starred: false,
    trashed: false,
  };
}

function chunkText(
  files: TeleFile[],
  chunkIndex: number,
  totalChunks: number,
  savedAt: number,
  ids?: number[],
): string {
  return serializeChunk({
    teledrive_index: true,
    version: 3,
    chunkIndex,
    totalChunks,
    savedAt,
    ...(chunkIndex === 0 && ids ? { chunkMsgIds: ids.slice(1) } : {}),
    files,
  });
}

function seed(files: TeleFile[], savedAt = 1000) {
  const { chunks } = packChunks(files);
  const ids = chunks.map((_, index) => 500 + index);
  const texts = chunks.map((chunk, index) =>
    chunkText(chunk, index, chunks.length, savedAt, index === 0 ? ids : undefined),
  );
  const parsed = texts.map(
    (text, index) => parseIndexMessage({ id: ids[index], text })!,
  );
  getIndexQueue(CHANNEL).setKnownIndex(ids, texts, parsed);
  ids.forEach((id, index) => fake.messages.set(id, texts[index]));
  return { ids, texts, parsed, chunks };
}

function ready(
  files: TeleFile[],
  ids: number[],
  texts: string[],
  savedAt = 2000,
): {
  status: "ready";
  files: TeleFile[];
  ids: number[];
  texts: string[];
  savedAt: number;
  format: 2;
  chunks: ParsedIndexChunk[];
} {
  const chunks = texts.map(
    (text, index) => parseIndexMessage({ id: ids[index], text })!,
  );
  return {
    status: "ready",
    files,
    ids,
    texts,
    savedAt,
    format: 2,
    chunks,
  };
}

function idSet(text: string | undefined): Set<string> {
  const parsed = text
    ? parseIndexMessage({ id: 1, text })
    : null;
  return new Set((parsed?.files ?? []).map((file) => file.id));
}

beforeEach(() => {
  resetQueuesForTests();
  fake = new FakeClient();
  h.client = fake;
  h.discovery = null;
  useFileStore.setState({
    files: [],
    indexLoadState: "ready",
    indexLoadError: null,
    indexQueueState: "idle",
    indexQueueError: null,
    indexQueueRetryInSec: 0,
    bootstrapComplete: true,
    isSyncing: false,
    uploadQueue: [],
  });
  vi.mocked(discoverIndex).mockClear();
});

afterEach(() => {
  vi.clearAllTimers();
  resetQueuesForTests();
});

describe("commit-time index revision guard", () => {
  it("re-applies B's mutation after A committed, keeping both entries", async () => {
    const shared = [makeFile("shared")];
    const { ids } = seed(shared);
    useFileStore.setState({ files: shared });

    const deviceA = [...shared, makeFile("from-a")];
    const aText = chunkText(deviceA, 0, 1, 2000);
    fake.messages.set(ids[0], aText);
    h.discovery = ready(deviceA, ids, [aText]);

    const deviceB = [...shared, makeFile("from-b")];
    await enqueueSave(CHANNEL, deviceB);

    const committed = idSet(fake.messages.get(ids[0]));
    expect(committed).toContain(deviceA[deviceA.length - 1].id);
    expect(committed).toContain(deviceB[deviceB.length - 1].id);
    expect(vi.mocked(discoverIndex)).toHaveBeenCalledTimes(1);

    const storeIds = new Set(useFileStore.getState().files.map((file) => file.id));
    expect(storeIds).toContain(deviceA[deviceA.length - 1].id);
    expect(storeIds).toContain(deviceB[deviceB.length - 1].id);
  });

  it("bounds retries and surfaces IndexConflictError when a race keeps landing", async () => {
    const shared = [makeFile("base")];
    const { ids } = seed(shared);
    useFileStore.setState({ files: shared });

    const deviceA = [...shared, makeFile("race-a")];
    const aText = chunkText(deviceA, 0, 1, 2000);
    // The first guard sees the base epoch; the remote write lands exactly
    // between that check and our edit, which the post-write check detects.
    h.discovery = ready(deviceA, ids, [aText]);
    // Every write is immediately replaced by the other device.
    fake.afterEdit = (id) => {
      if (id === ids[0]) fake.messages.set(id, aText);
    };

    const deviceB = [...shared, makeFile("race-b")];
    let caught: unknown = null;
    try {
      await enqueueSave(CHANNEL, deviceB);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(IndexConflictError);
    expect((caught as IndexConflictError).code).toBe("INDEX_CONFLICT");
    expect(fake.calls.filter((call) => call.op === "edit")).toHaveLength(2);
    // The remote epoch remains intact; our stale snapshot never wins silently.
    expect(fake.messages.get(ids[0])).toBe(aText);
    expect(useFileStore.getState().indexQueueState).toBe("failed");
    expect(useFileStore.getState().indexQueueError).toContain("Another device");
  });

  it("refreshes the catalog and known revision before a WebDAV write", async () => {
    const shared = [makeFile("base")];
    const { ids } = seed(shared);
    useFileStore.setState({ files: shared });

    const deviceA = [...shared, makeFile("pushed-by-a")];
    const aText = chunkText(deviceA, 0, 1, 2000);
    fake.messages.set(ids[0], aText);
    h.discovery = ready(deviceA, ids, [aText]);

    await expect(ensureFreshIndexForWrite(CHANNEL)).resolves.toBe("refreshed");
    expect(useFileStore.getState().files.map((file) => file.id)).toContain(
      deviceA[deviceA.length - 1].id,
    );
    // A second probe is current, so the PUT does not re-discover.
    await expect(ensureFreshIndexForWrite(CHANNEL)).resolves.toBe("current");
    expect(vi.mocked(discoverIndex)).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the revision check cannot read the channel", async () => {
    const shared = [makeFile("base")];
    const { ids } = seed(shared);
    useFileStore.setState({ files: shared });
    h.discovery = ready(shared, ids, [fake.messages.get(ids[0])!]);
    fake.getMessagesImpl = () => {
      throw new Error("Timeout of 5000ms exceeded for index revision");
    };

    const deviceB = [...shared, makeFile("unreadable")];
    let caught: unknown = null;
    try {
      await enqueueSave(CHANNEL, deviceB);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(IndexConflictError);
    expect((caught as IndexConflictError).transient).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });





  it("writes the pending marker before the background commit, surviving a restart", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    });
    useFileStore.setState({ files: [] });
    const pending = enqueueSave(
      CHANNEL,
      [makeFile("survives-restart")],
      { rateLimited: true }
    );
    pending.catch(() => {});
    expect(readPendingMarker(CHANNEL)).not.toBeNull();

    // Simulate a crash/restart: queue state is lost, the marker is not.
    resetQueuesForTests();
    expect(readPendingMarker(CHANNEL)).not.toBeNull();
    vi.unstubAllGlobals();
  });
  it("paces 15 rate-limited metadata saves over 10 s", async () => {
    vi.useFakeTimers();
    const shared = [makeFile("base")];
    seed(shared);
    useFileStore.setState({ files: shared });
    let commits = 0;
    let lastState: TeleFile[] = [];
    setCommitImplForTests(CHANNEL, async (state) => {
      commits++;
      lastState = state;
    });

    const added = Array.from({ length: 15 }, (_, index) => makeFile(`paced-${index}`));
    const promises: Array<Promise<void>> = [];
    for (let index = 0; index < added.length; index++) {
      promises.push(
        enqueueSave(
          CHANNEL,
          [...shared, ...added.slice(0, index + 1)],
          { rateLimited: true }
        )
      );
      await vi.advanceTimersByTimeAsync(500);
    }
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.all(promises);

    expect(commits).toBeLessThanOrEqual(3);
    expect(new Set(lastState.map((entry) => entry.id))).toEqual(
      new Set([shared[0].id, ...added.map((entry) => entry.id)])
    );
    expect(DEFAULT_METADATA_EDIT_INTERVAL_MS).toBe(5_000);
    vi.useRealTimers();
  });

  it("widens the metadata edit interval after a FLOOD_WAIT", async () => {
    vi.useFakeTimers();
    const shared = [makeFile("base")];
    seed(shared);
    useFileStore.setState({ files: shared });
    let attempts = 0;
    setCommitImplForTests(CHANNEL, async () => {
      attempts++;
      if (attempts === 1) {
        throw Object.assign(new Error("A wait of 20 seconds is required"), {
          seconds: 20,
        });
      }
    });

    const pending = enqueueSave(
      CHANNEL,
      [...shared, makeFile("adaptive")],
      { rateLimited: true }
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(getIndexQueue(CHANNEL).getMetadataEditIntervalMs()).toBeGreaterThanOrEqual(
      20_000
    );
    await vi.advanceTimersByTimeAsync(25_000);
    await pending;
    expect(attempts).toBe(2);
    vi.useRealTimers();
  });
  it("clears the WebDAV backoff after the Telegram flood deadline", async () => {
    vi.useFakeTimers();
    const shared = [makeFile("base")];
    seed(shared);
    useFileStore.setState({ files: shared });
    let attempts = 0;
    setCommitImplForTests(CHANNEL, async () => {
      attempts++;
      if (attempts === 1) {
        throw Object.assign(new Error("A wait of 5 seconds is required"), {
          seconds: 5,
        });
      }
    });

    const pending = enqueueSave(CHANNEL, [...shared, makeFile("after-flood")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(getIndexBackoffMs(CHANNEL)).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(6_000);
    await pending;
    expect(attempts).toBe(2);
    expect(getIndexBackoffMs(CHANNEL)).toBe(0);
    vi.useRealTimers();
  });
  it("coalesces a burst of metadata saves into few index edits", async () => {
    const shared = [makeFile("base")];
    const { ids } = seed(shared);
    useFileStore.setState({ files: shared });

    const added = Array.from({ length: 5 }, (_, index) => makeFile(`burst-${index}`));
    const states = added.map((_, index) => [...shared, ...added.slice(0, index + 1)]);

    // All WebDAV metadata responses now return after the local apply, so the
    // requests overlap one in-flight commit and coalesce in the queue.
    await Promise.all(states.map((state) => enqueueSave(CHANNEL, state)));

    const edits = fake.calls.filter((call) => call.op === "edit");
    expect(edits.length).toBeLessThanOrEqual(2);
    const committed = idSet(fake.messages.get(ids[0]));
    for (const entry of added) expect(committed).toContain(entry.id);
  });
  it("fails closed when discovery cannot verify the channel", async () => {
    resetQueuesForTests();
    h.discovery = { status: "incomplete", reason: "timeout" };
    const files = [makeFile("first")];
    useFileStore.setState({ files: [] });

    let caught: unknown = null;
    try {
      await enqueueSave(CHANNEL, files);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(IndexConflictError);
    expect((caught as IndexConflictError).transient).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });

  it("does not resurrect a target deleted by the other device", async () => {
    const target = makeFile("target");
    const shared = [target];
    const { ids } = seed(shared);
    useFileStore.setState({ files: shared });

    // Device A deleted the target; B only renamed it.
    const aText = chunkText([], 0, 1, 2000);
    fake.messages.set(ids[0], aText);
    h.discovery = ready([], ids, [aText]);

    const renamed = [{ ...target, name: "renamed.txt" }];
    let caught: unknown = null;
    try {
      await enqueueSave(CHANNEL, renamed);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(IndexConflictError);
    expect(fake.messages.get(ids[0])).toBe(aText);
    // The stale local entry is gone, so the next action cannot resurrect it.
    expect(useFileStore.getState().files).toHaveLength(0);
  });
});
