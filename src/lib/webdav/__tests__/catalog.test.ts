import { describe, expect, it } from "vitest";
import type { TeleFile } from "../../types";
import {
  childNodesOf,
  childrenOf,
  dedupeChildrenByName,
  findEntryByPath,
  folderExists,
  fullPathOf,
  nodeForPath,
  rebaseFolderPath,
  subtreeEntries,
  visibleDriveEntries,
} from "../catalog";

function file(overrides: Partial<TeleFile> & { name: string; folderPath: string }): TeleFile {
  return {
    id: overrides.id ?? overrides.name,
    size: overrides.size ?? 1,
    mime: overrides.mime ?? "text/plain",
    messageId: overrides.messageId ?? 1,
    channelId: overrides.channelId ?? "chan",
    uploadedAt: overrides.uploadedAt ?? 1,
    ...overrides,
  };
}

const folder = (name: string, folderPath: string, extra: Partial<TeleFile> = {}) =>
  file({ name, folderPath, mime: "inode/directory", messageId: 0, size: 0, ...extra });

describe("visible drive entries", () => {
  it("hides trash, archive and the backup namespace", () => {
    const files = [
      file({ name: "keep.txt", folderPath: "/" }),
      file({ name: "trashed.txt", folderPath: "/", trashed: true }),
      file({ name: "archived.txt", folderPath: "/", archived: true }),
      folder("TeleDrive Backups", "/"),
      file({ name: "backup.bin", folderPath: "/TeleDrive Backups/device" }),
    ];
    expect(visibleDriveEntries(files).map((entry) => entry.name)).toEqual(["keep.txt"]);
  });
});

describe("children and lookups", () => {
  const files = [
    folder("Docs", "/"),
    file({ name: "a.txt", folderPath: "/" }),
    file({ name: "b.txt", folderPath: "/", messageId: 2 }),
    file({ name: "a.txt", folderPath: "/", messageId: 3, uploadedAt: 5 }),
  ];

  it("dedupes duplicate names deterministically and prefers folders", () => {
    const children = childrenOf(files, "/");
    expect(children.map((entry) => entry.name)).toEqual(["a.txt", "b.txt", "Docs"]);
    const a = children.find((entry) => entry.name === "a.txt")!;
    expect(a.messageId).toBe(3);
  });

  it("prefers a folder over a file with the same name", () => {
    const entries = dedupeChildrenByName([
      file({ name: "same", folderPath: "/" }),
      folder("same", "/"),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].mime).toBe("inode/directory");
  });

  it("finds entries by absolute path and reports implicit folders", () => {
    expect(fullPathOf(file({ name: "a.txt", folderPath: "/Docs" }))).toBe("/Docs/a.txt");
    expect(findEntryByPath(files, "/a.txt")?.messageId).toBe(3);
    expect(folderExists(files, "/Docs")).toBe(true);
    expect(folderExists(files, "/Missing")).toBe(false);

    const deep = [file({ name: "deep.txt", folderPath: "/A/B" })];
    expect(folderExists(deep, "/A/B")).toBe(true);
    expect(nodeForPath(deep, "/A")?.isFolder).toBe(true);
    expect(nodeForPath(deep, "/A/B")?.isFolder).toBe(true);
    expect(nodeForPath(files, "/")?.name).toBe("TeleDrive");
  });

  it("synthesizes intermediate folders for Depth:1 listings", () => {
    const deep = [
      folder("A", "/"),
      file({ name: "deep.txt", folderPath: "/A/B/C" }),
    ];
    const root = childNodesOf(deep, "/").map((node) => node.name);
    expect(root).toContain("A");
    const a = childNodesOf(deep, "/A").map((node) => node.name);
    expect(a).toEqual(["B"]);
    const b = childNodesOf(deep, "/A/B").map((node) => node.name);
    expect(b).toEqual(["C"]);
  });
});

describe("subtree helpers", () => {
  it("collects descendants and rebases folder paths", () => {
    const files = [
      folder("A", "/"),
      folder("B", "/A"),
      file({ name: "x.txt", folderPath: "/A/B" }),
      file({ name: "y.txt", folderPath: "/A" }),
      file({ name: "z.txt", folderPath: "/" }),
    ];
    expect(subtreeEntries(files, "/A").map(fullPathOf).sort()).toEqual([
      "/A",
      "/A/B",
      "/A/B/x.txt",
      "/A/y.txt",
    ]);
    expect(rebaseFolderPath("/A/B", "/A", "/Moved")).toBe("/Moved/B");
    expect(rebaseFolderPath("/A", "/A", "/Moved")).toBe("/Moved");
    expect(rebaseFolderPath("/Other", "/A", "/Moved")).toBe("/Other");
  });
});
