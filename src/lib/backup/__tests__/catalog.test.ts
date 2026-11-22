import { describe, expect, it } from "vitest";
import { compactBackupCatalog } from "../catalog";
import { folderIdForPath } from "../../storage/folderIdentity";
import type { TeleFile } from "../../types";

function folder(folderPath: string, name: string): TeleFile {
  return {
    id: folderIdForPath(`${folderPath}/${name}`), folderPath, name,
    mime: "inode/directory", size: 0, messageId: 0, channelId: "channel", uploadedAt: 1,
  };
}

describe("backup catalog writes", () => {
  it("compacts old generated subfolders without losing files or explicit folders", () => {
    const root = "/TeleDrive Backups/PC/TeleDrive";
    const iso = folder(root, "iso");
    const random = folder(root, "random");
    const generated = Array.from({ length: 7000 }, (_, i) => folder(`${root}/random`, `folder${i}`));
    const saved = { ...folder(`${root}/random`, "saved"), starred: true };
    const manual = { ...folder(`${root}/random`, "manual"), id: "manually-created" };
    const local = folder("/my-drive/projects", "work");
    const file = {
      ...folder(`${root}/random/folder1`, "linux.iso"),
      mime: "application/octet-stream", messageId: 123, size: 100,
    };

    expect(compactBackupCatalog([iso, random, ...generated, saved, manual, local, file]))
      .toEqual([iso, random, saved, manual, local, file]);
  });
});
