import { describe, expect, it } from "vitest";
import type { TeleFile } from "../../types";
import { createWebdavHandler, type WebdavHandlerDeps } from "../handler";
import { LockManager } from "../locks";
import { parseBridgeRequest } from "../types";

function folderEntry(name: string, folderPath: string): TeleFile {
  return {
    id: `folder-${name}`,
    name,
    size: 0,
    mime: "inode/directory",
    folderPath,
    messageId: 0,
    channelId: "chan",
    uploadedAt: 1,
  };
}

function fileEntry(name: string, folderPath: string, overrides: Partial<TeleFile> = {}): TeleFile {
  return {
    id: `file-${name}`,
    name,
    size: 10,
    mime: "text/plain",
    folderPath,
    messageId: 5,
    channelId: "chan",
    uploadedAt: 1000,
    ...overrides,
  };
}

function conflictError(transient = false): Error {
  return Object.assign(new Error("Another device changed the drive; refreshed - retry."), {
    name: "IndexConflictError",
    code: "INDEX_CONFLICT",
    transient,
  });
}

function isConflict(err: unknown): { transient: boolean; message: string } | null {
  if (
    err instanceof Error &&
    "code" in err &&
    err.code === "INDEX_CONFLICT"
  ) {
    return {
      transient: Boolean((err as { transient?: unknown }).transient),
      message: err.message,
    };
  }
  return null;
}

function makeDeps(initial: TeleFile[]) {
  const state = {
    files: [...initial],
    deleted: [] as number[],
    tombstones: [] as number[],
    downloads: [] as { start: number; end: number; target: string }[],
    uploads: [] as Array<Record<string, unknown>>,
    cloned: [] as string[],
    saveError: null as Error | null,
    saveCalls: 0,
    idCounter: 0,
    prepareError: null as Error | null,
    prepareCalls: 0,
    clearedTombstones: [] as number[],
    indexBackoffMs: 0,
    saveDeferred: null as {
      promise: Promise<void>;
      resolve: () => void;
      reject: (err: unknown) => void;
    } | null,
  };

  const deps: WebdavHandlerDeps = {
    now: () => 5000,
    newId: () => `new-${++state.idCounter}`,
    getFiles: () => state.files,
    setFiles: (files) => {
      state.files = files;
    },
    isAuthenticated: () => true,
    isIndexReady: () => true,
    isBootstrapComplete: () => true,
    getChannelId: async () => "chan",
    saveIndex: async () => {
      state.saveCalls += 1;
      if (state.saveError) throw state.saveError;
      if (state.saveDeferred) await state.saveDeferred.promise;
    },
    isDeferredError: () => false,
    uploadFile: async (args) => {
      state.uploads.push(args as unknown as Record<string, unknown>);
      return { message: { id: 99 }, hash: "hash-99" };
    },
    cloneFile: async (_channelId, existing) => {
      state.cloned.push(existing.id);
      return { message: { id: 77 } };
    },
    deleteMessages: async (_channelId, ids) => {
      state.deleted.push(...ids);
    },
    downloadRange: async (_channelId, _file, start, end, target) => {
      state.downloads.push({ start, end, target });
      return end - start + 1;
    },
    encryption: () => ({
      configured: false,
      encryptNewUploads: false,
      masterKey: null,
      saltB64: null,
    }),
    checkpoint: { load: () => null, clear: () => {} },
    mimeForName: () => "text/plain",
    prepareWrite: async () => {
      state.prepareCalls += 1;
      if (state.prepareError) throw state.prepareError;
    },
    getIndexBackoffMs: () => state.indexBackoffMs,
    metadataCommitDeadlineMs: 25,
    describeConflict: isConflict,
    validateSize: async (size) =>
      size > 1000
        ? { ok: false, message: "File exceeds Telegram limits" }
        : { ok: true },
    reconstructMissingFolders: (files) => ({ healedFiles: files }),
    recordDeletedMessages: (_channelId, ids) => {
      state.tombstones.push(...ids);
    },
    clearDeletedMessages: (_channelId, ids) => {
      state.clearedTombstones.push(...ids);
    },
    locks: new LockManager(),
    log: () => {},
  };

  return { deps, state };
}

function request(payload: Record<string, unknown>) {
  return parseBridgeRequest(payload);
}

const baseFiles = () => [
  folderEntry("Docs", "/"),
  fileEntry("a.txt", "/Docs"),
  folderEntry("Nested", "/Docs"),
  fileEntry("b.txt", "/Docs/Nested", { messageId: 6 }),
];

describe("WebDAV handler", () => {
  it("returns 503 until TeleDrive is signed in and indexed", async () => {
    const { deps } = makeDeps(baseFiles());
    deps.isAuthenticated = () => false;
    const handler = createWebdavHandler(deps);
    const response = await handler.handle(request({ id: 1, method: "PROPFIND", path: "/" }));
    expect(response.status).toBe(503);
  });

  it("serves PROPFIND depth 0 and depth 1", async () => {
    const { deps } = makeDeps(baseFiles());
    const handler = createWebdavHandler(deps);

    const root = await handler.handle(request({ id: 1, method: "PROPFIND", path: "/", depth: "0" }));
    expect(root.status).toBe(207);
    expect(root.body).toContain("<D:href>/</D:href>");
    expect(root.body).not.toContain("Docs/</D:href>");

    const depth1 = await handler.handle(
      request({ id: 2, method: "PROPFIND", path: "/", depth: "1" })
    );
    expect(depth1.status).toBe(207);
    expect(depth1.body).toContain("<D:href>/Docs/</D:href>");
    expect(depth1.body).not.toContain("a.txt");
  });

  it("returns 404 for unknown PROPFIND targets and 400 for invalid depth", async () => {
    const { deps } = makeDeps(baseFiles());
    const handler = createWebdavHandler(deps);
    expect(
      (await handler.handle(request({ id: 1, method: "PROPFIND", path: "/missing" }))).status
    ).toBe(404);
    expect(
      (await handler.handle(request({ id: 2, method: "PROPFIND", path: "/", depth: "2" }))).status
    ).toBe(400);
  });

  it("serves GET ranges through the downloader and HEAD without a download", async () => {
    const { deps, state } = makeDeps(baseFiles());
    const handler = createWebdavHandler(deps);

    const ranged = await handler.handle(
      request({
        id: 1,
        method: "GET",
        path: "/Docs/a.txt",
        range: "bytes=2-5",
        outputPath: "C:/tmp/out.bin",
      })
    );
    expect(ranged.status).toBe(206);
    expect(ranged.bodyPath).toBe("C:/tmp/out.bin");
    expect(ranged.headers?.["Content-Range"]).toBe("bytes 2-5/10");
    expect(state.downloads).toEqual([{ start: 2, end: 5, target: "C:/tmp/out.bin" }]);

    const full = await handler.handle(
      request({
        id: 4,
        method: "GET",
        path: "/Docs/a.txt",
        outputPath: "C:/tmp/full.bin",
      })
    );
    expect(full.status).toBe(200);
    expect(full.headers?.["Content-Range"]).toBeUndefined();
    expect(state.downloads).toHaveLength(2);

    const head = await handler.handle(
      request({ id: 2, method: "HEAD", path: "/Docs/a.txt" })
    );
    expect(head.status).toBe(200);
    expect(head.headers?.["Content-Length"]).toBe("10");
    expect(state.downloads).toHaveLength(2);

    const unsatisfiable = await handler.handle(
      request({ id: 3, method: "GET", path: "/Docs/a.txt", range: "bytes=99-100" })
    );
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers?.["Content-Range"]).toBe("bytes */10");
  });

  it("rejects GET on a collection", async () => {
    const { deps } = makeDeps(baseFiles());
    const handler = createWebdavHandler(deps);
    const response = await handler.handle(request({ id: 1, method: "GET", path: "/Docs" }));
    expect(response.status).toBe(405);
  });

  it("creates files with PUT and replaces existing names", async () => {
    const { deps, state } = makeDeps(baseFiles());
    const handler = createWebdavHandler(deps);

    const created = await handler.handle(
      request({
        id: 1,
        method: "PUT",
        path: "/Docs/new.txt",
        bodyPath: "C:/tmp/body.bin",
        contentLength: 12,
        contentType: "text/plain",
      })
    );
    expect(created.status).toBe(201);
    expect(state.uploads).toHaveLength(1);
    expect(state.files.some((entry) => entry.name === "new.txt" && entry.folderPath === "/Docs")).toBe(
      true
    );

    const replaced = await handler.handle(
      request({
        id: 2,
        method: "PUT",
        path: "/Docs/a.txt",
        bodyPath: "C:/tmp/body.bin",
        contentLength: 12,
      })
    );
    expect(replaced.status).toBe(204);
    expect(state.files.filter((entry) => entry.name === "a.txt")).toHaveLength(1);
    expect(state.deleted).toContain(5);
  });

  it("maps PUT conflicts and size limits to WebDAV statuses", async () => {
    const { deps } = makeDeps(baseFiles());
    const handler = createWebdavHandler(deps);

    expect(
      (
        await handler.handle(
          request({
            id: 1,
            method: "PUT",
            path: "/Missing/x.txt",
            bodyPath: "C:/tmp/body.bin",
            contentLength: 1,
          })
        )
      ).status
    ).toBe(409);
    expect(
      (
        await handler.handle(
          request({
            id: 2,
            method: "PUT",
            path: "/Docs/empty.txt",
            bodyPath: "C:/tmp/body.bin",
            contentLength: 0,
          })
        )
      ).status
    ).toBe(507);
    expect(
      (
        await handler.handle(
          request({
            id: 3,
            method: "PUT",
            path: "/Docs/big.bin",
            bodyPath: "C:/tmp/body.bin",
            contentLength: 5000,
          })
        )
      ).status
    ).toBe(507);
    expect(
      (
        await handler.handle(
          request({
            id: 4,
            method: "PUT",
            path: "/Docs",
            bodyPath: "C:/tmp/body.bin",
            contentLength: 10,
          })
        )
      ).status
    ).toBe(409);
  });

  it("deletes the uploaded message when the catalog commit fails", async () => {
    const { deps, state } = makeDeps(baseFiles());
    state.saveError = new Error("hard failure");
    const handler = createWebdavHandler(deps);
    const response = await handler.handle(
      request({
        id: 1,
        method: "PUT",
        path: "/Docs/rollback.txt",
        bodyPath: "C:/tmp/body.bin",
        contentLength: 10,
      })
    );
    expect(response.status).toBe(500);
    expect(state.deleted).toContain(99);
    expect(state.files.some((entry) => entry.name === "rollback.txt")).toBe(false);
  });

  it("refuses plaintext writes when encryption is enabled but locked", async () => {
    const { deps } = makeDeps(baseFiles());
    deps.encryption = () => ({
      configured: true,
      encryptNewUploads: true,
      masterKey: null,
      saltB64: "salt",
    });
    const handler = createWebdavHandler(deps);
    const response = await handler.handle(
      request({
        id: 1,
        method: "PUT",
        path: "/Docs/secret.txt",
        bodyPath: "C:/tmp/body.bin",
        contentLength: 10,
      })
    );
    expect(response.status).toBe(403);
  });

  it("creates and rejects MKCOL correctly", async () => {
    const { deps, state } = makeDeps(baseFiles());
    const handler = createWebdavHandler(deps);
    expect(
      (await handler.handle(request({ id: 1, method: "MKCOL", path: "/Docs/New" }))).status
    ).toBe(201);
    expect(state.files.some((entry) => entry.name === "New" && entry.folderPath === "/Docs")).toBe(
      true
    );
    expect(
      (await handler.handle(request({ id: 2, method: "MKCOL", path: "/Docs" }))).status
    ).toBe(405);
    expect(
      (await handler.handle(request({ id: 3, method: "MKCOL", path: "/Nope/Child" }))).status
    ).toBe(409);
  });

  it("deletes collections recursively with tombstones", async () => {
    const { deps, state } = makeDeps(baseFiles());
    const handler = createWebdavHandler(deps);
    const response = await handler.handle(request({ id: 1, method: "DELETE", path: "/Docs" }));
    expect(response.status).toBe(204);
    expect(state.files.map((entry) => entry.name).sort()).toEqual([]);
    expect(state.tombstones.sort()).toEqual([5, 6]);
    expect(state.deleted.sort()).toEqual([5, 6]);
    expect(
      (await handler.handle(request({ id: 2, method: "DELETE", path: "/" }))).status
    ).toBe(403);
    expect(
      (await handler.handle(request({ id: 3, method: "DELETE", path: "/missing" }))).status
    ).toBe(404);
  });

  it("moves resources and honours Overwrite: F", async () => {
    const { deps, state } = makeDeps([
      ...baseFiles(),
      fileEntry("occupied.txt", "/Docs"),
    ]);
    const handler = createWebdavHandler(deps);
    const moved = await handler.handle(
      request({ id: 1, method: "MOVE", path: "/Docs/a.txt", destination: "/Docs/renamed.txt" })
    );
    expect(moved.status).toBe(201);
    expect(state.files.some((entry) => entry.name === "renamed.txt")).toBe(true);
    expect(state.files.some((entry) => entry.name === "a.txt")).toBe(false);

    const blocked = await handler.handle(
      request({
        id: 2,
        method: "MOVE",
        path: "/Docs/renamed.txt",
        destination: "/Docs/occupied.txt",
        overwrite: "F",
      })
    );
    expect(blocked.status).toBe(412);
  });

  it("copies files with clone semantics", async () => {
    const { deps, state } = makeDeps(baseFiles());
    const handler = createWebdavHandler(deps);
    const response = await handler.handle(
      request({ id: 1, method: "COPY", path: "/Docs/a.txt", destination: "/Docs/copy.txt" })
    );
    expect(response.status).toBe(201);
    expect(state.cloned).toEqual(["file-a.txt"]);
    const copied = state.files.find((entry) => entry.name === "copy.txt");
    expect(copied?.messageId).toBe(77);
  });

  it("enforces LOCK/UNLOCK around writes", async () => {
    const { deps, state } = makeDeps(baseFiles());
    const handler = createWebdavHandler(deps);
    const locked = await handler.handle(
      request({ id: 1, method: "LOCK", path: "/Docs/a.txt", timeout: "Second-120" })
    );
    expect(locked.status).toBe(200);
    const token = locked.headers?.["Lock-Token"];
    expect(token?.startsWith("<opaquelocktoken:")).toBe(true);

    const blocked = await handler.handle(
      request({
        id: 2,
        method: "PUT",
        path: "/Docs/a.txt",
        bodyPath: "C:/tmp/body.bin",
        contentLength: 10,
      })
    );
    expect(blocked.status).toBe(423);

    const allowed = await handler.handle(
      request({
        id: 3,
        method: "PUT",
        path: "/Docs/a.txt",
        bodyPath: "C:/tmp/body.bin",
        contentLength: 10,
        ifHeader: `(${token})`,
      })
    );
    expect(allowed.status).toBe(204);
    expect(state.uploads).toHaveLength(1);

    const wrongUnlock = await handler.handle(
      request({ id: 4, method: "UNLOCK", path: "/Docs/a.txt", lockToken: "<opaquelocktoken:nope>" })
    );
    expect(wrongUnlock.status).toBe(409);

    const unlocked = await handler.handle(
      request({ id: 5, method: "UNLOCK", path: "/Docs/a.txt", lockToken: token })
    );
    expect(unlocked.status).toBe(204);
  });


  it("fails a stale PUT before uploading any bytes", async () => {
    const { deps, state } = makeDeps(baseFiles());
    state.prepareError = conflictError(false);
    const handler = createWebdavHandler(deps);
    const response = await handler.handle(
      request({
        id: 1,
        method: "PUT",
        path: "/Docs/stale.txt",
        bodyPath: "C:/tmp/body.bin",
        contentLength: 10,
      })
    );
    expect(response.status).toBe(409);
    expect(state.uploads).toHaveLength(0);
    expect(state.deleted).toHaveLength(0);
    expect(state.prepareCalls).toBe(1);
  });

  it("maps a transient pre-check failure to 503 with Retry-After", async () => {
    const { deps, state } = makeDeps(baseFiles());
    state.prepareError = conflictError(true);
    const handler = createWebdavHandler(deps);
    const response = await handler.handle(
      request({
        id: 1,
        method: "PUT",
        path: "/Docs/retry.txt",
        bodyPath: "C:/tmp/body.bin",
        contentLength: 10,
      })
    );
    expect(response.status).toBe(503);
    expect(response.headers?.["Retry-After"]).toBe("2");
    expect(state.uploads).toHaveLength(0);
  });

  it("cleans up uploaded messages on an unresolved commit conflict, then retries", async () => {
    const { deps, state } = makeDeps(baseFiles());
    state.saveError = conflictError(false);
    const handler = createWebdavHandler(deps);

    const conflicted = await handler.handle(
      request({
        id: 1,
        method: "PUT",
        path: "/Docs/contended.txt",
        bodyPath: "C:/tmp/body.bin",
        contentLength: 10,
      })
    );
    expect(conflicted.status).toBe(409);
    expect(state.uploads).toHaveLength(1);
    expect(state.deleted).toContain(99);
    expect(state.files.some((entry) => entry.name === "contended.txt")).toBe(false);

    state.saveError = null;
    const retried = await handler.handle(
      request({
        id: 2,
        method: "PUT",
        path: "/Docs/contended.txt",
        bodyPath: "C:/tmp/body.bin",
        contentLength: 10,
      })
    );
    expect(retried.status).toBe(201);
    expect(state.files.some((entry) => entry.name === "contended.txt")).toBe(true);
  });

  it("routes MKCOL and DELETE through the conflict guard", async () => {
    const { deps, state } = makeDeps(baseFiles());
    state.saveError = conflictError(false);
    const handler = createWebdavHandler(deps);

    const mkcol = await handler.handle(
      request({ id: 1, method: "MKCOL", path: "/Docs/ConflictFolder" })
    );
    expect(mkcol.status).toBe(409);
    expect(state.files.some((entry) => entry.name === "ConflictFolder")).toBe(false);

    const removed = await handler.handle(
      request({ id: 2, method: "DELETE", path: "/Docs/a.txt" })
    );
    expect(removed.status).toBe(409);
    expect(state.files.some((entry) => entry.name === "a.txt")).toBe(true);
    expect(state.tombstones).toContain(5);
    expect(state.clearedTombstones).toContain(5);
  });

  it("rejects metadata mutations while the index queue is backing off", async () => {
    const { deps, state } = makeDeps(baseFiles());
    state.indexBackoffMs = 60_000;
    const handler = createWebdavHandler(deps);

    const put = await handler.handle(
      request({
        id: 1,
        method: "PUT",
        path: "/Docs/backoff.txt",
        bodyPath: "C:/tmp/body.bin",
        contentLength: 10,
      })
    );
    expect(put.status).toBe(503);
    expect(put.headers?.["Retry-After"]).toBe("60");
    expect(state.uploads).toHaveLength(0);
    expect(state.saveCalls).toBe(0);

    const mkcol = await handler.handle(
      request({ id: 2, method: "MKCOL", path: "/Docs/Backoff" })
    );
    expect(mkcol.status).toBe(503);
    expect(mkcol.headers?.["Retry-After"]).toBe("60");
    expect(state.files.some((entry) => entry.name === "Backoff")).toBe(false);
  });

  it("returns 503 when a catalog commit exceeds the deadline and cleans up later", async () => {
    const { deps, state } = makeDeps(baseFiles());
    let resolveSave!: () => void;
    let rejectSave!: (err: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveSave = resolve;
      rejectSave = reject;
    });
    state.saveDeferred = { promise, resolve: resolveSave, reject: rejectSave };
    const handler = createWebdavHandler(deps);

    const response = await handler.handle(
      request({
        id: 1,
        method: "PUT",
        path: "/Docs/pending.txt",
        bodyPath: "C:/tmp/body.bin",
        contentLength: 10,
      })
    );
    expect(response.status).toBe(503);
    expect(response.headers?.["Retry-After"]).toBe("3");
    expect(state.uploads).toHaveLength(1);
    expect(state.deleted).not.toContain(99);

    rejectSave(new Error("late hard failure"));
    await promise.catch(() => {});
    await Promise.resolve();
    await Promise.resolve();
    expect(state.deleted).toContain(99);
  });

  it("commits 8 parallel PUTs and 8 MKCOLs exactly once", async () => {
    const { deps, state } = makeDeps(baseFiles());
    const handler = createWebdavHandler(deps);

    const puts = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        handler.handle(
          request({
            id: 100 + index,
            method: "PUT",
            path: `/Docs/parallel-${index}.bin`,
            bodyPath: "C:/tmp/body.bin",
            contentLength: 10,
          })
        )
      )
    );
    expect(puts.every((response) => response.status === 201)).toBe(true);
    expect(state.uploads).toHaveLength(8);

    const mkcols = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        handler.handle(
          request({ id: 200 + index, method: "MKCOL", path: `/Docs/Coll-${index}` })
        )
      )
    );
    expect(mkcols.every((response) => response.status === 201)).toBe(true);

    for (let index = 0; index < 8; index++) {
      expect(
        state.files.filter((entry) => entry.name === `parallel-${index}.bin`)
      ).toHaveLength(1);
      expect(
        state.files.filter(
          (entry) => entry.name === `Coll-${index}` && entry.mime === "inode/directory"
        )
      ).toHaveLength(1);
    }
  });
  it("answers PROPPATCH with 207 containing a 403 propstat", async () => {
    const { deps } = makeDeps(baseFiles());
    const handler = createWebdavHandler(deps);
    const response = await handler.handle(
      request({ id: 1, method: "PROPPATCH", path: "/Docs/a.txt" })
    );
    expect(response.status).toBe(207);
    expect(response.body).toContain("HTTP/1.1 403 Forbidden");
  });
});
