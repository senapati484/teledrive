import { Download, ExternalLink, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { runtimeOpenUrl } from "@/lib/runtime/bridge";
import type { UpdateCheckResult } from "@/lib/support/updateChecker";

interface UpdateAvailableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateInfo: UpdateCheckResult | null;
}

export function UpdateAvailableDialog({
  open,
  onOpenChange,
  updateInfo,
}: UpdateAvailableDialogProps) {
  const { t } = useTranslation("settings");

  if (!updateInfo) return null;

  const handleDownload = async () => {
    if (updateInfo.platformDownloadUrl) {
      await runtimeOpenUrl(updateInfo.platformDownloadUrl).catch(() => {});
    }
  };

  const handleOpenGitHub = async () => {
    if (updateInfo.githubReleaseUrl) {
      await runtimeOpenUrl(updateInfo.githubReleaseUrl).catch(() => {});
    }
  };

  const handleOpenSourceForge = async () => {
    if (updateInfo.sourceforgeUrl) {
      await runtimeOpenUrl(updateInfo.sourceforgeUrl).catch(() => {});
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-lg p-6 bg-white dark:bg-[#0c0d0f] border border-slate-200/90 dark:border-white/[0.08] shadow-2xl">
        <DialogHeader className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-800/40 text-[11px] font-semibold text-[#0B57D0] dark:text-[#8ab4f8]">
              <Sparkles className="h-3.5 w-3.5" />
              <span>{t("about.updateDialog.badge", "New Update Available")}</span>
            </div>

            <span className="text-xs font-mono font-medium text-slate-400 dark:text-slate-500">
              v{updateInfo.currentVersion} → <span className="text-slate-800 dark:text-slate-200 font-bold">v{updateInfo.latestVersion}</span>
            </span>
          </div>

          <DialogTitle className="text-lg font-bold text-slate-900 dark:text-white pt-1">
            {updateInfo.releaseName || `TeleDrive v${updateInfo.latestVersion}`}
          </DialogTitle>

          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            {t(
              "about.updateDialog.description",
              "A newer version of TeleDrive is ready to download with new features, performance improvements, and fixes."
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Release notes container */}
        {updateInfo.releaseNotes && (
          <div className="my-2 p-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200/70 dark:border-white/[0.06] max-h-48 overflow-y-auto text-xs leading-relaxed text-slate-700 dark:text-slate-300 font-sans select-text whitespace-pre-wrap">
            {updateInfo.releaseNotes}
          </div>
        )}

        <DialogFooter className="flex flex-col sm:flex-row gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-xl text-xs cursor-pointer order-last sm:order-first"
          >
            {t("about.updateDialog.later", "Later")}
          </Button>

          <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenGitHub}
              className="rounded-xl text-xs gap-1.5 cursor-pointer"
              title="View on GitHub Releases"
            >
              <span>GitHub</span>
              <ExternalLink className="h-3.5 w-3.5 opacity-60" />
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenSourceForge}
              className="rounded-xl text-xs gap-1.5 cursor-pointer"
              title="View on SourceForge"
            >
              <span>SourceForge</span>
              <ExternalLink className="h-3.5 w-3.5 opacity-60" />
            </Button>

            <Button
              type="button"
              onClick={handleDownload}
              className="rounded-xl text-xs font-semibold gap-1.5 bg-[#0B57D0] hover:bg-[#0842a0] text-white dark:bg-[#1a73e8] dark:hover:bg-[#1558b0] cursor-pointer shadow-xs"
            >
              <Download className="h-4 w-4" />
              <span>{t("about.updateDialog.downloadPlatform", { platform: updateInfo.platformName, defaultValue: `Download ${updateInfo.platformName}` })}</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
