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
  const lastResult = useBackupProgressStore((s) => s.lastResult);

  const [excludeDraft, setExcludeDraft] = useState("");
  const [pendingInterval, setPendingInterval] = useState<string | null>(null);

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
      console.warn("[BackupSection] setIntervalMinutes failed:", err);
    } finally {
      setPendingInterval(null);
    }
  }

  async function handleAddFolder() {
    if (paths.length >= MAX_FOLDERS) {
      toast.warning(t("backup.toasts.maxFolders", { count: MAX_FOLDERS }));
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
      console.warn("[BackupSection] folder picker failed:", err);
      toast.error(t("backup.toasts.pickerFailed"), {
        description: err instanceof Error ? err.message : String(err),
      });
    }
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
      console.warn("[BackupSection] runNow failed:", err);
    }
  }

  const lastBackupLabel = lastBackupAt
    ? t("backup.lastBackupAgo", { time: formatDistanceToNow(lastBackupAt) })
    : t("backup.never");

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
      <div className="p-6 bg-white dark:bg-[#1E1F20] border border-slate-200/90 dark:border-slate-800 rounded-2xl space-y-4 shadow-xs">
        <div className="flex items-start gap-3.5">
          <div className="h-10 w-10 rounded-full bg-[#C2E7FF] dark:bg-[#004A77] flex items-center justify-center text-[#0B57D0] dark:text-[#A8C7FA] shrink-0 mt-0.5">
            <Folder className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                {t("backup.folders.title")}
              </h4>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[#444746] dark:text-[#C4C7C5]">
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
                    className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#282A2C]/60 border border-slate-200/70 dark:border-slate-800 text-xs"
                  >
                    <Folder className="h-4 w-4 text-[#0B57D0] dark:text-[#A8C7FA] shrink-0" />
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
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddFolder}
              disabled={paths.length >= MAX_FOLDERS}
              className="rounded-full text-xs font-medium border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 h-9 px-4"
            >
              <FolderPlus className="h-3.5 w-3.5 mr-1.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
              {t("backup.folders.add")}
            </Button>
          </div>
        </div>
      </div>

      {/* Exclude patterns Card */}
      <div className="p-6 bg-white dark:bg-[#1E1F20] border border-slate-200/90 dark:border-slate-800 rounded-2xl space-y-4 shadow-xs">
        <div className="flex items-start gap-3.5">
          <div className="h-10 w-10 rounded-full bg-[#C2E7FF] dark:bg-[#004A77] flex items-center justify-center text-[#0B57D0] dark:text-[#A8C7FA] shrink-0 mt-0.5">
            <FileX2 className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                {t("backup.excludes.title")}
              </h4>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[#444746] dark:text-[#C4C7C5]">
                {excludes.length}/{MAX_EXCLUDES}
              </span>
            </div>
            <p className="text-xs text-[#444746] dark:text-[#C4C7C5] leading-relaxed">
              <Trans
                t={t}
                i18nKey="backup.excludes.description"
                components={{
                  code: <code className="text-[11px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200/60 dark:border-slate-700/60" />,
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
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-[#282A2C]/60 border border-slate-200/70 dark:border-slate-800 text-xs"
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
                      className="h-6 w-6 rounded-full hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center text-[#747775] hover:text-rose-600 transition-colors"
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
                className="h-9 text-xs font-mono rounded-xl flex-1 bg-slate-50 dark:bg-[#282A2C]/50 border-slate-300 dark:border-slate-700 focus:bg-white dark:focus:bg-[#1E1F20]"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleAddExclude}
                disabled={
                  excludes.length >= MAX_EXCLUDES ||
                  excludeDraft.trim().length === 0
                }
                className="rounded-full text-xs font-medium border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 h-9 px-3.5"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t("backup.excludes.add")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Cadence Card */}
      <div className="p-6 bg-white dark:bg-[#1E1F20] border border-slate-200/90 dark:border-slate-800 rounded-2xl space-y-5 shadow-xs">
        <div className="flex items-start gap-3.5">
          <div className="h-10 w-10 rounded-full bg-[#C2E7FF] dark:bg-[#004A77] flex items-center justify-center text-[#0B57D0] dark:text-[#A8C7FA] shrink-0 mt-0.5">
            <Clock className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                {t("backup.cadence.title")}
              </h4>
              {intervalMinutes !== null && (
                <span className="bg-blue-50 dark:bg-blue-950/40 text-[#0B57D0] dark:text-[#A8C7FA] border border-blue-200/60 dark:border-blue-800/60 font-medium text-[11px] px-2.5 py-0.5 rounded-full">
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
                    className="w-full sm:w-56 rounded-full h-10 text-xs font-medium justify-between border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <span className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-[#747775]" />
                      {t(currentLabelKey)}
                    </span>
                    <ChevronDown className="h-4 w-4 text-[#747775]" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-56 rounded-2xl bg-white dark:bg-[#282A2C] border-slate-200 dark:border-slate-700 p-1.5 shadow-lg"
                >
                  {INTERVAL_PRESETS.map((p) => {
                    const isCurrent = p.value === currentPreset;
                    return (
                      <DropdownMenuItem
                        key={p.value}
                        onSelect={() => handleChange(p.value)}
                        className="rounded-xl text-xs font-medium cursor-pointer"
                      >
                        <span className="flex-1">{t(p.labelKey)}</span>
                        {isCurrent && (
                          <Check className="h-4 w-4 text-[#0B57D0] dark:text-[#A8C7FA]" />
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
        <div className="flex items-center justify-between flex-wrap gap-3 pt-4 border-t border-slate-200/80 dark:border-slate-800">
          <div className="flex flex-col gap-0.5 text-xs text-[#747775] min-w-0">
            <div className="flex items-center gap-2">
              <History className="h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {t("backup.lastBackup")}
                </span>{" "}
                {lastBackupLabel}
              </span>
            </div>
            {lastResult && (
              <div className="pl-5 text-[11px]">
                {lastResult.filesUploaded > 0 && (
                  <span>{t("backup.lastResult.uploaded", { count: lastResult.filesUploaded })}</span>
                )}
                {lastResult.filesSkipped > 0 && (
                  <span>{t("backup.lastResult.unchanged", { count: lastResult.filesSkipped })}</span>
                )}
                {lastResult.filesFailed > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {t("backup.lastResult.failed", { count: lastResult.filesFailed })}
                  </span>
                )}
              </div>
            )}
            {isRunning && (
              <div className="pl-5 text-[11px] text-[#0B57D0] dark:text-[#A8C7FA] font-medium">
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
              className="rounded-full text-xs font-medium border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 h-9 px-4 disabled:opacity-50"
              onClick={handleRunNow}
              disabled={isRunning || paths.length === 0}
            >
              {isRunning ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin text-[#0B57D0] dark:text-[#A8C7FA]" />
                  {t("backup.running")}
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
                  {t("backup.runNow")}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Footer explainer callout */}
      <div className="flex items-start sm:items-center gap-3.5 justify-between flex-wrap p-4 rounded-2xl bg-slate-50 dark:bg-[#282A2C]/50 border border-slate-200/70 dark:border-slate-800 text-xs text-[#444746] dark:text-[#C4C7C5] leading-relaxed">
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
          className="rounded-full text-xs font-medium border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 h-9 px-4 shrink-0"
        >
          <Shield className="h-3.5 w-3.5 mr-1.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
          {t("backup.viewBackups")}
          <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
        </Button>
      </div>
    </div>
  );
}