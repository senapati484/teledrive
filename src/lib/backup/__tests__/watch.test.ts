import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../controller", () => ({ isBackupRunning: () => false, startBackup: vi.fn() }));
vi.mock("../../telegram/indexReadiness", () => ({ isIndexReady: () => true }));

import { RETRY_DELAYS_MS, retryDelay, shouldRetry } from "../watch";

describe("backup watcher retries", () => {
  it("retries failed runs and partial runs with failed files", () => {
    expect(shouldRetry({ status: "failed", filesFailed: 0 })).toBe(true);
    expect(shouldRetry({ status: "partial", filesFailed: 1 })).toBe(true);
  });

  it("does not loop when only a source folder is missing", () => {
    expect(shouldRetry({ status: "partial", filesFailed: 0 })).toBe(false);
    expect(shouldRetry({ status: "success", filesFailed: 0 })).toBe(false);
    expect(shouldRetry({ status: "cancelled", filesFailed: 0 })).toBe(false);
  });

  it("backs off and settles on the longest delay", () => {
    expect(retryDelay(0)).toBe(RETRY_DELAYS_MS[0]);
    expect(retryDelay(1)).toBeGreaterThan(retryDelay(0));
    expect(retryDelay(50)).toBe(RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
  });
});
