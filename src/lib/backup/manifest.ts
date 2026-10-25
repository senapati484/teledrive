/**
 * Device backup manifest (v2).
 *
 * One file per storage channel under `<app-data>/backup_manifests/`.
 * The manifest is local to this device and records which local file maps to
 * which Telegram message. The runner appends every successful upload to a
 * journal; the base file is compacted at run end.
 */

import { invoke } from "@tauri-apps/api/core";
import type { TeleFile } from "../types";

const LEGACY_MANIFEST_KEY = "teledrive_backup_manifest_v1";
export const CURRENT_MANIFEST_VERSION = 2 as const;

export interface BackupRunSummary {
  status: "success" | "partial" | "failed" | "cancelled";
  uploaded: number;
  skipped: number;
  failed: number;
  missingRoots: string[];
}

export interface ManifestEntryV2 {
  mtimeMs: number;
  size: number;
  messageId: number;
  folderPath: string;
  uploadedAt: string;
  hash?: string;
  sourceMissing?: boolean;
  previousMessageIds?: number[];
}

export interface BackupManifestV2 {
  version: typeof CURRENT_MANIFEST_VERSION;
  generation: number;
  channelId: string;
  deviceName: string;
  deviceOs: string;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastResult: BackupRunSummary | null;
  entries: Record<string, ManifestEntryV2>;
  garbage: { messageId: number; folderPath: string; since: number }[];
}

interface LegacyManifestV1 {
  version: 1;
  deviceName?: string;
  deviceOs?: string;
  lastRunAt?: number | null;
  entries: Record<string, ManifestEntryV2>;
}

interface BackupManifestLoad {
  base: string | null;
  generation: number;
  journal: string[];
}

interface JournalRecord {
  generation: number;
  absPath: string;
  entry: ManifestEntryV2;
}

const corruptChannels = new Map<string, string>();
const corruptListeners = new Set<
  (channelId: string, quarantineKey: string | null) => void
>();
const ensuredChannels = new Set<string>();

export function isManifestCorrupt(channelId: string): boolean {
  return corruptChannels.has(channelId);
}

export function resetManifestCorrupt(channelId: string): void {
  if (!corruptChannels.delete(channelId)) return;
  for (const listener of corruptListeners) listener(channelId, null);
}

export function onManifestCorruptChange(
  listener: (channelId: string, quarantineKey: string | null) => void,
): () => void {
  corruptListeners.add(listener);
  for (const [channelId, quarantineKey] of corruptChannels) {
    listener(channelId, quarantineKey);
  }
  return () => corruptListeners.delete(listener);
}

function markCorrupt(channelId: string, quarantineKey: string): void {
  corruptChannels.set(channelId, quarantineKey);
  for (const listener of corruptListeners) listener(channelId, quarantineKey);
}

async function quarantineBase(channelId: string, reason: string): Promise<void> {
  const suffix = String(Date.now());
  console.warn(
    `[backup.manifest] manifest corruption for ${channelId} (${reason}); quarantining`,
  );
  try {
    await invoke("quarantine_backup_manifest", { channelId, suffix });
    markCorrupt(channelId, `${channelId}.corrupt-${suffix}`);
  } catch (err) {
    console.error("[backup.manifest] quarantine failed:", err);
    markCorrupt(channelId, "");
  }
}

function emptyResult(): BackupRunSummary {
  return { status: "failed", uploaded: 0, skipped: 0, failed: 0, missingRoots: [] };
}

export function emptyManifest(channelId: string): BackupManifestV2 {
  return {
    version: CURRENT_MANIFEST_VERSION,
    generation: 0,
    channelId,
    deviceName: "",
    deviceOs: "",
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastResult: null,
    entries: {},
    garbage: [],
  };
}

function isValidEntry(value: unknown): value is ManifestEntryV2 {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<ManifestEntryV2>;
  return (
    Number.isFinite(e.messageId) &&
    Number(e.messageId) > 0 &&
    typeof e.folderPath === "string" &&
    Number.isFinite(e.size) &&
    Number.isFinite(e.mtimeMs)
  );
}

function replayJournal(
  manifest: BackupManifestV2,
  lines: string[],
): void {
  for (const line of lines) {
    if (!line.trim()) continue;
    let record: JournalRecord;
    try {
      record = JSON.parse(line) as JournalRecord;
    } catch {
      console.warn("[backup.manifest] ignoring malformed journal line");
      continue;
    }
    if (
      record.generation !== manifest.generation ||
      typeof record.absPath !== "string" ||
      !isValidEntry(record.entry)
    ) {
      continue;
    }
    manifest.entries[record.absPath] = record.entry;
  }
}

async function readManifest(
  channelId: string,
): Promise<{ manifest: BackupManifestV2; exists: boolean }> {
  let loaded: BackupManifestLoad;
  try {
    loaded = await invoke<BackupManifestLoad>("load_backup_manifest", {
      channelId,
    });
  } catch (err) {
    console.warn("[backup.manifest] load failed; starting empty:", err);
    return { manifest: emptyManifest(channelId), exists: false };
  }

  if (!loaded.base) {
    return { manifest: emptyManifest(channelId), exists: false };
  }

  let parsed: BackupManifestV2;
  try {
    parsed = JSON.parse(loaded.base) as BackupManifestV2;
  } catch (err) {
    await quarantineBase(
      channelId,
      `json parse: ${(err as Error).message ?? err}`,
    );
    return { manifest: emptyManifest(channelId), exists: true };
  }

  if (
    parsed.version !== CURRENT_MANIFEST_VERSION ||
    !parsed.entries ||
    typeof parsed.entries !== "object"
  ) {
    await quarantineBase(
      channelId,
      `schema drift: version=${(parsed as { version?: unknown }).version}`,
    );
    return { manifest: emptyManifest(channelId), exists: true };
  }

  const manifest: BackupManifestV2 = {
    ...parsed,
    version: CURRENT_MANIFEST_VERSION,
    channelId,
    generation: Number(loaded.generation) || 0,
    entries: { ...parsed.entries },
    garbage: Array.isArray(parsed.garbage) ? parsed.garbage : [],
    lastAttemptAt: parsed.lastAttemptAt ?? null,
    lastSuccessAt: parsed.lastSuccessAt ?? null,
    lastResult: parsed.lastResult ?? null,
  };
  replayJournal(manifest, loaded.journal ?? []);
  resetManifestCorrupt(channelId);
  return { manifest, exists: true };
}

export async function loadManifest(channelId: string): Promise<BackupManifestV2> {
  return (await readManifest(channelId)).manifest;
}

export async function saveManifest(
  channelId: string,
  manifest: BackupManifestV2,
): Promise<number> {
  const nextGeneration = await invoke<number>("save_backup_manifest", {
    channelId,
    value: JSON.stringify(manifest),
    generation: manifest.generation,
  });
  resetManifestCorrupt(channelId);
  return Number(nextGeneration) || manifest.generation + 1;
}

export async function appendManifestEntry(
  channelId: string,
  generation: number,
  absPath: string,
  entry: ManifestEntryV2,
): Promise<void> {
  const record: JournalRecord = { generation, absPath, entry };
  await invoke("append_backup_manifest_journal", {
    channelId,
    generation,
    line: JSON.stringify(record),
  });
}

/**
 * Load v2, migrating the legacy vault manifest once per channel/session.
 * The verifier must confirm every sampled message id is live before entries
 * are adopted; otherwise the legacy value is quarantined and we start empty.
 */
export async function ensureManifest(
  channelId: string,
  verifyMessageIds?: (ids: number[]) => Promise<Set<number>>,
): Promise<BackupManifestV2> {
  const existing = await readManifest(channelId);
  if (existing.exists) {
    ensuredChannels.add(channelId);
    return existing.manifest;
  }
  if (ensuredChannels.has(channelId)) return existing.manifest;

  let raw: string | null;
  try {
    raw = await invoke<string | null>("load_vault_value", {
      key: LEGACY_MANIFEST_KEY,
    });
  } catch (err) {
    console.warn("[backup.manifest] legacy load failed:", err);
    return existing.manifest;
  }
  if (!raw) {
    ensuredChannels.add(channelId);
    return existing.manifest;
  }

  const quarantineLegacy = async () => {
    try {
      await invoke("quarantine_vault_value", {
        key: LEGACY_MANIFEST_KEY,
        backupKey: `${LEGACY_MANIFEST_KEY}.migrated-${Date.now()}`,
      });
    } catch (err) {
      console.warn("[backup.manifest] legacy quarantine failed:", err);
    }
  };

  let legacy: LegacyManifestV1;
  try {
    legacy = JSON.parse(raw) as LegacyManifestV1;
  } catch {
    await quarantineLegacy();
    return existing.manifest;
  }
  if (legacy.version !== 1 || !legacy.entries) {
    await quarantineLegacy();
    return existing.manifest;
  }

  const entries = Object.fromEntries(
    Object.entries(legacy.entries).filter(([, entry]) => isValidEntry(entry)),
  );
  const ids = [...new Set(Object.values(entries).map((e) => e.messageId))].slice(
    0,
    5,
  );
  let verified = ids.length === 0;
  if (!verified && verifyMessageIds) {
    try {
      const live = await verifyMessageIds(ids);
      verified = ids.every((id) => live.has(id));
    } catch (err) {
      console.warn("[backup.manifest] legacy verification failed:", err);
    }
  }

  if (!verified) {
    await quarantineLegacy();
    return existing.manifest;
  }

  const manifest: BackupManifestV2 = {
    ...emptyManifest(channelId),
    deviceName: legacy.deviceName ?? "",
    deviceOs: legacy.deviceOs ?? "",
    lastAttemptAt: legacy.lastRunAt ?? null,
    lastSuccessAt: legacy.lastRunAt ?? null,
    entries,
    lastResult:
      ids.length > 0
        ? { ...emptyResult(), status: "success" }
        : null,
  };
  try {
    manifest.generation = await saveManifest(channelId, manifest);
    ensuredChannels.add(channelId);
  } catch (err) {
    console.warn("[backup.manifest] legacy migration save failed:", err);
    return existing.manifest;
  }
  await quarantineLegacy();
  return manifest;
}

/** Reset module-level migration state. Test-only. */
export function resetManifestStateForTests(): void {
  ensuredChannels.clear();
  corruptChannels.clear();
}

export interface ManifestDiff {
  toUpload: { absPath: string; relPath: string; mtimeMs: number; size: number }[];
  unchanged: { absPath: string; entry: ManifestEntryV2 }[];
  missing: { absPath: string; entry: ManifestEntryV2 }[];
}

export function diffAgainstManifest(
  manifest: BackupManifestV2,
  walk: { absPath: string; relPath: string; mtimeMs: number; size: number }[],
): ManifestDiff {
  const toUpload: ManifestDiff["toUpload"] = [];
  const unchanged: ManifestDiff["unchanged"] = [];
  const walkByPath = new Map<string, { mtimeMs: number; size: number }>();
  for (const f of walk) walkByPath.set(f.absPath, { mtimeMs: f.mtimeMs, size: f.size });

  for (const f of walk) {
    const prior = manifest.entries[f.absPath];
    if (!prior) {
      toUpload.push(f);
      continue;
    }
    if (prior.mtimeMs !== f.mtimeMs || prior.size !== f.size) {
      toUpload.push(f);
    } else {
      unchanged.push({ absPath: f.absPath, entry: prior });
    }
  }

  const missing: ManifestDiff["missing"] = [];
  for (const absPath of Object.keys(manifest.entries)) {
    if (!walkByPath.has(absPath)) {
      missing.push({ absPath, entry: manifest.entries[absPath] });
    }
  }

  return { toUpload, unchanged, missing };
}

export function recordUpload(
  manifest: BackupManifestV2,
  absPath: string,
  info: {
    mtimeMs: number;
    size: number;
    messageId: number;
    folderPath: string;
    hash?: string;
    previousMessageIds?: number[];
  },
): BackupManifestV2 {
  return {
    ...manifest,
    lastAttemptAt: Date.now(),
    entries: {
      ...manifest.entries,
      [absPath]: {
        mtimeMs: info.mtimeMs,
        size: info.size,
        messageId: info.messageId,
        folderPath: info.folderPath,
        uploadedAt: new Date().toISOString(),
        ...(info.hash ? { hash: info.hash } : {}),
        ...(info.previousMessageIds && info.previousMessageIds.length > 0
          ? { previousMessageIds: info.previousMessageIds }
          : {}),
      },
    },
  };
}


/**
 * Drop superseded backup messages and collapse duplicate same-path entries.
 * Runs after orphan recovery so the scan cannot re-add an old message id.
 */
export function filterSupersededBackupFiles(
  manifest: BackupManifestV2,
  files: TeleFile[],
): { files: TeleFile[]; changed: boolean } {
  const currentIds = new Set(
    Object.values(manifest.entries).map((entry) => Number(entry.messageId)),
  );
  const superseded = new Set<number>();
  for (const entry of Object.values(manifest.entries)) {
    for (const id of entry.previousMessageIds ?? []) superseded.add(Number(id));
  }
  for (const item of manifest.garbage) superseded.add(Number(item.messageId));

  const filtered = files.filter((file) => {
    const id = Number(file.messageId);
    return !(superseded.has(id) && !currentIds.has(id));
  });

  const byPath = new Map<string, TeleFile>();
  const passthrough: TeleFile[] = [];
  for (const file of filtered) {
    if (!file.folderPath?.startsWith("/TeleDrive Backups/") || !(Number(file.messageId) > 0)) {
      passthrough.push(file);
      continue;
    }
    const key = `${file.folderPath}\u0000${file.name}`;
    const existing = byPath.get(key);
    if (!existing) {
      byPath.set(key, file);
      continue;
    }
    const existingCurrent = currentIds.has(Number(existing.messageId));
    const nextCurrent = currentIds.has(Number(file.messageId));
    if (nextCurrent && !existingCurrent) {
      byPath.set(key, file);
    } else if (!existingCurrent && !nextCurrent && file.uploadedAt > existing.uploadedAt) {
      byPath.set(key, file);
    }
  }

  const next = [...passthrough, ...byPath.values()];
  const before = new Set(files.map((f) => `${f.id}:${f.messageId}`));
  const after = new Set(next.map((f) => `${f.id}:${f.messageId}`));
  const changed =
    before.size !== after.size || [...before].some((key) => !after.has(key));
  return { files: next, changed };
}

const EXTENSION_MIME_MAP: Record<string, string> = {
  txt: "text/plain", md: "text/markdown", json: "application/json",
  pdf: "application/pdf", html: "text/html", htm: "text/html", css: "text/css", csv: "text/csv",
  js: "application/javascript", ts: "application/typescript", tsx: "application/typescript",
  jsx: "application/javascript", xml: "application/xml", yaml: "application/yaml", yml: "application/yaml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
  heic: "image/heic", heif: "image/heif", tiff: "image/tiff", tif: "image/tiff",
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4", webm: "video/webm",
  mkv: "video/x-matroska", avi: "video/x-msvideo", mp3: "audio/mpeg",
  m4a: "audio/mp4", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/opus",
  zip: "application/zip", tar: "application/x-tar", gz: "application/gzip",
  tgz: "application/gzip", bz2: "application/x-bzip2", "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xz: "application/x-xz", iso: "application/x-iso9660-image",
  dmg: "application/x-apple-diskimage",
};

export function guessMimeFromName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME_MAP[ext] ?? "application/octet-stream";
}

export function manifestEntryToTeleFile(
  absPath: string,
  entry: ManifestEntryV2,
  channelId: string,
): TeleFile | null {
  if (!entry.messageId || entry.messageId <= 0) return null;
  if (!entry.folderPath) return null;
  const folderPath = entry.folderPath.replace(/\\/g, "/");
  const fileName =
    absPath.split(/[\\/]/).pop() ||
    folderPath.split("/").pop() ||
    `file_${entry.messageId}`;
  const uploadedMs = Date.parse(entry.uploadedAt);
  return {
    id: `backup_${entry.messageId}`,
    name: fileName,
    size: entry.size,
    mime: guessMimeFromName(fileName),
    folderPath,
    messageId: entry.messageId,
    channelId,
    uploadedAt: Number.isFinite(uploadedMs) ? uploadedMs : Date.now(),
    starred: false,
    trashed: false,
    archived: false,
  };
}
