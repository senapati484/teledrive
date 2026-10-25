import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useFileStore } from "../../../stores/fileStore";
import type { TeleFile } from "../../types";
import {
  serializeChunk,
  packChunks,
  parseIndexMessage,
  epochTimestamp,
} from "../indexFormat";
import {
  enqueueSave,
  getIndexQueue,
  resetQueuesForTests,
} from "../indexQueue";
import { discoverIndex } from "../metadataStore";

const h = vi.hoisted(() => ({
  client: null as any,
  discovery: null as any,
  forceOmit: false,
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
        ms
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    }),
  discoverIndex: vi.fn(async () => h.discovery ?? { status: "incomplete", reason: "not_found" }),
}));

vi.mock("../indexFormat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../indexFormat")>();
  return {
    ...actual,
    packChunks: (files: TeleFile[]) => {
      const result = actual.packChunks(files);
      return h.forceOmit ? { ...result, manifestOmitted: true } : result;
    },
  };
});

const CHANNEL = "chan_commit_test";
let fileCounter = 0;

class FakeClient {
  messages = new Map<number, string>();
  calls: Array<{ op: string; id?: number; text?: string; ids?: number[] }> = [];
  nextId = 10_000;
  sendCount = 0;
  failSend: ((n: number) => Error | null) | null = null;
  failEdit: ((id: number, text: string) => Error | null) | null = null;
  failDelete = false;

  async getInputEntity() {
    return { channelId: 1 };
  }

  async sendMessage(_peer: any, { message }: { message: string }) {
    this.sendCount++;
    this.calls.push({ op: "send", text: message });
    const err = this.failSend?.(this.sendCount);
    if (err) throw err;
    const id = this.nextId++;
    this.messages.set(id, message);
    return { id };
  }

  async editMessage(_peer: any, { message, text }: { message: number; text: string }) {
    this.calls.push({ op: "edit", id: message, text });
    const err = this.failEdit?.(message, text);
    if (err) throw err;
    this.messages.set(message, text);
    return {};
  }

  async deleteMessages(_peer: any, ids: number[]) {
    this.calls.push({ op: "delete", ids: [...ids] });
    if (this.failDelete) throw new Error("delete failed");
    for (const id of ids) this.messages.delete(id);
    return [];
  }

  invoke() {
    this.calls.push({ op: "pin" });
    return Promise.resolve();
  }
}

let fake: FakeClient;

function makeFiles(count: number, long = true): TeleFile[] {
  return Array.from({ length: count }, () => {
    const n = ++fileCounter;
    return {
      id: `file_${n}`,
      name: long ? `track_${n}_${"x".repeat(180)}.mp4` : `track_${n}.mp4`,
      size: 1024,
      mime: "video/mp4",
      folderPath: long ? `/${"p".repeat(50)}` : "/",
      messageId: 1,
      channelId: CHANNEL,
      uploadedAt: 1,
      starred: false,
      trashed: false,
    };
  });
}

function v2Text(
  files: TeleFile[],
  chunkIndex: number,
  totalChunks: number,
  savedAt: number,
  ids?: number[]
): string {
  return serializeChunk({
    teledrive_index: true,
    version: 2,
    chunkIndex,
    totalChunks,
    savedAt,
    ...(ids ? { chunkMsgIds: ids } : {}),
    files,
  });
}

function seed(files: TeleFile[], savedAt = 1000) {
  const { chunks } = packChunks(files);
  const ids = chunks.map((_, i) => 500 + i);
  const texts = chunks.map((c, i) =>
    v2Text(c, i, chunks.length, savedAt, i === 0 ? ids.slice(1) : undefined)
  );
  const parsed = texts.map((text, i) =>
    parseIndexMessage({ id: ids[i], text })!
  );
  const queue = getIndexQueue(CHANNEL);
  queue.setKnownIndex(ids, texts, parsed);
  ids.forEach((id, i) => fake.messages.set(id, texts[i]));
  return { chunks, ids, texts, parsed };
}

function seedLegacy(files: TeleFile[]) {
  const { chunks } = packChunks(files);
  const ids = chunks.map((_, i) => 700 + i);
  const texts = chunks.map((c, i) =>
    JSON.stringify({
      teledrive_index: true,
      version: 1,
      chunkIndex: i,
      totalChunks: chunks.length,
      files: c,
    })
  );
  getIndexQueue(CHANNEL).setKnownIndex(ids, texts);
  ids.forEach((id, i) => fake.messages.set(id, texts[i]));
  return { chunks, ids, texts };
}

function edits() {
  return fake.calls.filter((c) => c.op === "edit");
}

beforeEach(() => {
  resetQueuesForTests();
  fake = new FakeClient();
  h.client = fake;
  h.discovery = null;
  h.forceOmit = false;
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
  vi.useRealTimers();
  vi.clearAllTimers();
  resetQueuesForTests();
});

describe("atomic index writer", () => {
  it("fast path edits exactly one changed non-zero chunk in place", async () => {
    const files = makeFiles(500);
    const { chunks, ids, texts, parsed } = seed(files);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].length).toBeLessThan(files.length);

    const next = files.map((f) => ({ ...f }));
    next[chunks[0].length].starred = true;
    fake.calls = [];

    await enqueueSave(CHANNEL, next);

    const editCalls = edits();
    expect(editCalls).toHaveLength(1);
    expect(editCalls[0].id).toBe(ids[1]);
    expect(fake.calls.some((c) => c.op === "send")).toBe(false);
    expect(fake.calls.some((c) => c.op === "delete")).toBe(false);
    expect(fake.messages.get(ids[0])).toBe(texts[0]);

    const edited = parseIndexMessage({
      id: ids[1],
      text: editCalls[0].text!,
    })!;
    expect(edited.savedAt).toBeGreaterThan(1000);
    expect(epochTimestamp([parsed[0], edited])).toBeGreaterThan(1000);
  });

  it("fast path on chunk 0 keeps the manifest unchanged", async () => {
    const files = makeFiles(500);
    const { chunks, ids } = seed(files);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const before = parseIndexMessage({ id: ids[0], text: fake.messages.get(ids[0])! })!;

    const next = files.map((f) => ({ ...f }));
    next[0].starred = true;
    fake.calls = [];

    await enqueueSave(CHANNEL, next);

    expect(edits()).toHaveLength(1);
    expect(edits()[0].id).toBe(ids[0]);
    const after = parseIndexMessage({ id: ids[0], text: edits()[0].text! })!;
    expect(after.chunkMsgIds).toEqual(before.chunkMsgIds);
    expect(after.savedAt).toBeGreaterThan(before.savedAt!);
  });

  it("structural grow sends changed chunks, commits chunk 0 last, then deletes old ids", async () => {
    const files = makeFiles(500);
    const { ids } = seed(files);
    const bigger = makeFiles(1000);
    fake.calls = [];

    await enqueueSave(CHANNEL, bigger);

    const editIndex = fake.calls.findIndex((c) => c.op === "edit");
    const sendIndices = fake.calls
      .map((c, i) => (c.op === "send" ? i : -1))
      .filter((i) => i >= 0);
    const deleteIndex = fake.calls.findIndex((c) => c.op === "delete");
    expect(sendIndices.length).toBeGreaterThan(0);
    expect(Math.max(...sendIndices)).toBeLessThan(editIndex);
    expect(deleteIndex).toBeGreaterThan(editIndex);

    const zero = parseIndexMessage({ id: ids[0], text: fake.messages.get(ids[0])! })!;
    expect(zero.version).toBe(3);
    expect(zero.chunkMsgIds).toHaveLength(zero.totalChunks - 1);
    expect(fake.calls.find((c) => c.op === "delete")!.ids).toEqual(ids.slice(1));
  });

  it("structural with several changed chunks reuses the unchanged chunk", async () => {
    const files = makeFiles(500);
    const { chunks, ids } = seed(files);
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    const next = files.map((f) => ({ ...f }));
    next[0].starred = true;
    next[chunks[0].length].starred = true;
    fake.calls = [];

    await enqueueSave(CHANNEL, next);

    const sends = fake.calls.filter((c) => c.op === "send");
    expect(sends).toHaveLength(1);
    const newId = parseIndexMessage({ id: ids[0], text: fake.messages.get(ids[0])! })!;
    expect(newId.chunkMsgIds).toHaveLength(chunks.length - 1);
    expect(newId.chunkMsgIds![0]).not.toBe(ids[1]);
    expect(newId.chunkMsgIds!.slice(1)).toEqual(ids.slice(2));
    expect(fake.calls.find((c) => c.op === "delete")!.ids).toEqual([ids[1]]);
  });

  it("shrink commits chunk 0 and deletes extras only after", async () => {
    const files = makeFiles(1000);
    const { ids, chunks } = seed(files);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const smaller = files.slice(0, 5);
    fake.calls = [];

    await enqueueSave(CHANNEL, smaller);

    expect(fake.calls.some((c) => c.op === "send")).toBe(false);
    const editIndex = fake.calls.findIndex((c) => c.op === "edit");
    const deleteIndex = fake.calls.findIndex((c) => c.op === "delete");
    expect(editIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeGreaterThan(editIndex);
    const zero = parseIndexMessage({ id: ids[0], text: fake.messages.get(ids[0])! })!;
    expect(zero.totalChunks).toBe(1);
    expect(zero.chunkMsgIds).toEqual([]);
    expect(fake.calls.find((c) => c.op === "delete")!.ids).toEqual(ids.slice(1));
  });

  it("failure while sending a new chunk never edits chunk 0 and leaves the old set intact", async () => {
    const files = makeFiles(500);
    const { ids, texts } = seed(files);
    fake.failSend = () => new Error("MSG_ID_INVALID");
    fake.calls = [];

    await expect(enqueueSave(CHANNEL, makeFiles(1000))).rejects.toThrow();
    expect(edits()).toHaveLength(0);
    ids.forEach((id, i) => expect(fake.messages.get(id)).toBe(texts[i]));
  });

  it("failure on the chunk 0 edit keeps the old set and retries successfully", async () => {
    const files = makeFiles(500);
    const { ids, texts, parsed } = seed(files);
    h.discovery = {
      status: "ready",
      files,
      ids,
      texts,
      savedAt: 1000,
      format: 2,
      chunks: parsed,
    };
    let failed = false;
    fake.failEdit = (id) => {
      if (id === ids[0] && !failed) {
        failed = true;
        return new Error("MSG_ID_INVALID");
      }
      return null;
    };
    fake.calls = [];

    await enqueueSave(CHANNEL, makeFiles(1000));

    expect(vi.mocked(discoverIndex)).toHaveBeenCalledTimes(1);
    expect(fake.calls.some((c) => c.op === "pin")).toBe(false);
    const zero = parseIndexMessage({ id: ids[0], text: fake.messages.get(ids[0])! })!;
    expect(zero.chunkMsgIds).toHaveLength(zero.totalChunks - 1);
    expect(fake.messages.get(ids[0])).not.toBe(texts[0]);
  });

  it("a crash after the chunk 0 edit but before deletes still leaves the new set loadable", async () => {
    const files = makeFiles(1000);
    const { ids } = seed(files);
    fake.failDelete = true;
    fake.calls = [];

    await enqueueSave(CHANNEL, makeFiles(500));

    const zero = parseIndexMessage({ id: ids[0], text: fake.messages.get(ids[0])! })!;
    expect(zero.chunkMsgIds).toHaveLength(zero.totalChunks - 1);
    expect(fake.calls.some((c) => c.op === "delete")).toBe(true);
  });

  it("legacy cache upgrade adds the manifest after the content edit", async () => {
    const files = makeFiles(500);
    const { ids, chunks } = seedLegacy(files);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const next = files.map((f) => ({ ...f }));
    next[chunks[0].length].starred = true;
    fake.calls = [];

    await enqueueSave(CHANNEL, next);

    const editCalls = edits();
    expect(editCalls).toHaveLength(2);
    expect(editCalls[0].id).toBe(ids[1]);
    expect(editCalls[1].id).toBe(ids[0]);
    const zero = parseIndexMessage({ id: ids[0], text: editCalls[1].text! })!;
    expect(zero.version).toBe(3);
    expect(zero.chunkMsgIds).toEqual(ids.slice(1));
    expect(zero.savedAt).toBeGreaterThan(0);
  });

  it("above the manifest bound uses full copy-on-write and repins", async () => {
    const files = makeFiles(500);
    const { ids } = seed(files);
    h.forceOmit = true;
    const next = files.map((f) => ({ ...f }));
    next[0].starred = true;
    fake.calls = [];

    await enqueueSave(CHANNEL, next);

    expect(edits()).toHaveLength(0);
    const sends = fake.calls.filter((c) => c.op === "send");
    expect(sends.length).toBeGreaterThanOrEqual(2);
    const pinIndex = fake.calls.findIndex((c) => c.op === "pin");
    const deleteIndex = fake.calls.findIndex((c) => c.op === "delete");
    expect(pinIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeGreaterThan(pinIndex - 1);
    expect(fake.calls.find((c) => c.op === "delete")!.ids!.sort()).toEqual(
      [...ids].sort()
    );
    const newChunk0 = [...fake.messages.entries()].find(([id, text]) => {
      if (id <= 10_000) return false;
      return parseIndexMessage({ id, text })?.chunkIndex === 0;
    })!;
    const zero = parseIndexMessage({ id: newChunk0[0], text: newChunk0[1] })!;
    expect(zero.chunkMsgIds).toBeUndefined();
  });

  it("a timeout retries the same message edit, not a delete/resend", async () => {
    const files = makeFiles(500);
    const { chunks, ids } = seed(files);
    let timedOut = false;
    fake.failEdit = (id) => {
      if (id === ids[1] && !timedOut) {
        timedOut = true;
        return new Error("Timeout of 5000ms exceeded for editMessage(fast)");
      }
      return null;
    };
    const next = files.map((f) => ({ ...f }));
    next[chunks[0].length].starred = true;
    fake.calls = [];

    await enqueueSave(CHANNEL, next);

    const editCalls = edits();
    expect(editCalls).toHaveLength(2);
    expect(editCalls.every((c) => c.id === ids[1])).toBe(true);
    expect(fake.calls.some((c) => c.op === "send")).toBe(false);
    expect(fake.calls.some((c) => c.op === "delete")).toBe(false);
  });

  it("MSG_ID_INVALID triggers exactly one rediscovery, then a full COW", async () => {
    const files = makeFiles(500);
    const { chunks, ids } = seed(files);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    fake.failEdit = () => new Error("MSG_ID_INVALID");
    h.discovery = null;
    vi.mocked(discoverIndex).mockClear();
    const next = files.map((f) => ({ ...f }));
    next[0].starred = true;
    next[chunks[0].length].starred = true;
    fake.calls = [];

    await enqueueSave(CHANNEL, next);

    expect(vi.mocked(discoverIndex)).toHaveBeenCalledTimes(1);
    const sends = fake.calls.filter((c) => c.op === "send");
    // First attempt sends the changed non-zero chunk(s); the COW recovery
    // then sends every chunk, including chunk 0.
    expect(sends.length).toBe(1 + chunks.length);
    expect(fake.calls.some((c) => c.op === "pin")).toBe(true);
    expect(fake.calls.find((c) => c.op === "delete")!.ids!.sort()).toEqual(
      [...ids].sort()
    );
  });
});
