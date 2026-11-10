import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const { getMessagesMock, getInputEntityMock, sendFileMock } = vi.hoisted(() => ({
  getMessagesMock: vi.fn(),
  getInputEntityMock: vi.fn(),
  sendFileMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../telegram/client", () => ({
  getClient: () => ({
    connected: true,
    getInputEntity: getInputEntityMock,
    getMessages: getMessagesMock,
    sendFile: sendFileMock,
  }),
}));

import {
  buildUploadCheckpointKey,
  clearUploadCheckpoint,
  loadUploadCheckpoint,
  saveUploadCheckpoint,
} from "../uploadCheckpoints";
import {
  cloneTelegramFileMessages,
  computeUploadSourceSha256,
  findUploadDuplicateMatch,
  hasUploadDuplicateSizeCandidate,
} from "../dedupeCheck";
import type { TeleFile } from "../../types";

beforeEach(() => {
  getMessagesMock.mockReset();
  getInputEntityMock.mockReset().mockResolvedValue({ channelId: "123" });
  sendFileMock.mockReset();
});

describe("uploadCheckpoints", () => {
  it("persists, retrieves, expires after 24h TTL, and clears cleanly", () => {
    const key = buildUploadCheckpointKey({
      channelId: "-100123",
      folderPath: "/Backups",
      name: "iso.img",
      size: 1024,
      sourceKey: 999,
    });

    clearUploadCheckpoint(key);
    expect(loadUploadCheckpoint(key)).toBeNull();

    saveUploadCheckpoint({
      key,
      segmentIndex: 1,
      fileIdStr: "123456789",
      totalParts: 20,
      completedParts: 12,
      completedSegments: [{ messageId: 88, size: 512 }],
      encrypted: false,
      updatedAt: Date.now(),
    });

    const loaded = loadUploadCheckpoint(key);
    expect(loaded?.completedParts).toBe(12);
    expect(loaded?.completedSegments).toEqual([{ messageId: 88, size: 512 }]);

    // Expired after >24h
    const future = Date.now() + 25 * 60 * 60 * 1000;
    expect(loadUploadCheckpoint(key, future)).toBeNull();
  });
});

describe("dedupeCheck & zero-byte clone", () => {
  it("gates pre-upload SHA-256 scans using O(n) size, encryption, hash, and trash filters", () => {
    const plainWithHash: TeleFile = {
      id: "plain-1",
      name: "doc.pdf",
      size: 4096,
      mime: "application/pdf",
      folderPath: "/",
      messageId: 11,
      channelId: "-1001",
      uploadedAt: 1000,
      hash: "abcd".repeat(16),
    };
    const encWithHash: TeleFile = {
      id: "enc-1",
      name: "secret.tde",
      size: 4148,
      mime: "application/octet-stream",
      folderPath: "/Vault",
      messageId: 12,
      channelId: "-1001",
      uploadedAt: 1000,
      hash: "ef01".repeat(16),
      enc: { v: 1, s: "salt-b64", plainSize: 4096 },
    };
    const withoutHash: TeleFile = {
      ...plainWithHash,
      id: "no-hash",
      size: 9999,
      hash: undefined,
    };
    const trashedFile: TeleFile = {
      ...plainWithHash,
      id: "trashed-1",
      size: 8192,
      trashed: true,
    };

    const files = [plainWithHash, encWithHash, withoutHash, trashedFile];

    expect(hasUploadDuplicateSizeCandidate(files, 4096, false)).toBe(true);
    expect(hasUploadDuplicateSizeCandidate(files, 4096, true)).toBe(true);
    expect(hasUploadDuplicateSizeCandidate([plainWithHash], 4096, true)).toBe(false);
    expect(hasUploadDuplicateSizeCandidate([encWithHash], 4096, false)).toBe(false);
    expect(hasUploadDuplicateSizeCandidate(files, 9999, false)).toBe(false);
    expect(hasUploadDuplicateSizeCandidate(files, 8192, false)).toBe(false);
    expect(hasUploadDuplicateSizeCandidate(files, 1234, false)).toBe(false);
    expect(hasUploadDuplicateSizeCandidate(files, 0, false)).toBe(false);
  });

  it("computes exact SHA-256 and detects exact vs cross-folder cloneable matches respecting encryption", async () => {
    const data = new TextEncoder().encode("identical-content-payload");
    const expectedHash = createHash("sha256").update(data).digest("hex");
    const fileObj = new File([data], "report.pdf", { type: "application/pdf" });

    const computed = await computeUploadSourceSha256(fileObj, data.length);
    expect(computed).toBe(expectedHash);

    const existingPlain: TeleFile = {
      id: "existing-1",
      name: "report.pdf",
      size: data.length,
      mime: "application/pdf",
      folderPath: "/Docs",
      messageId: 77,
      channelId: "-100123",
      uploadedAt: 1000,
      hash: expectedHash,
    };

    // Exact same folder + name + encryption state
    expect(
      findUploadDuplicateMatch([existingPlain], "/Docs", "report.pdf", data.length, expectedHash, false)?.kind
    ).toBe("exact_in_folder");

    // Different folder -> cloneable zero-byte
    expect(
      findUploadDuplicateMatch([existingPlain], "/Shared", "copy.pdf", data.length, expectedHash, false)?.kind
    ).toBe("cloneable");

    // Encryption mismatch -> never clone plaintext into encrypted target
    expect(
      findUploadDuplicateMatch([existingPlain], "/Shared", "copy.pdf", data.length, expectedHash, true)
    ).toBeNull();
  });

  it("clones multi-segment Telegram documents with new independent messageIds", async () => {
    const existing: TeleFile = {
      id: "src-1",
      name: "big.tar",
      size: 3000,
      mime: "application/x-tar",
      folderPath: "/Source",
      messageId: 10,
      segments: [
        { messageId: 10, size: 2000 },
        { messageId: 11, size: 1000 },
      ],
      channelId: "-100123",
      uploadedAt: 1000,
    };

    getMessagesMock.mockResolvedValueOnce([
      { id: 11, media: { document: { id: "doc11" } } },
      { id: 10, media: { document: { id: "doc10" } } },
    ]);

    sendFileMock
      .mockResolvedValueOnce({ id: 201 })
      .mockResolvedValueOnce({ id: 202 });

    const cloned = await cloneTelegramFileMessages("-100123", existing, "/Dest", "big-copy.tar");

    expect(cloned.message.id).toBe(201);
    expect(cloned.segments).toEqual([
      { messageId: 201, size: 2000 },
      { messageId: 202, size: 1000 },
    ]);
    expect(sendFileMock).toHaveBeenCalledTimes(2);
    expect(sendFileMock.mock.calls[0][1].caption).toContain("teledrive_file:");
    expect(sendFileMock.mock.calls[0][1].caption).toContain('"seg":0');
    expect(sendFileMock.mock.calls[1][1].caption).toContain("teledrive_file_part:");
    expect(sendFileMock.mock.calls[1][1].caption).toContain('"seg":1');
  });
});
