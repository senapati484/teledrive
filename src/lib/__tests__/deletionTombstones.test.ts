import { beforeEach, describe, expect, it } from "vitest";
import { installMemoryLocalStorage, makeTeleFile } from "../backup/__tests__/helpers";
import {
  clearDeletedMessages,
  filterDeletedMessages,
  getDeletedMessageIds,
  recordDeletedMessages,
  resetDeletedMessagesForTests,
} from "../storage/tombstones";
import { useFileStore } from "../../stores/fileStore";

let restoreLocalStorage: () => void;

beforeEach(() => {
  restoreLocalStorage?.();
  restoreLocalStorage = installMemoryLocalStorage();
  resetDeletedMessagesForTests();
  useFileStore.setState({
    files: [],
    indexQueueState: "idle",
    indexLoadState: "ready",
    bootstrapComplete: true,
  });
});

describe("deletion tombstones", () => {
  it("records message ids and filters only those files", () => {
    recordDeletedMessages("chan", [10, 10, 0, -1, Number.NaN, 11]);
    expect([...getDeletedMessageIds("chan")].sort((a, b) => a - b)).toEqual([10, 11]);

    const files = [
      makeTeleFile("a", { messageId: 10 }),
      makeTeleFile("b", { messageId: 11 }),
      makeTeleFile("c", { messageId: 12 }),
      makeTeleFile("folder", { messageId: 0 }),
    ];
    expect(filterDeletedMessages("chan", files).map((f) => f.id)).toEqual([
      "c",
      "folder",
    ]);
  });

  it("can remove a tombstone when a delete rolls back", () => {
    recordDeletedMessages("chan", [10, 11]);
    clearDeletedMessages("chan", [10]);
    expect([...getDeletedMessageIds("chan")]).toEqual([11]);
  });

  it("keeps tombstones per channel", () => {
    recordDeletedMessages("chan-a", [10]);
    expect(filterDeletedMessages("chan-b", [makeTeleFile("a", { messageId: 10 })])).toHaveLength(1);
  });
});

describe("remote snapshot reconciliation", () => {
  it("removes every local entry absent from the remote index", async () => {
    recordDeletedMessages("chan", [30]);
    const deleted = makeTeleFile("deleted", {
      messageId: 30,
      channelId: "chan",
      folderPath: "/Docs",
    });
    const stale = makeTeleFile("stale", {
      messageId: 20,
      channelId: "chan",
      folderPath: "/Docs",
    });
    const backup = makeTeleFile("backup", {
      messageId: 40,
      channelId: "chan",
      folderPath: "/TeleDrive Backups/Test Mac/root",
    });
    const remote = makeTeleFile("remote", {
      messageId: 50,
      channelId: "chan",
      name: "remote.txt",
      folderPath: "/Docs",
    });
    useFileStore.setState({ files: [deleted, stale, backup] });

    await useFileStore.getState().setRemoteSnapshot([remote, deleted]);

    const ids = useFileStore.getState().files.map((f) => f.id);
    expect(ids).toContain("remote");
    expect(ids).not.toContain("backup");
    expect(ids).not.toContain("stale");
    expect(ids).not.toContain("deleted");
  });

  it("does not clobber a local action that landed while loading", async () => {
    const stale = makeTeleFile("stale", {
      messageId: 20,
      channelId: "chan",
      folderPath: "/Docs",
    });
    const localEdit = { ...stale, name: "renamed.txt" };
    useFileStore.setState({ files: [stale] });
    const expectedFiles = useFileStore.getState().files;

    useFileStore.getState().setFiles([localEdit]);
    await useFileStore
      .getState()
      .setRemoteSnapshot([makeTeleFile("remote")], expectedFiles);

    expect(useFileStore.getState().files.map((f) => f.name)).toEqual([
      "renamed.txt",
    ]);
  });

  it("filters tombstoned entries from additive remote deltas", async () => {
    recordDeletedMessages("chan", [30]);
    const deleted = makeTeleFile("deleted", { messageId: 30, channelId: "chan" });
    useFileStore.setState({ files: [] });

    await useFileStore.getState().setRemoteDelta([deleted]);

    expect(useFileStore.getState().files).toHaveLength(0);
  });
});
