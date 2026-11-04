import { beforeEach, describe, expect, it } from "vitest";
import { DownloadItem, useTransferStore } from "../transferStore";

function download(overrides: Partial<DownloadItem>): DownloadItem {
  return {
    id: "job-1",
    name: "file.bin",
    size: 1024,
    progress: 0,
    receivedBytes: 0,
    status: "downloading",
    channelId: "-1001",
    messageId: 10,
    ...overrides,
  };
}

beforeEach(() => {
  useTransferStore.setState({ downloads: [] });
});

describe("transferStore", () => {
  it("adds and updates downloads by id", () => {
    useTransferStore.getState().addDownload(download({}));
    useTransferStore.getState().updateDownload("job-1", {
      status: "paused",
      receivedBytes: 512,
      progress: 50,
    });

    const [item] = useTransferStore.getState().downloads;
    expect(item).toMatchObject({
      status: "paused",
      receivedBytes: 512,
      progress: 50,
    });
  });

  it("does not mutate other downloads", () => {
    useTransferStore.getState().addDownload(download({ id: "a" }));
    useTransferStore.getState().addDownload(download({ id: "b" }));
    useTransferStore.getState().updateDownload("a", { progress: 80 });

    expect(useTransferStore.getState().downloads.map((d) => d.progress)).toEqual([
      80, 0,
    ]);
  });

  it("removes a single download", () => {
    useTransferStore.getState().addDownload(download({ id: "a" }));
    useTransferStore.getState().addDownload(download({ id: "b" }));
    useTransferStore.getState().removeDownload("a");

    expect(useTransferStore.getState().downloads.map((d) => d.id)).toEqual(["b"]);
  });

  it("clears only finished downloads", () => {
    useTransferStore.getState().addDownload(download({ id: "active" }));
    useTransferStore.getState().addDownload(
      download({ id: "done", status: "done" })
    );
    useTransferStore.getState().addDownload(
      download({ id: "paused", status: "paused" })
    );
    useTransferStore.getState().addDownload(
      download({ id: "failed", status: "error" })
    );
    useTransferStore.getState().addDownload(
      download({ id: "cancelled", status: "cancelled" })
    );

    useTransferStore.getState().clearFinishedDownloads();

    expect(
      useTransferStore
        .getState()
        .downloads.map((d) => d.id)
        .sort()
    ).toEqual(["active", "paused"]);
  });
});
