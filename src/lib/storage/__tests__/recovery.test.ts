import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useFileStore } from "../../../stores/fileStore";
import type { TeleFile } from "../../types";
import {
  mergeIndexFromRecovery,
  scanIndexHistory,
  replaceIndexFromRecovery,
} from "../recovery";
import {
  resetQueuesForTests,
  setCommitImplForTests,
} from "../indexQueue";

const h = vi.hoisted(() => ({ client: null as any }));

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
  resolveChannelInputPeer: async () => ({ channelId: 1 }),
  reconstructMissingFolders: (files: TeleFile[]) => ({
    healedFiles: files,
    changed: false,
  }),
  discoverIndex: vi.fn(async () => ({
    status: "incomplete",
    reason: "not_found",
  })),
}));

const CHANNEL = "chan_recovery_test";

class FakeClient {
  messages: Array<any> = [];
  calls: any[] = [];

  async getMessages(_peer: any, opts: any) {
    this.calls.push(opts);
    if (opts.ids) {
      const ids = new Set<number>(opts.ids.map(Number));
      return this.messages.filter((m) => ids.has(m.id));
    }
    const offset = Number(opts.offsetId ?? 0);
    return [...this.messages]
      .filter((m) => !offset || m.id < offset)
      .sort((a, b) => b.id - a.id)
      .slice(0, opts.limit ?? 100);
  }
}

let fake: FakeClient;
let counter = 0;

function file(id: string, overrides: Partial<TeleFile> = {}): TeleFile {
  return {
    id,
    name: `${id}.mp4`,
    size: 1024,
    mime: "video/mp4",
    folderPath: "/",
    messageId: 100,
    channelId: CHANNEL,
    uploadedAt: 1,
    starred: false,
    trashed: false,
    ...overrides,
  };
}

function chunk(
  id: number,
  chunkIndex: number,
  totalChunks: number,
  files: TeleFile[],
  extra: { savedAt?: number; chunkMsgIds?: number[] } = {}
): { id: number; text: string; date?: number; editDate?: number } {
  return {
    id,
    text: JSON.stringify({
      teledrive_index: true,
      version: extra.savedAt ? 2 : 1,
      chunkIndex,
      totalChunks,
      ...(extra.savedAt ? { savedAt: extra.savedAt } : {}),
      ...(extra.chunkMsgIds ? { chunkMsgIds: extra.chunkMsgIds } : {}),
      files,
    }),
    date: 1000 + ++counter,
    editDate: 1000 + counter,
  };
}

beforeEach(() => {
  resetQueuesForTests();
  fake = new FakeClient();
  h.client = fake;
  useFileStore.setState({
    files: [],
    indexLoadState: "loading",
    indexLoadError: null,
    indexQueueState: "idle",
    indexQueueError: null,
    indexQueueRetryInSec: 0,
    bootstrapComplete: false,
  });
});

afterEach(() => {
  resetQueuesForTests();
});

describe("scanIndexHistory", () => {
  it("finds multiple epochs and excludes files already in the current index", async () => {
    const a = file("a", { messageId: 10 });
    const b = file("b", { messageId: 11 });
    const c = file("c", { messageId: 12 });
    fake.messages = [
      chunk(100, 0, 2, [a]),
      chunk(101, 1, 2, [b]),
      chunk(200, 0, 1, [c], { savedAt: 2_000_000_000_000 }),
    ];
    useFileStore.setState({ files: [a] });

    const report = await scanIndexHistory(CHANNEL);

    expect(report.cancelled).toBe(false);
    expect(report.recoverable.map((r) => r.file.id).sort()).toEqual(["b", "c"]);
    expect(report.recoverable.find((r) => r.file.id === "c")?.epochAt).toBe(2_000_000_000_000);
    // Read-only: getMessages is the only client interaction.
    expect(fake.calls.every((call) => !call.ids)).toBe(true);
  });

  it("returns cancelled with zero writes when aborted", async () => {
    fake.messages = [chunk(100, 0, 1, [file("a")])];
    const controller = new AbortController();
    controller.abort();

    const report = await scanIndexHistory(CHANNEL, controller.signal);

    expect(report.cancelled).toBe(true);
    expect(report.recoverable).toEqual([]);
    expect(fake.calls).toEqual([]);
    expect(useFileStore.getState().files).toEqual([]);
  });

  it("finds uploaded documents in channel history when no index snapshot has them", async () => {
    fake.messages = [
      {
        id: 900,
        message: 'teledrive_file:{"folder":"/Docs"}',
        date: 1700000000,
        media: {
          document: {
            mimeType: "text/plain",
            size: 5,
            attributes: [
              { className: "DocumentAttributeFilename", fileName: "lost.txt" },
            ],
          },
        },
      },
    ];

    const report = await scanIndexHistory(CHANNEL);

    expect(report.recoverable).toHaveLength(1);
    expect(report.recoverable[0]).toMatchObject({
      epochAt: -1,
      file: {
        id: "recovered_900",
        name: "lost.txt",
        folderPath: "/Docs",
        messageId: 900,
      },
    });
  });

  it("merges duplicate content across epochs exactly once", async () => {
    const first = file("first", { name: "same.mp4", size: 42, messageId: 10 });
    const second = file("second", { name: "same.mp4", size: 42, messageId: 20 });
    fake.messages = [
      chunk(100, 0, 1, [first], { savedAt: 1000 }),
      chunk(200, 0, 1, [second], { savedAt: 2000 }),
    ];

    const report = await scanIndexHistory(CHANNEL);

    expect(report.recoverable).toHaveLength(1);
    expect(report.recoverable[0].file.id).toBe("second");
  });
});

describe("replaceIndexFromRecovery", () => {
  it("writes the recovered set through the recovery queue and flips ready", async () => {
    const files = [file("a", { messageId: 50 }), file("b", { messageId: 51 })];
    fake.messages = [
      { id: 50, text: "" },
      { id: 51, text: "" },
    ];
    const committed: TeleFile[][] = [];
    setCommitImplForTests(CHANNEL, async (state) => {
      committed.push(state);
    });
    useFileStore.getState().setIndexLoadState("incomplete", "partial_manifest");

    const result = await replaceIndexFromRecovery(CHANNEL, files);

    expect(result).toEqual({ restored: 2, skipped: 0 });
    expect(committed[0].map((f) => f.id)).toEqual(["a", "b"]);
    expect(useFileStore.getState().indexLoadState).toBe("ready");
    expect(useFileStore.getState().files.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("skips files whose Telegram message is gone", async () => {
    const live = file("live", { messageId: 50 });
    const gone = file("gone", { messageId: 51 });
    fake.messages = [{ id: 50, text: "" }];
    const committed: TeleFile[][] = [];
    setCommitImplForTests(CHANNEL, async (state) => {
      committed.push(state);
    });

    const result = await replaceIndexFromRecovery(CHANNEL, [live, gone]);

    expect(result).toEqual({ restored: 1, skipped: 1 });
    expect(committed[0].map((f) => f.id)).toEqual(["live"]);
    expect(useFileStore.getState().files.map((f) => f.id)).toEqual(["live"]);
  });
});

describe("mergeIndexFromRecovery", () => {
  it("keeps current files and appends recovered files", async () => {
    const current = file("current", { messageId: 50 });
    const recovered = file("recovered", { messageId: 51, name: "new.mp4" });
    useFileStore.setState({ files: [current] });
    fake.messages = [
      { id: 50, text: "" },
      { id: 51, text: "" },
    ];
    const committed: TeleFile[][] = [];
    setCommitImplForTests(CHANNEL, async (state) => {
      committed.push(state);
    });

    const result = await mergeIndexFromRecovery(CHANNEL, [recovered]);

    expect(result).toEqual({ restored: 1, skipped: 0, alreadyPresent: 0 });
    expect(committed[0].map((f) => f.id)).toEqual(["current", "recovered"]);
    expect(useFileStore.getState().files.map((f) => f.id)).toEqual([
      "current",
      "recovered",
    ]);
  });

  it("never removes current files when a recovered message is gone", async () => {
    const current = file("current", { messageId: 50 });
    const gone = file("gone", { messageId: 51 });
    useFileStore.setState({ files: [current] });
    fake.messages = [{ id: 50, text: "" }];
    const committed: TeleFile[][] = [];
    setCommitImplForTests(CHANNEL, async (state) => {
      committed.push(state);
    });

    const result = await mergeIndexFromRecovery(CHANNEL, [gone]);

    expect(result).toEqual({ restored: 0, skipped: 1, alreadyPresent: 0 });
    expect(committed[0].map((f) => f.id)).toEqual(["current"]);
    expect(useFileStore.getState().files.map((f) => f.id)).toEqual(["current"]);
  });

  it("trusts live files found by the channel scan without re-verifying them", async () => {
    const live = file("live", { messageId: 77 });
    fake.messages = [];
    const committed: TeleFile[][] = [];
    setCommitImplForTests(CHANNEL, async (state) => {
      committed.push(state);
    });

    const result = await mergeIndexFromRecovery(CHANNEL, [live], {
      trustedMessageIds: new Set([77]),
    });

    expect(result).toEqual({ restored: 1, skipped: 0, alreadyPresent: 0 });
    expect(committed[0].map((f) => f.id)).toEqual(["live"]);
  });

  it("skips a recovered copy when the current drive already has that path", async () => {
    const current = file("current", { messageId: 50, name: "same.mp4" });
    const duplicate = file("duplicate", { messageId: 51, name: "same.mp4" });
    useFileStore.setState({ files: [current] });
    fake.messages = [
      { id: 50, text: "" },
      { id: 51, text: "" },
    ];
    setCommitImplForTests(CHANNEL, async () => {});

    const result = await mergeIndexFromRecovery(CHANNEL, [duplicate]);

    expect(result).toEqual({ restored: 0, skipped: 0, alreadyPresent: 1 });
    expect(useFileStore.getState().files.map((f) => f.id)).toEqual(["current"]);
  });
});
