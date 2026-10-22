import { describe, it, expect } from "vitest";
import { normalizeFolderPath } from "../utils";
import { pickCoherentIndexSet } from "../storage/metadataStore";

describe("normalizeFolderPath", () => {
  it("normalizes empty or root paths to '/'", () => {
    expect(normalizeFolderPath("")).toBe("/");
    expect(normalizeFolderPath("   ")).toBe("/");
    expect(normalizeFolderPath("/")).toBe("/");
    expect(normalizeFolderPath(null)).toBe("/");
    expect(normalizeFolderPath(undefined)).toBe("/");
  });

  it("normalizes single-level folders with or without slashes", () => {
    expect(normalizeFolderPath("Photos")).toBe("/Photos");
    expect(normalizeFolderPath("/Photos")).toBe("/Photos");
    expect(normalizeFolderPath("/Photos/")).toBe("/Photos");
    expect(normalizeFolderPath("Photos/")).toBe("/Photos");
  });

  it("normalizes nested folder paths with whitespace and multiple slashes", () => {
    expect(normalizeFolderPath("/Photos/Summer/")).toBe("/Photos/Summer");
    expect(normalizeFolderPath("Photos/Summer")).toBe("/Photos/Summer");
    expect(normalizeFolderPath("//Photos///Summer//")).toBe("/Photos/Summer");
    expect(normalizeFolderPath("  /Photos / Vacation 2026 /  ")).toBe("/Photos/Vacation 2026");
  });
});

describe("pickCoherentIndexSet", () => {
  it("prefers newer unpinned index epoch with higher message ID over older pinned epoch", () => {
    // Older pinned epoch: 2 chunks (ids 3001, 3002)
    const oldChunk0 = {
      id: 3001,
      message: JSON.stringify({
        teledrive_index: true,
        version: 1,
        chunkIndex: 0,
        totalChunks: 2,
        files: [{ id: "f1", name: "old.txt", size: 10, mime: "text/plain", folderPath: "/", messageId: 200 }],
      }),
    };
    const oldChunk1 = {
      id: 3002,
      message: JSON.stringify({
        teledrive_index: true,
        version: 1,
        chunkIndex: 1,
        totalChunks: 2,
        files: [{ id: "f2", name: "old2.txt", size: 20, mime: "text/plain", folderPath: "/", messageId: 201 }],
      }),
    };

    // Newer recent unpinned epoch: 2 chunks (ids 3501, 3502)
    const newChunk0 = {
      id: 3501,
      message: JSON.stringify({
        teledrive_index: true,
        version: 1,
        chunkIndex: 0,
        totalChunks: 2,
        files: [
          { id: "f1", name: "old.txt", size: 10, mime: "text/plain", folderPath: "/", messageId: 200 },
          { id: "photo1", name: "pic1.jpg", size: 1000, mime: "image/jpeg", folderPath: "/Photos", messageId: 3400 },
        ],
      }),
    };
    const newChunk1 = {
      id: 3502,
      message: JSON.stringify({
        teledrive_index: true,
        version: 1,
        chunkIndex: 1,
        totalChunks: 2,
        files: [
          { id: "f2", name: "old2.txt", size: 20, mime: "text/plain", folderPath: "/", messageId: 201 },
          { id: "photo2", name: "pic2.jpg", size: 2000, mime: "image/jpeg", folderPath: "/Photos", messageId: 3401 },
        ],
      }),
    };

    // Combined message list with both old pinned chunks and new recent chunks
    const messages = [oldChunk0, oldChunk1, newChunk0, newChunk1];
    const chosen = pickCoherentIndexSet(messages);

    expect(chosen).not.toBeNull();
    expect(chosen!.length).toBe(2);
    // The chosen epoch must be the newer one (ids 3501 and 3502)
    expect(chosen![0].msgId).toBe(3501);
    expect(chosen![1].msgId).toBe(3502);

    // Verify all files from the newer epoch are present
    const allFiles = chosen!.flatMap((c) => c.files);
    expect(allFiles.some((f) => f.id === "photo1")).toBe(true);
    expect(allFiles.some((f) => f.id === "photo2")).toBe(true);
  });
});

describe("reconstructMissingFolders", () => {
  it("reconstructs missing parent folders even when files have mixed folderPath formats", async () => {
    const { reconstructMissingFolders } = await import("../storage/metadataStore");
    const rawFiles: any[] = [
      { id: "1", name: "beach.jpg", size: 500, mime: "image/jpeg", folderPath: "Photos", messageId: 101 },
      { id: "2", name: "sunset.png", size: 600, mime: "image/png", folderPath: "/Photos/", messageId: 102 },
      { id: "3", name: "trip.mov", size: 9000, mime: "video/mp4", folderPath: "/Photos/Trip", messageId: 103 },
    ];

    const { healedFiles } = reconstructMissingFolders(rawFiles, "chan_123");

    // Must have reconstructed /Photos and /Photos/Trip virtual folder entries
    const folders = healedFiles.filter((f) => f.mime === "inode/directory" || f.mime === "application/x-directory");
    const folderNames = folders.map((f) => f.name);
    expect(folderNames).toContain("Photos");
    expect(folderNames).toContain("Trip");

    // The Photos folder must have parent "/"
    const photosFolder = folders.find((f) => f.name === "Photos");
    expect(photosFolder).toBeDefined();
    expect(photosFolder!.folderPath).toBe("/");

    // The Trip folder must have parent "/Photos"
    const tripFolder = folders.find((f) => f.name === "Trip");
    expect(tripFolder).toBeDefined();
    expect(tripFolder!.folderPath).toBe("/Photos");
  });

  it("dynamically reconstructs any arbitrary user folder (e.g. 'Dev' or nested custom folders)", async () => {
    const { reconstructMissingFolders } = await import("../storage/metadataStore");
    const customUserFiles: any[] = [
      { id: "dev1", name: "main.rs", size: 1200, mime: "text/x-rust", folderPath: "/Dev", messageId: 501 },
      { id: "dev2", name: "package.json", size: 400, mime: "application/json", folderPath: "/Dev/Frontend", messageId: 502 },
      { id: "work1", name: "notes.txt", size: 80, mime: "text/plain", folderPath: "/MyWork/2026/Q1", messageId: 503 },
    ];

    const { healedFiles } = reconstructMissingFolders(customUserFiles, "channel_arbitrary");

    const folders = healedFiles.filter((f) => f.mime === "inode/directory" || f.mime === "application/x-directory");
    const folderPaths = folders.map((f) => (f.folderPath === "/" ? `/${f.name}` : `${f.folderPath}/${f.name}`));

    // Confirms no folder names are hardcoded — every user-created folder path is dynamically generated
    expect(folderPaths).toContain("/Dev");
    expect(folderPaths).toContain("/Dev/Frontend");
    expect(folderPaths).toContain("/MyWork");
    expect(folderPaths).toContain("/MyWork/2026");
    expect(folderPaths).toContain("/MyWork/2026/Q1");
  });
});
