import { beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";

const {
  writeDownloadChunkMock,
  finalizeDownloadFileMock,
  discardDownloadFileMock,
  saveDialogMock,
  iterDownloadMock,
  getMessagesMock,
  getInputEntityMock,
} = vi.hoisted(() => ({
  writeDownloadChunkMock: vi.fn(),
  finalizeDownloadFileMock: vi.fn(),
  discardDownloadFileMock: vi.fn(),
  saveDialogMock: vi.fn(),
  iterDownloadMock: vi.fn(),
  getMessagesMock: vi.fn(),
  getInputEntityMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: saveDialogMock,
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

import {
  collectFilesForZipExport,
  downloadSelectionAsZip,
  suggestZipArchiveName,
} from "../zipDownloader";
import type { TeleFile } from "../../types";
import { useTransferStore } from "../../../stores/transferStore";

const makeFolder = (id: string, name: string, folderPath: string): TeleFile => ({
  id,
  name,
  size: 0,
  mime: "inode/directory",
  folderPath,
  messageId: 0,
  channelId: "-100123",
  uploadedAt: 1_700_000_000_000,
});

const makeFile = (
  id: string,
  name: string,
  folderPath: string,
  messageId: number,
  size = 5,
  trashed = false
): TeleFile => ({
  id,
  name,
  size,
  mime: "text/plain",
  folderPath,
  messageId,
  channelId: "-100123",
  uploadedAt: 1_700_000_000_000,
  trashed,
});

beforeEach(() => {
  useTransferStore.setState({ downloads: [] });
  writeDownloadChunkMock.mockReset().mockResolvedValue(undefined);
  finalizeDownloadFileMock.mockReset().mockResolvedValue(undefined);
  discardDownloadFileMock.mockReset().mockResolvedValue(undefined);
  saveDialogMock.mockReset().mockResolvedValue("/tmp/archive.zip");
  getInputEntityMock.mockReset().mockResolvedValue({ channelId: "123" });
  getMessagesMock.mockReset().mockResolvedValue([{ id: 1, media: { document: { size: 5 } } }]);
  iterDownloadMock.mockReset();
  delete (globalThis as any).window;
});

describe("collectFilesForZipExport", () => {
  it("expands folders recursively, excludes trashed items, deduplicates overlaps, and disambiguates collisions", () => {
    const docsFolder = makeFolder("f1", "Docs", "/");
    const subFile = makeFile("a1", "readme.txt", "/Docs/Sub", 10);
    const trashedChild = makeFile("a2", "secret.txt", "/Docs", 11, 5, true);
    const rootSameName = makeFile("a3", "note.txt", "/", 12);
    const dupRootSameName = makeFile("a4", "note.txt", "/Work", 13);

    const all = [docsFolder, subFile, trashedChild, rootSameName, dupRootSameName];
    // Selecting parent Docs + child subFile + two files named note.txt
    const entries = collectFilesForZipExport(all, [
      docsFolder,
      subFile,
      rootSameName,
      dupRootSameName,
    ]);

    expect(entries.map((e) => e.archivePath)).toEqual([
      "Docs/Sub/readme.txt",
      "note.txt",
      "note (2).txt",
    ]);
  });

  it("suggests clean ZIP archive filenames", () => {
    expect(suggestZipArchiveName([makeFolder("f1", "Photos 2026", "/")])).toBe("Photos 2026.zip");
    expect(suggestZipArchiveName([makeFile("1", "a.zip", "/", 1)])).toBe("a.zip");
    expect(
      suggestZipArchiveName([makeFile("1", "a.txt", "/", 1), makeFile("2", "b.txt", "/", 2)])
    ).toMatch(/^teledrive-files-\d{4}-\d{2}-\d{2}\.zip$/);
  });
});

describe("downloadSelectionAsZip", () => {
  it("streams multiple Telegram files into a valid ZIP written via writeDownloadChunk", async () => {
    (globalThis as any).window = { __TAURI_INTERNALS__: {} };

    const folder = makeFolder("f1", "Bundle", "/");
    const f1 = makeFile("1", "hello.txt", "/Bundle", 101, 5);
    const f2 = makeFile("2", "world.txt", "/Bundle/Sub", 102, 5);

    const writtenChunks: Uint8Array[] = [];
    writeDownloadChunkMock.mockImplementation(async (_path: string, data: Uint8Array) => {
      writtenChunks.push(new Uint8Array(data));
    });

    getMessagesMock
      .mockResolvedValueOnce([{ id: 101, media: { document: { size: 5 } } }])
      .mockResolvedValueOnce([{ id: 102, media: { document: { size: 5 } } }]);

    iterDownloadMock
      .mockImplementationOnce(async function* () {
        yield new TextEncoder().encode("hello");
      })
      .mockImplementationOnce(async function* () {
        yield new TextEncoder().encode("world");
      });

    await downloadSelectionAsZip([folder, f1, f2], [folder]);

    expect(finalizeDownloadFileMock).toHaveBeenCalledWith("/tmp/archive.zip");
    expect(discardDownloadFileMock).not.toHaveBeenCalled();

    const totalLen = writtenChunks.reduce((s, c) => s + c.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of writtenChunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    const extracted = unzipSync(merged);
    expect(Object.keys(extracted).sort()).toEqual([
      "Bundle/Sub/world.txt",
      "Bundle/hello.txt",
    ]);
    expect(strFromU8(extracted["Bundle/hello.txt"])).toBe("hello");
    expect(strFromU8(extracted["Bundle/Sub/world.txt"])).toBe("world");
  });
});

