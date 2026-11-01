import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushBackupIndexSave, queueBackupIndexSave } from "../indexSave";
import { enqueueSave } from "../../storage/indexQueue";
import { makeTeleFile, resetBackupTestState } from "./helpers";

vi.mock("../../storage/indexQueue", () => ({
  enqueueSave: vi.fn(),
  isChannelQueueRateLimited: vi.fn(() => false),
}));
const saveMock = vi.mocked(enqueueSave);

beforeEach(() => {
  resetBackupTestState();
  saveMock.mockReset();
  saveMock.mockResolvedValue(undefined as any);
});

describe("backup index saves", () => {
  it("coalesces queued snapshots into one write", async () => {
    const first = [makeTeleFile("1")];
    const second = [makeTeleFile("2")];
    queueBackupIndexSave("chan", first);
    queueBackupIndexSave("chan", second);

    const result = await flushBackupIndexSave("chan");

    expect(result.ok).toBe(true);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith("chan", second);
  });

  it("writes a snapshot queued during an in-flight save", async () => {
    let release!: () => void;
    saveMock
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (release = resolve)),
      )
      .mockResolvedValue(undefined as any);

    queueBackupIndexSave("chan", [makeTeleFile("1")]);
    const inFlight = flushBackupIndexSave("chan");
    queueBackupIndexSave("chan", [makeTeleFile("2")]);
    const overlapping = flushBackupIndexSave("chan");

    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    release();
    await expect(inFlight).resolves.toEqual({ ok: true });
    await expect(overlapping).resolves.toEqual({ ok: true });
    expect(saveMock).toHaveBeenCalledTimes(2);
  });

  it("returns a failure and does not retry the failed snapshot", async () => {
    saveMock.mockRejectedValueOnce(new Error("offline"));
    queueBackupIndexSave("chan", [makeTeleFile("1")]);

    const result = await flushBackupIndexSave("chan");
    expect(result).toEqual({ ok: false, error: "offline" });

    await flushBackupIndexSave("chan");
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("throttles rapid multi-file uploads and flushes once cleanly at completion", async () => {
    // Simulate 300 files queued sequentially during a backup
    for (let i = 1; i <= 300; i++) {
      queueBackupIndexSave("chan_300", [makeTeleFile(String(i))]);
    }

    // Prior to flush, saves were not spammed 300 times
    expect(saveMock).not.toHaveBeenCalled();

    // End-of-backup flush commits the final complete state
    const result = await flushBackupIndexSave("chan_300");
    expect(result.ok).toBe(true);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith("chan_300", [makeTeleFile("300")]);
  });
});
