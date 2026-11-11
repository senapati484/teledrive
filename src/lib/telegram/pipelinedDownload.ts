import bigInt from "big-integer";
import { Api, errors, utils } from "telegram";
import { parseFloodWaitSeconds, FLOOD_WAIT_CAP_SECONDS } from "./rateLimit";

export const DEFAULT_DOWNLOAD_CHUNK_SIZE = 512 * 1024;
export const DEFAULT_DOWNLOAD_CONCURRENCY = 3;
const MIN_ALIGN = 4096;

export interface PipelinedDownloadOptions {
  client: any;
  media: any;
  peer?: any;
  messageId?: number;
  /** Wire size of this single Telegram document/segment if already known. */
  fileSize?: number;
  /** Inclusive start byte offset within this segment (default 0). */
  startOffset?: number;
  /** Inclusive end byte offset within this segment (default end-of-file). */
  endOffset?: number;
  /** Aligned MTProto request size (default 512 KiB). */
  requestSize?: number;
  /** Maximum concurrent in-flight upload.GetFile RPCs (default 3). */
  concurrency?: number;
  signal?: AbortSignal;
  /** Optional pause hook awaited before scheduling or emitting parts; returns false if cancelled. */
  waitWhilePaused?: () => Promise<boolean>;
}

function toNum(val: any): number {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "object" && typeof val.toJSNumber === "function") {
    return val.toJSNumber();
  }
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
}

function normalizeRequestSize(size?: number): number {
  let req = size ?? DEFAULT_DOWNLOAD_CHUNK_SIZE;
  req -= req % MIN_ALIGN;
  if (req < MIN_ALIGN) req = MIN_ALIGN;
  if (req > DEFAULT_DOWNLOAD_CHUNK_SIZE) req = DEFAULT_DOWNLOAD_CHUNK_SIZE;
  // Telegram requires offsets to be multiples of requestSize and <= 1 MiB alignment.
  if (DEFAULT_DOWNLOAD_CHUNK_SIZE % req !== 0) {
    req = DEFAULT_DOWNLOAD_CHUNK_SIZE;
  }
  return req;
}

function slicePartToRequestedRange(
  bytes: Uint8Array,
  partOffset: number,
  rangeStart: number,
  rangeEnd?: number
): Uint8Array {
  const partEnd = partOffset + bytes.length - 1;
  const clipStart = Math.max(0, rangeStart - partOffset);
  const clipEndExclusive =
    rangeEnd !== undefined
      ? Math.min(bytes.length, Math.max(clipStart, rangeEnd - partOffset + 1))
      : bytes.length;
  if (clipStart >= bytes.length || partEnd < rangeStart) {
    return new Uint8Array(0);
  }
  if (clipStart === 0 && clipEndExclusive === bytes.length) {
    return bytes;
  }
  return bytes.subarray(clipStart, clipEndExclusive);
}

/**
 * Fetches Telegram `upload.GetFile` chunks over bounded concurrent MTProto
 * requests (`concurrency = 3` by default) and yields decrypted/raw wire buffers
 * strictly in ascending part order.
 *
 * Automatically handles `FileMigrateError` DC handoffs, `FloodWaitError`
 * concurrency step-downs (`3 -> 1`), `FILEREF_UPGRADE_NEEDED` refreshes, and
 * arbitrary unaligned byte-range sub-slicing for HTTP Range streaming.
 */
export async function* iteratePipelinedDownloadParts(
  opts: PipelinedDownloadOptions
): AsyncGenerator<Uint8Array> {
  const { client, peer, messageId, signal, waitWhilePaused } = opts;
  const requestSize = normalizeRequestSize(opts.requestSize);

  let info: { dcId?: number; location: any; size?: any };
  try {
    info = utils.getFileInfo(opts.media);
  } catch {
    info = { dcId: undefined, location: null, size: undefined };
  }

  let activeDcId = info.dcId;
  let activeLocation = info.location;
  const resolvedSize = opts.fileSize && opts.fileSize > 0
    ? opts.fileSize
    : toNum(info.size);

  const rangeStart = Math.max(0, opts.startOffset ?? 0);
  const effectiveEnd =
    opts.endOffset !== undefined && resolvedSize > 0
      ? Math.min(opts.endOffset, resolvedSize - 1)
      : opts.endOffset !== undefined
      ? opts.endOffset
      : resolvedSize > 0
      ? resolvedSize - 1
      : undefined;

  if (effectiveEnd !== undefined && effectiveEnd < rangeStart) {
    return;
  }

  // Fallback to GramJS sequential iterDownload if location/dc metadata or direct size
  // are unavailable (e.g. non-document/legacy inline inputs).
  if (!activeLocation || activeDcId === undefined || resolvedSize <= 0) {
    const startAlignedPart = Math.floor(rangeStart / requestSize);
    const iterator = client.iterDownload({
      file: opts.media,
      offset: bigInt(startAlignedPart * requestSize),
      requestSize,
      msgData: peer && messageId ? [peer, messageId] : undefined,
    });
    let offset = startAlignedPart * requestSize;
    for await (const raw of iterator) {
      if (signal?.aborted) {
        throw new DOMException("Download aborted", "AbortError");
      }
      if (waitWhilePaused && !(await waitWhilePaused())) {
        return;
      }
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      const sliced = slicePartToRequestedRange(
        bytes,
        offset,
        rangeStart,
        effectiveEnd
      );
      offset += bytes.length;
      if (sliced.length > 0) yield sliced;
      if (effectiveEnd !== undefined && offset > effectiveEnd) break;
    }
    return;
  }

  const firstPart = Math.floor(rangeStart / requestSize);
  const lastPart =
    effectiveEnd !== undefined
      ? Math.floor(effectiveEnd / requestSize)
      : Math.floor(Math.max(0, resolvedSize - 1) / requestSize);

  let activeConcurrency = Math.max(
    1,
    Math.min(opts.concurrency ?? DEFAULT_DOWNLOAD_CONCURRENCY, 4)
  );

  // Serialize DC switches & fileRef upgrades across concurrent workers.
  let refreshPromise: Promise<void> | null = null;
  const refreshFileReference = async (): Promise<boolean> => {
    if (!peer || !messageId) return false;
    if (!refreshPromise) {
      refreshPromise = (async () => {
        try {
          const msgs = await client.getMessages(peer, { ids: [messageId] });
          const refreshedMsg = Array.isArray(msgs) ? msgs[0] : null;
          if (refreshedMsg?.media) {
            const nextInfo = utils.getFileInfo(refreshedMsg.media);
            if (nextInfo.location) activeLocation = nextInfo.location;
            if (nextInfo.dcId !== undefined) activeDcId = nextInfo.dcId;
          }
        } finally {
          refreshPromise = null;
        }
      })();
    }
    await refreshPromise;
    return true;
  };

  const fetchPartWithRetries = async (partIdx: number): Promise<Uint8Array> => {
    const offset = partIdx * requestSize;
    let timedOutOnce = false;
    let refreshedRef = false;

    for (;;) {
      if (signal?.aborted) {
        throw new DOMException("Download aborted", "AbortError");
      }
      if (waitWhilePaused && !(await waitWhilePaused())) {
        throw new DOMException("Download cancelled", "AbortError");
      }

      const sender = await client.getSender(activeDcId);
      const req = new Api.upload.GetFile({
        location: activeLocation,
        offset: bigInt(offset),
        limit: requestSize,
      });

      try {
        const result = await client.invokeWithSender(req, sender);
        timedOutOnce = false;
        if (result instanceof Api.upload.FileCdnRedirect) {
          throw new Error("CDN file redirects are not supported.");
        }
        const rawBytes = result?.bytes;
        return rawBytes instanceof Uint8Array
          ? rawBytes
          : new Uint8Array(rawBytes ?? []);
      } catch (err: any) {
        if (signal?.aborted) {
          throw new DOMException("Download aborted", "AbortError");
        }
        if (err instanceof errors.FileMigrateError || typeof err?.newDc === "number") {
          const newDc = Number(err.newDc);
          if (Number.isFinite(newDc) && newDc > 0) {
            activeDcId = newDc;
            continue;
          }
        }
        const floodSecs = parseFloodWaitSeconds(err);
        if (floodSecs !== null) {
          activeConcurrency = 1;
          const waitMs = Math.min(floodSecs, FLOOD_WAIT_CAP_SECONDS) * 1000;
          await sleep(waitMs);
          continue;
        }
        if (err?.errorMessage === "FILEREF_UPGRADE_NEEDED" && !refreshedRef) {
          refreshedRef = true;
          if (await refreshFileReference()) continue;
        }
        if (err?.errorMessage === "TIMEOUT" && !timedOutOnce) {
          timedOutOnce = true;
          await sleep(500);
          continue;
        }
        throw err;
      }
    }
  };

  const inFlight = new Map<number, Promise<Uint8Array>>();
  let nextToSchedule = firstPart;
  let reachedEof = false;
  let stopScheduling = false;

  const scheduleWindow = () => {
    if (stopScheduling || reachedEof || signal?.aborted) return;
    while (
      inFlight.size < activeConcurrency &&
      nextToSchedule <= lastPart &&
      !stopScheduling &&
      !reachedEof &&
      !signal?.aborted
    ) {
      const idx = nextToSchedule++;
      inFlight.set(idx, fetchPartWithRetries(idx));
    }
  };

  try {
    for (let cursor = firstPart; cursor <= lastPart; cursor++) {
      if (signal?.aborted) {
        throw new DOMException("Download aborted", "AbortError");
      }
      if (waitWhilePaused && !(await waitWhilePaused())) {
        return;
      }
      scheduleWindow();

      let partPromise = inFlight.get(cursor);
      if (!partPromise) {
        partPromise = fetchPartWithRetries(cursor);
      }
      inFlight.delete(cursor);

      const bytes = await partPromise;
      const partOffset = cursor * requestSize;
      if (bytes.length < requestSize) {
        reachedEof = true;
      }

      const out = slicePartToRequestedRange(
        bytes,
        partOffset,
        rangeStart,
        effectiveEnd
      );
      if (out.length > 0) {
        yield out;
      }
      if (reachedEof || (effectiveEnd !== undefined && partOffset + bytes.length - 1 >= effectiveEnd)) {
        break;
      }
      // Keep the pipeline saturated as each part completes
      scheduleWindow();
    }
  } finally {
    stopScheduling = true;
    for (const pending of inFlight.values()) {
      void pending.catch(() => {});
    }
    inFlight.clear();
  }
}
