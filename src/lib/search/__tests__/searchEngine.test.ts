import { describe, expect, it } from "vitest";
import { fuzzySearch } from "../searchEngine";
import type { TeleFile } from "../../types";

function mockFile(id: string, name: string, folderPath = "/", mime = "text/plain"): TeleFile {
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

  it("caps results at 50 items", () => {
    const files: TeleFile[] = [];
    for (let i = 0; i < 100; i++) {
      files.push(mockFile(`id-${i}`, `item_${i}.txt`));
    }

    const results = fuzzySearch(files, "item");
    expect(results.length).toBe(50);
  });
});
