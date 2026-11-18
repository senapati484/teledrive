import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TeleFile } from "@/lib/types";
import { computeItemStats } from "@/lib/files/fileStats";
import { FileIcon } from "./FileIcon";
import { FolderIcon } from "./FolderIcon";
import { Lock, CheckCircle, Star, HardDrive, Folder, FileText, Clock, MapPin } from "lucide-react";

interface FileInfoDialogProps {
  file: TeleFile | null;
  allFiles: TeleFile[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  Images: "bg-sky-500",
  Videos: "bg-violet-500",
  Audio: "bg-amber-500",
  Documents: "bg-emerald-500",
  Archives: "bg-rose-500",
  Other: "bg-slate-400",
};

function formatBytes(bytes: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value >= 100 || idx === 0 ? Math.round(value) : value.toFixed(1)} ${units[idx]}`;
}

function formatDateTime(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export function FileInfoDialog({
  file,
  allFiles,
  open,
  onOpenChange,
}: FileInfoDialogProps) {
  const { t } = useTranslation("files");

  const stats = useMemo(
    () => (file ? computeItemStats(file, allFiles) : null),
    [file, allFiles],
  );

  if (!file || !stats) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl p-6 bg-white dark:bg-[#141518] border border-slate-200/80 dark:border-white/[0.08]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-base font-semibold text-[#1f1f1f] dark:text-[#e3e3e3] pr-6">
            <div className="h-10 w-10 rounded-xl bg-[#f0f4f9] dark:bg-[#1e2024] flex items-center justify-center shrink-0">
              {stats.isDirectory ? (
                <FolderIcon className="h-6 w-6" />
              ) : (
                <FileIcon mime={file.mime} name={file.name} className="h-6 w-6" />
              )}
            </div>
            <span className="truncate" title={file.name}>
              {file.name}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Status Badges */}
          <div className="flex flex-wrap gap-1.5">
            {file.enc && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
                <Lock className="h-3 w-3" />
                {t("info.encrypted", "End-to-end encrypted")}
              </span>
            )}
            {file.offline && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-500/20">
                <CheckCircle className="h-3 w-3" />
                {t("info.offline", "Available offline")}
              </span>
            )}
            {file.starred && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {t("info.starred", "Starred")}
              </span>
            )}
          </div>

          {/* Core Metadata Grid */}
          <dl className="divide-y divide-slate-100 dark:divide-white/[0.06] rounded-xl border border-slate-200/70 dark:border-white/[0.06] bg-[#f8fafc] dark:bg-[#0c0d0f] px-3.5 text-xs">
            <div className="py-2.5 flex items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-[#747775] dark:text-[#8e918f] shrink-0">
                <HardDrive className="h-3.5 w-3.5" />
                <span>{stats.isDirectory ? t("info.totalSize", "Total size") : t("info.size", "Size")}</span>
              </dt>
              <dd className="font-semibold text-[#1f1f1f] dark:text-[#e3e3e3] text-right">
                {formatBytes(stats.totalBytes)}
              </dd>
            </div>

            {stats.isDirectory && (
              <div className="py-2.5 flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-[#747775] dark:text-[#8e918f] shrink-0">
                  <Folder className="h-3.5 w-3.5" />
                  <span>{t("info.contents", "Contents")}</span>
                </dt>
                <dd className="font-medium text-[#1f1f1f] dark:text-[#e3e3e3] text-right">
                  {t("info.contentsSummary", {
                    files: stats.fileCount,
                    folders: stats.folderCount,
                    defaultValue: `${stats.fileCount} files, ${stats.folderCount} folders`,
                  })}
                </dd>
              </div>
            )}

            <div className="py-2.5 flex items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-[#747775] dark:text-[#8e918f] shrink-0">
                <FileText className="h-3.5 w-3.5" />
                <span>{t("info.type", "Type")}</span>
              </dt>
              <dd className="font-mono text-[11px] text-[#444746] dark:text-[#c4c7c5] truncate max-w-[220px]" title={file.mime}>
                {stats.isDirectory ? t("info.folder", "Folder") : file.mime || "application/octet-stream"}
              </dd>
            </div>

            <div className="py-2.5 flex items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-[#747775] dark:text-[#8e918f] shrink-0">
                <MapPin className="h-3.5 w-3.5" />
                <span>{t("info.location", "Location")}</span>
              </dt>
              <dd className="font-mono text-[11px] text-[#444746] dark:text-[#c4c7c5] truncate max-w-[220px]" title={stats.fullPath}>
                {file.folderPath || "/"}
              </dd>
            </div>

            <div className="py-2.5 flex items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-[#747775] dark:text-[#8e918f] shrink-0">
                <Clock className="h-3.5 w-3.5" />
                <span>{t("info.modified", "Last modified")}</span>
              </dt>
              <dd className="font-medium text-[#444746] dark:text-[#c4c7c5] text-right">
                {formatDateTime(stats.lastModifiedAt)}
              </dd>
            </div>
          </dl>

          {/* Storage Breakdown Bar for Folders */}
          {stats.isDirectory && stats.breakdown.length > 0 && (
            <div className="space-y-2.5 pt-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#747775] dark:text-[#8e918f] block">
                {t("info.breakdown", "Storage Breakdown")}
              </span>
              <div
                className="h-2.5 w-full rounded-full overflow-hidden flex bg-slate-100 dark:bg-white/[0.06]"
                aria-label={t("info.breakdown", "Storage Breakdown")}
              >
                {stats.breakdown.map((seg) => (
                  <div
                    key={seg.category}
                    className={`${CATEGORY_COLORS[seg.category] ?? "bg-slate-400"} h-full`}
                    style={{ width: `${Math.max(seg.percentage, 2)}%` }}
                    title={`${seg.category}: ${formatBytes(seg.bytes)} (${seg.percentage}%)`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {stats.breakdown.map((seg) => (
                  <div key={seg.category} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[#444746] dark:text-[#c4c7c5] truncate">
                      <span
                        className={`h-2 w-2 rounded-full shrink-0 ${CATEGORY_COLORS[seg.category] ?? "bg-slate-400"}`}
                      />
                      <span className="truncate">{seg.category}</span>
                      <span className="text-[10px] text-[#747775] dark:text-[#8e918f]">({seg.count})</span>
                    </span>
                    <span className="font-medium text-[#1f1f1f] dark:text-[#e3e3e3] shrink-0">
                      {formatBytes(seg.bytes)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
