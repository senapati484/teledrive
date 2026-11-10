import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  discardDownloadFile,
  finalizeDownloadFile,
  uint8ToBase64,
  writeDownloadChunk,
} from "../downloadStreamWriter";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("uint8ToBase64", () => {
  it("encodes binary slices to base64", () => {
    expect(uint8ToBase64(new Uint8Array([]))).toBe("");
    expect(uint8ToBase64(new Uint8Array([102, 111, 111]))).toBe("Zm9v");
    expect(uint8ToBase64(new Uint8Array([1, 2, 3, 255]))).toBe("AQID/w==");
  });
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

  it("streams Android SAF content:// URIs through native write_file_chunk with base64", async () => {
    const chunk = new Uint8Array([72, 105]);
    await writeDownloadChunk("content://downloads/1", chunk, true);

    expect(invokeMock).toHaveBeenCalledWith("write_file_chunk", {
      path: "content://downloads/1",
      dataB64: "SGk=",
      append: true,
      done: false,
      sync: false,
    });
  });
});

describe("finalizeDownloadFile", () => {
  it("commits local temp files and closes Android SAF descriptors", async () => {
    await finalizeDownloadFile("/tmp/file.bin");
    expect(invokeMock).toHaveBeenCalledWith("write_file_chunk", {
      path: "/tmp/file.bin",
      data: [],
      append: true,
      done: true,
      sync: true,
    });

    invokeMock.mockClear();
    await finalizeDownloadFile("content://downloads/1");
    expect(invokeMock).toHaveBeenCalledWith("write_file_chunk", {
      path: "content://downloads/1",
      data: [],
      append: true,
      done: true,
      sync: true,
    });
  });
});

describe("discardDownloadFile", () => {
  it("removes the native temp file or resets content URIs", async () => {
    await discardDownloadFile("/tmp/file.bin");
    expect(invokeMock).toHaveBeenCalledWith("write_file_chunk", {
      path: "/tmp/file.bin",
      data: [],
      append: true,
      discard: true,
    });

    invokeMock.mockClear();
    await discardDownloadFile("content://downloads/1");
    expect(invokeMock).toHaveBeenCalledWith("write_file_chunk", {
      path: "content://downloads/1",
      data: [],
      append: true,
      discard: true,
    });
  });

  it("does not throw when cleanup fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    await expect(discardDownloadFile("/tmp/file.bin")).resolves.toBeUndefined();
  });
});
