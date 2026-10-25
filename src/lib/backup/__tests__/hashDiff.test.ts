import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryBackend,
  resetBackupTestState,
  type MemoryBackend,
} from "./helpers";
import { runBackup } from "../runner";
import { walkSourceFolders } from "../walker";
import { uploadFileToTelegram } from "../../telegram/uploader";
import { enqueueSave } from "../../storage/indexQueue";
import { isIndexReady, waitForIndexReady } from "../../telegram/indexReadiness";
import { deleteMessages } from "../telegramOps";
import { emptyManifest, loadManifest, saveManifest, type ManifestEntryV2 } from "../manifest";
import { useLicenseStore } from "@/stores/licenseStore";
import { useAuthStore } from "@/stores/authStore";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

const h = vi.hoisted(() => ({
  backend: null as MemoryBackend | null,
  hashFile: null as null | ((path: string) => Promise<string>),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) =>
    args[0] === "hash_file"
      ? h.hashFile!(args[1].path)
      : h.backend!.invoke(...args),
}));
vi.mock("../walker", () => ({ walkSourceFolders: vi.fn(), sanitizeFolderSegment: (s: string) => s }));
vi.mock("../../telegram/uploader", () => ({
  uploadFileToTelegram: vi.fn(),
  isHashedUploadResult: (value: any) =>
    Boolean(value) &&
    typeof value === "object" &&
    "message" in value &&
    "hash" in value,
}));
vi.mock("../../telegram/client", () => ({
  getClient: () => ({
    connected: true,
    connect: vi.fn(async () => {}),
    getMessages: vi.fn(async () => []),
    deleteMessages: vi.fn(async () => {}),
  }),
}));
vi.mock("../../secure/vault", () => ({
  getSecret: vi.fn(async (key: string) =>
    key.startsWith("telegram_channel_id") ? "chan_hash" : null,
  ),
  channelIdKey: (phone: string) => `telegram_channel_id_${phone}`,
  VAULT_KEY_CHANNEL_ID: "telegram_channel_id",
}));
vi.mock("../../secure/deviceInfo", () => ({
  detectOS: () => "macos",
  getDeviceName: () => "Test Mac",
}));
vi.mock("../../storage/indexQueue", () => ({ enqueueSave: vi.fn(async () => {}) }));
vi.mock("../../telegram/indexReadiness", () => ({
  isIndexReady: vi.fn(() => true),
  waitForIndexReady: vi.fn(async () => true),
}));
vi.mock("../../storage/metadataStore", () => ({
  reconstructMissingFolders: (files: any[]) => ({ healedFiles: files }),
  resolveChannelInputPeer: async () => ({ id: 1 }),
}));
vi.mock("../../events", () => ({ logEvent: vi.fn() }));
vi.mock("../telegramOps", () => ({ deleteMessages: vi.fn(async () => {}) }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

const walkMock = vi.mocked(walkSourceFolders);
const uploadMock = vi.mocked(uploadFileToTelegram);
const saveMock = vi.mocked(enqueueSave);
const readyMock = vi.mocked(isIndexReady);
const waitReadyMock = vi.mocked(waitForIndexReady);
const deleteMock = vi.mocked(deleteMessages);

const CHANNEL = "chan_hash";
const ROOT = "/root";
const FOLDER = "/TeleDrive Backups/Test Mac/root";

function walk(files: Array<{ relPath: string; size?: number; mtimeMs?: number }>) {
  return {
    files: files.map((f) => ({
      absPath: `${ROOT}/${f.relPath}`,
      relPath: f.relPath,
      size: f.size ?? 10,
      mtimeMs: f.mtimeMs ?? 1000,
    })),
    roots: [{ path: ROOT, status: "ok", skipped: 0 }],
    cancelled: false,
    complete: true,
    errors: [],
  } as any;
}

async function seed(entries: Record<string, ManifestEntryV2>) {
  const manifest = {
    ...emptyManifest(CHANNEL),
    deviceName: "Test Mac",
    deviceOs: "macos",
    entries,
  };
  manifest.generation = await saveManifest(CHANNEL, manifest);
  return manifest;
}

function priorEntry(overrides: Partial<ManifestEntryV2> = {}): ManifestEntryV2 {
  return {
    mtimeMs: 1,
    size: 10,
    messageId: 10,
    folderPath: FOLDER,
    uploadedAt: new Date(1).toISOString(),
    ...overrides,
  };
}

let uploadId = 0;

beforeEach(() => {
  resetBackupTestState();
  h.backend = createMemoryBackend();
  h.hashFile = vi.fn(async () => "hash");
  walkMock.mockReset();
  uploadMock.mockReset();
  saveMock.mockReset();
  saveMock.mockResolvedValue(undefined as any);
  readyMock.mockReset();
  readyMock.mockReturnValue(true);
  waitReadyMock.mockReset();
  waitReadyMock.mockResolvedValue(true);
  deleteMock.mockReset();
  deleteMock.mockResolvedValue(undefined as any);
  useAuthStore.setState({ phoneNumber: "+111", isAuthenticated: true });
  useLicenseStore.setState({
    backupFolders: { paths: [ROOT], excludes: [] },
    license: {
      id: "local",
      plan: "PRO",
      purchasedAt: null,
      expiresAt: null,
      scheduledBackupIntervalMinutes: 60,
    },
  });
  uploadId = 0;
  uploadMock.mockImplementation(async () => ({ id: ++uploadId }) as any);
});

describe("content-hash diff", () => {
  it("skips a touched file with identical content and updates its stat fields", async () => {
    h.hashFile = vi.fn(async () => "same-hash");
    await seed({ [`${ROOT}/a.txt`]: priorEntry({ hash: "same-hash" }) });
    walkMock.mockResolvedValue(walk([{ relPath: "a.txt", size: 10, mtimeMs: 2 }]));

    const result = await runBackup({ triggeredBy: "manual" });

    expect(result.filesUploaded).toBe(0);
    expect(result.filesSkipped).toBe(1);
    expect(h.hashFile).toHaveBeenCalledWith(`${ROOT}/a.txt`);
    expect(uploadMock).not.toHaveBeenCalled();

    const loaded = await loadManifest(CHANNEL);
    expect(loaded.entries[`${ROOT}/a.txt`]).toMatchObject({
      mtimeMs: 2,
      size: 10,
      messageId: 10,
      hash: "same-hash",
    });
  });

  it("uploads changed content with the same size and a new mtime", async () => {
    h.hashFile = vi.fn(async () => "new-hash");
    await seed({ [`${ROOT}/a.txt`]: priorEntry({ hash: "old-hash" }) });
    walkMock.mockResolvedValue(walk([{ relPath: "a.txt", size: 10, mtimeMs: 2 }]));
    uploadMock.mockResolvedValueOnce({ message: { id: 20 }, hash: "new-hash" } as any);

    const result = await runBackup({ triggeredBy: "manual" });

    expect(result.filesUploaded).toBe(1);
    expect(result.filesSkipped).toBe(0);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock.mock.calls[0][7]).toBe(true);

    const loaded = await loadManifest(CHANNEL);
    expect(loaded.entries[`${ROOT}/a.txt`]).toMatchObject({
      messageId: 20,
      mtimeMs: 2,
      size: 10,
      hash: "new-hash",
    });
  });

  it("keeps the upload when the streamed hash is unavailable", async () => {
    h.hashFile = vi.fn(async () => "new-hash");
    await seed({ [`${ROOT}/a.txt`]: priorEntry({ hash: "old-hash" }) });
    walkMock.mockResolvedValue(walk([{ relPath: "a.txt", size: 10, mtimeMs: 2 }]));
    uploadMock.mockResolvedValueOnce({ message: { id: 21 }, hash: null } as any);

    const result = await runBackup({ triggeredBy: "manual" });

    expect(result.filesUploaded).toBe(1);
    const loaded = await loadManifest(CHANNEL);
    expect(loaded.entries[`${ROOT}/a.txt`].messageId).toBe(21);
    expect(loaded.entries[`${ROOT}/a.txt`].hash).toBeUndefined();
  });

  it("skips comparison above the size cap and uploads without a hash", async () => {
    h.hashFile = vi.fn(async () => "unused");
    await seed({ [`${ROOT}/big.bin`]: priorEntry({ hash: "old-hash", size: 10 }) });
    walkMock.mockResolvedValue(walk([{ relPath: "big.bin", size: 10, mtimeMs: 2 }]));

    const result = await runBackup({
      triggeredBy: "manual",
      hashSizeCapBytes: 5,
    });

    expect(result.filesUploaded).toBe(1);
    expect(h.hashFile).not.toHaveBeenCalled();
    expect(uploadMock.mock.calls[0][7]).toBe(false);
    const loaded = await loadManifest(CHANNEL);
    expect(loaded.entries[`${ROOT}/big.bin`].hash).toBeUndefined();
  });

  it("incremental JS SHA-256 matches the known vector", () => {
    const hasher = sha256.create();
    hasher.update(new Uint8Array([0x61]));
    hasher.update(new Uint8Array([0x62, 0x63]));
    expect(bytesToHex(hasher.digest())).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
