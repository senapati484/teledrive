import { describe, expect, it } from "vitest";
import { computeItemStats, resolveItemFullPath } from "../fileStats";
import type { TeleFile } from "../../types";

function makeItem(
  id: string,
  name: string,
  folderPath: string,
  mime: string,
  size: number,
  overrides: Partial<TeleFile> = {},
): TeleFile {
  return {
    id,
    name,
    size,
    mime,
    folderPath,
    messageId: 1,
    channelId: "-1001",
    uploadedAt: 1000,
    starred: false,
    trashed: false,
    archived: false,
    ...overrides,
  };
}

describe("computeItemStats", () => {
  it("resolves canonical paths for root and nested items", () => {
    expect(resolveItemFullPath(makeItem("1", "Work", "/", "inode/directory", 0))).toBe("/Work");
    expect(resolveItemFullPath(makeItem("2", "doc.pdf", "/Work", "application/pdf", 500))).toBe("/Work/doc.pdf");
  });

  it("computes single-file stats accurately", () => {
    const file = makeItem("f1", "photo.png", "/Photos", "image/png", 2048, {
      uploadedAt: 5000,
      offline: true,
    });
    const stats = computeItemStats(file, [file]);
    expect(stats.isDirectory).toBe(false);
    expect(stats.totalBytes).toBe(2048);
    expect(stats.fileCount).toBe(1);
    expect(stats.folderCount).toBe(0);
    expect(stats.offlineCount).toBe(1);
    expect(stats.breakdown[0]).toMatchObject({ category: "Images", count: 1, bytes: 2048, percentage: 100 });
  });

  it("computes recursive folder size, counts, latest timestamp, and category breakdown", () => {
    const rootFolder = makeItem("d1", "Projects", "/", "inode/directory", 0, { uploadedAt: 1000 });
    const subFolder = makeItem("d2", "Assets", "/Projects", "inode/directory", 0, { uploadedAt: 2000 });
    const siblingFolder = makeItem("d3", "ProjectsOld", "/", "inode/directory", 0, { uploadedAt: 9000 });
    const f1 = makeItem("f1", "spec.pdf", "/Projects", "application/pdf", 3000, { uploadedAt: 3000 });
    const f2 = makeItem("f2", "banner.png", "/Projects/Assets", "image/png", 7000, { uploadedAt: 6000 });
    const trashed = makeItem("f3", "old.mp4", "/Projects", "video/mp4", 99999, { trashed: true });
    const siblingFile = makeItem("f4", "other.txt", "/ProjectsOld", "text/plain", 50000);

    const stats = computeItemStats(rootFolder, [
      rootFolder,
      subFolder,
      siblingFolder,
      f1,
      f2,
      trashed,
      siblingFile,
    ]);

    expect(stats.isDirectory).toBe(true);
    expect(stats.totalBytes).toBe(10000);
    expect(stats.fileCount).toBe(2);
    expect(stats.folderCount).toBe(1);
    expect(stats.lastModifiedAt).toBe(6000);
    expect(stats.breakdown).toEqual([
      { category: "Images", count: 1, bytes: 7000, percentage: 70 },
      { category: "Documents", count: 1, bytes: 3000, percentage: 30 },
    ]);
  });
});
