import { describe, expect, it } from "vitest";
import {
  collectDroppedFilesAndFolders,
  joinVirtualFolderPath,
  resolveRelativeUploadFolder,
} from "../droppedFiles";

describe("resolveRelativeUploadFolder & joinVirtualFolderPath", () => {
  it("preserves nested relative directories under root and custom folders", () => {
    expect(resolveRelativeUploadFolder("/", "Photos/2026/a.jpg")).toBe("/Photos/2026");
    expect(resolveRelativeUploadFolder("/Work", "Client\\Docs\\spec.pdf")).toBe("/Work/Client/Docs");
    expect(resolveRelativeUploadFolder("/Work", "single.txt")).toBe("/Work");
    expect(resolveRelativeUploadFolder("/Work", undefined)).toBe("/Work");
  });

  it("joins relative empty folder paths safely", () => {
    expect(joinVirtualFolderPath("/", "/Empty/Sub")).toBe("/Empty/Sub");
    expect(joinVirtualFolderPath("/Archive", "/Empty/Sub")).toBe("/Archive/Empty/Sub");
    expect(joinVirtualFolderPath("/Archive", "/")).toBe("/Archive");
  });
});

describe("collectDroppedFilesAndFolders", () => {
  it("walks nested webkitGetAsEntry directories across multiple readEntries batches and collects empty dirs", async () => {
    const fileA = new File(["a"], "a.txt", { type: "text/plain" });
    const fileB = new File(["b"], "b.txt", { type: "text/plain" });

    const rootDirEntry = {
      isFile: false,
      isDirectory: true,
      name: "Project",
      createReader: () => {
        let calls = 0;
        return {
          readEntries: (cb: (entries: any[]) => void) => {
            calls++;
            if (calls === 1) {
              cb([
                {
                  isFile: true,
                  isDirectory: false,
                  name: "a.txt",
                  file: (ok: (f: File) => void) => ok(fileA),
                },
              ]);
            } else if (calls === 2) {
              cb([
                {
                  isFile: false,
                  isDirectory: true,
                  name: "Nested",
                  createReader: () => {
                    let subCalls = 0;
                    return {
                      readEntries: (subCb: (entries: any[]) => void) => {
                        subCalls++;
                        if (subCalls === 1) {
                          subCb([
                            {
                              isFile: true,
                              isDirectory: false,
                              name: "b.txt",
                              file: (ok: (f: File) => void) => ok(fileB),
                            },
                          ]);
                        } else {
                          subCb([]);
                        }
                      },
                    };
                  },
                },
                {
                  isFile: false,
                  isDirectory: true,
                  name: "EmptySub",
                  createReader: () => ({
                    readEntries: (emptyCb: (entries: any[]) => void) => emptyCb([]),
                  }),
                },
              ]);
            } else {
              cb([]);
            }
          },
        };
      },
    };

    const collected = await collectDroppedFilesAndFolders({
      items: [
        {
          kind: "file",
          webkitGetAsEntry: () => rootDirEntry,
        },
      ] as unknown as DataTransferItemList,
      files: [] as unknown as FileList,
    });

    expect(collected.files).toEqual([
      { file: fileA, relativePath: "Project/a.txt" },
      { file: fileB, relativePath: "Project/Nested/b.txt" },
    ]);
    expect(collected.emptyFolderPaths).toEqual(["/Project/EmptySub"]);
  });

  it("falls back cleanly to dataTransfer.files when webkitGetAsEntry is unavailable", async () => {
    const f = new File(["hi"], "note.md", { type: "text/markdown" });
    Object.defineProperty(f, "webkitRelativePath", { value: "Notes/note.md" });

    const collected = await collectDroppedFilesAndFolders({
      items: [] as unknown as DataTransferItemList,
      files: [f] as unknown as FileList,
    });

    expect(collected.files).toEqual([{ file: f, relativePath: "Notes/note.md" }]);
    expect(collected.emptyFolderPaths).toEqual([]);
  });
});

