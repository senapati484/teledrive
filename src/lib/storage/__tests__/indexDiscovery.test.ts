import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TeleFile } from "../../types";
import { useFileStore } from "../../../stores/fileStore";

const { fakeHolder } = vi.hoisted(() => ({
  fakeHolder: { client: null as any },
}));

vi.mock("../../telegram/client", () => ({
  getClient: () => fakeHolder.client,
}));

import {
  discoverIndex,
  findMostRecentCoherentEpoch,
  loadIndexOutcome,
  parseIndexMessages,
} from "../metadataStore";

function file(i: number, folderPath = "/"): TeleFile {
  return {
    id: `file_${i}`,
    name: `file-${i}.txt`,
    size: i,
    mime: "text/plain",
    folderPath,
    messageId: 1000 + i,
    channelId: "chan",
    uploadedAt: 1700000000000 + i,
    starred: false,
    trashed: false,
    archived: false,
  };
}

function indexMessage(
  id: number,
  chunkIndex: number,
  totalChunks: number,
  files: TeleFile[],
  extra: Record<string, unknown> = {},
  date = 1700000000
) {
  return {
    id,
    text: JSON.stringify({
      teledrive_index: true,
      version: 2,
      chunkIndex,
      totalChunks,
      ...extra,
      files,
    }),
    date,
  };
}

interface FakeOptions {
  pinned?: any[];
  recent?: any[];
  search?: any[][];
  history?: any[][];
  byId?: Map<number, any>;
  reject?: "pinned" | "recent" | "both";
}

function installFake(options: FakeOptions) {
  const calls: any[] = [];
  const searchPages = [...(options.search ?? [])];
  const historyPages = [...(options.history ?? [])];

  fakeHolder.client = {
    getInputEntity: vi.fn(async () => "peer"),
    getMessages: vi.fn(async (_peer: any, params: any) => {
      calls.push(params);
      if (params?.filter) {
        if (options.reject === "pinned" || options.reject === "both") {
          throw new Error("pinned failed");
        }
        return options.pinned ?? [];
      }
      if (params?.ids) {
        return params.ids
          .map((id: number) => options.byId?.get(id))
          .filter(Boolean);
      }
      if (params?.search) {
        return searchPages.shift() ?? [];
      }
      if (params?.offsetId != null) {
        return historyPages.shift() ?? [];
      }
      if (options.reject === "recent" || options.reject === "both") {
        throw new Error("recent failed");
      }
      return options.recent ?? [];
    }),
  };
  return calls;
}

beforeEach(() => {
  useFileStore.getState().setFiles([]);
  useFileStore.getState().setLastIndexMsgId(0);
  useFileStore.getState().setIndexLoadState("loading");
});

describe("discoverIndex", () => {
  it("loads a v2 manifest and its named chunks", async () => {
    const c0 = indexMessage(500, 0, 2, [file(1)], {
      savedAt: 1700000000000,
      chunkMsgIds: [600],
    });
    const c1 = indexMessage(600, 1, 2, [file(2)], {
      savedAt: 1700000000100,
    });
    const calls = installFake({
      pinned: [c0],
      recent: [c0],
      byId: new Map([[600, c1]]),
    });

    const result = await discoverIndex("chan");

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.format).toBe(2);
    expect(result.ids).toEqual([500, 600]);
    expect(result.savedAt).toBe(1700000000100);
    expect(result.files.map((f) => f.id).sort()).toEqual(["file_1", "file_2"]);
    expect(result.texts).toHaveLength(2);
    expect(calls.some((c) => Array.isArray(c.ids))).toBe(true);
  });

  it("returns partial_manifest when a named chunk stays missing", async () => {
    const c0 = indexMessage(500, 0, 3, [file(1)], {
      savedAt: 1700000000000,
      chunkMsgIds: [600, 700],
    });
    const c1 = indexMessage(600, 1, 3, [file(2)], {
      savedAt: 1700000000000,
    });
    installFake({ recent: [c0, c1], byId: new Map([[600, c1]]) });

    const result = await discoverIndex("chan");

    expect(result).toEqual({ status: "incomplete", reason: "partial_manifest" });
  });

  it("loads a legacy coherent epoch and uses edit dates", async () => {
    const c0 = indexMessage(100, 0, 2, [file(1)], { version: 1 }, 1700000000);
    const c1 = indexMessage(101, 1, 2, [file(2)], { version: 1 }, 1700000100);
    installFake({ recent: [c0, c1] });

    const result = await discoverIndex("chan");

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.format).toBe(1);
    expect(result.ids).toEqual([100, 101]);
    expect(result.savedAt).toBe(1700000100000);
  });

  it("finds an epoch through server-side search when it is outside the recent window", async () => {
    const c0 = indexMessage(500, 0, 2, [file(1)], {
      savedAt: 1700000000000,
      chunkMsgIds: [600],
    });
    const c1 = indexMessage(600, 1, 2, [file(2)], {
      savedAt: 1700000000000,
    });
    const calls = installFake({
      recent: [{ id: 900, text: "not an index", date: 1700000005 }],
      search: [[c0, c1]],
    });

    const result = await discoverIndex("chan");

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.ids).toEqual([500, 600]);
    expect(calls.some((c) => c.search === "teledrive_index")).toBe(true);
  });

  it("falls back to paginated history when search returns nothing", async () => {
    const c0 = indexMessage(500, 0, 2, [file(1)], {
      savedAt: 1700000000000,
      chunkMsgIds: [600],
    });
    const c1 = indexMessage(600, 1, 2, [file(2)], {
      savedAt: 1700000000000,
    });
    const calls = installFake({
      recent: [{ id: 900, text: "not an index", date: 1700000005 }],
      history: [[c0, c1]],
    });

    const result = await discoverIndex("chan");

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.ids).toEqual([500, 600]);
    expect(calls.some((c) => c.offsetId === 900)).toBe(true);
  });

  it("returns not_found for a non-empty channel with no index", async () => {
    installFake({
      recent: [{ id: 900, text: "not an index", date: 1700000005 }],
    });

    const result = await discoverIndex("chan");

    expect(result).toEqual({ status: "incomplete", reason: "not_found" });
  });

  it("treats a truly empty channel as a new drive", async () => {
    installFake({ pinned: [], recent: [] });

    const result = await discoverIndex("chan");

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.files).toEqual([]);
    expect(result.ids).toEqual([]);
    expect(result.savedAt).toBe(0);
  });

  it("reports a network failure when both initial reads fail", async () => {
    installFake({ reject: "both" });

    const result = await discoverIndex("chan");

    expect(result).toEqual({ status: "incomplete", reason: "network" });
  });

  it("prefers a newer legacy epoch over an older manifest", async () => {
    const manifest0 = indexMessage(500, 0, 2, [file(1)], {
      savedAt: 1700000000000,
      chunkMsgIds: [600],
    });
    const manifest1 = indexMessage(600, 1, 2, [file(2)], {
      savedAt: 1700000000000,
    });
    const legacy0 = indexMessage(100, 0, 2, [file(3)], { version: 1 }, 1700000100);
    const legacy1 = indexMessage(101, 1, 2, [file(4)], { version: 1 }, 1700000100);
    installFake({
      recent: [manifest0, legacy0, legacy1],
      byId: new Map([[600, manifest1]]),
    });

    const result = await discoverIndex("chan");

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.format).toBe(1);
    expect(result.ids).toEqual([100, 101]);
    expect(result.files.map((f) => f.id).sort()).toEqual(["file_3", "file_4"]);
  });
});

describe("loadIndexOutcome", () => {
  it("marks the store ready and seeds the cursor on success", async () => {
    installFake({
      recent: [indexMessage(100, 0, 1, [file(1)], { version: 1 })],
    });

    const outcome = await loadIndexOutcome("chan");

    expect(outcome.status).toBe("ready");
    expect(outcome.files).toHaveLength(1);
    const state = useFileStore.getState();
    expect(state.indexLoadState).toBe("ready");
    expect(state.indexLoadError).toBeNull();
    expect(state.lastIndexMsgId).toBe(100);
  });

  it("keeps cached files and marks incomplete without writing", async () => {
    useFileStore.getState().setFiles([file(9)]);
    installFake({
      recent: [{ id: 900, text: "not an index", date: 1700000005 }],
    });

    const outcome = await loadIndexOutcome("chan");

    expect(outcome.status).toBe("incomplete");
    if (outcome.status !== "incomplete") return;
    expect(outcome.reason).toBe("not_found");
    expect(outcome.files.map((f) => f.id)).toEqual(["file_9"]);
    const state = useFileStore.getState();
    expect(state.indexLoadState).toBe("incomplete");
    expect(state.indexLoadError).toBe("not_found");
    expect(state.files.map((f) => f.id)).toEqual(["file_9"]);
  });
});

describe("coherent epoch selection", () => {
  it("rejects an epoch with a duplicated chunk index", () => {
    const parsed = parseIndexMessages([
      indexMessage(1, 0, 3, [file(1)], { version: 1 }),
      indexMessage(2, 1, 3, [file(2)], { version: 1 }),
      indexMessage(3, 1, 3, [file(3)], { version: 1 }),
      indexMessage(4, 2, 3, [file(4)], { version: 1 }),
    ]);
    expect(findMostRecentCoherentEpoch(parsed)).toBeNull();
  });
});
