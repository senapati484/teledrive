import { describe, it, expect, beforeEach } from "vitest";
import { useFileStore } from "../../stores/fileStore";
import { enqueueSave } from "../storage/indexQueue";
import {
  IndexNotReadyError,
  isIndexReady,
  waitForIndexReady,
} from "../telegram/indexReadiness";
import { processQueue } from "../upload/uploadManager";
import { runSyncTickOnce } from "../sync/remoteSync";

beforeEach(() => {
  useFileStore.setState({
    files: [],
    uploadQueue: [],
    indexLoadState: "loading",
    indexLoadError: null,
    bootstrapComplete: false,
    lastIndexMsgId: 0,
  });
});

describe("index write gate", () => {
  it("rejects enqueueSave with a typed error while loading", async () => {
    await expect(enqueueSave("chan", [])).rejects.toBeInstanceOf(IndexNotReadyError);
  });

  it("rejects enqueueSave while incomplete", async () => {
    useFileStore.getState().setIndexLoadState("incomplete", "partial_manifest");
    await expect(enqueueSave("chan", [])).rejects.toBeInstanceOf(IndexNotReadyError);
    expect(isIndexReady()).toBe(false);
  });

  it("opens only when the store is ready", () => {
    useFileStore.getState().setIndexLoadState("ready");
    expect(isIndexReady()).toBe(true);
    expect(() => {
      if (!isIndexReady()) throw new IndexNotReadyError();
    }).not.toThrow();
  });
});

describe("waitForIndexReady", () => {
  it("times out while loading and resolves after ready", async () => {
    await expect(waitForIndexReady(30)).resolves.toBe(false);
    useFileStore.getState().setIndexLoadState("ready");
    await expect(waitForIndexReady(1000)).resolves.toBe(true);
  });

  it("resolves when readiness flips during the wait", async () => {
    const waiting = waitForIndexReady(2000);
    setTimeout(() => useFileStore.getState().setIndexLoadState("ready"), 50);
    await expect(waiting).resolves.toBe(true);
  });
});

describe("background writers", () => {
  it("leaves upload queue items pending while the index is not ready", async () => {
    useFileStore.getState().addToQueue({
      id: "u1",
      name: "a.txt",
      size: 1,
      progress: 0,
      status: "pending",
      folderPath: "/",
    });

    await processQueue();

    const item = useFileStore.getState().uploadQueue[0];
    expect(item.status).toBe("pending");
  });

  it("waits for bootstrapComplete before starting queued uploads", async () => {
    useFileStore.getState().setIndexLoadState("ready");
    useFileStore.getState().setBootstrapComplete(false);
    useFileStore.getState().addToQueue({
      id: "u-wait",
      name: "wait.txt",
      size: 1,
      progress: 0,
      status: "pending",
      folderPath: "/",
    });

    await processQueue();

    expect(useFileStore.getState().uploadQueue[0].status).toBe("pending");
  });

  it("does not run a remote-sync tick while incomplete", async () => {
    useFileStore.getState().setIndexLoadState("incomplete", "not_found");
    useFileStore.getState().setLastIndexMsgId(10);

    await expect(runSyncTickOnce("chan")).resolves.toBe(false);
  });
});
