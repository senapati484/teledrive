import { beforeEach, describe, expect, it } from "vitest";
import { useFileStore } from "../../../stores/fileStore";
import type { TeleFile } from "../../types";

const CHANNEL = "chan_names";

function userFile(id: string, name: string): TeleFile {
  return {
    id,
    name,
    size: 10,
    mime: "application/octet-stream",
    folderPath: "/",
    messageId: 1,
    channelId: CHANNEL,
    uploadedAt: 1,
    starred: false,
    trashed: false,
  };
}

beforeEach(() => {
  useFileStore.setState({ files: [], bootstrapComplete: true });
});

describe("user files stay visible", () => {
  it("does not drop common file names that resemble git/system files", () => {
    const files = [
      userFile("a", "config"),
      userFile("b", "index"),
      userFile("c", "HEAD"),
      userFile("d", "description"),
      userFile("e", "main"),
      userFile("f", "notes.tmp"),
    ];

    useFileStore.getState().setFiles(files);

    expect(useFileStore.getState().files.map((f) => f.name)).toEqual(
      files.map((f) => f.name),
    );
  });

  it("keeps nested folders and their files", () => {
    const nested = userFile("nested", "report.pdf");
    nested.folderPath = "/Work/Reports";
    useFileStore.getState().setFiles([nested]);

    expect(useFileStore.getState().files[0].folderPath).toBe("/Work/Reports");
  });
});
