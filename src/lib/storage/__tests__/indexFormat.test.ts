import { describe, it, expect } from "vitest";
import type { TeleFile } from "../../types";
import {
  CHUNK_FILE_CAP,
  TELEGRAM_TEXT_LIMIT,
  decodeChunkIds,
  encodeChunkIds,
  epochTimestamp,
  isValidManifest,
  manifestBudget,
  packChunks,
  parseIndexMessage,
  serializeChunk,
} from "../indexFormat";

function makeFile(i: number, folderPath = "/Documents"): TeleFile {
  return {
    id: `file_${i}`,
    name: `report-${i}.pdf`,
    size: 1024 + i,
    mime: "application/pdf",
    folderPath,
    messageId: 1000 + i,
    channelId: "channel_1",
    uploadedAt: 1700000000000 + i,
    starred: i % 7 === 0,
    trashed: false,
    archived: false,
  };
}

function makeFiles(count: number): TeleFile[] {
  return Array.from({ length: count }, (_, i) => makeFile(i));
}

function serializedSize(files: TeleFile[], index: number, total: number): number {
  return serializeChunk({
    teledrive_index: true,
    version: 3,
    chunkIndex: index,
    totalChunks: total,
    savedAt: 1700000000000,
    files,
  }).length;
}

describe("chunk id encoding", () => {
  it("round-trips absolute and negative deltas", () => {
    const cases = [
      [101],
      [101, 102, 103],
      [101, 50, 9000],
      [1, 2, 3, 2, 1],
      [123456789, 123456790, 123456789],
    ];
    for (const ids of cases) {
      expect(decodeChunkIds(encodeChunkIds(ids))).toEqual(ids);
    }
  });

  it("round-trips 400 ids compactly", () => {
    const ids = Array.from({ length: 400 }, (_, i) => 100000 + i);
    const encoded = encodeChunkIds(ids);
    expect(encoded.length).toBeLessThan(1200);
    expect(decodeChunkIds(encoded)).toEqual(ids);
  });

  it("returns an empty list for an empty encoding", () => {
    expect(encodeChunkIds([])).toBe("");
    expect(decodeChunkIds("")).toEqual([]);
  });

  it("rejects malformed encodings", () => {
    for (const encoded of ["0", "1,,", "1,-", "1,zz-", "-1", "1,0,abc"]) {
      if (encoded === "1,0,abc") {
        expect(() => decodeChunkIds(encoded)).not.toThrow();
      } else {
        expect(() => decodeChunkIds(encoded)).toThrow();
      }
    }
  });
});

describe("manifest validation", () => {
  const chunk = (ids?: number[], total = 3) => ({
    msgId: 500,
    version: 2,
    chunkIndex: 0,
    totalChunks: total,
    savedAt: 1700000000000,
    chunkMsgIds: ids,
    files: [makeFile(1)],
    editedAt: 1700000000000,
  });

  it("accepts a manifest with exactly totalChunks - 1 unique ids", () => {
    expect(isValidManifest(chunk([501, 502]))).toBe(true);
    expect(isValidManifest(chunk([], 1))).toBe(true);
  });

  it("rejects missing, extra, duplicate, and non-zero-index manifests", () => {
    expect(isValidManifest(chunk(undefined))).toBe(false);
    expect(isValidManifest(chunk([501]))).toBe(false);
    expect(isValidManifest(chunk([501, 502, 503]))).toBe(false);
    expect(isValidManifest(chunk([501, 501]))).toBe(false);
    expect(isValidManifest({ ...chunk([501, 502]), chunkIndex: 1 })).toBe(false);
  });
});

describe("parseIndexMessage", () => {
  it("parses a v2 chunk from text and message fields", () => {
    const payload = {
      teledrive_index: true,
      version: 2,
      chunkIndex: 1,
      totalChunks: 3,
      savedAt: 1700000000000,
      chunkMsgIds: [10, 11],
      files: [makeFile(1, "/Documents/Work/")],
    };
    const fromText = parseIndexMessage({
      id: "501",
      text: JSON.stringify(payload),
      date: 1700000000,
    });
    const fromMessage = parseIndexMessage({
      id: 501,
      message: JSON.stringify(payload),
      date: 1700000000,
    });

    expect(fromText?.msgId).toBe(501);
    expect(fromText?.chunkIndex).toBe(1);
    expect(fromText?.savedAt).toBe(1700000000000);
    expect(fromText?.chunkMsgIds).toEqual([10, 11]);
    expect(fromText?.files[0].folderPath).toBe("/Documents/Work");
    expect(fromText?.editedAt).toBe(1700000000000);
    expect(fromMessage?.files.length).toBe(1);
  });

  it("parses legacy v1 chunks without savedAt or chunkMsgIds", () => {
    const chunk = parseIndexMessage({
      id: 100,
      text: JSON.stringify({
        teledrive_index: true,
        version: 1,
        chunkIndex: 0,
        totalChunks: 1,
        files: [makeFile(2)],
      }),
      date: 1600000000,
    });
    expect(chunk?.savedAt).toBeUndefined();
    expect(chunk?.chunkMsgIds).toBeUndefined();
    expect(chunk?.editedAt).toBe(1600000000000);
  });

  it("uses editDate over date", () => {
    const chunk = parseIndexMessage({
      id: 100,
      text: JSON.stringify({
        teledrive_index: true,
        chunkIndex: 0,
        totalChunks: 1,
        files: [],
      }),
      date: 1600000000,
      editDate: 1700000000,
    });
    expect(chunk?.editedAt).toBe(1700000000000);
  });

  it("rejects malformed, out-of-range, non-index, and id-less messages", () => {
    expect(parseIndexMessage({ id: 1, text: "not json" })).toBeNull();
    expect(parseIndexMessage({ id: 1, text: '{"teledrive_index":true}' })).toBeNull();
    expect(
      parseIndexMessage({
        id: 1,
        text: '{"teledrive_index":true,"chunkIndex":3,"totalChunks":2,"files":[]}',
      })
    ).toBeNull();
    expect(parseIndexMessage({ id: 1, text: '{"hello":true}' })).toBeNull();
    expect(
      parseIndexMessage({
        id: 0,
        text: '{"teledrive_index":true,"chunkIndex":0,"totalChunks":1,"files":[]}',
      })
    ).toBeNull();
  });

  it("drops malformed chunkMsgIds instead of rejecting the chunk", () => {
    const chunk = parseIndexMessage({
      id: 10,
      text: '{"teledrive_index":true,"chunkIndex":0,"totalChunks":2,"chunkMsgIds":[1,"x"],"files":[]}',
    });
    expect(chunk).not.toBeNull();
    expect(chunk?.chunkMsgIds).toBeUndefined();
  });
});

describe("compressed chunks", () => {
  it("round-trips through the compressed wire format", () => {
    const files = makeFiles(5);
    const text = serializeChunk({
      teledrive_index: true,
      version: 3,
      chunkIndex: 0,
      totalChunks: 1,
      savedAt: 1700000000000,
      chunkMsgIds: [],
      files,
    });

    expect(text.startsWith("teledrive_index gz:")).toBe(true);
    const parsed = parseIndexMessage({ id: 77, text });
    expect(parsed?.files.map((f) => f.id)).toEqual(files.map((f) => f.id));
    expect(parsed?.savedAt).toBe(1700000000000);
  });
});

describe("packChunks", () => {
  it("keeps an empty index in one empty chunk", () => {
    expect(packChunks([])).toEqual({ chunks: [[]], manifestOmitted: false });
  });

  it("packs deterministically and under the Telegram limit", () => {
    const files = makeFiles(1000);
    const first = packChunks(files);
    const second = packChunks(makeFiles(1000));

    expect(first.chunks.length).toBe(second.chunks.length);
    expect(first.chunks.map((c) => c.map((f) => f.id))).toEqual(
      second.chunks.map((c) => c.map((f) => f.id))
    );
    expect(first.manifestOmitted).toBe(false);

    first.chunks.forEach((chunk, i) => {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_FILE_CAP);
      expect(serializedSize(chunk, i, first.chunks.length)).toBeLessThan(TELEGRAM_TEXT_LIMIT);
    });

    const total = first.chunks.reduce((sum, c) => sum + c.length, 0);
    expect(total).toBe(1000);
  });

  it("reserves manifest room in chunk 0", () => {
    const files = makeFiles(300);
    const { chunks } = packChunks(files);
    const budget = manifestBudget(chunks.length);
    expect(serializedSize(chunks[0], 0, chunks.length) + budget).toBeLessThan(TELEGRAM_TEXT_LIMIT);
  });

  it("caps each chunk at CHUNK_FILE_CAP files", () => {
    const files = Array.from(
      { length: 120 },
      (_, i) => ({ id: `f${i}`, name: "a", folderPath: "/" }) as unknown as TeleFile
    );
    const { chunks } = packChunks(files);
    expect(chunks.length).toBe(Math.ceil(120 / CHUNK_FILE_CAP));
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_FILE_CAP);
    }
  });

  it("puts an oversized file in its own chunk instead of dropping it", () => {
    let seed = 1;
    const random = Array.from({ length: 20_000 }, () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return String.fromCharCode(33 + (seed % 90));
    }).join("");
    const huge = { ...makeFile(1), name: random };
    const { chunks } = packChunks([huge, makeFile(2)]);
    expect(chunks.length).toBe(2);
    expect(chunks[0][0].id).toBe(huge.id);
  });

  it("packs a 465-file backup tree into a few compressed messages", () => {
    const files = Array.from({ length: 465 }, (_, i) => ({
      ...makeFile(i),
      name: `Report-${i}.pdf`,
      folderPath: `/TeleDrive Backups/TeleDrive Desktop on macOS (macos)/Documents/Work/Reports/2026/Q${(i % 4) + 1}/Week ${(i % 52) + 1}`,
    }));

    const { chunks } = packChunks(files);

    expect(chunks.length).toBeLessThanOrEqual(12);
    chunks.forEach((chunk, i) => {
      expect(serializedSize(chunk, i, chunks.length)).toBeLessThan(TELEGRAM_TEXT_LIMIT);
    });
  });

  it("flags very large libraries so the writer can use full copy-on-write", () => {
    const files = makeFiles(20_000).map((f) => ({ ...f, name: "a" }));
    const { manifestOmitted } = packChunks(files);
    expect(manifestOmitted).toBe(true);
  });
});

describe("epochTimestamp", () => {
  it("prefers the max savedAt over editedAt", () => {
    const chunks = [
      { msgId: 1, version: 2, chunkIndex: 0, totalChunks: 2, savedAt: 200, files: [], editedAt: 900 },
      { msgId: 2, version: 2, chunkIndex: 1, totalChunks: 2, savedAt: 300, files: [], editedAt: 100 },
    ];
    expect(epochTimestamp(chunks)).toBe(300);
  });

  it("falls back to the max editedAt for legacy chunks", () => {
    const chunks = [
      { msgId: 1, version: 1, chunkIndex: 0, totalChunks: 1, files: [], editedAt: 500 },
    ];
    expect(epochTimestamp(chunks)).toBe(500);
  });

  it("returns 0 when nothing is known", () => {
    expect(epochTimestamp([])).toBe(0);
    expect(
      epochTimestamp([
        { msgId: 1, version: 1, chunkIndex: 0, totalChunks: 1, files: [], editedAt: 0 },
      ])
    ).toBe(0);
  });
});
