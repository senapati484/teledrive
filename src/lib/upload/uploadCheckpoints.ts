import type { TeleFileSegment } from "../types";

const STORAGE_KEY = "teledrive_upload_checkpoints_v1";
const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000; // 24h — Telegram retains uncommitted file parts temporarily
const MAX_CHECKPOINTS = 100;

export interface UploadCheckpoint {
  key: string;
  segmentIndex: number;
  fileIdStr: string;
  totalParts: number;
  /** Strictly contiguous prefix `[0 .. completedParts - 1]` acknowledged by Telegram. */
  completedParts: number;
  fileSaltB64?: string;
  completedSegments: TeleFileSegment[];
  encrypted: boolean;
  updatedAt: number;
}

const memoryFallback = new Map<string, UploadCheckpoint>();

export function buildUploadCheckpointKey(params: {
  channelId: string;
  folderPath: string;
  name: string;
  size: number;
  sourceKey?: string | number;
}): string {
  const src = params.sourceKey != null ? String(params.sourceKey) : "";
  return `${params.channelId}|${params.folderPath}|${params.name}|${params.size}|${src}`;
}

function readAllCheckpoints(): Record<string, UploadCheckpoint> {
  if (typeof localStorage === "undefined") {
    return Object.fromEntries(memoryFallback.entries());
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAllCheckpoints(map: Record<string, UploadCheckpoint>): void {
  const now = Date.now();
  const freshEntries = Object.entries(map)
    .filter(([, v]) => v && now - v.updatedAt < CHECKPOINT_TTL_MS)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CHECKPOINTS);

  const trimmed = Object.fromEntries(freshEntries);
  if (typeof localStorage === "undefined") {
    memoryFallback.clear();
    for (const [k, v] of freshEntries) memoryFallback.set(k, v);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage quota issues cleanly; uploads continue normally.
  }
}

export function loadUploadCheckpoint(
  key: string,
  now: number = Date.now()
): UploadCheckpoint | null {
  const all = readAllCheckpoints();
  const cp = all[key];
  if (!cp) return null;
  if (now - cp.updatedAt >= CHECKPOINT_TTL_MS) {
    clearUploadCheckpoint(key);
    return null;
  }
  return cp;
}

export function saveUploadCheckpoint(cp: UploadCheckpoint): void {
  const all = readAllCheckpoints();
  all[cp.key] = { ...cp, updatedAt: Date.now() };
  writeAllCheckpoints(all);
}

export function clearUploadCheckpoint(key: string): void {
  const all = readAllCheckpoints();
  if (!(key in all)) return;
  delete all[key];
  writeAllCheckpoints(all);
}

