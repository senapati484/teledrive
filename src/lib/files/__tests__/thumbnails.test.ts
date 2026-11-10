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
  isThumbnailEligible,
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
});

describe("thumbnail eligibility and caching", () => {
  it("excludes SVG, RAW/PSD, trashed, and non-media entries", () => {
    expect(
      isThumbnailEligible({ name: "photo.jpg", mime: "image/jpeg", messageId: 10, trashed: false })
    ).toBe(true);
    expect(
      isThumbnailEligible({ name: "clip.mp4", mime: "video/mp4", messageId: 11, trashed: false })
    ).toBe(true);
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

  it("caps legacy raster fallback candidates to <= 3 MiB", () => {
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
  });

  it("sanitizes thumbnail cache filenames and persists via Tauri preview_cache", async () => {
    expect(thumbnailCacheFilename("-100123/45", 99)).toBe("thumb_-100123_45_99.jpg");

    (globalThis as any).window = { __TAURI_INTERNALS__: {} };
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

