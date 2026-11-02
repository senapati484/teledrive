import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Star, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSupportStore, getIsFirstSession } from "@/stores/supportStore";
import { useFileStore } from "@/stores/fileStore";
import { shouldShowStarPrompt } from "@/lib/support/starPromptLogic";

const GITHUB_URL = "https://github.com/senapati484/teledrive";
/** Check every 60 seconds whether the conditions to show are now met. */
const POLL_MS = 60_000;

export default function StarPromptDialog() {
  const { t } = useTranslation("support");
  const [open, setOpen] = useState(false);

  // Support store
  const firstLaunchAt = useSupportStore((s) => s.firstLaunchAt);
  const successfulUploads = useSupportStore((s) => s.successfulUploads);
  const snoozedUntil = useSupportStore((s) => s.snoozedUntil);
  const dontAskAgain = useSupportStore((s) => s.dontAskAgain);
  const starredAt = useSupportStore((s) => s.starredAt);
  const snooze = useSupportStore((s) => s.snooze);
  const dismissForever = useSupportStore((s) => s.dismissForever);
  const markStarred = useSupportStore((s) => s.markStarred);

  // Is there an active upload or download?
  const uploadQueue = useFileStore((s) => s.uploadQueue);
  const isTransferActive = uploadQueue.some(
    (item) => item.status === "pending" || item.status === "uploading",
  );

  const check = useCallback(() => {
    if (open) return; // already showing
    const state = { firstLaunchAt, successfulUploads, snoozedUntil, dontAskAgain, starredAt };
    const show = shouldShowStarPrompt(state, {
      now: Date.now(),
      isFirstSession: getIsFirstSession(),
      isTransferActive,
    });
    if (show) setOpen(true);
  }, [open, firstLaunchAt, successfulUploads, snoozedUntil, dontAskAgain, starredAt, isTransferActive]);

  // Poll periodically
  useEffect(() => {
    check();
    const id = setInterval(check, POLL_MS);
    return () => clearInterval(id);
  }, [check]);

  // Also re-check whenever upload count changes (upload just finished)
  useEffect(() => {
    check();
  }, [successfulUploads]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStar = async () => {
    try {
      await openUrl(GITHUB_URL);
    } catch {
      toast.error("Failed to open link.");
    }
    markStarred();
    setOpen(false);
  };

  const handleMaybeLater = () => {
    snooze();
    setOpen(false);
  };

  const handleDontAskAgain = () => {
    dismissForever();
    setOpen(false);
  };

  // Esc key / overlay click maps to "maybe later"
  const handleOpenChange = (next: boolean) => {
    if (!next) handleMaybeLater();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[calc(100%-2rem)] sm:w-full max-w-md p-0 overflow-hidden gap-0 rounded-2xl sm:rounded-3xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0c0d10] shadow-2xl shadow-black/20 dark:shadow-[0_25px_70px_-15px_rgba(0,0,0,0.8)]"
      >
        {/* ── Close (×) button — acts as "Maybe later" ── */}
        <button
          onClick={handleMaybeLater}
          aria-label="Close"
          className="absolute top-4 right-4 z-20 h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        {/* ── Ambient Header ── */}
        <div className="relative flex flex-col items-center gap-3 pt-8 pb-5 px-6 sm:px-7 bg-gradient-to-b from-blue-500/[0.06] via-transparent to-transparent">
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-40 h-40 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />

          <div className="h-12 w-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 dark:text-amber-400 flex items-center justify-center shadow-lg shadow-amber-500/10 shrink-0">
            <Star className="h-6 w-6 fill-current" />
          </div>
          <DialogTitle className="text-base sm:text-lg font-bold text-center text-slate-900 dark:text-white">
            {t("starPrompt.title")}
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-center text-slate-600 dark:text-slate-300 leading-relaxed max-w-xs">
            {t("starPrompt.description")}
          </DialogDescription>
        </div>

        {/* ── Actions ── */}
        <div className="flex flex-col gap-2.5 px-6 pb-6 sm:px-7 sm:pb-7">
          {/* Primary CTA */}
          <Button
            onClick={handleStar}
            className="w-full h-10 rounded-xl text-xs sm:text-sm font-semibold bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-blue-600 dark:hover:bg-blue-500 text-white shadow-md shadow-blue-500/20 active:scale-[0.98] transition-all cursor-pointer border border-blue-400/20"
          >
            <Star className="h-3.5 w-3.5 mr-1.5 fill-current text-amber-300" />
            {t("starPrompt.starButton")}
          </Button>

          {/* Secondary actions row */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleMaybeLater}
              className="flex-1 h-9 rounded-xl text-xs font-medium border-slate-200 dark:border-white/[0.08] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.04] cursor-pointer"
            >
              {t("starPrompt.maybeLater")}
            </Button>
            <Button
              variant="ghost"
              onClick={handleDontAskAgain}
              className="flex-1 h-9 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04] cursor-pointer"
            >
              {t("starPrompt.dontAskAgain")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
