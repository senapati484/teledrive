import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  writeDownloadChunkMock,
  finalizeDownloadFileMock,
  discardDownloadFileMock,
  iterDownloadMock,
  getMessagesMock,
  getInputEntityMock,
} = vi.hoisted(() => ({
  writeDownloadChunkMock: vi.fn(),
  finalizeDownloadFileMock: vi.fn(),
  discardDownloadFileMock: vi.fn(),
  iterDownloadMock: vi.fn(),
  getMessagesMock: vi.fn(),
  getInputEntityMock: vi.fn(),
}));

vi.mock("../../storage/downloadStreamWriter", () => ({
  writeDownloadChunk: writeDownloadChunkMock,
  finalizeDownloadFile: finalizeDownloadFileMock,
  discardDownloadFile: discardDownloadFileMock,
}));

vi.mock("../client", () => ({
  getClient: () => ({
    connected: true,
    connect: vi.fn(),
    getInputEntity: getInputEntityMock,
    getEntity: vi.fn(),
    getMessages: getMessagesMock,
    iterDownload: iterDownloadMock,
  }),
}));

import { downloadFilePrefixToBuffer, streamFileToLocalPath } from "../downloader";

beforeEach(() => {
  writeDownloadChunkMock.mockReset().mockResolvedValue(undefined);
  finalizeDownloadFileMock.mockReset().mockResolvedValue(undefined);
  discardDownloadFileMock.mockReset().mockResolvedValue(undefined);
  getInputEntityMock.mockReset().mockResolvedValue({ channelId: "123" });
  getMessagesMock.mockReset().mockResolvedValue([
    {
      id: 42,
      media: { document: { size: 6 } },
    },
  ]);
});

describe("streamFileToLocalPath", () => {
  it("streams chunks directly to disk and finalizes cleanly", async () => {
    iterDownloadMock.mockImplementationOnce(async function* () {
      yield new Uint8Array([1, 2, 3]);
      yield new Uint8Array([4, 5, 6]);
    });

    const pcts: number[] = [];
    const total = await streamFileToLocalPath(
      "-100123",
      42,
      "/tmp/preview.mp4",
      (pct) => pcts.push(pct)
    );

    expect(total).toBe(6);
    expect(writeDownloadChunkMock).toHaveBeenCalledTimes(1);
    expect(writeDownloadChunkMock).toHaveBeenCalledWith(
      "/tmp/preview.mp4",
      new Uint8Array([1, 2, 3, 4, 5, 6]),
      false
    );
    expect(finalizeDownloadFileMock).toHaveBeenCalledWith("/tmp/preview.mp4");
    expect(discardDownloadFileMock).not.toHaveBeenCalled();
    expect(pcts[pcts.length - 1]).toBe(100);
  });

  it("aborts cleanly via AbortSignal and discards partial file", async () => {
    const controller = new AbortController();
    iterDownloadMock.mockImplementationOnce(async function* () {
      yield new Uint8Array([1, 2]);
      controller.abort();
      yield new Uint8Array([3, 4]);
    });

    await expect(
      streamFileToLocalPath(
        "-100123",
        42,
        "/tmp/preview.mkv",
        undefined,
        controller.signal
      )
    ).rejects.toThrow();

    expect(discardDownloadFileMock).toHaveBeenCalledWith("/tmp/preview.mkv");
    expect(finalizeDownloadFileMock).not.toHaveBeenCalled();
  });
});

describe("downloadFilePrefixToBuffer", () => {
  it("stops early at maxBytes and marks truncated when file exceeds limit", async () => {
    getMessagesMock.mockResolvedValueOnce([
      {
        id: 42,
        media: { document: { size: 12 } },
      },
    ]);

    let yieldedThirdChunk = false;
    iterDownloadMock.mockImplementationOnce(async function* () {
      yield new Uint8Array([1, 2, 3, 4]);
      yield new Uint8Array([5, 6, 7, 8]);
      yieldedThirdChunk = true;
      yield new Uint8Array([9, 10, 11, 12]);
    });

    const pcts: number[] = [];
    const res = await downloadFilePrefixToBuffer(
      "-100123",
      42,
      6,
      (pct) => pcts.push(pct)
    );

    expect(res.data).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
    expect(res.truncated).toBe(true);
    expect(res.totalSize).toBe(12);
    expect(yieldedThirdChunk).toBe(false);
    expect(pcts[pcts.length - 1]).toBe(100);
  });

  it("returns truncated: false when payload fits within maxBytes", async () => {
    getMessagesMock.mockResolvedValueOnce([
      {
        id: 42,
        media: { document: { size: 6 } },
      },
    ]);

    iterDownloadMock.mockImplementationOnce(async function* () {
      yield new Uint8Array([10, 20, 30]);
      yield new Uint8Array([40, 50, 60]);
    });

    const res = await downloadFilePrefixToBuffer("-100123", 42, 16);

    expect(res.data).toEqual(new Uint8Array([10, 20, 30, 40, 50, 60]));
    expect(res.truncated).toBe(false);
    expect(res.totalSize).toBe(6);
  });

  it("aborts cleanly via AbortSignal", async () => {
    const controller = new AbortController();
    iterDownloadMock.mockImplementationOnce(async function* () {
      yield new Uint8Array([1, 2]);
      controller.abort();
      yield new Uint8Array([3, 4]);
    });

    await expect(
      downloadFilePrefixToBuffer("-100123", 42, 16, undefined, controller.signal)
    ).rejects.toThrow();
  });
});

