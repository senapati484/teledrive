import { beforeEach, describe, expect, it, vi } from "vitest";
import { walkSourceFolders } from "../walker";

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));

function rawEntry(abs: string, rel: string, isDir = false, size = 10) {
  return {
    abs_path: abs,
    rel_path: rel,
    is_dir: isDir,
    size,
    mtime_ms: 1,
  };
}

function output(
  entries: ReturnType<typeof rawEntry>[],
  overrides: Record<string, unknown> = {},
) {
  return {
    entries,
    roots: [{ path: "/root", status: "ok", skipped: 0 }],
    cancelled: false,
    complete: true,
    errors: [],
    ...overrides,
  };
}

beforeEach(() => {
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (command: string) => {
    if (command === "get_app_data_dir") return "/home/me/.teledrive";
    if (command === "read_dir_recursive") return output([]);
    return null;
  });
});

describe("walkSourceFolders", () => {
  it("prunes children of an excluded directory", async () => {
    h.invoke.mockImplementation(async (command: string) => {
      if (command === "get_app_data_dir") return "/home/me/.teledrive";
      return output([
        rawEntry("/root/build", "build", true, 0),
        rawEntry("/root/build/child.js", "build/child.js"),
        rawEntry("/root/keep.txt", "keep.txt"),
      ]);
    });

    const result = await walkSourceFolders({
      paths: ["/root"],
      excludes: ["build"],
    });

    expect(result.files.map((f) => f.relPath)).toEqual(["keep.txt"]);
    expect(result.complete).toBe(true);
  });

  it("keeps default excludes working", async () => {
    h.invoke.mockImplementation(async (command: string) => {
      if (command === "get_app_data_dir") return "/home/me/.teledrive";
      return output([
        rawEntry("/root/node_modules", "node_modules", true, 0),
        rawEntry("/root/node_modules/a.js", "node_modules/a.js"),
        rawEntry("/root/.DS_Store", ".DS_Store"),
        rawEntry("/root/a.txt", "a.txt"),
      ]);
    });

    const result = await walkSourceFolders({ paths: ["/root"], excludes: [] });
    expect(result.files.map((f) => f.relPath)).toEqual(["a.txt"]);
  });

  it("dedupes overlapping roots by absolute path", async () => {
    h.invoke.mockImplementation(async (command: string, args: any) => {
      if (command === "get_app_data_dir") return "/none";
      return output([
        rawEntry("/root/same.txt", "same.txt"),
        rawEntry(`${args.path}/only-${args.path.split("/").pop()}.txt`, `only-${args.path.split("/").pop()}.txt`),
      ]);
    });

    const result = await walkSourceFolders({
      paths: ["/root", "/root/sub"],
      excludes: [],
    });
    expect(result.files).toHaveLength(3);
    expect(new Set(result.files.map((f) => f.absPath)).size).toBe(3);
  });

  it("surfaces missing roots as incomplete", async () => {
    h.invoke.mockImplementation(async (command: string) => {
      if (command === "get_app_data_dir") return "/none";
      return output([], {
        roots: [{ path: "/root", status: "missing", skipped: 1 }],
        complete: false,
        errors: [{ path: "/root", code: "missing" }],
      });
    });

    const result = await walkSourceFolders({ paths: ["/root"], excludes: [] });
    expect(result.complete).toBe(false);
    expect(result.roots[0].status).toBe("missing");
  });

  it("never returns files under the app data directory", async () => {
    h.invoke.mockImplementation(async (command: string) => {
      if (command === "get_app_data_dir") return "/home/me/.teledrive";
      return output([
        rawEntry("/home/me/.teledrive", ".teledrive", true, 0),
        rawEntry("/home/me/.teledrive/session.json", ".teledrive/session.json"),
        rawEntry("/home/me/keep.txt", "keep.txt"),
      ]);
    });

    const result = await walkSourceFolders({ paths: ["/home/me"], excludes: [] });
    expect(result.files.map((f) => f.relPath)).toEqual(["keep.txt"]);
  });

  it("returns early when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await walkSourceFolders(
      { paths: ["/root"], excludes: [] },
      { signal: controller.signal },
    );
    expect(result.cancelled).toBe(true);
    expect(result.complete).toBe(false);
    expect(h.invoke).not.toHaveBeenCalledWith(
      "read_dir_recursive",
      expect.anything(),
    );
  });
});
