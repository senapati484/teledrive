import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetBackupTestState } from "./helpers";
import { cancelBackup, isBackupRunning, startBackup } from "../controller";
import { runBackup } from "../runner";
import type { BackupRunResult } from "../runner";

vi.mock("../runner", () => ({ runBackup: vi.fn() }));

const runBackupMock = vi.mocked(runBackup);

function result(overrides: Partial<BackupRunResult> = {}): BackupRunResult {
  return {
    triggeredBy: "manual",
    deviceRoot: "/TeleDrive Backups/Device",
    totalFound: 0,
    filesUploaded: 0,
    filesSkipped: 0,
    filesFailed: 0,
    missingFolders: [],
    auditJobId: null,
    status: "success",
    error: null,
    durationMs: 1,
    finishedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  resetBackupTestState();
  runBackupMock.mockReset();
});

describe("backup controller", () => {
  it("collapses concurrent starts into one runner invocation", async () => {
    let resolve!: (value: BackupRunResult) => void;
    runBackupMock.mockImplementation(
      () =>
        new Promise<BackupRunResult>((r) => {
          resolve = r;
        }),
    );

    const first = startBackup({ triggeredBy: "manual" });
    const second = startBackup({ triggeredBy: "auto" });
    expect(runBackupMock).toHaveBeenCalledTimes(1);
    expect(isBackupRunning()).toBe(true);

    resolve(result());
    await expect(first).resolves.toMatchObject({ status: "success" });
    await expect(second).resolves.toMatchObject({ status: "success" });
    expect(isBackupRunning()).toBe(false);
  });

  it("cancels the active run via one signal", async () => {
    let seenSignal: AbortSignal | undefined;
    runBackupMock.mockImplementation(
      (opts) =>
        new Promise<BackupRunResult>((resolve) => {
          seenSignal = opts.signal;
          opts.signal?.addEventListener("abort", () =>
            resolve(result({ status: "cancelled" })),
          );
        }),
    );

    const promise = startBackup({ triggeredBy: "auto", reason: "scheduled" });
    expect(cancelBackup()).toBe(true);
    await expect(promise).resolves.toMatchObject({ status: "cancelled" });
    expect(seenSignal?.aborted).toBe(true);
    expect(cancelBackup()).toBe(false);
  });
});
