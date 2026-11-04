import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, writeFileMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: writeFileMock }));

import {
  discardDownloadFile,
  finalizeDownloadFile,
  writeDownloadChunk,
} from "../downloadStreamWriter";

beforeEach(() => {
  invokeMock.mockReset();
  writeFileMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  writeFileMock.mockResolvedValue(undefined);
});

describe("writeDownloadChunk", () => {
  it("streams local chunks through the native temp writer", async () => {
    await writeDownloadChunk("/tmp/file.bin", new Uint8Array([1, 2]), false);

    expect(invokeMock).toHaveBeenCalledWith("write_file_chunk", {
      path: "/tmp/file.bin",
      data: [1, 2],
      append: false,
      done: false,
      sync: false,
    });
  });

  it("uses plugin-fs for Android SAF URIs", async () => {
    const chunk = new Uint8Array([3]);
    await writeDownloadChunk("content://downloads/1", chunk, true);

    expect(writeFileMock).toHaveBeenCalledWith("content://downloads/1", chunk, {
      append: true,
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("finalizeDownloadFile", () => {
  it("commits the native temp file", async () => {
    await finalizeDownloadFile("/tmp/file.bin");

    expect(invokeMock).toHaveBeenCalledWith("write_file_chunk", {
      path: "/tmp/file.bin",
      data: [],
      append: true,
      done: true,
      sync: true,
    });
  });

  it("is a no-op for content URIs", async () => {
    await finalizeDownloadFile("content://downloads/1");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("discardDownloadFile", () => {
  it("removes the native temp file", async () => {
    await discardDownloadFile("/tmp/file.bin");

    expect(invokeMock).toHaveBeenCalledWith("write_file_chunk", {
      path: "/tmp/file.bin",
      data: [],
      append: true,
      discard: true,
    });
  });

  it("truncates the document for content URIs", async () => {
    await discardDownloadFile("content://downloads/1");

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [, bytes] = writeFileMock.mock.calls[0];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toHaveLength(0);
  });

  it("does not throw when cleanup fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    await expect(discardDownloadFile("/tmp/file.bin")).resolves.toBeUndefined();
  });
});
