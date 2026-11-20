/**
 * BackupSection — settings panel for the device-backup Pro feature.
 *
 * Renders inside PlanSection (Settings → Plan & Devices). For FREE users
 * the section is visible but disabled with an "Upgrade to enable" CTA.
 * For PRO users it shows:
 *   - Source folders (auto-saved on pick)
 *   - Exclude patterns (auto-saved on add)
 *   - Backup cadence dropdown
 *   - Run-now button (progress surfaces in the bottom-right overlay)
 *
 * UX notes
 * --------
 * - "Save changes" button is gone. Every mutation persists immediately
 *   via the licenseStore action — see useBackupFolders for the why.
 * - Progress during a run lives in BackupProgressOverlay (mounted at
 *   app root), NOT inline in this section. The user can navigate away
 *   from Settings and still see the backup progress.
 */
import { useState } from "react";
import { logger } from "@/lib/logger";
import { Trans, useTranslation } from "react-i18next";
import {
  Clock,
  RefreshCw,
  History,
  ChevronDown,
  Check,
  FolderPlus,
  X,
  Folder,
  FileX2,
  Plus,
  ArrowRight,
  Shield,
  AlertTriangle,
  Camera,
  Download,
  Image,
  FileText,
  Music,
  Film,
  MessageSquare,
  Send,
} from "lucide-react";
import { open as tauriOpenDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { isMobilePlatform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useBackupSchedule } from "@/hooks/useBackupSchedule";
import { useBackupFolders } from "@/hooks/useBackupFolders";
import { useBackupRunner } from "@/hooks/useBackupRunner";
import { useBackupProgressStore } from "@/stores/backupProgressStore";
import { formatDistanceToNow } from "@/lib/utils";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const INTERVAL_PRESETS: Array<{
  value: string;
  labelKey: string;
  minutes: number | null;
}> = [
  { value: "off", labelKey: "backup.cadence.off", minutes: null },
  { value: "6h", labelKey: "backup.cadence.every6h", minutes: 360 },
  { value: "12h", labelKey: "backup.cadence.every12h", minutes: 720 },
  { value: "24h", labelKey: "backup.cadence.every24h", minutes: 1440 },
];

const MAX_FOLDERS = 5;
const MAX_EXCLUDES = 20;

export default function BackupSection() {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();
  const {
    intervalMinutes,
    lastBackupAt,
    lastAttemptAt,
    lastResult: persistedResult,
    isRunning: scheduleIsRunning,
    setIntervalMinutes,
  } = useBackupSchedule();
  const {
    paths,
    excludes,
    isSaving,
    addFolder,
    removeFolder,
    addExclude,
    removeExclude,
  } = useBackupFolders();
  const {
    isRunning: runnerIsRunning,
    runNow: runRunnerNow,
    cancel,
  } = useBackupRunner();

  // Read the latest result from the global progress store so we can
  // show it inline below the Run-now button.
  const liveResult = useBackupProgressStore((s) => s.lastResult);
  const runCounts = liveResult
    ? {
        uploaded: liveResult.filesUploaded,
        skipped: liveResult.filesSkipped,
        failed: liveResult.filesFailed,
      }
    : persistedResult
      ? {
          uploaded: persistedResult.uploaded,
          skipped: persistedResult.skipped,
          failed: persistedResult.failed,
        }
      : null;
  const runStatus = liveResult?.status ?? persistedResult?.status ?? null;
  const missingRoots =
    liveResult?.missingRoots ?? persistedResult?.missingRoots ?? [];

  const [excludeDraft, setExcludeDraft] = useState("");
  const [pendingInterval, setPendingInterval] = useState<string | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [manualFolderInput, setManualFolderInput] = useState("");

  const MOBILE_FOLDER_PRESETS = [
    { label: t("backup.folders.dialog.camera"), path: "/storage/emulated/0/DCIM/Camera", icon: Camera },
    { label: t("backup.folders.dialog.downloads"), path: "/storage/emulated/0/Download", icon: Download },
    { label: t("backup.folders.dialog.pictures"), path: "/storage/emulated/0/Pictures", icon: Image },
    { label: t("backup.folders.dialog.documents"), path: "/storage/emulated/0/Documents", icon: FileText },
    { label: t("backup.folders.dialog.music"), path: "/storage/emulated/0/Music", icon: Music },
    { label: t("backup.folders.dialog.movies"), path: "/storage/emulated/0/Movies", icon: Film },
    { label: t("backup.folders.dialog.whatsapp"), path: "/storage/emulated/0/Android/media/com.whatsapp/WhatsApp/Media", icon: MessageSquare },
    { label: t("backup.folders.dialog.telegram"), path: "/storage/emulated/0/Download/Telegram", icon: Send },
  ];

  const isRunning = scheduleIsRunning || runnerIsRunning;

  const currentPreset =
    INTERVAL_PRESETS.find((p) => p.minutes === intervalMinutes)?.value ?? "off";

  async function handleChange(value: string) {
    const preset = INTERVAL_PRESETS.find((p) => p.value === value);
    if (!preset) return;
    setPendingInterval(value);
    try {
      await setIntervalMinutes(preset.minutes);
    } catch (err) {
      logger.warn("[BackupSection] setIntervalMinutes failed:", err);
    } finally {
      setPendingInterval(null);
    }
  }

  async function handleAddFolder() {
    const { isWebRuntime } = await import("@/lib/runtime/bridge");
    if (isWebRuntime()) {
      toast.info("Local folder backups require the desktop or mobile app.");
      return;
    }
    if (paths.length >= MAX_FOLDERS) {
      toast.warning(t("backup.toasts.maxFolders", { count: MAX_FOLDERS }));
      return;
    }

    if (isMobilePlatform()) {
      setFolderDialogOpen(true);
      return;
    }

    try {
      const selected = await tauriOpenDialog({
        directory: true,
        multiple: false,
        title: t("backup.folders.pickerTitle"),
      });
      if (!selected || typeof selected !== "string") return;
      // Auto-save — folder appears in the list immediately.
      addFolder(selected);
    } catch (err) {
      logger.warn("[BackupSection] native folder picker failed, falling back to manual dialog:", err);
      setFolderDialogOpen(true);
    }
  }

  function handleConfirmManualFolder(folderPathToUse?: string) {
    const target = (folderPathToUse ?? manualFolderInput).trim();
    if (!target) {
      toast.error(t("backup.folders.dialog.invalidPath"));
      return;
    }
    addFolder(target);
    setManualFolderInput("");
    setFolderDialogOpen(false);
  }

  function handleAddExclude() {
    if (excludes.length >= MAX_EXCLUDES) {
      toast.warning(t("backup.toasts.maxExcludes", { count: MAX_EXCLUDES }));
      return;
    }
    addExclude(excludeDraft);
    setExcludeDraft("");
  }

  async function handleRunNow() {
    if (paths.length === 0) {
      toast.warning(t("backup.toasts.noFolders"));
      return;
    }
    try {
      await runRunnerNow();
    } catch (err) {
      logger.warn("[BackupSection] runNow failed:", err);
    }
  }

  const lastBackupLabel = lastBackupAt
    ? t("backup.lastBackupAgo", { time: formatDistanceToNow(lastBackupAt) })
    : t("backup.never");
  const lastAttemptLabel = lastAttemptAt
    ? t("backup.lastAttemptAgo", { time: formatDistanceToNow(lastAttemptAt) })
    : null;

  const currentLabelKey =
    INTERVAL_PRESETS.find((p) => p.value === currentPreset)?.labelKey ?? "backup.cadence.off";

  return (
    <div className="space-y-6 select-none">
      <div>
        <h3 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
          {t("backup.title")}
        </h3>
        <p className="text-sm text-[#444746] dark:text-[#C4C7C5] mt-1">
          {t("backup.description")}
        </p>
      </div>

      {/* Source folders Card */}
      <div
        id="backup-folders"
        className="p-6 bg-white dark:bg-[#0c0d0f] border border-slate-200/90 dark:border-white/[0.06] rounded-2xl space-y-4 shadow-xs">
        <div className="flex items-start gap-3.5">
          <div className="h-10 w-10 rounded-full bg-[#C2E7FF]/60 dark:bg-[#004A77]/40 border border-[#0B57D0]/20 dark:border-[#1a73e8]/20 flex items-center justify-center text-[#0B57D0] dark:text-[#8ab4f8] shrink-0 mt-0.5">
            <Folder className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                {t("backup.folders.title")}
              </h4>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-[#060709] border border-transparent dark:border-white/[0.06] text-[#444746] dark:text-[#C4C7C5]">
                {paths.length}/{MAX_FOLDERS}
              </span>
              {isSaving && (
                <span className="text-[11px] text-[#747775] italic">
                  {t("backup.folders.saving")}
                </span>
              )}
            </div>
            <p className="text-xs text-[#444746] dark:text-[#C4C7C5] leading-relaxed">
              {t("backup.folders.description")}
            </p>
            {paths.length === 0 ? (
              <p className="text-xs text-[#747775] italic py-1">
                {t("backup.folders.empty")}
              </p>
            ) : (
              <ul className="space-y-2">
                {paths.map((p) => (
                  <li
                    key={p}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#060709] border border-slate-200/70 dark:border-white/[0.06] text-xs"
                  >
                    <Folder className="h-4 w-4 text-[#0B57D0] dark:text-[#8ab4f8] shrink-0" />
                    <span
                      className="flex-1 truncate font-mono text-[11px] text-[#1F1F1F] dark:text-[#E3E3E3]"
                      title={p}
                    >
                      {p}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFolder(p)}
                      className="h-6 w-6 rounded-full hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center text-[#747775] hover:text-rose-600 transition-colors"
                      aria-label={t("backup.remove", { item: p })}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={handleAddFolder}
                disabled={paths.length >= MAX_FOLDERS}
                className="rounded-full text-xs font-medium border-slate-300 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-200 cursor-pointer h-9 px-4"
              >
                <FolderPlus className="h-3.5 w-3.5 mr-1.5 text-[#0B57D0] dark:text-[#8ab4f8]" />
                {t("backup.folders.add")}
              </Button>
              {!isMobilePlatform() && (
                <button
                  type="button"
                  onClick={() => setFolderDialogOpen(true)}
                  disabled={paths.length >= MAX_FOLDERS}
                  className="text-xs text-[#0B57D0] dark:text-[#8ab4f8] hover:underline px-2 py-1"
                >
                  {t("backup.folders.enterManually")}
                </button>
              )}
            </div>

            <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
              <DialogContent className="max-w-md p-6 bg-white dark:bg-[#161719] border border-slate-200/80 dark:border-white/[0.08] rounded-2xl">
                <DialogHeader>
                  <DialogTitle className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                    {t("backup.folders.dialog.title")}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-[#444746] dark:text-[#C4C7C5]">
                    {t("backup.folders.dialog.description")}
                  </DialogDescription>
                </DialogHeader>

                {isMobilePlatform() && (
                  <div className="space-y-2 mt-2">
                    <span className="text-xs font-medium text-[#444746] dark:text-[#C4C7C5]">
                      {t("backup.folders.dialog.presets")}
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      {MOBILE_FOLDER_PRESETS.map((preset) => {
                        const Icon = preset.icon;
                        const isAdded = paths.includes(preset.path);
                        return (
                          <button
                            key={preset.path}
                            type="button"
                            disabled={isAdded}
                            onClick={() => handleConfirmManualFolder(preset.path)}
                            className={cn(
                              "flex items-center gap-2 p-2 rounded-xl border text-xs text-left transition-all",
                              isAdded
                                ? "opacity-50 cursor-not-allowed bg-slate-50 dark:bg-white/[0.02] border-slate-200/40 dark:border-white/[0.04]"
                                : "hover:bg-slate-50 dark:hover:bg-white/[0.04] border-slate-200/80 dark:border-white/[0.08] active:scale-[0.98]"
                            )}
                          >
                            <Icon className="h-4 w-4 text-[#0B57D0] dark:text-[#8ab4f8] shrink-0" />
                            <div className="min-w-0 flex-1 truncate">
                              <div className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3] truncate">
                                {preset.label}
                              </div>
                              <div className="text-[10px] text-[#747775] truncate font-mono">
                                {preset.path.split("/").slice(-2).join("/")}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-2 mt-3">
                  <label className="text-xs font-medium text-[#444746] dark:text-[#C4C7C5]">
                    {t("backup.folders.dialog.customPath")}
                  </label>
                  <Input
                    value={manualFolderInput}
                    onChange={(e) => setManualFolderInput(e.target.value)}
                    placeholder={t("backup.folders.dialog.pathPlaceholder")}
                    className="text-xs font-mono h-9 bg-slate-50 dark:bg-[#060709] border-slate-300 dark:border-white/[0.08]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleConfirmManualFolder();
                      }
                    }}
                  />
                </div>

                <DialogFooter className="mt-4 flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setFolderDialogOpen(false);
                      setManualFolderInput("");
                    }}
                    className="rounded-full text-xs"
                  >
                    {t("backup.folders.dialog.cancel")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleConfirmManualFolder()}
                    disabled={!manualFolderInput.trim()}
                    className="rounded-full text-xs bg-[#0B57D0] hover:bg-[#0B57D0]/90 text-white"
                  >
                    {t("backup.folders.dialog.add")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {/* Exclude patterns Card */}
      <div className="p-6 bg-white dark:bg-[#0c0d0f] border border-slate-200/90 dark:border-white/[0.06] rounded-2xl space-y-4 shadow-xs">
        <div className="flex items-start gap-3.5">
          <div className="h-10 w-10 rounded-full bg-[#C2E7FF]/60 dark:bg-[#004A77]/40 border border-[#0B57D0]/20 dark:border-[#1a73e8]/20 flex items-center justify-center text-[#0B57D0] dark:text-[#8ab4f8] shrink-0 mt-0.5">
            <FileX2 className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                {t("backup.excludes.title")}
              </h4>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-[#060709] border border-transparent dark:border-white/[0.06] text-[#444746] dark:text-[#C4C7C5]">
                {excludes.length}/{MAX_EXCLUDES}
              </span>
            </div>
            <p className="text-xs text-[#444746] dark:text-[#C4C7C5] leading-relaxed">
              <Trans
                t={t}
                i18nKey="backup.excludes.description"
                components={{
                  code: <code className="text-[11px] bg-slate-100 dark:bg-[#060709] px-1.5 py-0.5 rounded border border-slate-200/60 dark:border-white/[0.06]" />,
                }}
              />
            </p>
            {excludes.length === 0 ? (
              <p className="text-xs text-[#747775] italic py-1">
                {t("backup.excludes.empty")}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {excludes.map((p) => (
                  <li
                    key={p}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-[#060709] border border-slate-200/70 dark:border-white/[0.06] text-xs"
                  >
                    <span
                      className="flex-1 truncate font-mono text-[11px] text-[#1F1F1F] dark:text-[#E3E3E3]"
                      title={p}
                    >
                      {p}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeExclude(p)}
                      className="h-7 w-7 sm:h-6 sm:w-6 rounded-full hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center text-[#747775] hover:text-rose-600 transition-colors cursor-pointer"
                      aria-label={t("backup.remove", { item: p })}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2 pt-1">
              <Input
                value={excludeDraft}
                onChange={(e) => setExcludeDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddExclude();
                  }
                }}
                placeholder={t("backup.excludes.placeholder")}
                disabled={excludes.length >= MAX_EXCLUDES}
                inputMode="text"
                autoComplete="off"
                enterKeyHint="done"
                className="h-9 text-xs font-mono rounded-xl flex-1 bg-slate-50 dark:bg-[#060709] border-slate-300 dark:border-white/[0.08] focus:bg-white dark:focus:bg-[#0a0b0d]"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleAddExclude}
                disabled={
                  excludes.length >= MAX_EXCLUDES ||
                  excludeDraft.trim().length === 0
                }
                className="rounded-full text-xs font-medium border-slate-300 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-200 cursor-pointer h-9 px-3.5"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t("backup.excludes.add")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Cadence Card */}
      <div className="p-6 bg-white dark:bg-[#0c0d0f] border border-slate-200/90 dark:border-white/[0.06] rounded-2xl space-y-5 shadow-xs">
        <div className="flex items-start gap-3.5">
          <div className="h-10 w-10 rounded-full bg-[#C2E7FF]/60 dark:bg-[#004A77]/40 border border-[#0B57D0]/20 dark:border-[#1a73e8]/20 flex items-center justify-center text-[#0B57D0] dark:text-[#8ab4f8] shrink-0 mt-0.5">
            <Clock className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                {t("backup.cadence.title")}
              </h4>
              {intervalMinutes !== null && (
                <span className="bg-blue-50 dark:bg-[#004A77]/30 text-[#0B57D0] dark:text-[#8ab4f8] border border-blue-200/60 dark:border-[#1a73e8]/30 font-medium text-[11px] px-2.5 py-0.5 rounded-full">
                  {t("backup.cadence.active")}
                </span>
              )}
            </div>
            <p className="text-xs text-[#444746] dark:text-[#C4C7C5] leading-relaxed">
              {t("backup.cadence.description")}
            </p>
            <div className="pt-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={pendingInterval !== null}
                    className="w-full sm:w-56 rounded-full h-10 text-xs font-medium justify-between border-slate-300 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-[#747775] dark:text-[#9aa0a6]" />
                      {t(currentLabelKey)}
                    </span>
                    <ChevronDown className="h-4 w-4 text-[#747775] dark:text-[#9aa0a6]" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-56 rounded-2xl bg-white dark:bg-[#0d0e11] border-slate-200 dark:border-white/[0.08] p-1.5 shadow-lg"
                >
                  {INTERVAL_PRESETS.map((p) => {
                    const isCurrent = p.value === currentPreset;
                    return (
                      <DropdownMenuItem
                        key={p.value}
                        onSelect={() => handleChange(p.value)}
                        className="rounded-xl text-xs font-medium cursor-pointer dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-200"
                      >
                        <span className="flex-1">{t(p.labelKey)}</span>
                        {isCurrent && (
                          <Check className="h-4 w-4 text-[#0B57D0] dark:text-[#8ab4f8]" />
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Last run + Run now / Cancel */}
        <div className="flex items-center justify-between flex-wrap gap-3 pt-4 border-t border-slate-200/80 dark:border-white/[0.06]">
          <div className="flex flex-col gap-0.5 text-xs text-[#747775] dark:text-[#9aa0a6] min-w-0">
            <div className="flex items-center gap-2">
              <History className="h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {t("backup.lastBackup")}
                </span>{" "}
                {lastBackupLabel}
              </span>
            </div>
            {lastAttemptLabel && runStatus && (
              <div className="pl-5 text-[11px]">
                {t("backup.lastAttempt")} {lastAttemptLabel} ·{" "}
                <span
                  className={
                    runStatus === "failed"
                      ? "text-rose-600 dark:text-rose-400"
                      : runStatus === "cancelled"
                        ? "text-slate-500"
                        : "text-[#444746] dark:text-[#C4C7C5]"
                  }
                >
                  {t(`backup.runStatus.${runStatus}`)}
                </span>
              </div>
            )}
            {runCounts && (
              <div className="pl-5 text-[11px]">
                {runCounts.uploaded > 0 && (
                  <span>{t("backup.lastResult.uploaded", { count: runCounts.uploaded })}</span>
                )}
                {runCounts.skipped > 0 && (
                  <span>{t("backup.lastResult.unchanged", { count: runCounts.skipped })}</span>
                )}
                {runCounts.failed > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {t("backup.lastResult.failed", { count: runCounts.failed })}
                  </span>
                )}
              </div>
            )}
            {missingRoots.length > 0 && (
              <div
                role="alert"
                className="mt-1 ml-5 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300/60 bg-amber-50/80 dark:border-amber-700/40 dark:bg-amber-950/30 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-200"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{t("backup.missingRoots", { count: missingRoots.length })}</span>
                <button
                  type="button"
                  onClick={() =>
                    document
                      .getElementById("backup-folders")
                      ?.scrollIntoView({ behavior: "smooth", block: "center" })
                  }
                  className="font-semibold underline underline-offset-2 hover:no-underline"
                >
                  {t("backup.editFolders")}
                </button>
              </div>
            )}
            {isRunning && (
              <div className="pl-5 text-[11px] text-[#0B57D0] dark:text-[#8ab4f8] font-medium">
                {t("backup.progressHint")}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <Button
                size="sm"
                variant="ghost"
                onClick={cancel}
                className="rounded-full text-xs font-medium h-9 px-4 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
              >
                {t("backup.cancel")}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="rounded-full text-xs font-medium border-slate-300 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-200 cursor-pointer h-9 px-4 disabled:opacity-50"
              onClick={handleRunNow}
              disabled={isRunning || paths.length === 0}
            >
              {isRunning ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin text-[#0B57D0] dark:text-[#8ab4f8]" />
                  {t("backup.running")}
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 text-[#0B57D0] dark:text-[#8ab4f8]" />
                  {t("backup.runNow")}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Footer explainer callout */}
      <div className="flex items-start sm:items-center gap-3.5 justify-between flex-wrap p-4 rounded-2xl bg-[#F0F4F9] dark:bg-[#060709] border border-slate-200/60 dark:border-white/[0.06] text-xs text-[#444746] dark:text-[#C4C7C5] leading-relaxed">
        <div className="flex items-start gap-2.5 flex-1 min-w-[220px]">
          <span className="text-base select-none mt-0.5">💡</span>
          <span>
            <Trans t={t} i18nKey="backup.howItWorks" components={{ strong: <strong /> }} />
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate("/drive/backups")}
          className="rounded-full text-xs font-medium border-slate-300 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-200 cursor-pointer h-9 px-4 shrink-0"
        >
          <Shield className="h-3.5 w-3.5 mr-1.5 text-[#0B57D0] dark:text-[#8ab4f8]" />
          {t("backup.viewBackups")}
          <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
        </Button>
      </div>
    </div>
  );
}