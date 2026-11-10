import { describe, expect, it } from "vitest";
import {
  containsNullByte,
  getFileCategory,
  getMediaMimeType,
  NON_PREVIEWABLE_BINARY_EXTS,
  UNRENDERABLE_IMAGE_EXTS,
} from "../fileUtils";

describe("getMediaMimeType", () => {
  it("resolves MKV to video/x-matroska even with generic Telegram metadata", () => {
    expect(getMediaMimeType("movie.mkv", "application/octet-stream", "video")).toBe(
      "video/x-matroska"
    );
    expect(getMediaMimeType("CLIP.MKV", "", "video")).toBe("video/x-matroska");
  });

  it("maps standard video and audio extensions accurately", () => {
    expect(getMediaMimeType("clip.mp4", "application/octet-stream", "video")).toBe(
      "video/mp4"
    );
    expect(getMediaMimeType("demo.mov", "", "video")).toBe("video/quicktime");
    expect(getMediaMimeType("song.mp3", "", "audio")).toBe("audio/mpeg");
    expect(getMediaMimeType("voice.opus", "application/octet-stream", "audio")).toBe(
      "audio/opus"
    );
  });

  it("falls back to provided category MIME when extension is unfamiliar", () => {
    expect(getMediaMimeType("stream.unknown", "video/mp4", "video")).toBe("video/mp4");
  });
});

describe("getFileCategory", () => {
  it("categorizes MP4 and MKV as Videos", () => {
    expect(getFileCategory("movie.mkv", "application/octet-stream")).toBe("Videos");
    expect(getFileCategory("video.mp4", "video/mp4")).toBe("Videos");
  });
});

describe("preview classification helpers", () => {
  it("flags camera RAW and PSD formats in UNRENDERABLE_IMAGE_EXTS while keeping web rasters excluded", () => {
    for (const ext of ["psd", "ai", "raw", "cr2", "nef", "arw", "dng", "tga"]) {
      expect(UNRENDERABLE_IMAGE_EXTS.has(ext)).toBe(true);
    }
    for (const ext of ["png", "jpg", "jpeg", "webp", "gif", "avif", "heic"]) {
      expect(UNRENDERABLE_IMAGE_EXTS.has(ext)).toBe(false);
    }
  });

  it("flags installers, office docs, databases, and fonts in NON_PREVIEWABLE_BINARY_EXTS", () => {
    for (const ext of ["exe", "msi", "appimage", "docx", "xlsx", "pptx", "sqlite", "wasm", "woff2"]) {
      expect(NON_PREVIEWABLE_BINARY_EXTS.has(ext)).toBe(true);
    }
    for (const ext of ["pdf", "txt", "json", "mp4", "mkv", "png", "csv"]) {
      expect(NON_PREVIEWABLE_BINARY_EXTS.has(ext)).toBe(false);
    }
  });

  it("detects binary payloads via containsNullByte within the inspect window", () => {
    const cleanText = new TextEncoder().encode("hello\nworld\tUTF-8");
    expect(containsNullByte(cleanText)).toBe(false);

    const binaryPayload = new Uint8Array([0x25, 0x50, 0x44, 0x00, 0x46]);
    expect(containsNullByte(binaryPayload)).toBe(true);

    // Null byte beyond inspectBytes window is ignored for header sniffing
    const padded = new Uint8Array(64).fill(0x61);
    padded[32] = 0x00;
    expect(containsNullByte(padded, 16)).toBe(false);
    expect(containsNullByte(padded, 64)).toBe(true);
  });
});

