import type { TeleFile, TeleFileEncryption, TeleFileSegment } from "../types";
import {
  childNodesOf,
  folderExists,
  fullPathOf,
  isFolderEntry,
  nodeForPath,
  rebaseFolderPath,
  subtreeEntries,
  visibleDriveEntries,
  type TreeNode,
} from "./catalog";
import { collectWriteTokens, type LockManager } from "./locks";
import {
  buildLockDiscoveryXml,
  buildPropfindXml,
  buildProppatchForbiddenXml,
  type PropfindEntry,
} from "./propfind";
import {
  WebdavError,
  basename,
  dirname,
  encodeHref,
  etagForFile,
  formatHttpDate,
  isWithinPath,
  normalizeVirtualPath,
  parseRangeHeader,
  parseTimeoutHeader,
} from "./protocol";
import type { WebdavBridgeRequest, WebdavBridgeResponse } from "./types";

const MAX_PROPFIND_ENTRIES = 10_000;
const MAX_COPY_FILES = 500;
export const DEFAULT_METADATA_COMMIT_DEADLINE_MS = 15_000;
const COMMIT_DEADLINE = Symbol("webdav-commit-deadline");

export interface WebdavUploadResult {
  message: { id?: number | string };
  hash?: string | null;
  segments?: TeleFileSegment[];
  enc?: TeleFileEncryption;
}

export interface WebdavEncryptionState {
  configured: boolean;
  encryptNewUploads: boolean;
  masterKey: CryptoKey | null;
  saltB64: string | null;
}

/** Everything the protocol handler needs from the app, injected for tests. */
export interface WebdavHandlerDeps {
  now(): number;
  newId(): string;
  getFiles(): TeleFile[];
  setFiles(files: TeleFile[]): void;
  isAuthenticated(): boolean;
  isIndexReady(): boolean;
  isBootstrapComplete(): boolean;
  getChannelId(): Promise<string | null>;
  saveIndex(channelId: string, files: TeleFile[]): Promise<void>;
  isDeferredError(err: unknown): boolean;
  uploadFile(args: {
    channelId: string;
    name: string;
    size: number;
    sourcePath: string;
    folderPath: string;
    encryptionKey: CryptoKey | null;
    encryptionSaltB64: string | null;
    anonymizedFileName?: string;
    checkpointKey: string;
  }): Promise<WebdavUploadResult>;
  cloneFile(
    channelId: string,
    existing: TeleFile,
    destinationFolder: string,
    fileName: string
  ): Promise<{ message: { id?: number | string }; segments?: TeleFileSegment[] }>;
  deleteMessages(channelId: string, ids: number[]): Promise<void>;
  downloadRange(
    channelId: string,
    file: TeleFile,
    start: number,
    end: number,
    targetPath: string,
    encryptionKey: CryptoKey | null
  ): Promise<number>;
  encryption(): WebdavEncryptionState;
  checkpoint: {
    load(key: string): { completedSegments?: TeleFileSegment[] } | null;
    clear(key: string): void;
  };
  mimeForName(name: string): string;
  validateSize(size: number): Promise<{ ok: boolean; message?: string }>;
  /** Milliseconds until the channel index queue leaves its backoff (0 = ready). */
  getIndexBackoffMs(channelId: string): number;
  /** Server-side catalog commit deadline; shorter in tests. */
  metadataCommitDeadlineMs: number;
  /**
   * Verifies the live index revision before a PUT transfers bytes and
   * refreshes the catalog when another device committed first. Throws
   * IndexConflictError (via the app's queue) when that is unsafe.
   */
  prepareWrite(channelId: string): Promise<void>;
  /** Classifies an IndexConflictError without importing the queue here. */
  describeConflict(
    err: unknown
  ): { transient: boolean; message: string } | null;
  reconstructMissingFolders(
    files: TeleFile[],
    channelId: string
  ): { healedFiles: TeleFile[] };
  recordDeletedMessages(channelId: string, ids: number[]): void;
  clearDeletedMessages(channelId: string, ids: number[]): void;
  locks: LockManager;
  log(message: string): void;
}

function messageIds(entries: TeleFile[]): number[] {
  const ids = new Set<number>();
  for (const entry of entries) {
    const primary = Number(entry.messageId);
    if (Number.isFinite(primary) && primary > 0) ids.add(primary);
    for (const segment of entry.segments ?? []) {
      const id = Number(segment?.messageId);
      if (Number.isFinite(id) && id > 0) ids.add(id);
    }
  }
  return Array.from(ids);
}

function toPropfindEntry(node: TreeNode): PropfindEntry {
  return {
    href: encodeHref(node.path, node.isFolder),
    name: node.name,
    isFolder: node.isFolder,
    file: node.file,
  };
}

function parseDepth(raw: string | undefined): "0" | "1" | "infinity" {
  if (raw === undefined || raw.trim() === "") return "1";
  const value = raw.trim().toLowerCase();
  if (value === "0" || value === "1" || value === "infinity") return value;
  throw new WebdavError(400, "Invalid Depth header");
}

function xmlResponse(
  xml: string,
  status = 207,
  extraHeaders: Record<string, string> = {}
): WebdavBridgeResponse {
  return {
    status,
    headers: { "Content-Type": "application/xml; charset=utf-8", ...extraHeaders },
    body: xml,
  };
}

function textResponse(
  status: number,
  message: string,
  extraHeaders: Record<string, string> = {}
): WebdavBridgeResponse {
  return {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...extraHeaders },
    body: message,
  };
}

function errorToResponse(
  err: unknown,
  log: (message: string) => void,
  describeConflict: (err: unknown) => { transient: boolean; message: string } | null
): WebdavBridgeResponse {
  if (err instanceof WebdavError) {
    return textResponse(
      err.status,
      err.message,
      err.retryAfterSeconds
        ? { "Retry-After": String(err.retryAfterSeconds) }
        : {}
    );
  }
  if (err instanceof Error && err.name === "IndexNotReadyError") {
    return {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "2" },
      body: "Drive index is still loading; retry shortly",
    };
  }
  const conflict = describeConflict(err);
  if (conflict) {
    if (conflict.transient) {
      return {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Retry-After": "2",
        },
        body: conflict.message,
      };
    }
    return textResponse(409, conflict.message);
  }
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && "code" in err) {
    const code = err.code;
    if (code === "locked") {
      return textResponse(403, "Encryption is enabled and the vault is locked");
    }
    if (code === "invalid_passphrase") {
      return textResponse(403, "Encryption key mismatch");
    }
  }
  const upper = message.toUpperCase();
  if (
    upper.includes("TOO_LARGE") ||
    upper.includes("FILE_TOO_BIG") ||
    upper.includes("EXCEEDS")
  ) {
    return textResponse(507, "Telegram file-size limit exceeded");
  }
  if (upper.includes("FLOOD_WAIT")) {
    return textResponse(503, "Telegram rate limit; retry later");
  }
  log(`unhandled error: ${message}`);
  return textResponse(500, "Internal WebDAV bridge error");
}

export interface WebdavHandler {
  handle(request: WebdavBridgeRequest): Promise<WebdavBridgeResponse>;
}

export function createWebdavHandler(deps: WebdavHandlerDeps): WebdavHandler {
  let catalogChain: Promise<unknown> = Promise.resolve();

  const withCatalogLock = <T>(task: () => Promise<T>): Promise<T> => {
    const run = catalogChain.then(task, task);
    catalogChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  const requireChannel = async (): Promise<string> => {
    if (!deps.isAuthenticated()) {
      throw new WebdavError(503, "TeleDrive is not signed in");
    }
    if (!deps.isIndexReady() || !deps.isBootstrapComplete()) {
      throw new WebdavError(503, "Drive index is still loading; retry shortly");
    }
    const channelId = await deps.getChannelId();
    if (!channelId) throw new WebdavError(503, "Telegram storage channel is unavailable");
    return channelId;
  };

  const assertIndexWritable = (channelId: string) => {
    const backoffMs = deps.getIndexBackoffMs(channelId);
    if (backoffMs > 0) {
      throw new WebdavError(
        503,
        "Catalog is temporarily rate-limited; retry shortly",
        { retryAfterSeconds: Math.max(1, Math.ceil(backoffMs / 1000)) }
      );
    }
  };

  const scheduleCommitCleanup = (
    err: unknown,
    onCommitted: () => Promise<void>,
    onFailed: () => Promise<void>
  ): boolean => {
    if (!(err instanceof WebdavError) || !err.commitOutcome) return false;
    void err.commitOutcome
      .then((committed) => (committed ? onCommitted() : onFailed()))
      .catch(() => {});
    return true;
  };

  const assertWriteAllowed = (
    path: string,
    request: WebdavBridgeRequest,
    extraPaths: string[] = []
  ) => {
    const tokens = collectWriteTokens(request.ifHeader, request.lockToken);
    for (const candidate of [path, ...extraPaths]) {
      if (!deps.locks.canWrite(candidate, tokens)) {
        throw new WebdavError(423, "Resource is locked");
      }
    }
  };

  /** Applies a catalog mutation atomically and rolls back on hard failures. */
  const commitFiles = async (
    channelId: string,
    build: (current: TeleFile[]) => TeleFile[]
  ): Promise<TeleFile[]> => {
    return withCatalogLock(async () => {
      // Fail before mutating the store when Telegram has already asked us to
      // wait; a 503+Retry-After is better than a 60 s hang.
      assertIndexWritable(channelId);
      const previous = deps.getFiles();
      const next = build(previous);
      deps.setFiles(next);
      // `setFiles` normalizes into a new array; capture the applied reference
      // so a concurrent action can never be rolled back by this request.
      const applied = deps.getFiles();
      const commitPromise = deps.saveIndex(channelId, next);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<typeof COMMIT_DEADLINE>((resolve) => {
        timer = setTimeout(
          () => resolve(COMMIT_DEADLINE),
          Math.max(1, deps.metadataCommitDeadlineMs)
        );
      });
      try {
        const result = await Promise.race([
          commitPromise.then(() => "committed" as const),
          deadline,
        ]);
        if (result === COMMIT_DEADLINE) {
          // The queue still owns the write. Keep the optimistic state and let
          // the route schedule cleanup based on the eventual outcome.
          commitPromise.catch(() => {});
          const outcome = commitPromise.then(
            () => true,
            () => false
          );
          throw new WebdavError(
            503,
            "Catalog commit is still pending; retry shortly",
            { retryAfterSeconds: 3, commitOutcome: outcome }
          );
        }
      } catch (err) {
        if (err instanceof WebdavError && err.commitOutcome) throw err;
        // Transient index failures keep the optimistic state and retry in the
        // IndexQueue; only hard errors roll the catalog back.
        if (!deps.isDeferredError(err)) {
          if (deps.getFiles() === applied) deps.setFiles(previous);
          throw err;
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
      return next;
    });
  };

  const handlePropfind = async (request: WebdavBridgeRequest): Promise<WebdavBridgeResponse> => {
    await requireChannel();
    const files = deps.getFiles();
    const node = nodeForPath(files, request.path);
    if (!node) throw new WebdavError(404, "Not found");
    const depth = parseDepth(request.depth);

    const nodes: TreeNode[] = [node];
    if (node.isFolder && depth !== "0") {
      nodes.push(...childNodesOf(files, node.path));
      if (nodes.length > MAX_PROPFIND_ENTRIES) {
        throw new WebdavError(507, "PROPFIND result is too large");
      }
      if (depth === "infinity") {
        const queue = [...nodes.slice(1)];
        while (queue.length > 0) {
          const current = queue.shift()!;
          if (!current.isFolder) continue;
          const children = childNodesOf(files, current.path);
          for (const child of children) {
            if (nodes.length >= MAX_PROPFIND_ENTRIES) {
              throw new WebdavError(507, "PROPFIND result is too large; request a smaller depth");
            }
            nodes.push(child);
            if (child.isFolder) queue.push(child);
          }
        }
      }
    }

    if (nodes.length > MAX_PROPFIND_ENTRIES) {
      throw new WebdavError(507, "PROPFIND result is too large");
    }
    return xmlResponse(buildPropfindXml(nodes.map(toPropfindEntry)));
  };

  const handleGetOrHead = async (
    request: WebdavBridgeRequest
  ): Promise<WebdavBridgeResponse> => {
    const channelId = await requireChannel();
    const node = nodeForPath(deps.getFiles(), request.path);
    if (!node) throw new WebdavError(404, "Not found");
    if (node.isFolder || !node.file) {
      return {
        status: 405,
        headers: { Allow: "PROPFIND, DELETE, MOVE, COPY, LOCK, UNLOCK" },
      };
    }
    const file = node.file;
    const size = Number.isFinite(file.size) ? file.size : 0;
    const parsed = parseRangeHeader(request.range, size);

    const commonHeaders: Record<string, string> = {
      "Content-Type": file.mime || "application/octet-stream",
      ETag: etagForFile(file),
      "Last-Modified": formatHttpDate(file.uploadedAt),
      "Accept-Ranges": "bytes",
    };

    if (parsed === "unsatisfiable") {
      return {
        status: 416,
        headers: { ...commonHeaders, "Content-Range": `bytes */${size}` },
      };
    }

    let start = 0;
    let end = Math.max(0, size - 1);
    let status = 200;
    if (parsed) {
      start = parsed.start;
      end = parsed.end;
      status = 206;
      commonHeaders["Content-Range"] = `bytes ${start}-${end}/${size}`;
    }
    const length = size === 0 ? 0 : end - start + 1;

    if (request.method === "HEAD" || size === 0) {
      return {
        status,
        headers: { ...commonHeaders, "Content-Length": String(length) },
      };
    }

    if (!request.outputPath) {
      throw new WebdavError(500, "Bridge did not provide an output path");
    }

    const encryption = deps.encryption();
    await deps.downloadRange(
      channelId,
      file,
      start,
      end,
      request.outputPath,
      encryption.masterKey
    );
    return {
      status,
      headers: commonHeaders,
      bodyPath: request.outputPath,
    };
  };

  const handlePut = async (request: WebdavBridgeRequest): Promise<WebdavBridgeResponse> => {
    const channelId = await requireChannel();
    const target = normalizeVirtualPath(request.path);
    if (target === "/") throw new WebdavError(405, "Cannot PUT the drive root");
    if (!request.bodyPath) throw new WebdavError(400, "Missing PUT body");
    assertIndexWritable(channelId);
    // Fail stale writes before uploading bytes. This also refreshes the
    // catalog when another device committed since our last poll.
    await deps.prepareWrite(channelId);
    assertIndexWritable(channelId);
    const files = deps.getFiles();
    const parent = dirname(target);
    const name = basename(target);
    if (!folderExists(files, parent)) {
      throw new WebdavError(409, "Parent collection does not exist");
    }
    const existingNode = nodeForPath(files, target);
    if (existingNode?.isFolder) {
      throw new WebdavError(409, "Cannot overwrite a collection with a file");
    }
    assertWriteAllowed(target, request);

    const size = request.contentLength ?? 0;
    if (size <= 0) {
      throw new WebdavError(507, "Telegram cannot store empty files");
    }
    const sizeCheck = await deps.validateSize(size);
    if (!sizeCheck.ok) {
      throw new WebdavError(507, sizeCheck.message ?? "File exceeds Telegram limits");
    }

    const encryption = deps.encryption();
    const shouldEncrypt = encryption.configured && encryption.encryptNewUploads;
    if (shouldEncrypt && !encryption.masterKey) {
      throw new WebdavError(403, "Encryption is enabled but the vault is locked");
    }

    const id = deps.newId();
    const checkpointKey = `webdav-${id}`;
    let uploaded: WebdavUploadResult;
    try {
      uploaded = await deps.uploadFile({
        channelId,
        name,
        size,
        sourcePath: request.bodyPath,
        folderPath: parent,
        encryptionKey: shouldEncrypt ? encryption.masterKey : null,
        encryptionSaltB64: shouldEncrypt ? encryption.saltB64 : null,
        anonymizedFileName: shouldEncrypt ? `${id}.tde` : undefined,
        checkpointKey,
      });
    } catch (err) {
      // A failed multi-segment upload may already have committed earlier
      // segments; remove them so failed PUTs leave no orphaned messages.
      const checkpoint = deps.checkpoint.load(checkpointKey);
      const partial = (checkpoint?.completedSegments ?? [])
        .map((segment) => Number(segment.messageId))
        .filter((value) => Number.isFinite(value) && value > 0);
      deps.checkpoint.clear(checkpointKey);
      if (partial.length > 0) {
        await deps.deleteMessages(channelId, partial).catch(() => {});
      }
      throw err;
    }
    deps.checkpoint.clear(checkpointKey);

    const messageId = Number(uploaded.message?.id ?? 0);
    if (!messageId) {
      throw new WebdavError(502, "Telegram did not return a message id");
    }

    const newFile: TeleFile = {
      id,
      name,
      size,
      mime: deps.mimeForName(name),
      folderPath: parent,
      messageId,
      channelId,
      uploadedAt: deps.now(),
      starred: false,
      trashed: false,
      ...(uploaded.hash ? { hash: uploaded.hash } : {}),
      ...(uploaded.segments && uploaded.segments.length > 1
        ? { segments: uploaded.segments }
        : {}),
      ...(uploaded.enc ? { enc: uploaded.enc } : {}),
    };

    let replaced: TeleFile[] = [];
    try {
      await commitFiles(channelId, (current) => {
        const currentNode = nodeForPath(current, target);
        if (currentNode?.isFolder) {
          throw new WebdavError(409, "Cannot overwrite a collection with a file");
        }
        replaced = visibleDriveEntries(current).filter(
          (entry) => !isFolderEntry(entry) && fullPathOf(entry) === target
        );
        const removedIds = new Set(replaced.map((entry) => entry.id));
        const base = current.filter((entry) => !removedIds.has(entry.id));
        return deps.reconstructMissingFolders([...base, newFile], channelId).healedFiles;
      });
    } catch (err) {
      // Bytes are on Telegram but the catalog rejected them: delete them so a
      // failed PUT does not leave an orphaned document behind. A commit that
      // is still queued after the deadline must not be deleted here; clean up
      // according to its eventual outcome instead.
      const deferred = scheduleCommitCleanup(
        err,
        () => deps.deleteMessages(channelId, messageIds(replaced)),
        () => deps.deleteMessages(channelId, messageIds([newFile]))
      );
      if (!deferred) {
        await deps.deleteMessages(channelId, messageIds([newFile])).catch(() => {});
      }
      throw err;
    }

    if (replaced.length > 0) {
      await deps.deleteMessages(channelId, messageIds(replaced)).catch(() => {});
    }

    return {
      status: replaced.length > 0 ? 204 : 201,
      headers: { ETag: etagForFile(newFile) },
    };
  };

  const handleMkcol = async (request: WebdavBridgeRequest): Promise<WebdavBridgeResponse> => {
    const channelId = await requireChannel();
    assertIndexWritable(channelId);
    const target = normalizeVirtualPath(request.path);
    if (target === "/") throw new WebdavError(405, "Drive root already exists");
    const parent = dirname(target);
    const name = basename(target);
    if (!folderExists(deps.getFiles(), parent)) {
      throw new WebdavError(409, "Parent collection does not exist");
    }
    assertWriteAllowed(target, request);

    await commitFiles(channelId, (current) => {
      if (nodeForPath(current, target)) {
        throw new WebdavError(405, "Resource already exists");
      }
      const folder: TeleFile = {
        id: deps.newId(),
        name,
        size: 0,
        mime: "inode/directory",
        folderPath: parent,
        messageId: 0,
        channelId,
        uploadedAt: deps.now(),
        starred: false,
        trashed: false,
        archived: false,
      };
      return deps.reconstructMissingFolders([...current, folder], channelId).healedFiles;
    });
    return { status: 201 };
  };

  const handleDelete = async (request: WebdavBridgeRequest): Promise<WebdavBridgeResponse> => {
    const channelId = await requireChannel();
    assertIndexWritable(channelId);
    const target = normalizeVirtualPath(request.path);
    if (target === "/") throw new WebdavError(403, "Cannot delete the drive root");
    const files = deps.getFiles();
    const node = nodeForPath(files, target);
    if (!node) throw new WebdavError(404, "Not found");

    const targets = subtreeEntries(files, target);
    const targetPaths = new Set(targets.map((entry) => fullPathOf(entry)));
    assertWriteAllowed(target, request, Array.from(targetPaths));
    const ids = messageIds(targets);
    deps.recordDeletedMessages(channelId, ids);

    const removedIds = new Set(targets.map((entry) => entry.id));
    try {
      await commitFiles(channelId, (current) =>
        current.filter((entry) => !removedIds.has(entry.id))
      );
    } catch (err) {
      const deferred = scheduleCommitCleanup(
        err,
        () => deps.deleteMessages(channelId, ids),
        async () => deps.clearDeletedMessages(channelId, ids)
      );
      if (!deferred) deps.clearDeletedMessages(channelId, ids);
      throw err;
    }

    if (ids.length > 0) {
      await deps.deleteMessages(channelId, ids).catch((err) => {
        deps.log(`telegram delete failed for ${ids.length} message(s): ${String(err)}`);
      });
    }
    return { status: 204 };
  };

  const handleMove = async (request: WebdavBridgeRequest): Promise<WebdavBridgeResponse> => {
    const channelId = await requireChannel();
    assertIndexWritable(channelId);
    if (!request.destination) throw new WebdavError(400, "Missing Destination header");
    const source = normalizeVirtualPath(request.path);
    const destination = normalizeVirtualPath(request.destination);
    if (source === "/") throw new WebdavError(403, "Cannot move the drive root");
    if (source === destination) return { status: 204 };
    if (isWithinPath(destination, source)) {
      throw new WebdavError(409, "Cannot move a collection into itself");
    }
    if (!folderExists(deps.getFiles(), dirname(destination))) {
      throw new WebdavError(409, "Destination parent does not exist");
    }
    const overwrite = (request.overwrite ?? "T").trim().toUpperCase() !== "F";
    const destinationNode = nodeForPath(deps.getFiles(), destination);
    if (destinationNode && !overwrite) {
      throw new WebdavError(412, "Destination exists and Overwrite is F");
    }
    assertWriteAllowed(source, request);
    assertWriteAllowed(destination, request);

    let existed = Boolean(destinationNode);
    let replaced: TeleFile[] = [];
    try {
      await commitFiles(channelId, (current) => {
        const sourceNode = nodeForPath(current, source);
        if (!sourceNode) throw new WebdavError(404, "Source not found");
        const currentNode = nodeForPath(current, destination);
        existed = Boolean(currentNode);
        if (currentNode && !overwrite) {
          throw new WebdavError(412, "Destination exists and Overwrite is F");
        }
        replaced = currentNode ? subtreeEntries(current, destination) : [];
        const replacedIds = new Set(replaced.map((entry) => entry.id));

        const moved = current
          .filter((entry) => !replacedIds.has(entry.id))
          .map((entry) => {
            const entryPath = fullPathOf(entry);
            if (!isWithinPath(entryPath, source)) return entry;
            if (entryPath === source) {
              return {
                ...entry,
                name: basename(destination),
                folderPath: dirname(destination),
              };
            }
            return {
              ...entry,
              folderPath: rebaseFolderPath(entry.folderPath, source, destination),
            };
          });

        return deps.reconstructMissingFolders(moved, channelId).healedFiles;
      });
    } catch (err) {
      scheduleCommitCleanup(
        err,
        () => deps.deleteMessages(channelId, messageIds(replaced)),
        async () => {}
      );
      throw err;
    }

    if (replaced.length > 0) {
      await deps.deleteMessages(channelId, messageIds(replaced)).catch(() => {});
    }
    return { status: existed ? 204 : 201 };
  };

  const handleCopy = async (request: WebdavBridgeRequest): Promise<WebdavBridgeResponse> => {
    const channelId = await requireChannel();
    assertIndexWritable(channelId);
    if (!request.destination) throw new WebdavError(400, "Missing Destination header");
    const source = normalizeVirtualPath(request.path);
    const destination = normalizeVirtualPath(request.destination);
    if (source === "/") throw new WebdavError(403, "Cannot copy the drive root");
    if (source === destination) throw new WebdavError(409, "Source and destination are identical");
    if (isWithinPath(destination, source)) {
      throw new WebdavError(409, "Cannot copy a collection into itself");
    }
    const files = deps.getFiles();
    const sourceNode = nodeForPath(files, source);
    if (!sourceNode) throw new WebdavError(404, "Source not found");
    if (!folderExists(files, dirname(destination))) {
      throw new WebdavError(409, "Destination parent does not exist");
    }
    const overwrite = (request.overwrite ?? "T").trim().toUpperCase() !== "F";
    if (nodeForPath(files, destination) && !overwrite) {
      throw new WebdavError(412, "Destination exists and Overwrite is F");
    }
    assertWriteAllowed(destination, request);

    const sourceEntries = subtreeEntries(files, source);
    const copyFiles = sourceEntries.filter((entry) => !isFolderEntry(entry));
    if (copyFiles.length > MAX_COPY_FILES) {
      throw new WebdavError(507, "COPY is limited to 500 files per request");
    }

    const created: TeleFile[] = [];
    try {
      for (const entry of copyFiles) {
        const destinationFolder = rebaseFolderPath(entry.folderPath, source, destination);
        const cloned = await deps.cloneFile(channelId, entry, destinationFolder, entry.name);
        const messageId = Number(cloned.message?.id ?? 0);
        if (!messageId) throw new WebdavError(502, "Telegram did not return a message id");
        created.push({
          ...entry,
          id: deps.newId(),
          name: sourceNode.isFolder ? entry.name : basename(destination),
          folderPath: destinationFolder,
          messageId,
          uploadedAt: deps.now(),
          ...(cloned.segments && cloned.segments.length > 1
            ? { segments: cloned.segments }
            : { segments: undefined }),
        });
      }
    } catch (err) {
      const partial = created.flatMap((entry) => messageIds([entry]));
      if (partial.length > 0) await deps.deleteMessages(channelId, partial).catch(() => {});
      throw err;
    }

    // Folder entries for the copied tree (including the source root itself).
    const folderPaths = new Set<string>();
    if (sourceNode.isFolder) folderPaths.add(destination);
    for (const entry of sourceEntries) {
      if (!isFolderEntry(entry)) continue;
      const entryPath = fullPathOf(entry);
      const relative = entryPath.slice(source.length);
      folderPaths.add(`${destination}${relative}`);
    }

    let existed = false;
    try {
      await commitFiles(channelId, (current) => {
        const currentNode = nodeForPath(current, destination);
        existed = Boolean(currentNode);
        if (currentNode && !overwrite) {
          throw new WebdavError(412, "Destination exists and Overwrite is F");
        }
        const replaced = currentNode ? subtreeEntries(current, destination) : [];
        const replacedIds = new Set(replaced.map((entry) => entry.id));
        const base = current.filter((entry) => !replacedIds.has(entry.id));

        const folders: TeleFile[] = [];
      const existingPaths = new Set(
        base
          .filter(isFolderEntry)
          .map((entry) => fullPathOf(entry))
      );
      for (const folderPath of folderPaths) {
        if (existingPaths.has(folderPath)) continue;
        folders.push({
          id: deps.newId(),
          name: basename(folderPath),
          size: 0,
          mime: "inode/directory",
          folderPath: dirname(folderPath),
          messageId: 0,
          channelId,
          uploadedAt: deps.now(),
          starred: false,
          trashed: false,
          archived: false,
        });
      }

        return deps.reconstructMissingFolders([...base, ...folders, ...created], channelId)
          .healedFiles;
      });
    } catch (err) {
      // Catalog rejected the copy: remove the cloned messages too. If the
      // commit is still queued after the deadline, wait for its outcome.
      const partial = created.flatMap((entry) => messageIds([entry]));
      const deferred = scheduleCommitCleanup(
        err,
        async () => {},
        () =>
          partial.length > 0
            ? deps.deleteMessages(channelId, partial)
            : Promise.resolve()
      );
      if (!deferred && partial.length > 0) {
        await deps.deleteMessages(channelId, partial).catch(() => {});
      }
      throw err;
    }

    return { status: existed ? 204 : 201 };
  };

  const handleLock = async (request: WebdavBridgeRequest): Promise<WebdavBridgeResponse> => {
    await requireChannel();
    const target = normalizeVirtualPath(request.path);
    const tokens = collectWriteTokens(request.ifHeader, request.lockToken);
    const timeout = parseTimeoutHeader(request.timeout);

    // Empty-body LOCK is a refresh of an existing lock.
    const refreshToken = tokens.find(
      (token) => deps.locks.findByToken(target, token) !== null
    );
    if (refreshToken) {
      const refreshed = deps.locks.refresh(target, refreshToken, timeout);
      if (!refreshed) throw new WebdavError(412, "Lock token does not cover this resource");
      return xmlResponse(buildLockDiscoveryXml(refreshed), 200, {
        "Lock-Token": `<${refreshed.token}>`,
        Timeout: `Second-${refreshed.timeoutSeconds}`,
      });
    }

    const existingNode = nodeForPath(deps.getFiles(), target);
    if (!existingNode && !folderExists(deps.getFiles(), dirname(target))) {
      throw new WebdavError(409, "Parent collection does not exist");
    }
    const depth = request.depth?.trim() === "0" ? "0" : "infinity";
    const result = deps.locks.lock(target, { owner: null, timeoutSeconds: timeout, depth });
    if (!result.ok) {
      return textResponse(423, "Resource is already locked");
    }
    const status = existingNode ? 200 : 201;
    return xmlResponse(buildLockDiscoveryXml(result.lock), status, {
      "Lock-Token": `<${result.lock.token}>`,
      Timeout: `Second-${result.lock.timeoutSeconds}`,
    });
  };

  const handleUnlock = async (request: WebdavBridgeRequest): Promise<WebdavBridgeResponse> => {
    await requireChannel();
    const target = normalizeVirtualPath(request.path);
    const tokens = collectWriteTokens(null, request.lockToken);
    if (tokens.length === 0) throw new WebdavError(400, "Missing Lock-Token header");
    const result = deps.locks.unlock(target, tokens[0]);
    if (result === "not-found") throw new WebdavError(409, "Lock token is unknown");
    if (result === "mismatch") throw new WebdavError(409, "Lock token does not cover this resource");
    return { status: 204 };
  };

  const route = async (request: WebdavBridgeRequest): Promise<WebdavBridgeResponse> => {
    switch (request.method) {
      case "PROPFIND":
        return handlePropfind(request);
      case "PROPPATCH":
        await requireChannel();
        return xmlResponse(buildProppatchForbiddenXml());
      case "GET":
      case "HEAD":
        return handleGetOrHead(request);
      case "PUT":
        return handlePut(request);
      case "MKCOL":
        return handleMkcol(request);
      case "DELETE":
        return handleDelete(request);
      case "MOVE":
        return handleMove(request);
      case "COPY":
        return handleCopy(request);
      case "LOCK":
        return handleLock(request);
      case "UNLOCK":
        return handleUnlock(request);
      case "OPTIONS":
        return {
          status: 200,
          headers: {
            DAV: "1, 2",
            Allow:
              "OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY, PROPFIND, PROPPATCH, LOCK, UNLOCK",
          },
        };
      default:
        throw new WebdavError(405, `Method ${request.method} is not supported`);
    }
  };

  return {
    async handle(request: WebdavBridgeRequest): Promise<WebdavBridgeResponse> {
      try {
        return await route(request);
      } catch (err) {
        return errorToResponse(err, deps.log, deps.describeConflict);
      }
    },
  };
}

