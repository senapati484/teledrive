import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const { invokeMock, sendFileMock, getMeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  sendFileMock: vi.fn(),
  getMeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../client", () => ({
  getClient: () => ({
    connected: true,
    invoke: invokeMock,
    sendFile: sendFileMock,
    getMe: getMeMock,
  }),
}));

import {
  FREE_MAX_FILE_PARTS,
  PREMIUM_MAX_FILE_PARTS,
  resetCachedPremiumStatus,
  UPLOAD_CHUNK_SIZE,
  uploadFileToTelegram,
  validateUploadSizeForAccount,
} from "../uploader";

beforeEach(() => {
  resetCachedPremiumStatus();
  invokeMock.mockReset().mockResolvedValue(true);
  sendFileMock.mockReset().mockResolvedValue({ id: 500 });
  getMeMock.mockReset().mockResolvedValue({ premium: false });
});

describe("validateUploadSizeForAccount", () => {
  it("enforces standard 4,000-part (~2 GB) and Premium 8,000-part (~4 GB) limits", () => {
    const freeCap = FREE_MAX_FILE_PARTS * UPLOAD_CHUNK_SIZE;
    const premiumCap = PREMIUM_MAX_FILE_PARTS * UPLOAD_CHUNK_SIZE;

    expect(validateUploadSizeForAccount(0, true)).toMatchObject({ ok: false, reason: "empty" });
    expect(validateUploadSizeForAccount(freeCap, false)).toMatchObject({ ok: true });
    expect(validateUploadSizeForAccount(freeCap + 1, false)).toMatchObject({
      ok: false,
      reason: "exceeds_free_limit",
    });
    expect(validateUploadSizeForAccount(freeCap + 1, true)).toMatchObject({
      ok: true,
      isBig: true,
    });
    expect(validateUploadSizeForAccount(premiumCap + 1, true)).toMatchObject({
      ok: false,
      reason: "exceeds_premium_limit",
    });
    // Unknown account status does not false-reject 2-4 GB uploads
    expect(validateUploadSizeForAccount(freeCap + 1024, null)).toMatchObject({ ok: true });
  });
});

describe("uploadFileToTelegram enhancements", () => {
  it("rejects pre-flight when non-Premium account exceeds ~2 GB without uploading chunks", async () => {
    getMeMock.mockResolvedValueOnce({ premium: false });
    const overFreeSize = FREE_MAX_FILE_PARTS * UPLOAD_CHUNK_SIZE + 512;
    const fakeFile = new File([new Uint8Array(1)], "oversize.iso");

    await expect(
      uploadFileToTelegram(
        "-100123",
        "oversize.iso",
        overFreeSize,
        fakeFile,
        "/",
        undefined,
        undefined,
        false,
        null,
        { allowMultiSegment: false }
      )
    ).rejects.toThrow();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(sendFileMock).not.toHaveBeenCalled();
  });

  it("pipelines big-file chunks (>10 MB), keeps SHA-256 deterministic, and passes thumb to sendFile", async () => {
    // 10.5 MiB -> 21 chunks (SaveBigFilePart)
    const size = 10 * 1024 * 1024 + 512 * 1024;
    const payload = new Uint8Array(size);
    for (let i = 0; i < size; i += 4096) {
      payload[i] = (i >> 12) & 0xff;
    }
    const expectedHash = createHash("sha256").update(payload).digest("hex");
    const fakeFile = new File([payload], "movie.mp4", { type: "video/mp4" });
    const thumbBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

    const seenParts = new Set<number>();
    invokeMock.mockImplementation(async (req: any) => {
      seenParts.add(req.filePart);
      return true;
    });

    const progresses: number[] = [];
    const res = await uploadFileToTelegram(
      "-100123",
      "movie.mp4",
      size,
      fakeFile,
      "/Movies",
      (uploaded) => progresses.push(uploaded),
      undefined,
      true,
      thumbBytes
    );

    expect(seenParts.size).toBe(21);
    expect(progresses[progresses.length - 1]).toBe(size);
    expect(res.hash).toBe(expectedHash);
    expect(sendFileMock).toHaveBeenCalledTimes(1);
    expect(sendFileMock.mock.calls[0][1].thumb).toBeDefined();
    expect(sendFileMock.mock.calls[0][1].caption).toBe('teledrive_file:{"folder":"/Movies"}');
  });
});

