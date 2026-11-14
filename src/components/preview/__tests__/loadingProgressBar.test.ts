import { describe, it, expect } from "vitest";

describe("Loading Screen Progress Bar Logic", () => {
  it("bounds and formats determinate progress percentages safely", () => {
    const formatProgress = (raw: number) => {
      const bounded = Math.min(100, Math.max(0, Math.round(raw)));
      const widthPct = Math.min(100, Math.max(bounded, 6));
      return { bounded, widthPct };
    };

    expect(formatProgress(0)).toEqual({ bounded: 0, widthPct: 6 });
    expect(formatProgress(15)).toEqual({ bounded: 15, widthPct: 15 });
    expect(formatProgress(50.4)).toEqual({ bounded: 50, widthPct: 50 });
    expect(formatProgress(99.6)).toEqual({ bounded: 100, widthPct: 100 });
    expect(formatProgress(120)).toEqual({ bounded: 100, widthPct: 100 });
    expect(formatProgress(-5)).toEqual({ bounded: 0, widthPct: 6 });
  });

  it("determines indeterminate mode when progress is zero or negative", () => {
    const isIndeterminate = (progress: number | undefined) =>
      typeof progress !== "number" || progress <= 0;

    expect(isIndeterminate(undefined)).toBe(true);
    expect(isIndeterminate(0)).toBe(true);
    expect(isIndeterminate(-1)).toBe(true);
    expect(isIndeterminate(1)).toBe(false);
    expect(isIndeterminate(45)).toBe(false);
    expect(isIndeterminate(100)).toBe(false);
  });

  it("scales chunk-based download progress smoothly across phases", () => {
    const scaleStreamProgress = (received: number, total: number, start = 15, end = 99) => {
      if (total <= 0) return start;
      const ratio = Math.min(1, received / total);
      return Math.min(end, start + Math.round(ratio * (end - start)));
    };

    expect(scaleStreamProgress(0, 1000)).toBe(15);
    expect(scaleStreamProgress(500, 1000)).toBe(57);
    expect(scaleStreamProgress(1000, 1000)).toBe(99);
  });
});
