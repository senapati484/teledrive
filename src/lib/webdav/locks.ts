import {
  extractLockTokens,
  isWithinPath,
  normalizeVirtualPath,
} from "./protocol";

/** In-memory exclusive write locks. Sufficient for Windows/RaiDrive clients. */

export type LockDepth = "0" | "infinity";

export interface WebdavLock {
  token: string;
  path: string;
  depth: LockDepth;
  owner: string | null;
  timeoutSeconds: number;
  expiresAt: number;
}

export type LockResult =
  | { ok: true; lock: WebdavLock; created: boolean }
  | { ok: false; reason: "conflict"; lock: WebdavLock };

function randomToken(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `opaquelocktoken:${cryptoApi.randomUUID()}`;
  }
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.random() * 256;
  return `opaquelocktoken:${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Does `lock` guard writes to `path`? */
export function lockCoversPath(lock: WebdavLock, path: string): boolean {
  if (lock.path === path) return true;
  if (lock.depth === "infinity" && isWithinPath(path, lock.path)) return true;
  return false;
}

export class LockManager {
  private locks = new Map<string, WebdavLock>();

  clear(): void {
    this.locks.clear();
  }

  private prune(now = Date.now()): void {
    for (const [token, lock] of this.locks) {
      if (lock.expiresAt <= now) this.locks.delete(token);
    }
  }

  /** Returns the first unexpired lock covering `path`, if any. */
  lockForPath(path: string): WebdavLock | null {
    this.prune();
    const normalized = normalizeVirtualPath(path);
    for (const lock of this.locks.values()) {
      if (lockCoversPath(lock, normalized)) return lock;
    }
    return null;
  }

  /** Finds a lock owned by `token` that still covers `path`. */
  findByToken(path: string, token: string): WebdavLock | null {
    this.prune();
    const lock = this.locks.get(token);
    if (!lock) return null;
    return lockCoversPath(lock, normalizeVirtualPath(path)) ? lock : null;
  }

  lock(
    path: string,
    options: { owner?: string | null; timeoutSeconds?: number; depth?: LockDepth } = {}
  ): LockResult {
    this.prune();
    const normalized = normalizeVirtualPath(path);
    const timeoutSeconds = Math.min(3600, Math.max(1, options.timeoutSeconds ?? 600));
    const depth = options.depth ?? "infinity";
    const owner = options.owner ? options.owner.slice(0, 1024) : null;

    const existing = this.lockForPath(normalized);
    if (existing) {
      return { ok: false, reason: "conflict", lock: existing };
    }
    if (depth === "infinity") {
      for (const lock of this.locks.values()) {
        if (isWithinPath(lock.path, normalized)) {
          return { ok: false, reason: "conflict", lock };
        }
      }
    }

    const lock: WebdavLock = {
      token: randomToken(),
      path: normalized,
      depth,
      owner,
      timeoutSeconds,
      expiresAt: Date.now() + timeoutSeconds * 1000,
    };
    this.locks.set(lock.token, lock);
    return { ok: true, lock, created: true };
  }

  refresh(path: string, token: string, timeoutSeconds: number): WebdavLock | null {
    this.prune();
    const lock = this.findByToken(path, token);
    if (!lock) return null;
    const seconds = Math.min(3600, Math.max(1, timeoutSeconds));
    lock.timeoutSeconds = seconds;
    lock.expiresAt = Date.now() + seconds * 1000;
    return lock;
  }

  unlock(path: string, token: string): "ok" | "not-found" | "mismatch" {
    this.prune();
    const normalized = normalizeVirtualPath(path);
    const lock = this.locks.get(token);
    if (!lock) return "not-found";
    if (!lockCoversPath(lock, normalized)) return "mismatch";
    this.locks.delete(token);
    return "ok";
  }

  /**
   * Returns true when a write to `path` may proceed. A lock only blocks writes
   * that do not present its token in the `If` / `Lock-Token` headers.
   */
  canWrite(path: string, tokens: string[]): boolean {
    this.prune();
    const normalized = normalizeVirtualPath(path);
    const presented = new Set(tokens);
    for (const lock of this.locks.values()) {
      if (!lockCoversPath(lock, normalized)) continue;
      if (!presented.has(lock.token)) return false;
    }
    return true;
  }
}

export const webdavLocks = new LockManager();

/** Collects tokens from both `If` and `Lock-Token` headers. */
export function collectWriteTokens(ifHeader?: string | null, lockToken?: string | null): string[] {
  return [...extractLockTokens(ifHeader), ...extractLockTokens(lockToken)];
}
