import { describe, expect, it } from "vitest";
import { applySearchFilters, fuzzySearch } from "../searchEngine";
import type { TeleFile } from "../../types";

function mockFile(
  id: string,
  name: string,
  folderPath = "/",
  mime = "text/plain",
  overrides: Partial<TeleFile> = {},
): TeleFile {
  return {
    id,
    name,
    size: 1024,
    mime,
    folderPath,
    messageId: 1,
    channelId: "-10012345",
    uploadedAt: Date.now(),
    starred: false,
    trashed: false,
    archived: false,
    ...overrides,
  };
}

describe("fuzzySearch", () => {
  it("returns empty array for empty or whitespace query", () => {
    const files = [mockFile("1", "document.pdf")];
    expect(fuzzySearch(files, "")).toEqual([]);
    expect(fuzzySearch(files, "   ")).toEqual([]);
  });

  it("ranks exact name match higher than prefix and substring match", () => {
    const files = [
      mockFile("1", "notes_report.txt"),
      mockFile("2", "report"),
      mockFile("3", "report_final.docx"),
    ];

    const results = fuzzySearch(files, "report");
    expect(results.length).toBe(3);
    // Exact match "report" has highest score (100)
    expect(results[0].name).toBe("report");
    // Prefix match "report_final.docx" has score 80
    expect(results[1].name).toBe("report_final.docx");
    // Substring match "notes_report.txt" has score 50
    expect(results[2].name).toBe("notes_report.txt");
  });

  it("matches against folderPath and mime type", () => {
    const files = [
      mockFile("1", "file.dat", "/Projects/Finances"),
      mockFile("2", "photo.png", "/", "image/png"),
    ];

    expect(fuzzySearch(files, "finances").map((f) => f.id)).toEqual(["1"]);
    expect(fuzzySearch(files, "image").map((f) => f.id)).toEqual(["2"]);
  });

  it("matches typo queries via trigram similarity while ranking exact/substring higher", () => {
    const files = [
      mockFile("1", "document_2026.pdf"),
      mockFile("2", "vacation_video.mp4"),
      mockFile("3", "unrelated.bin"),
    ];

    const results = fuzzySearch(files, "documnt");
    expect(results.map((f) => f.id)).toEqual(["1"]);
  });

  it("supports multi-word queries across name, path, and mime", () => {
    const files = [
      mockFile("1", "invoice_q4.pdf", "/Work/Finance", "application/pdf"),
      mockFile("2", "invoice_q4.png", "/Work/Finance", "image/png"),
    ];

    const results = fuzzySearch(files, "finance pdf");
    expect(results.map((f) => f.id)).toEqual(["1"]);
  });

  it("caps results at 50 items", () => {
    const files: TeleFile[] = [];
    for (let i = 0; i < 100; i++) {
      files.push(mockFile(`id-${i}`, `item_${i}.txt`));
    }

    const results = fuzzySearch(files, "item");
    expect(results.length).toBe(50);
  });
});

describe("applySearchFilters", () => {
  const NOW = 1_800_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;
  const MB = 1024 * 1024;

  const catalog: TeleFile[] = [
    mockFile("recent-small", "a.txt", "/", "text/plain", {
      uploadedAt: NOW - 2 * DAY,
      size: 500 * 1024,
    }),
    mockFile("month-medium", "b.mp4", "/", "video/mp4", {
      uploadedAt: NOW - 15 * DAY,
      size: 25 * MB,
    }),
    mockFile("old-large", "c.iso", "/", "application/octet-stream", {
      uploadedAt: NOW - 400 * DAY,
      size: 250 * MB,
    }),
    mockFile("folder", "Docs", "/", "inode/directory", {
      uploadedAt: NOW - 1 * DAY,
      size: 0,
    }),
  ];

  it("filters by date range", () => {
    expect(
      applySearchFilters(catalog, { dateRange: "7d" }, NOW).map((f) => f.id),
    ).toEqual(["recent-small", "folder"]);

    expect(
      applySearchFilters(catalog, { dateRange: "30d" }, NOW).map((f) => f.id),
    ).toEqual(["recent-small", "month-medium", "folder"]);

    expect(
      applySearchFilters(catalog, { dateRange: "1y" }, NOW).map((f) => f.id),
    ).toEqual(["recent-small", "month-medium", "folder"]);
  });

  it("filters by size range and excludes directories", () => {
    expect(
      applySearchFilters(catalog, { sizeRange: "small" }, NOW).map((f) => f.id),
    ).toEqual(["recent-small"]);

    expect(
      applySearchFilters(catalog, { sizeRange: "medium" }, NOW).map((f) => f.id),
    ).toEqual(["month-medium"]);

    expect(
      applySearchFilters(catalog, { sizeRange: "large" }, NOW).map((f) => f.id),
    ).toEqual(["old-large"]);
  });

  it("combines fuzzySearch with date and size filters", () => {
    const results = fuzzySearch(
      catalog,
      "mp4",
      { dateRange: "30d", sizeRange: "medium" },
      NOW,
    );
    expect(results.map((f) => f.id)).toEqual(["month-medium"]);
  });
});
