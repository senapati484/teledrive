import { useState, useCallback } from "react";
import { HardDrive, RefreshCw, Info, Loader2, Files, Folder, Trash2, ShieldCheck, RotateCcw } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { useFileStore } from "@/stores/fileStore";
import { loadIndexOutcome } from "@/lib/storage/metadataStore";
import { retryIndexDiscovery } from "@/lib/telegram/bootstrap";
import { useRecoveryStore } from "@/stores/recoveryStore";
import { getSecret, VAULT_KEY_CHANNEL_ID, channelIdKey } from "@/lib/secure/vault";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function formatBytes(bytes: number): string {
  if (!bytes || !isFinite(bytes) || bytes <= 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const value = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
  return `${value} ${sizes[i]}`;
}

function safeSize(raw: unknown): number {
  if (raw == null) return 0;
  const n = Number(raw);
  return isFinite(n) && n >= 0 ? n : 0;
}

export default function StorageSection() {
  const { t } = useTranslation("settings");
  const files = useFileStore((state) => state.files);
  const setFiles = useFileStore((state) => state.setFiles);
  const indexQueueState = useFileStore((state) => state.indexQueueState);
  const indexQueueRetryInSec = useFileStore(
    (state) => state.indexQueueRetryInSec
  );
  const phoneNumber = useAuthStore((state) => state.phoneNumber);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const openRecovery = useRecoveryStore((s) => s.openFor);

  const activeFiles = files.filter((f) => !f.trashed && f.mime !== "inode/directory");
  const activeFolders = files.filter((f) => !f.trashed && f.mime === "inode/directory");
  const trashedItems = files.filter((f) => f.trashed);

  const totalSizeBytes = activeFiles.reduce((acc, f) => acc + safeSize(f.size), 0);
  const formattedSize = formatBytes(totalSizeBytes);

  const handleRecalculate = useCallback(async () => {
    setIsRefreshing(true);
    try {
      let channelId: string | null = null;
      if (phoneNumber) {
        channelId = await getSecret(channelIdKey(phoneNumber));
      }
      if (!channelId) {
        channelId = await getSecret(VAULT_KEY_CHANNEL_ID);
      }
      if (!channelId) {
        toast.error(t("storage.toasts.channelNotInitialised"));
        return;
      }
      const outcome = await loadIndexOutcome(channelId);
      if (outcome.status !== "ready") {
        retryIndexDiscovery(channelId);
        toast.error(t("storage.toasts.indexIncomplete"));
        return;
      }
      let freshFiles = outcome.files;
      try {
        const { syncOfflineStatusWithDisk } = await import("@/lib/storage/offlineStorage");
        freshFiles = await syncOfflineStatusWithDisk(freshFiles);
      } catch (err) {
        console.warn("[StorageSection] Failed to sync offline status with disk:", err);
      }
      setFiles(freshFiles);
      toast.success(t("storage.toasts.refreshed"));
    } catch (err: any) {
      console.error("[StorageSection] Recalculate failed:", err);
      toast.error(err?.message || t("storage.toasts.refreshFailed"));
    } finally {
      setIsRefreshing(false);
    }
  }, [setFiles, phoneNumber]);

  const handleOpenRecovery = useCallback(async () => {
    let channelId: string | null = null;
    if (phoneNumber) {
      channelId = await getSecret(channelIdKey(phoneNumber));
    }
    if (!channelId) {
      channelId = await getSecret(VAULT_KEY_CHANNEL_ID);
    }
    if (!channelId) {
      toast.error(t("storage.toasts.channelNotInitialised"));
      return;
    }
    openRecovery(channelId);
  }, [openRecovery, phoneNumber, t]);

  return (
    <div className="space-y-6 select-none">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">
          {t("storage.title")}
        </h2>
        <p className="text-sm text-[#444746] dark:text-[#C4C7C5]">
          {t("storage.description")}
        </p>
      </div>

      {/* Main Storage Meter Card */}
      <div className="p-6 border border-slate-200/90 dark:border-white/[0.06] rounded-2xl bg-white dark:bg-[#0c0d0f] shadow-xs space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="h-11 w-11 rounded-full bg-[#C2E7FF]/60 dark:bg-[#004A77]/40 border border-[#0B57D0]/20 dark:border-[#1a73e8]/20 flex items-center justify-center text-[#0B57D0] dark:text-[#8ab4f8] shrink-0">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-[#747775] dark:text-[#8E918F] uppercase tracking-wider block">
                {t("storage.totalUsed")}
              </span>
              {isRefreshing ? (
                <span className="text-xl font-bold flex items-center gap-2 text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin text-[#0B57D0] dark:text-[#8ab4f8]" />
                  {t("storage.calculating")}
                </span>
              ) : (
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[#1F1F1F] dark:text-[#E3E3E3] tracking-tight">
                    {formattedSize}
                  </span>
                  <span className="text-xs font-medium text-[#747775] dark:text-[#8E918F]">
                    {t("storage.ofUnlimited")}
                  </span>
                </div>
              )}
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/20 rounded-full px-3 py-1 self-start sm:self-auto">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t("storage.unlimitedBadge")}
          </span>
        </div>

        {/* Google Drive style linear progress meter */}
        <div className="space-y-1.5">
          <div className="h-2 rounded-full bg-slate-100 dark:bg-[#060709] overflow-hidden">
            <div className="h-full bg-[#0B57D0] dark:bg-[#1a73e8] w-3 rounded-full" />
          </div>
          <div className="flex justify-between text-[11px] text-[#747775] dark:text-[#8E918F] font-medium">
            <span>0 Bytes</span>
            <span>{t("storage.meterLabel")}</span>
          </div>
        </div>

        {/* 3-Column Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-white/[0.06]">
          <div className="p-3.5 rounded-xl bg-[#F0F4F9] dark:bg-[#060709] border border-slate-200/60 dark:border-white/[0.06] flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 text-[#0B57D0] dark:text-[#8ab4f8] flex items-center justify-center shrink-0">
              <Files className="h-4 w-4" />
            </div>
            <div>
              <span className="text-[11px] font-medium text-[#747775] dark:text-[#8E918F] block">
                {t("storage.stats.files")}
              </span>
              <span className="font-bold text-base text-[#1F1F1F] dark:text-[#E3E3E3]">
                {isRefreshing ? "…" : activeFiles.length}
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F0F4F9] dark:bg-[#060709] border border-slate-200/60 dark:border-white/[0.06] flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Folder className="h-4 w-4" />
            </div>
            <div>
              <span className="text-[11px] font-medium text-[#747775] dark:text-[#8E918F] block">
                {t("storage.stats.folders")}
              </span>
              <span className="font-bold text-base text-[#1F1F1F] dark:text-[#E3E3E3]">
                {isRefreshing ? "…" : activeFolders.length}
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F0F4F9] dark:bg-[#060709] border border-slate-200/60 dark:border-white/[0.06] flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-rose-500/10 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <Trash2 className="h-4 w-4" />
            </div>
            <div>
              <span className="text-[11px] font-medium text-[#747775] dark:text-[#8E918F] block">
                {t("storage.stats.trash")}
              </span>
              <span className="font-bold text-base text-[#1F1F1F] dark:text-[#E3E3E3]">
                {isRefreshing ? "…" : trashedItems.length}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isRefreshing}
            onClick={handleRecalculate}
            className="rounded-full text-xs font-medium gap-2 h-9 px-4 border border-slate-300 dark:border-white/[0.08] hover:bg-[#F0F4F9] dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            {isRefreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0B57D0] dark:text-[#8ab4f8]" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 text-[#444746] dark:text-[#C4C7C5]" />
            )}
            {isRefreshing ? t("storage.recalculating") : t("storage.recalculate")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenRecovery}
            className="rounded-full text-xs font-medium gap-2 h-9 px-4 border border-amber-500/40 text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950/30 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("storage.recovery.button")}
          </Button>
        </div>

        {(indexQueueState === "saving" ||
          (indexQueueState === "retrying" && indexQueueRetryInSec > 0)) && (
          <p
            role="status"
            aria-live="polite"
            className="text-xs text-slate-500 dark:text-slate-400"
          >
            {indexQueueState === "retrying"
              ? t("storage.indexSave.retrying", {
                  seconds: indexQueueRetryInSec,
                })
              : t("storage.indexSave.saving")}
          </p>
        )}
      </div>

      {/* Storage Guidelines Info Box */}
      <div className="p-4 rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-[#F0F4F9] dark:bg-[#060709] text-xs text-[#444746] dark:text-[#C4C7C5] leading-relaxed flex items-start gap-3">
        <Info className="h-4.5 w-4.5 text-[#0B57D0] dark:text-[#8ab4f8] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p>
            {t("storage.info.noLimit")}
          </p>
          <p>
            <Trans t={t} i18nKey="storage.info.fileLimits" components={{ strong: <strong /> }} />
          </p>
        </div>
      </div>
    </div>
  );
}
