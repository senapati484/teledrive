/**
 * Device backup source-folder walker.
 *
 * The Rust side enumerates a root in one shot (size/mtime included) and
 * returns a structured result: files, per-root status, unreadable paths, and
 * whether the walk was complete. JS applies excludes and prunes whole
 * subtrees so an excluded `build/` never yields `build/child.js`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { BackupSourceFolders } from "./sourceFolders";
import {
  directoryShouldBeExcluded,
  normalizeRelativePath,
  pathMatchesExclude,
} from "./sourceFolders";
import { isJunkFile } from "../storage/fileSanitizer";

export interface WalkedFile {
  absPath: string;
  relPath: string;
  size: number;
  mtimeMs: number;
}

export type WalkRootState =
  | "ok"
  | "empty"
  | "missing"
  | "unreadable"
  | "truncated";

export interface WalkRootStatus {
  path: string;
  status: WalkRootState;
  skipped?: number;
}

export interface WalkError {
  path: string;
  code: string;
}

export interface WalkResult {
  files: WalkedFile[];
  roots: WalkRootStatus[];
  cancelled: boolean;
  complete: boolean;
  errors: WalkError[];
}

interface RustDirEntry {
  abs_path: string;
  rel_path: string;
  is_dir: boolean;
  size: number;
  mtime_ms: number;
}

interface RustWalkOutput {
  entries: RustDirEntry[];
  roots: WalkRootStatus[];
  cancelled: boolean;
  complete: boolean;
  errors: WalkError[];
}

function yieldToUi(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

let walkRunCounter = 0;

function nextRunId(): string {
  walkRunCounter += 1;
  return `backup-walk-${Date.now()}-${walkRunCounter}`;
}

function normalizeAbs(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

export async function walkSourceFolders(
  folders: BackupSourceFolders,
  opts: { signal?: AbortSignal; runId?: string } = {},
): Promise<WalkResult> {
  const empty: WalkResult = {
    files: [],
    roots: [],
    cancelled: Boolean(opts.signal?.aborted),
    complete: false,
    errors: [],
  };
  if (!folders.paths || folders.paths.length === 0) {
    return { ...empty, cancelled: false, complete: true };
  }

  const runId = opts.runId ?? nextRunId();
  let appDataDir = "";
  try {
    appDataDir = normalizeAbs(await invoke<string>("get_app_data_dir"));
  } catch {
    appDataDir = "";
  }

  const abortListener = () => {
    void invoke("cancel_backup_walk", { runId }).catch(() => {});
  };
  opts.signal?.addEventListener("abort", abortListener, { once: true });

  const files: WalkedFile[] = [];
  const roots: WalkRootStatus[] = [];
  const errors: WalkError[] = [];
  let cancelled = Boolean(opts.signal?.aborted);
  let complete = true;

  try {
    for (const root of folders.paths) {
      if (opts.signal?.aborted) {
        cancelled = true;
        break;
      }
      let output: RustWalkOutput;
      try {
        output = await invoke<RustWalkOutput>("read_dir_recursive", {
          path: root,
          runId,
        });
      } catch (err) {
        roots.push({ path: root, status: "unreadable" });
        errors.push({ path: root, code: String(err) });
        complete = false;
        continue;
      }

      roots.push(...(output.roots ?? []));
      errors.push(...(output.errors ?? []));
      if (!output.complete) complete = false;
      if (output.cancelled) cancelled = true;

      const pruned: string[] = [];
      const appData = appDataDir;
      for (const entry of output.entries ?? []) {
        if (opts.signal?.aborted) {
          cancelled = true;
          break;
        }
        const rel = normalizeRelativePath(entry.rel_path || "");
        if (
          rel &&
          pruned.some((prefix) => rel === prefix || rel.startsWith(prefix + "/"))
        ) {
          continue;
        }

        const abs = normalizeAbs(entry.abs_path);
        if (appData && (abs === appData || abs.startsWith(appData + "/"))) {
          if (entry.is_dir && rel) pruned.push(rel);
          continue;
        }

        if (entry.is_dir) {
          if (directoryShouldBeExcluded(rel, folders.excludes ?? [])) {
            if (rel) pruned.push(rel);
          }
          continue;
        }

        if (pathMatchesExclude(rel, folders.excludes ?? []).matches) continue;
        const fileName = rel.split("/").pop() || "";
        if (isJunkFile({ name: fileName, folderPath: rel, size: entry.size })) {
          continue;
        }

        files.push({
          absPath: entry.abs_path,
          relPath: rel,
          size: entry.size,
          mtimeMs: entry.mtime_ms,
        });
      }

      await yieldToUi();
      if (cancelled) break;
    }
  } finally {
    opts.signal?.removeEventListener("abort", abortListener);
  }

  if (opts.signal?.aborted) cancelled = true;
  if (cancelled) complete = false;

  const seen = new Set<string>();
  const deduped: WalkedFile[] = [];
  for (const file of files) {
    if (seen.has(file.absPath)) continue;
    seen.add(file.absPath);
    deduped.push(file);
  }

  return {
    files: deduped,
    roots,
    cancelled,
    complete,
    errors,
  };
}

export function sanitizeFolderSegment(s: string): string {
  return s
    .replace(/[:*?<>|"]/g, "")
    .replace(/\/+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64) || "device";
}
