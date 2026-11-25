/**
 * Cross-upload permit pool for MTProto `SaveFilePart` / `SaveBigFilePart`
 * calls. Each file already pipelines `DEFAULT_BIG_PART_CONCURRENCY` parts; two
 * in-app uploads plus two WebDAV PUTs would otherwise put 12 large RPCs on one
 * GramJS session and trigger FLOOD_WAIT / throughput collapse.
 *
 * Keeping this at six part-RPCs preserves single-upload throughput (3) while
 * bounding parallel-file fan-out across every upload path.
 */
export const MAX_CONCURRENT_UPLOAD_PARTS = 6;

export class UploadPartSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(readonly capacity: number = MAX_CONCURRENT_UPLOAD_PARTS) {
    if (!Number.isFinite(capacity) || capacity < 1) {
      throw new RangeError("Upload semaphore capacity must be >= 1");
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get waitingCount(): number {
    return this.waiters.length;
  }

  async acquire(): Promise<void> {
    if (this.active < this.capacity) {
      this.active++;
      return;
    }
    // The releaser transfers its slot without decrementing `active`.
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.active = Math.max(0, this.active - 1);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}

/** Shared by every uploadFileToTelegram call in this webview session. */
export const uploadPartSemaphore = new UploadPartSemaphore();
