import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const {
  invokeMock,
  sendFileMock,
  getMessagesMock,
  getInputEntityMock,
  iterDownloadMock,
  writeDownloadChunkMock,
  finalizeDownloadFileMock,
  discardDownloadFileMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  sendFileMock: vi.fn(),
  getMessagesMock: vi.fn(),
  getInputEntityMock: vi.fn(),
  iterDownloadMock: vi.fn(),
  writeDownloadChunkMock: vi.fn(),
  finalizeDownloadFileMock: vi.fn(),
  discardDownloadFileMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
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
    invoke: invokeMock,
    sendFile: sendFileMock,
    getMessages: getMessagesMock,
    getInputEntity: getInputEntityMock,
    iterDownload: iterDownloadMock,
  }),
}));

import { deriveMasterKeyFromPassphrase, E2EE_BLOCK_SIZE } from "../../secure/e2ee";
import {
  clearUploadCheckpoint,
  loadUploadCheckpoint,
} from "../../upload/uploadCheckpoints";
import {
  isHashedUploadResult,
  planFileSegments,
  uploadFileToTelegram,
} from "../uploader";
import {
  downloadFilePrefixToBuffer,
  streamFileToLocalPath,
} from "../downloader";
import { getFileMessageIds } from "../../files/segmentHelpers";

beforeEach(() => {
  invokeMock.mockReset();
  sendFileMock.mockReset();
  getMessagesMock.mockReset();
  getInputEntityMock.mockReset().mockResolvedValue({ channelId: "123" });
  iterDownloadMock.mockReset();
  writeDownloadChunkMock.mockReset().mockResolvedValue(undefined);
  finalizeDownloadFileMock.mockReset().mockResolvedValue(undefined);
  discardDownloadFileMock.mockReset().mockResolvedValue(undefined);
});

describe("multi-segment E2EE upload -> resume -> decrypt stream roundtrip", () => {
  it("plans deterministic segments", () => {
    expect(planFileSegments(100, 1000)).toEqual([{ index: 0, offset: 0, size: 100 }]);
    expect(planFileSegments(2500, 1000)).toEqual([
      { index: 0, offset: 0, size: 1000 },
      { index: 1, offset: 1000, size: 1000 },
      { index: 2, offset: 2000, size: 500 },
    ]);
  });

  it("resumes an interrupted multi-segment E2EE upload and decrypts seamlessly across segments", async () => {
    const salt = new Uint8Array(16).fill(0x55);
    const masterKey = await deriveMasterKeyFromPassphrase("super-strong-passphrase", salt);

    // 700 KiB plaintext split cleanly across a 512 KiB segment boundary -> 2 segments (512 KiB + 188 KiB)
    const plain = new Uint8Array(700 * 1024);
    for (let i = 0; i < plain.length; i += 17) {
      plain[i] = (i * 13) & 0xff;
    }
    const expectedHash = createHash("sha256").update(plain).digest("hex");
    const fileObj = new File([plain], "vault-video.mp4", { type: "video/mp4" });
    const fakeThumb = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

    const checkpointKey = "test-resume-multi-seg-e2ee";
    clearUploadCheckpoint(checkpointKey);

    const capturedPartsByFileId = new Map<string, Map<number, Uint8Array>>();
    const finalizedWireSegments = new Map<number, Uint8Array>();

    invokeMock.mockImplementation(async (req: any) => {
      const fid = req.fileId.toString();
      if (!capturedPartsByFileId.has(fid)) capturedPartsByFileId.set(fid, new Map());
      capturedPartsByFileId.get(fid)!.set(req.filePart, new Uint8Array(req.bytes));
      return true;
    });

    let nextMsgId = 900;
    sendFileMock.mockImplementation(async (_peer: any, opts: any) => {
      const fid = opts.file.id.toString();
      // Verify no plaintext thumb leaked & filename obfuscated when encrypted!
      expect(opts.thumb).toBeUndefined();
      expect(opts.file.name).toBe("item-enc.tde");

      // Simulate transient hard failure while finalizing segment 2 on first attempt
      if (nextMsgId === 901 && !finalizedWireSegments.has(901)) {
        throw new Error("simulated finalize disconnect");
      }

      const partsMap = capturedPartsByFileId.get(fid)!;
      const ordered = Array.from(partsMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([, buf]) => buf);
      const joined = new Uint8Array(ordered.reduce((s, b) => s + b.length, 0));
      let pos = 0;
      for (const b of ordered) {
        joined.set(b, pos);
        pos += b.length;
      }
      const assignedId = nextMsgId++;
      finalizedWireSegments.set(assignedId, joined);
      return { id: assignedId };
    });

    // Attempt 1: segment 0 uploads & commits (id=900), segment 1 commits fail -> checkpoint saved!
    await expect(
      uploadFileToTelegram(
        "-100123",
        "vault-video.mp4",
        plain.length,
        fileObj,
        "/Vault",
        undefined,
        undefined,
        true,
        fakeThumb,
        {
          checkpointKey,
          maxSegmentBytesOverride: E2EE_BLOCK_SIZE,
          encryptionKey: masterKey,
          encryptionSaltB64: "KDF_SALT",
          anonymizedFileName: "item-enc.tde",
        }
      )
    ).rejects.toThrow("simulated finalize disconnect");

    const cp = loadUploadCheckpoint(checkpointKey);
    expect(cp?.completedSegments).toHaveLength(1);
    expect(cp?.completedSegments[0].messageId).toBe(900);

    // Attempt 2: sendFile now succeeds -> resumes directly at segment 1 without re-sending segment 0!
    const seg1SendCallsBefore = sendFileMock.mock.calls.length;
    sendFileMock.mockImplementationOnce(async (_peer: any, opts: any) => {
      const fid = opts.file.id.toString();
      const partsMap = capturedPartsByFileId.get(fid)!;
      const ordered = Array.from(partsMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([, buf]) => buf);
      const joined = new Uint8Array(ordered.reduce((s, b) => s + b.length, 0));
      let pos = 0;
      for (const b of ordered) {
        joined.set(b, pos);
        pos += b.length;
      }
      finalizedWireSegments.set(901, joined);
      return { id: 901 };
    });

    const uploadResult = await uploadFileToTelegram(
      "-100123",
      "vault-video.mp4",
      plain.length,
      fileObj,
      "/Vault",
      undefined,
      undefined,
      true,
      fakeThumb,
      {
        checkpointKey,
        maxSegmentBytesOverride: E2EE_BLOCK_SIZE,
        encryptionKey: masterKey,
        encryptionSaltB64: "KDF_SALT",
        anonymizedFileName: "item-enc.tde",
      }
    );

    expect(sendFileMock.mock.calls.length - seg1SendCallsBefore).toBe(1); // Only segment 1 sent!
    expect(loadUploadCheckpoint(checkpointKey)).toBeNull(); // Cleared on completion
    expect(isHashedUploadResult(uploadResult)).toBe(true);
    expect(uploadResult.hash).toBe(expectedHash);
    expect(uploadResult.segments).toHaveLength(2);
    expect(uploadResult.enc).toEqual({ v: 1, s: "KDF_SALT", plainSize: plain.length });
    expect(getFileMessageIds({ messageId: 900, segments: uploadResult.segments })).toEqual([
      900,
      901,
    ]);

    // Ensure ciphertext bytes DO NOT match plaintext anywhere
    expect(finalizedWireSegments.get(900)!.slice(32, 64)).not.toEqual(plain.slice(0, 32));

    // Decrypting multi-segment stream back to disk must match original plaintext bit-for-bit!
    getMessagesMock.mockResolvedValue([
      { id: 900, media: { document: { size: finalizedWireSegments.get(900)!.length } } },
      { id: 901, media: { document: { size: finalizedWireSegments.get(901)!.length } } },
    ]);

    let segCall = 0;
    iterDownloadMock.mockImplementation(async function* () {
      const segId = segCall === 0 ? 900 : 901;
      segCall++;
      const buf = finalizedWireSegments.get(segId)!;
      yield buf.slice(0, Math.floor(buf.length / 2));
      yield buf.slice(Math.floor(buf.length / 2));
    });

    const streamedOut: Uint8Array[] = [];
    writeDownloadChunkMock.mockImplementation(async (_p: string, data: Uint8Array) => {
      streamedOut.push(new Uint8Array(data));
    });

    const writtenTotal = await streamFileToLocalPath(
      "-100123",
      900,
      "/tmp/decrypted-video.mp4",
      undefined,
      undefined,
      plain.length,
      {
        segments: uploadResult.segments,
        enc: uploadResult.enc,
        encryptionKey: masterKey,
        plainSize: plain.length,
      }
    );

    expect(writtenTotal).toBe(plain.length);
    expect(finalizeDownloadFileMock).toHaveBeenCalledWith("/tmp/decrypted-video.mp4");

    const decrypted = new Uint8Array(streamedOut.reduce((s, c) => s + c.length, 0));
    let off = 0;
    for (const c of streamedOut) {
      decrypted.set(c, off);
      off += c.length;
    }
    expect(decrypted).toEqual(plain);

    // Prefix read stops early cleanly on encrypted file without failing truncation check!
    segCall = 0;
    const prefix = await downloadFilePrefixToBuffer(
      "-100123",
      900,
      1024,
      undefined,
      undefined,
      {
        segments: uploadResult.segments,
        enc: uploadResult.enc,
        encryptionKey: masterKey,
        plainSize: plain.length,
      }
    );
    expect(prefix.data).toEqual(plain.slice(0, 1024));
    expect(prefix.truncated).toBe(true);
  }, 15_000);
});

