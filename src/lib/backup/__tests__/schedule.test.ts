import { describe, expect, it } from "vitest";
import { isBackupDue } from "../schedule";

const NOW = 10_000_000_000;
const HOUR = 60 * 60 * 1000;

function base(overrides: Partial<Parameters<typeof isBackupDue>[0]> = {}) {
  return {
    now: NOW,
    lastSuccessAt: NOW - 2 * HOUR,
    lastAttemptAt: NOW - 2 * HOUR,
    lastResult: null,
    scheduleEnabledAt: NOW - 48 * HOUR,
    intervalMinutes: 60,
    ...overrides,
  };
}

describe("isBackupDue", () => {
  it("waits one interval after enabling", () => {
    expect(
      isBackupDue(base({ lastSuccessAt: null, scheduleEnabledAt: NOW - 30 * 60_000 })),
    ).toBe(false);
    expect(
      isBackupDue(base({ lastSuccessAt: null, scheduleEnabledAt: NOW - 2 * HOUR })),
    ).toBe(true);
  });

  it("runs once after a missed interval", () => {
    expect(isBackupDue(base({ lastSuccessAt: NOW - 3 * HOUR }))).toBe(true);
  });

  it("guards recent failures and cancellations", () => {
    expect(
      isBackupDue(
        base({
          lastAttemptAt: NOW - 5 * 60_000,
          lastResult: {
            status: "failed",
            uploaded: 0,
            skipped: 0,
            failed: 1,
            missingRoots: [],
          },
        }),
      ),
    ).toBe(false);
    expect(
      isBackupDue(
        base({
          lastAttemptAt: NOW - 31 * 60_000,
          lastResult: {
            status: "failed",
            uploaded: 0,
            skipped: 0,
            failed: 1,
            missingRoots: [],
          },
        }),
      ),
    ).toBe(true);
  });

  it("uses the newer of last success and schedule change", () => {
    expect(
      isBackupDue(
        base({
          lastSuccessAt: NOW - 10 * HOUR,
          scheduleEnabledAt: NOW - 10 * 60_000,
        }),
      ),
    ).toBe(false);
  });

  it("does nothing without an interval", () => {
    expect(isBackupDue(base({ intervalMinutes: null }))).toBe(false);
    expect(isBackupDue(base({ intervalMinutes: 0 }))).toBe(false);
  });
});
