import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Star, X } from "lucide-react";
import { toast } from "sonner";
import { runtimeOpenUrl } from "@/lib/runtime/bridge";

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

  // Poll periodically & listen for manual trigger events in dev
  useEffect(() => {
    const handleTrigger = () => setOpen(true);
    window.addEventListener("teledrive:show-star-prompt", handleTrigger);
    (window as unknown as { showStarPrompt?: () => void }).showStarPrompt = handleTrigger;

    check();
    const id = setInterval(check, POLL_MS);
    return () => {
      clearInterval(id);
      window.removeEventListener("teledrive:show-star-prompt", handleTrigger);
      delete (window as unknown as { showStarPrompt?: () => void }).showStarPrompt;
    };
  }, [check]);

  // Also re-check whenever upload count changes (upload just finished)
  useEffect(() => {
    check();
  }, [successfulUploads]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStar = async () => {
    try {
      await runtimeOpenUrl(GITHUB_URL);
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
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-[390px] sm:max-w-[440px] p-0 gap-0 rounded-2xl sm:rounded-3xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0c0d10] shadow-2xl shadow-black/30 dark:shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 duration-200 ease-out"
      >
        {/* ── Close (×) button — acts as "Maybe later" ── */}
        <button
          onClick={handleMaybeLater}
          aria-label="Close"
          className="absolute top-3.5 right-3.5 z-20 h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        {/* ── Header ── */}
        <div className="relative flex flex-col items-center gap-2.5 pt-6 pb-4 px-5 sm:pt-7 sm:pb-4 sm:px-6 bg-gradient-to-b from-blue-500/[0.06] via-transparent to-transparent shrink-0">
          <div className="h-11 w-11 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 dark:text-amber-400 flex items-center justify-center shadow-xs shrink-0">
            <Star className="h-5 w-5 fill-current" />
          </div>
          <DialogTitle className="text-base font-bold text-center text-slate-900 dark:text-white">
            {t("starPrompt.title")}
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-[13px] text-center text-slate-500 dark:text-slate-400 leading-relaxed px-1">
            {t("starPrompt.description")}
          </DialogDescription>
        </div>

        {/* ── Actions ── */}
        <div className="flex flex-col gap-2 px-5 pb-5 sm:px-6 sm:pb-6 shrink-0">
          <Button
            onClick={handleStar}
            className="w-full h-9.5 rounded-xl text-xs sm:text-[13px] font-semibold bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-blue-600 dark:hover:bg-blue-500 text-white shadow-xs active:scale-[0.98] transition-all cursor-pointer border border-blue-400/20"
          >
            <Star className="h-3.5 w-3.5 mr-1.5 fill-current text-amber-300" />
            {t("starPrompt.starButton")}
          </Button>

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
