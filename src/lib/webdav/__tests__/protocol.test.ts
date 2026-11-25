import { describe, expect, it } from "vitest";
import {
  WebdavPathError,
  basename,
  dirname,
  encodeHref,
  etagForFile,
  extractLockTokens,
  formatHttpDate,
  isWithinPath,
  joinVirtualPath,
  normalizeVirtualPath,
  parseRangeHeader,
  parseTimeoutHeader,
} from "../protocol";

describe("normalizeVirtualPath", () => {
  it("normalizes slashes, dots and trailing separators", () => {
    expect(normalizeVirtualPath("/")).toBe("/");
    expect(normalizeVirtualPath("")).toBe("/");
    expect(normalizeVirtualPath("/a//b/./c/")).toBe("/a/b/c");
    expect(normalizeVirtualPath("a/b")).toBe("/a/b");
  });

  it("keeps decoded UTF-8 and reserved characters as path data", () => {
    expect(normalizeVirtualPath("/My Files/日本語/#tag?q.txt")).toBe(
      "/My Files/日本語/#tag?q.txt"
    );
  });

  it("rejects traversal, NUL and control characters", () => {
    expect(() => normalizeVirtualPath("/a/../b")).toThrow(WebdavPathError);
    expect(() => normalizeVirtualPath("/..")).toThrow(WebdavPathError);
    expect(() => normalizeVirtualPath("/a\0b")).toThrow(WebdavPathError);
    expect(() => normalizeVirtualPath("/a\u0007b")).toThrow(WebdavPathError);
  });
});

describe("path helpers", () => {
  it("splits names and parents", () => {
    expect(basename("/a/b/c.txt")).toBe("c.txt");
    expect(dirname("/a/b/c.txt")).toBe("/a/b");
    expect(dirname("/a")).toBe("/");
    expect(basename("/")).toBe("");
    expect(joinVirtualPath("/a", "b")).toBe("/a/b");
    expect(joinVirtualPath("/", "b")).toBe("/b");
  });

  it("checks containment", () => {
    expect(isWithinPath("/a/b", "/")).toBe(true);
    expect(isWithinPath("/a/b", "/a")).toBe(true);
    expect(isWithinPath("/a", "/a")).toBe(true);
    expect(isWithinPath("/ab", "/a")).toBe(false);
  });

  it("percent-encodes hrefs and keeps collection trailing slashes", () => {
    expect(encodeHref("/My Files/日本語", false)).toBe(
      "/My%20Files/%E6%97%A5%E6%9C%AC%E8%AA%9E"
    );
    expect(encodeHref("/a b", true)).toBe("/a%20b/");
    expect(encodeHref("/", true)).toBe("/");
    expect(encodeHref("/x#y?z", false)).toBe("/x%23y%3Fz");
  });
});

describe("parseRangeHeader", () => {
  it("parses closed, open-ended and suffix ranges", () => {
    expect(parseRangeHeader("bytes=0-4", 12)).toEqual({ start: 0, end: 4 });
    expect(parseRangeHeader("bytes=5-", 12)).toEqual({ start: 5, end: 11 });
    expect(parseRangeHeader("bytes=-3", 12)).toEqual({ start: 9, end: 11 });
    expect(parseRangeHeader("bytes=10-99", 12)).toEqual({ start: 10, end: 11 });
    expect(parseRangeHeader("bytes=-99", 12)).toEqual({ start: 0, end: 11 });
  });

  it("returns null for absent, invalid and multipart ranges", () => {
    expect(parseRangeHeader(undefined, 12)).toBeNull();
    expect(parseRangeHeader("items=0-1", 12)).toBeNull();
    expect(parseRangeHeader("bytes=0-1,3-4", 12)).toBeNull();
    expect(parseRangeHeader("bytes=abc", 12)).toBeNull();
    expect(parseRangeHeader("bytes=5-1", 12)).toBeNull();
    expect(parseRangeHeader("bytes=", 12)).toBeNull();
  });

  it("reports unsatisfiable ranges", () => {
    expect(parseRangeHeader("bytes=12-20", 12)).toBe("unsatisfiable");
    expect(parseRangeHeader("bytes=-0", 12)).toBe("unsatisfiable");
    expect(parseRangeHeader("bytes=0-0", 0)).toBe("unsatisfiable");
  });
});

describe("header helpers", () => {
  it("parses lock timeouts", () => {
    expect(parseTimeoutHeader(undefined)).toBe(600);
    expect(parseTimeoutHeader("Second-120")).toBe(120);
    expect(parseTimeoutHeader("Infinite")).toBe(3600);
    expect(parseTimeoutHeader("Second-999999")).toBe(3600);
    expect(parseTimeoutHeader("garbage")).toBe(600);
  });

  it("extracts lock tokens from If and Lock-Token headers", () => {
    expect(
      extractLockTokens("(<opaquelocktoken:abc>) (<opaquelocktoken:def>)")
    ).toEqual(["opaquelocktoken:abc", "opaquelocktoken:def"]);
    expect(extractLockTokens("<opaquelocktoken:xyz>")).toEqual(["opaquelocktoken:xyz"]);
    expect(extractLockTokens(null)).toEqual([]);
  });

  it("formats RFC 7231 dates", () => {
    expect(formatHttpDate(Date.UTC(1994, 10, 6, 8, 49, 37))).toBe(
      "Sun, 06 Nov 1994 08:49:37 GMT"
    );
  });

  it("builds content etags", () => {
    expect(
      etagForFile({
        id: "a",
        name: "a.txt",
        size: 3,
        mime: "text/plain",
        folderPath: "/",
        messageId: 7,
        channelId: "c",
        uploadedAt: 1,
        hash: "abc",
      })
    ).toBe('"abc-3"');
  });
});
