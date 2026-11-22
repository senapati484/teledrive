import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, History } from "lucide-react";
import { logger } from "@/lib/logger";
import { findBackupVersions, type ManifestVersion } from "@/lib/backup/manifest";
import { isWebRuntime } from "@/lib/runtime/bridge";
import type { TeleFile } from "@/lib/types";

interface BackupVersionListProps {
  file: TeleFile;
  formatBytes: (bytes: number) => string;
  formatDateTime: (ts: number) => string;
}

/** "report.pdf" + date → "report (2026-11-20 14-05).pdf" */
export function versionFileName(name: string, uploadedAt: string): string {
  const d = new Date(uploadedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = Number.isFinite(d.getTime())
    ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`
    : "old";
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? `${name.slice(0, dot)} (${stamp})${name.slice(dot)}`
    : `${name} (${stamp})`;
}

/**
 * Earlier versions the device backup kept for this file. Each one downloads
 * through the normal download flow under a dated name, so restoring never
 * overwrites the current copy.
 */
export function BackupVersionList({ file, formatBytes, formatDateTime }: BackupVersionListProps) {
  const { t } = useTranslation("files");
  const [versions, setVersions] = useState<ManifestVersion[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVersions(null);
    if (isWebRuntime() || !file.channelId || !(Number(file.messageId) > 0)) {
      setVersions([]);
      return;
    }
    findBackupVersions(file.channelId, Number(file.messageId))
      .then((found) => { if (!cancelled) setVersions(found); })
      .catch((err) => {
        logger.warn("[BackupVersionList] could not load versions:", err);
        if (!cancelled) setVersions([]);
      });
    return () => { cancelled = true; };
  }, [file.channelId, file.messageId]);

  if (!versions) return null;

  function download(version: ManifestVersion) {
    // Built field by field: segments/encryption of the current copy do not
    // describe an older upload.
    const detail: TeleFile = {
      id: `backup_version_${version.messageId}`,
      name: versionFileName(file.name, version.uploadedAt),
      size: version.size,
      mime: file.mime,
      folderPath: file.folderPath,
      messageId: version.messageId,
      channelId: file.channelId,
      uploadedAt: Date.parse(version.uploadedAt) || file.uploadedAt,
      ...(version.hash ? { hash: version.hash } : {}),
      ...(version.segments ? { segments: version.segments } : {}),
      starred: false,
      trashed: false,
    };
    window.dispatchEvent(new CustomEvent("teledrive-download-file", { detail }));
  }

  return (
    <div className="space-y-2 pt-1">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#747775] dark:text-[#8e918f]">
        <History className="h-3.5 w-3.5" />
        {t("info.versions.title", "Previous versions")}
      </span>
      {versions.length === 0 ? (
        <p className="text-xs text-[#747775] dark:text-[#8e918f]">
          {t("info.versions.none", "No earlier versions kept for this file.")}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/[0.06] rounded-xl border border-slate-200/70 dark:border-white/[0.06] bg-[#f8fafc] dark:bg-[#0c0d0f] text-xs">
          {versions.map((version) => (
            <li key={version.messageId} className="flex items-center justify-between gap-3 px-3.5 py-2">
              <span className="text-[#444746] dark:text-[#c4c7c5]">
                {formatDateTime(Date.parse(version.uploadedAt))}
                <span className="ml-2 text-[#747775] dark:text-[#8e918f]">{formatBytes(version.size)}</span>
              </span>
              <button
                type="button"
                onClick={() => download(version)}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium text-[#0B57D0] dark:text-[#8ab4f8] hover:bg-[#e8f0fe] dark:hover:bg-[#1f2124]"
              >
                <Download className="h-3.5 w-3.5" />
                {t("info.versions.download", "Download")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
