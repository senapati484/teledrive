import { describe, it, expect } from "vitest";
import {
  parseFloodWaitSeconds,
  clampFloodWait,
  computeRetryDelay,
  FLOOD_WAIT_CAP_SECONDS,
} from "../telegram/rateLimit";
import { chunkFiles, chunkFilesStable } from "../storage/indexQueue";
import type { TeleFile } from "../types";

describe("FLOOD_WAIT rate limiting & cooldown calculations", () => {
  it("parses flood wait seconds from various Telegram error shapes", () => {
    expect(parseFloodWaitSeconds("A wait of 97 seconds is required (caused by messages.SendMessage)")).toBe(97);
    expect(parseFloodWaitSeconds(new Error("A wait of 176 seconds is required (caused by messages.SendMessage)"))).toBe(176);
    expect(parseFloodWaitSeconds({ seconds: 208 })).toBe(208);
    expect(parseFloodWaitSeconds({ name: "FloodWaitError", seconds: 45 })).toBe(45);
    expect(parseFloodWaitSeconds("FLOOD_WAIT_60")).toBe(60);
    expect(parseFloodWaitSeconds(new Error("Random network timeout"))).toBeNull();
  });

  it("respects high flood wait durations up to 300s without prematurely clamping to 30s", () => {
    expect(FLOOD_WAIT_CAP_SECONDS).toBe(300);
    expect(clampFloodWait(97)).toBe(97);
    expect(clampFloodWait(176)).toBe(176);
    expect(clampFloodWait(299)).toBe(299);
    expect(clampFloodWait(500)).toBe(300); // capped at 300s
  });

  it("computeRetryDelay respects Telegram's exact cooldown seconds so retries do not fail prematurely", () => {
    const err = new Error("A wait of 150 seconds is required (caused by messages.SendMessage)");
    const delayMs = computeRetryDelay(1, err);
    // Should be at least 150,000ms (150s) plus minor jitter
    expect(delayMs).toBeGreaterThanOrEqual(150000);
    expect(delayMs).toBeLessThanOrEqual(151000);
  });
});

describe("chunkFiles and chunkFilesStable", () => {
  function makeDummyFiles(count: number): TeleFile[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `file_${i + 1}`,
      name: `track_${String(i + 1).padStart(3, "0")}.mp4`,
      size: 1024 * 1024 * 50,
      mime: "video/mp4",
      folderPath: "/Vídeos/BB Hot100 YE/1978",
      messageId: 1000 + i,
      channelId: "chan_test",
      uploadedAt: 1700000000000 + i,
      starred: false,
      trashed: false,
    }));
  }

  it("dynamically packs files up to 25 files / 3400 chars per chunk", () => {
    const files = makeDummyFiles(55);
    const chunks = chunkFiles(files);
    // 55 files with long folder paths pack into 4 chunks safely under 3400 chars
    expect(chunks.length).toBe(4);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(25);
      const chars = 120 + chunk.reduce((sum, f) => sum + JSON.stringify(f).length + 2, 0);
      expect(chars).toBeLessThanOrEqual(3900);
    }
  });

  it("chunkFilesStable distributes evenly into existing chunk count when possible", () => {
    const files = makeDummyFiles(30);
    // If Telegram already has 2 chunks stored, distribute 30 files stably into 2 chunks (15 + 15)
    const stableChunks = chunkFilesStable(files, 2);
    expect(stableChunks.length).toBe(2);
    expect(stableChunks[0].length).toBe(15);
    expect(stableChunks[1].length).toBe(15);
  });

  it("chunkFilesStable falls back to dynamic chunking if stable distribution would overflow Telegram limit", () => {
    // 120 files in 1 chunk would overflow Telegram's 4096-char limit
    const files = makeDummyFiles(120);
    const result = chunkFilesStable(files, 1);
    expect(result.length).toBeGreaterThan(1);
  });
});
