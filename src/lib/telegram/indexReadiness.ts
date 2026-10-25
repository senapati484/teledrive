import { useFileStore } from "../../stores/fileStore";

/**
 * Thrown when an index write is attempted before discovery has produced a
 * complete, writable index. Callers may retry after `waitForIndexReady`.
 */
export class IndexNotReadyError extends Error {
  readonly code = "INDEX_NOT_READY";

  constructor(message = "The drive index is not ready yet") {
    super(message);
    this.name = "IndexNotReadyError";
  }
}

export function isIndexReady(): boolean {
  return useFileStore.getState().indexLoadState === "ready";
}

export function assertIndexReady(): void {
  if (!isIndexReady()) {
    throw new IndexNotReadyError();
  }
}

/**
 * Polls until discovery reports ready. Returns false on timeout; never throws.
 * A short poll interval keeps this cheap and avoids fabricating a resolver
 * that could leak across logout.
 */
export async function waitForIndexReady(timeoutMs: number = 60_000): Promise<boolean> {
  if (isIndexReady()) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (isIndexReady()) return true;
  }
  return isIndexReady();
}
