import { describe, expect, it, vi, afterEach } from "vitest";
import { LockManager, collectWriteTokens } from "../locks";

afterEach(() => {
  vi.useRealTimers();
});

describe("LockManager", () => {
  it("grants an exclusive lock and returns a token", () => {
    const locks = new LockManager();
    const result = locks.lock("/docs", { timeoutSeconds: 120 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lock.token.startsWith("opaquelocktoken:")).toBe(true);
    expect(result.lock.expiresAt).toBeGreaterThan(Date.now());
    expect(locks.lockForPath("/docs")).not.toBeNull();
  });

  it("rejects a second lock on the same resource", () => {
    const locks = new LockManager();
    expect(locks.lock("/docs").ok).toBe(true);
    const second = locks.lock("/docs");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("conflict");
  });

  it("honours Depth: infinity for descendants but not siblings", () => {
    const locks = new LockManager();
    locks.lock("/docs", { depth: "infinity" });
    expect(locks.lockForPath("/docs/a.txt")).not.toBeNull();
    expect(locks.lockForPath("/other/a.txt")).toBeNull();
  });

  it("does not cover descendants for Depth: 0", () => {
    const locks = new LockManager();
    locks.lock("/docs", { depth: "0" });
    expect(locks.lockForPath("/docs")).not.toBeNull();
    expect(locks.lockForPath("/docs/a.txt")).toBeNull();
  });

  it("rejects overlapping ancestor locks", () => {
    const locks = new LockManager();
    locks.lock("/docs/a.txt");
    expect(locks.lock("/docs").ok).toBe(false);
  });

  it("refreshes and unlocks only with the owning token", () => {
    const locks = new LockManager();
    const granted = locks.lock("/docs", { timeoutSeconds: 60 });
    if (!granted.ok) throw new Error("lock failed");
    const token = granted.lock.token;

    expect(locks.refresh("/docs", token, 300)?.timeoutSeconds).toBe(300);
    expect(locks.unlock("/docs", "opaquelocktoken:wrong")).toBe("not-found");
    expect(locks.canWrite("/docs", [token])).toBe(true);
    expect(locks.unlock("/docs", token)).toBe("ok");
    expect(locks.lockForPath("/docs")).toBeNull();
  });

  it("blocks writes without the token and allows them with it", () => {
    const locks = new LockManager();
    const granted = locks.lock("/docs/a.txt");
    if (!granted.ok) throw new Error("lock failed");
    expect(locks.canWrite("/docs/a.txt", [])).toBe(false);
    expect(locks.canWrite("/docs/a.txt", ["opaquelocktoken:other"])).toBe(false);
    expect(locks.canWrite("/docs/a.txt", [granted.lock.token])).toBe(true);
    expect(locks.canWrite("/free.txt", [])).toBe(true);
  });

  it("expires locks after their timeout", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const locks = new LockManager();
    locks.lock("/docs", { timeoutSeconds: 10 });
    vi.setSystemTime(new Date("2026-01-01T00:00:11Z"));
    expect(locks.lockForPath("/docs")).toBeNull();
    expect(locks.canWrite("/docs", [])).toBe(true);
  });
});

describe("collectWriteTokens", () => {
  it("merges If and Lock-Token headers", () => {
    expect(
      collectWriteTokens("(<opaquelocktoken:a>)", "<opaquelocktoken:b>")
    ).toEqual(["opaquelocktoken:a", "opaquelocktoken:b"]);
  });
});
