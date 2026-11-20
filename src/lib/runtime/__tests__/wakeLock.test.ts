import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { acquireWakeLock, releaseWakeLock, resetWakeLock } from "../wakeLock";

describe("wakeLock", () => {
  let mockRelease: any;
  let mockRequest: any;

  beforeEach(() => {
    mockRelease = vi.fn().mockResolvedValue(undefined);
    mockRequest = vi.fn().mockResolvedValue({
      release: mockRelease,
      addEventListener: vi.fn(),
    });

    Object.defineProperty(global, "navigator", {
      value: {
        wakeLock: {
          request: mockRequest,
        },
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(async () => {
    await resetWakeLock();
    vi.restoreAllMocks();
  });

  it("acquires screen wake lock when called", async () => {
    await acquireWakeLock();
    expect(mockRequest).toHaveBeenCalledWith("screen");
  });

  it("reuses existing wake lock for concurrent acquisitions", async () => {
    await acquireWakeLock();
    await acquireWakeLock();
    expect(mockRequest).toHaveBeenCalledTimes(1);

    await releaseWakeLock();
    expect(mockRelease).not.toHaveBeenCalled();

    await releaseWakeLock();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("handles platforms without wakeLock support gracefully", async () => {
    Object.defineProperty(global, "navigator", {
      value: {},
      configurable: true,
      writable: true,
    });

    await expect(acquireWakeLock()).resolves.not.toThrow();
    await expect(releaseWakeLock()).resolves.not.toThrow();
  });

  it("handles wake lock rejection gracefully", async () => {
    mockRequest.mockRejectedValue(new Error("Permission denied"));
    await expect(acquireWakeLock()).resolves.not.toThrow();
  });
});
