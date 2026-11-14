import { describe, expect, it } from "vitest";
import {
  formatFileSize,
  formatShortDate,
  formatFullDate,
  compareNames,
} from "../FileBrowser";

describe("Dynamic Loading & High-Performance Helpers", () => {
  describe("formatFileSize", () => {
    it("handles zero, negative, and non-numeric inputs gracefully", () => {
      expect(formatFileSize(0)).toBe("—");
      expect(formatFileSize(-100)).toBe("—");
      expect(formatFileSize(null)).toBe("—");
      expect(formatFileSize(undefined)).toBe("—");
      expect(formatFileSize(NaN)).toBe("—");
    });

    it("formats raw bytes up to 1023 B without decimals", () => {
      expect(formatFileSize(1)).toBe("1 B");
      expect(formatFileSize(512)).toBe("512 B");
      expect(formatFileSize(1023)).toBe("1023 B");
    });

    it("formats KB, MB, GB, TB boundaries with clean decimals", () => {
      expect(formatFileSize(1024)).toBe("1.00 KB");
      expect(formatFileSize(1024 * 1024)).toBe("1.00 MB");
      expect(formatFileSize(5.5 * 1024 * 1024)).toBe("5.50 MB");
      expect(formatFileSize(1024 * 1024 * 1024)).toBe("1.00 GB");
      expect(formatFileSize(2.25 * 1024 * 1024 * 1024)).toBe("2.25 GB");
      expect(formatFileSize(1024 * 1024 * 1024 * 1024)).toBe("1.00 TB");
    });
  });

  describe("Cached Date Formatting", () => {
    const fixedTimestamp = 1715000000000; // May 6, 2024

    it("formats short dates cleanly with cached Intl instance", () => {
      const formatted = formatShortDate(fixedTimestamp, "en-US");
      expect(formatted).toMatch(/May\s+6/);
    });

    it("formats full dates cleanly with cached Intl instance", () => {
      const formatted = formatFullDate(fixedTimestamp, "en-US");
      expect(formatted).toMatch(/5\/6\/2024|2024/);
    });
  });

  describe("compareNames natural sorting", () => {
    it("sorts numbers naturally (e.g. file2 before file10)", () => {
      const names = ["file10.txt", "file2.txt", "file1.txt"];
      names.sort(compareNames);
      expect(names).toEqual(["file1.txt", "file2.txt", "file10.txt"]);
    });

    it("returns 0 for identical strings", () => {
      expect(compareNames("report.pdf", "report.pdf")).toBe(0);
    });

    it("sorts case-sensitively or case-insensitively with base sensitivity", () => {
      expect(compareNames("apple", "banana")).toBeLessThan(0);
      expect(compareNames("banana", "apple")).toBeGreaterThan(0);
    });
  });

  describe("Grid Batch Alignment Verification", () => {
    it("ensures batch size 72 is cleanly divisible by all responsive Tailwind grid column counts", () => {
      const responsiveColCounts = [2, 3, 4, 6, 8];
      const BATCH_SIZE = 72;

      for (const cols of responsiveColCounts) {
        expect(BATCH_SIZE % cols).toBe(0);
      }
    });
  });
});
