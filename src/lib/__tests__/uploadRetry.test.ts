import { beforeEach, describe, expect, it } from "vitest";
import { useFileStore } from "../../stores/fileStore";
import { retryUploadItem } from "../upload/uploadManager";

beforeEach(() => {
  useFileStore.setState({
    uploadQueue: [],
    indexLoadState: "loading",
  });
});

describe("retryUploadItem", () => {
  it("requeues a failed item with its original file reference", () => {
    const file = new File(["hello"], "hello.txt");
    useFileStore.setState({
      uploadQueue: [
        {
          id: "u1",
          name: "hello.txt",
          size: 5,
          progress: 42,
          status: "error",
          file,
          folderPath: "/Docs",
          error: "network down",
          speed: 100,
          eta: 10,
          uploadedBytes: 2,
        },
      ],
    });

    expect(retryUploadItem("u1")).toBe(true);

    const item = useFileStore.getState().uploadQueue[0];
    expect(item.status).toBe("pending");
    expect(item.progress).toBe(0);
    expect(item.uploadedBytes).toBe(0);
    expect(item.error).toBeUndefined();
    expect(item.file).toBe(file);
  });

  it("ignores missing or non-error items", () => {
    useFileStore.setState({
      uploadQueue: [
        {
          id: "u2",
          name: "done.txt",
          size: 1,
          progress: 100,
          status: "done",
        },
      ],
    });

    expect(retryUploadItem("missing")).toBe(false);
    expect(retryUploadItem("u2")).toBe(false);
  });
});
