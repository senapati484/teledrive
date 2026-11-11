import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  invokeMock,
  convertFileSrcMock,
  writeDownloadChunkMock,
  finalizeDownloadFileMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  convertFileSrcMock: vi.fn((p: string) => `asset://localhost${p}`),
  writeDownloadChunkMock: vi.fn(),
  finalizeDownloadFileMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  convertFileSrc: convertFileSrcMock,
}));

vi.mock("../../storage/downloadStreamWriter", () => ({
  writeDownloadChunk: writeDownloadChunkMock,
  finalizeDownloadFile: finalizeDownloadFileMock,
}));

vi.mock("../../telegram/client", () => ({
  getClient: () => ({
    connected: true,
    connect: vi.fn(),
    getInputEntity: vi.fn(),
    getMessages: vi.fn(),
    downloadMedia: vi.fn(),
  }),
}));

import {
  clearThumbnailMemoryCache,
  getCachedThumbnailUrl,
  isLegacyRasterThumbCandidate,
  isLegacyVideoThumbCandidate,
  isPdfThumbCandidate,
  isThumbnailEligible,
  isValidRasterImageBytes,
  pickBestTelegramThumb,
  seedThumbnailCache,
  thumbnailCacheFilename,
} from "../thumbnails";

beforeEach(() => {
  clearThumbnailMemoryCache();
  invokeMock.mockReset();
  writeDownloadChunkMock.mockReset().mockResolvedValue(undefined);
  finalizeDownloadFileMock.mockReset().mockResolvedValue(undefined);
  delete (globalThis as any).window;
});

describe("pickBestTelegramThumb", () => {
  it("returns null when thumbs and photo sizes are empty or vector-only", () => {
    expect(pickBestTelegramThumb(null)).toBeNull();
    expect(pickBestTelegramThumb({ document: { thumbs: [] } })).toBeNull();
    expect(
      pickBestTelegramThumb({
        document: { thumbs: [{ className: "PhotoPathSize", bytes: new Uint8Array([1]) }] },
      })
    ).toBeNull();
  });

  it("prefers medium raster thumbnail while skipping vector outline paths", () => {
    const thumb = pickBestTelegramThumb({
      document: {
        thumbs: [
          { className: "PhotoPathSize", type: "j" },
          { className: "PhotoStrippedSize", type: "i", bytes: new Uint8Array([1, 2]) },
          { className: "PhotoSize", type: "m", size: 12_000 },
          { className: "PhotoSize", type: "w", size: 350_000 },
        ],
      },
    });
    expect(thumb?.type).toBe("m");
  });

  it("falls back cleanly to inline stripped thumb when no raster size exists", () => {
    const thumb = pickBestTelegramThumb({
      photo: {
        sizes: [{ className: "PhotoStrippedSize", type: "i", bytes: new Uint8Array([3, 4]) }],
      },
    });
    expect(thumb?.type).toBe("i");
  });

  it("prefers PhotoSizeProgressive raster sizes over inline stripped thumbs", () => {
    const thumb = pickBestTelegramThumb({
      photo: {
        sizes: [
          { className: "PhotoStrippedSize", type: "i", bytes: new Uint8Array([1, 20, 20]) },
          { className: "PhotoSizeProgressive", type: "x", sizes: [1200, 5400, 18000] },
        ],
      },
    });
    expect(thumb?.className).toBe("PhotoSizeProgressive");
    expect(thumb?.type).toBe("x");
  });
});

describe("thumbnail eligibility and caching", () => {
  it("excludes SVG, RAW/PSD, trashed, and non-media entries, and includes PDFs", () => {
    expect(
      isThumbnailEligible({ name: "photo.jpg", mime: "image/jpeg", messageId: 10, trashed: false })
    ).toBe(true);
    expect(
      isThumbnailEligible({ name: "clip.mp4", mime: "video/mp4", messageId: 11, trashed: false })
    ).toBe(true);
    expect(
      isThumbnailEligible({ name: "paper.pdf", mime: "application/pdf", messageId: 15, trashed: false })
    ).toBe(true);
    expect(
      isThumbnailEligible({
        name: "secret.pdf",
        mime: "application/pdf",
        messageId: 16,
        trashed: false,
        enc: { v: 1, s: "abc", plainSize: 100 },
      })
    ).toBe(false);
    expect(
      isThumbnailEligible({ name: "vector.svg", mime: "image/svg+xml", messageId: 12, trashed: false })
    ).toBe(false);
    expect(
      isThumbnailEligible({ name: "camera.cr2", mime: "image/x-canon-cr2", messageId: 13, trashed: false })
    ).toBe(false);
    expect(
      isThumbnailEligible({ name: "deleted.png", mime: "image/png", messageId: 14, trashed: true })
    ).toBe(false);
  });

  it("validates raster image magic bytes and rejects stripped or HTML payloads", () => {
    expect(isValidRasterImageBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(isValidRasterImageBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe(true);
    expect(isValidRasterImageBytes(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]))).toBe(true);
    expect(
      isValidRasterImageBytes(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
      )
    ).toBe(true);
    expect(isValidRasterImageBytes(new Uint8Array([0x01, 0x1e, 0x28, 0x30]))).toBe(false);
    expect(isValidRasterImageBytes(new TextEncoder().encode("<html>bad</html>"))).toBe(false);
    expect(isValidRasterImageBytes(new Uint8Array([]))).toBe(false);
  });

  it("caps legacy raster, video, and PDF fallback candidates appropriately", () => {
    expect(
      isLegacyRasterThumbCandidate({
        name: "small.png",
        mime: "image/png",
        size: 1024 * 1024,
        messageId: 1,
        trashed: false,
      })
    ).toBe(true);
    expect(
      isLegacyRasterThumbCandidate({
        name: "huge.png",
        mime: "image/png",
        size: 8 * 1024 * 1024,
        messageId: 2,
        trashed: false,
      })
    ).toBe(false);
    expect(
      isLegacyVideoThumbCandidate({
        name: "Screen Recording.mov",
        mime: "video/quicktime",
        size: 366 * 1024,
        messageId: 3,
        trashed: false,
      })
    ).toBe(true);
    expect(
      isLegacyVideoThumbCandidate({
        name: "movie.mkv",
        mime: "video/x-matroska",
        size: 32 * 1024 * 1024,
        messageId: 4,
        trashed: false,
      })
    ).toBe(false);
    expect(
      isPdfThumbCandidate({
        name: "2604.27202v1.pdf",
        mime: "application/pdf",
        size: 1.4 * 1024 * 1024,
        messageId: 5,
        trashed: false,
      })
    ).toBe(true);
    expect(
      isPdfThumbCandidate({
        name: "huge.pdf",
        mime: "application/pdf",
        size: 20 * 1024 * 1024,
        messageId: 6,
        trashed: false,
      })
    ).toBe(false);
  });

  it("sanitizes thumbnail cache filenames, rejects invalid bytes, and persists valid JPEG via Tauri", async () => {
    expect(thumbnailCacheFilename("-100123/45", 99)).toBe("thumb_-100123_45_99.jpg");

    (globalThis as any).window = { __TAURI_INTERNALS__: {} };
    const invalidUrl = await seedThumbnailCache("-100123", 99, new Uint8Array([0x01, 0x10, 0x20]));
    expect(invalidUrl).toBeNull();
    expect(writeDownloadChunkMock).not.toHaveBeenCalled();

    invokeMock.mockResolvedValueOnce("/app/cache/thumb_-100123_99.jpg");

    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const url = await seedThumbnailCache("-100123", 99, bytes);

    expect(url).toBe("asset://localhost/app/cache/thumb_-100123_99.jpg");
    expect(writeDownloadChunkMock).toHaveBeenCalledWith(
      "/app/cache/thumb_-100123_99.jpg",
      bytes,
      false
    );
    expect(finalizeDownloadFileMock).toHaveBeenCalledWith("/app/cache/thumb_-100123_99.jpg");
    expect(
      getCachedThumbnailUrl({ channelId: "-100123", messageId: 99 })
    ).toBe("asset://localhost/app/cache/thumb_-100123_99.jpg");
  });
});

