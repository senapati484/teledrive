import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryBackend,
  makeTeleFile,
  resetBackupTestState,
  type MemoryBackend,
} from "./helpers";
import { runBackup } from "../runner";
import { walkSourceFolders } from "../walker";
import { uploadFileToTelegram } from "../../telegram/uploader";
import { enqueueSave } from "../../storage/indexQueue";
import { isIndexReady, waitForIndexReady } from "../../telegram/indexReadiness";
import { deleteMessages } from "../telegramOps";
import { emptyManifest, saveManifest, type ManifestEntryV2 } from "../manifest";
import { useFileStore } from "@/stores/fileStore";
import { useLicenseStore } from "@/stores/licenseStore";
import { useAuthStore } from "@/stores/authStore";

const h = vi.hoisted(() => ({ backend: null as MemoryBackend | null }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => h.backend!.invoke(...args),
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
    key.startsWith("telegram_channel_id") ? "chan_runner" : null,
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

const CHANNEL = "chan_runner";
const ROOT = "/root";

function walk(files: Array<{ relPath: string; absPath?: string; size?: number; mtimeMs?: number }>, overrides: Record<string, unknown> = {}) {
  return {
    files: files.map((f) => ({
      absPath: f.absPath ?? `${ROOT}/${f.relPath}`,
      relPath: f.relPath,
      size: f.size ?? 10,
      mtimeMs: f.mtimeMs ?? 1000,
    })),
    roots: [{ path: ROOT, status: "ok", skipped: 0 }],
    cancelled: false,
    complete: true,
    errors: [],
    ...overrides,
  } as any;
}

async function seed(entries: Record<string, ManifestEntryV2>, extra: Record<string, unknown> = {}) {
  const manifest = {
    ...emptyManifest(CHANNEL),
    deviceName: "Test Mac",
    deviceOs: "macos",
    entries,
    ...extra,
  };
  manifest.generation = await saveManifest(CHANNEL, manifest as any);
  return manifest;
}

beforeEach(() => {
  resetBackupTestState();
  h.backend = createMemoryBackend();
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
  uploadMock.mockImplementation(async () => ({ id: ++uploadId } as any));
});

let uploadId = 0;
beforeEach(() => {
  uploadId = 0;
});

describe("backup runner", () => {
  it("keeps going when one file's folder path is too long", async () => {
    walkMock.mockResolvedValue(
      walk([
        { relPath: "ok1.txt" },
        { relPath: `${"x".repeat(950)}/f.txt` },
        { relPath: "ok2.txt" },
      ]),
    );

    const result = await runBackup({ triggeredBy: "manual" });

    expect(result.filesUploaded).toBe(2);
    expect(result.filesFailed).toBe(1);
    expect(result.status).toBe("partial");
    expect(uploadMock).toHaveBeenCalledTimes(2);
  });

  it("replaces a changed file without leaving a duplicate", async () => {
    await seed({
      [`${ROOT}/a.txt`]: {
        mtimeMs: 1,
        size: 10,
        messageId: 10,
        folderPath: "/TeleDrive Backups/Test Mac/root",
        uploadedAt: new Date(1).toISOString(),
      },
    });
    useFileStore.setState({
      files: [
        makeTeleFile("backup_10", {
          name: "a.txt",
          size: 10,
          messageId: 10,
          folderPath: "/TeleDrive Backups/Test Mac/root",
        }),
      ],
    });
    walkMock.mockResolvedValue(walk([{ relPath: "a.txt", size: 20, mtimeMs: 2 }]));
    uploadMock.mockResolvedValue({ id: 20 } as any);

    const result = await runBackup({ triggeredBy: "manual" });

    expect(result.status).toBe("success");
    const backupFiles = useFileStore
      .getState()
      .files.filter((f) => f.messageId === 10 || f.messageId === 20);
    expect(backupFiles.map((f) => f.messageId)).toEqual([20]);
    expect(deleteMock).toHaveBeenCalledWith(CHANNEL, [10]);
  });

  it("does not delete old messages when the final index save fails", async () => {
    await seed({
      [`${ROOT}/a.txt`]: {
        mtimeMs: 1,
        size: 10,
        messageId: 10,
        folderPath: "/TeleDrive Backups/Test Mac/root",
        uploadedAt: new Date(1).toISOString(),
      },
    });
    walkMock.mockResolvedValue(walk([{ relPath: "a.txt", size: 20, mtimeMs: 2 }]));
    uploadMock.mockResolvedValue({ id: 20 } as any);
    saveMock.mockRejectedValueOnce(new Error("network down"));

    const result = await runBackup({ triggeredBy: "manual" });

    expect(result.filesUploaded).toBe(1);
    expect(deleteMock).not.toHaveBeenCalled();
    const loaded = await h.backend!.invoke("load_backup_manifest", {
      channelId: CHANNEL,
    });
    expect(JSON.parse(loaded.base).entries[`${ROOT}/a.txt`].previousMessageIds).toEqual([10]);
  });

  it("cancels between files and leaves old messages alone", async () => {
    const controller = new AbortController();
    walkMock.mockResolvedValue(
      walk([{ relPath: "a.txt" }, { relPath: "b.txt" }, { relPath: "c.txt" }]),
    );
    uploadMock.mockImplementation(async () => {
      const id = ++uploadId;
      if (id === 2) controller.abort();
      return { id } as any;
    });

    const result = await runBackup({
      triggeredBy: "manual",
      signal: controller.signal,
    });

    expect(result.status).toBe("cancelled");
    expect(result.filesUploaded).toBe(2);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("adopts an upload left by a crash instead of re-uploading", async () => {
    await seed({}, { lastAttemptAt: Date.now() - 60_000 });
    walkMock.mockResolvedValue(walk([{ relPath: "a.txt", size: 10, mtimeMs: 5 }]));
    const folderPath = "/TeleDrive Backups/Test Mac (macos)/root";
    useFileStore.setState({
      files: [
        makeTeleFile("recovered_77", {
          name: "a.txt",
          size: 10,
          messageId: 77,
          folderPath,
          uploadedAt: Date.now() - 10_000,
          channelId: CHANNEL,
        }),
      ],
    });

    const result = await runBackup({ triggeredBy: "manual" });

    expect(result.filesUploaded).toBe(0);
    expect(result.filesSkipped).toBe(1);
    expect(uploadMock).not.toHaveBeenCalled();
    const loaded = await h.backend!.invoke("load_backup_manifest", {
      channelId: CHANNEL,
    });
    expect(JSON.parse(loaded.base).entries[`${ROOT}/a.txt`].messageId).toBe(77);
  });

  it("reports failure without uploading when the index is not ready", async () => {
    walkMock.mockResolvedValue(walk([{ relPath: "a.txt" }]));
    waitReadyMock.mockResolvedValue(false);

    const result = await runBackup({ triggeredBy: "manual" });

    expect(result.status).toBe("failed");
    expect(result.filesUploaded).toBe(0);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("reports partial when a root is missing", async () => {
    walkMock.mockResolvedValue(
      walk([{ relPath: "a.txt" }], {
        roots: [
          { path: ROOT, status: "ok", skipped: 0 },
          { path: "/missing", status: "missing", skipped: 0 },
        ],
        complete: false,
      }),
    );

    const result = await runBackup({ triggeredBy: "manual" });

    expect(result.status).toBe("partial");
    expect(result.missingFolders).toEqual(["/missing"]);
    expect(result.filesUploaded).toBe(1);
  });

  it("sweeps every prior id only when referenced nowhere", async () => {
    await seed({
      [`${ROOT}/a.txt`]: {
        mtimeMs: 1,
        size: 10,
        messageId: 20,
        folderPath: "/TeleDrive Backups/Test Mac/root",
        uploadedAt: new Date(1).toISOString(),
        previousMessageIds: [10, 11],
      },
      [`${ROOT}/b.txt`]: {
        mtimeMs: 1,
        size: 10,
        messageId: 30,
        folderPath: "/TeleDrive Backups/Test Mac/root",
        uploadedAt: new Date(1).toISOString(),
      },
    }, { garbage: [{ messageId: 12, folderPath: "/", since: 1 }] });
    useFileStore.setState({
      files: [
        makeTeleFile("backup_20", { messageId: 20, name: "a.txt", folderPath: "/TeleDrive Backups/Test Mac/root" }),
        makeTeleFile("backup_30", { messageId: 30, name: "b.txt", folderPath: "/TeleDrive Backups/Test Mac/root" }),
        makeTeleFile("backup_11", { messageId: 11, name: "old.txt", folderPath: "/TeleDrive Backups/Test Mac/root" }),
      ],
    });
    walkMock.mockResolvedValue(
      walk([
        { relPath: "a.txt", mtimeMs: 1, size: 10 },
        { relPath: "b.txt", mtimeMs: 1, size: 10 },
      ]),
    );

    await runBackup({ triggeredBy: "manual" });

    const deleted = deleteMock.mock.calls.flatMap((call) => call[1] as number[]);
    expect(deleted.sort((a, b) => a - b)).toEqual([10, 12]);
  });
});
