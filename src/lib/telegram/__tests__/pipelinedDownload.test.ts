import { describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import { errors } from "telegram";
import bigInt from "big-integer";
import { iteratePipelinedDownloadParts } from "../pipelinedDownload";

function makeFakeDocMedia(size: number, dcId = 2): Api.MessageMediaDocument {
  return new Api.MessageMediaDocument({
    document: new Api.Document({
      id: bigInt(987654),
      accessHash: bigInt(111222),
      fileReference: Buffer.from([1, 2, 3, 4]),
      date: 1700000000,
      mimeType: "application/octet-stream",
      size: bigInt(size),
      dcId,
      attributes: [],
    }),
  });
}

describe("iteratePipelinedDownloadParts", () => {
  it("pipelines up to 3 concurrent GetFile requests and emits bytes strictly in order", async () => {
    const partSize = 512 * 1024;
    const totalSize = partSize * 3 + 100_000;
    const payload = new Uint8Array(totalSize);
    for (let i = 0; i < totalSize; i += 997) {
      payload[i] = (i * 13) & 0xff;
    }

    let inFlight = 0;
    let maxInFlight = 0;
    const delaysByPart = new Map<number, number>([
      [0, 45], // part 0 finishes slower than parts 1 & 2!
      [1, 15],
      [2, 5],
      [3, 5],
    ]);

    const client = {
      getSender: vi.fn(async (dcId: number) => ({ dcId })),
      invokeWithSender: vi.fn(async (req: Api.upload.GetFile) => {
        const offset = Number(req.offset.toString());
        const limit = Number(req.limit);
        const partIdx = Math.floor(offset / partSize);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, delaysByPart.get(partIdx) ?? 1));
        inFlight--;
        const end = Math.min(offset + limit, totalSize);
        return new Api.upload.File({
          type: new Api.storage.FileUnknown(),
          mtime: 1700000000,
          bytes: Buffer.from(payload.subarray(offset, end)),
        });
      }),
    };

    const collected: Uint8Array[] = [];
    for await (const chunk of iteratePipelinedDownloadParts({
      client,
      media: makeFakeDocMedia(totalSize),
      fileSize: totalSize,
      concurrency: 3,
      requestSize: partSize,
    })) {
      collected.push(chunk);
    }

    expect(maxInFlight).toBe(3);
    const out = Buffer.concat(collected);
    expect(out.length).toBe(totalSize);
    expect(new Uint8Array(out)).toEqual(payload);
  });

  it("switches DC on FileMigrateError and preserves exact byte-range slices across part boundaries", async () => {
    const partSize = 512 * 1024;
    const totalSize = partSize * 2 + 50_000;
    const payload = new Uint8Array(totalSize);
    for (let i = 0; i < totalSize; i++) {
      payload[i] = i & 0xff;
    }

    let migrated = false;
    const dcsSeen: number[] = [];
    const client = {
      getSender: vi.fn(async (dcId: number) => ({ dcId })),
      invokeWithSender: vi.fn(async (req: Api.upload.GetFile, sender: { dcId: number }) => {
        dcsSeen.push(sender.dcId);
        if (!migrated && sender.dcId === 2) {
          migrated = true;
          throw new errors.FileMigrateError({ capture: 4 });
        }
        const offset = Number(req.offset.toString());
        const limit = Number(req.limit);
        const end = Math.min(offset + limit, totalSize);
        return new Api.upload.File({
          type: new Api.storage.FileUnknown(),
          mtime: 1700000000,
          bytes: Buffer.from(payload.subarray(offset, end)),
        });
      }),
    };

    // Range spanning end of part 0 into middle of part 1
    const startOffset = partSize - 1024;
    const endOffset = partSize + 2047;
    const chunks: Uint8Array[] = [];
    for await (const c of iteratePipelinedDownloadParts({
      client,
      media: makeFakeDocMedia(totalSize, 2),
      fileSize: totalSize,
      startOffset,
      endOffset,
      concurrency: 2,
      requestSize: partSize,
    })) {
      chunks.push(c);
    }

    const out = new Uint8Array(Buffer.concat(chunks));
    expect(out.length).toBe(endOffset - startOffset + 1);
    expect(out).toEqual(payload.subarray(startOffset, endOffset + 1));
    expect(dcsSeen).toContain(4);
  });

  it("drops concurrency to 1 after FLOOD_WAIT and stops scheduling on early abort", async () => {
    const partSize = 512 * 1024;
    const totalSize = partSize * 8;
    let calls = 0;
    let sawFlood = false;
    let maxInFlightAfterFlood = 0;
    let inFlightLaterParts = 0;

    const ac = new AbortController();

    const client = {
      getSender: vi.fn(async (dcId: number) => ({ dcId })),
      invokeWithSender: vi.fn(async (req: Api.upload.GetFile) => {
        calls++;
        const offset = Number(req.offset.toString());
        const partIdx = Math.floor(offset / partSize);
        if (calls === 1 && !sawFlood) {
          sawFlood = true;
          throw new errors.FloodWaitError({ capture: 0 });
        }
        if (partIdx >= 3) {
          inFlightLaterParts++;
          maxInFlightAfterFlood = Math.max(maxInFlightAfterFlood, inFlightLaterParts);
        }
        await new Promise((r) => setTimeout(r, 8));
        if (partIdx >= 3) {
          inFlightLaterParts--;
        }
        return new Api.upload.File({
          type: new Api.storage.FileUnknown(),
          mtime: 1700000000,
          bytes: Buffer.alloc(partSize, 7),
        });
      }),
    };

    const got: Uint8Array[] = [];
    for await (const chunk of iteratePipelinedDownloadParts({
      client,
      media: makeFakeDocMedia(totalSize),
      fileSize: totalSize,
      concurrency: 3,
      requestSize: partSize,
      signal: ac.signal,
    })) {
      got.push(chunk);
      if (got.length === 5) {
        ac.abort();
        break;
      }
    }

    expect(got).toHaveLength(5);
    expect(calls).toBeLessThan(8);
    expect(maxInFlightAfterFlood).toBe(1);
  });
});
