import { describe, expect, it } from "vitest";
import {
  concatChunks,
  downloadEta,
  downloadPercent,
  downloadSpeed,
} from "../downloadMath";

describe("downloadPercent", () => {
  it("computes a rounded percentage", () => {
    expect(downloadPercent(0, 1000)).toBe(0);
    expect(downloadPercent(500, 1000)).toBe(50);
    expect(downloadPercent(999, 1000)).toBe(100);
  });

  it("handles an unknown size", () => {
    expect(downloadPercent(500, 0)).toBe(0);
  });

  it("clamps out-of-range values", () => {
    expect(downloadPercent(2000, 1000)).toBe(100);
    expect(downloadPercent(-5, 1000)).toBe(0);
  });
});

describe("downloadSpeed", () => {
  it("converts bytes over a window to bytes/second", () => {
    expect(downloadSpeed(2000, 1000, 500)).toBe(2000);
  });

  it("returns 0 for unusable windows", () => {
    expect(downloadSpeed(2000, 1000, 0)).toBe(0);
    expect(downloadSpeed(0, 1000, 500)).toBe(0);
  });
});

describe("downloadEta", () => {
  it("estimates remaining seconds", () => {
    expect(downloadEta(1000, 500, 100)).toBe(5);
  });

  it("returns undefined without a size or speed", () => {
    expect(downloadEta(0, 0, 100)).toBeUndefined();
    expect(downloadEta(1000, 500, 0)).toBeUndefined();
    expect(downloadEta(1000, 1000, 100)).toBeUndefined();
  });
});

describe("concatChunks", () => {
  it("joins chunks in order", () => {
    const out = concatChunks([new Uint8Array([1, 2]), new Uint8Array([3])], 3);
    expect([...out]).toEqual([1, 2, 3]);
  });

  it("throws rather than silently zero-filling a short buffer", () => {
    expect(() => concatChunks([new Uint8Array([1])], 4)).toThrow(
      /Incomplete download/
    );
  });
});
