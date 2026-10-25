import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { uploadFileToTelegram } from "../../telegram/uploader";

const h = vi.hoisted(() => ({
  failHash: false,
  readFile: null as null | ((args: { offset: number; length: number }) => Promise<Uint8Array>),
  client: {
    invoke: vi.fn(async () => ({})),
    sendFile: vi.fn(async () => ({ id: 42 })),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) =>
    args[0] === "read_file_chunk" ? h.readFile!(args[1]) : null,
}));
vi.mock("../../telegram/client", () => ({ getClient: () => h.client }));
vi.mock("@noble/hashes/sha256", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@noble/hashes/sha256")>();
  return {
    sha256: {
      create: () => {
        const inner = actual.sha256.create();
        if (!h.failHash) return inner;
        return {
          update: (data: Uint8Array) => inner.update(data),
          digest: () => {
            throw new Error("simulated hash failure");
          },
        };
      },
    },
  };
});

const DATA = new Uint8Array(600 * 1024).fill(0x61);
const EXPECTED = createHash("sha256").update(DATA).digest("hex");

beforeEach(() => {
  h.failHash = false;
  h.client.invoke.mockClear();
  h.client.sendFile.mockClear();
  h.readFile = vi.fn(async ({ offset, length }) =>
    DATA.slice(offset, offset + length),
  );
});

describe("upload streamed hash", () => {
  it("hashes every read chunk while uploading", async () => {
    const result = await uploadFileToTelegram(
      "chan",
      "big.bin",
      DATA.length,
      "/tmp/big.bin",
      "/",
      undefined,
      undefined,
      true,
    );

    expect(h.readFile).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ message: { id: 42 }, hash: EXPECTED });
  });

  it("returns the raw message when hashing is not requested", async () => {
    const result = await uploadFileToTelegram(
      "chan",
      "big.bin",
      DATA.length,
      "/tmp/big.bin",
    );

    expect(result).toEqual({ id: 42 });
  });

  it("keeps the upload when hashing fails", async () => {
    h.failHash = true;

    const result = await uploadFileToTelegram(
      "chan",
      "big.bin",
      DATA.length,
      "/tmp/big.bin",
      "/",
      undefined,
      undefined,
      true,
    );

    expect(h.client.sendFile).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ message: { id: 42 }, hash: null });
  });
});
