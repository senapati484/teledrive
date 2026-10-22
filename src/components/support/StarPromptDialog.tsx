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
        className="w-full max-w-sm p-0 overflow-hidden gap-0 rounded-2xl border border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-[#0d0e11] shadow-2xl"
      >
        {/* ── Close (×) button — acts as "Maybe later" ── */}
        <button
          onClick={handleMaybeLater}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 h-7 w-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        {/* ── Header strip ── */}
        <div className="flex flex-col items-center gap-3 pt-8 pb-5 px-6 bg-gradient-to-b from-blue-50/80 dark:from-[#001533]/60 to-transparent">
          <div className="h-14 w-14 rounded-2xl bg-[#0B57D0] dark:bg-[#1a73e8] flex items-center justify-center shadow-lg shadow-blue-500/20 dark:shadow-blue-500/10">
            <Star className="h-7 w-7 text-white fill-white" />
          </div>
          <DialogTitle className="text-base font-semibold text-center text-[#1F1F1F] dark:text-[#E3E3E3]">
            {t("starPrompt.title")}
          </DialogTitle>
          <DialogDescription className="text-sm text-center text-[#444746] dark:text-[#9aa0a6] leading-relaxed max-w-xs">
            {t("starPrompt.description")}
          </DialogDescription>
        </div>

        {/* ── Actions ── */}
        <div className="flex flex-col gap-2.5 px-6 pb-6">
          {/* Primary CTA */}
          <Button
            onClick={handleStar}
            className="w-full h-10 rounded-full text-sm font-semibold bg-[#0B57D0] hover:bg-[#0842A0] text-white dark:bg-[#1a73e8] dark:hover:bg-[#1558b0] border-0 shadow-sm cursor-pointer transition-colors"
          >
            {t("starPrompt.starButton")}
          </Button>

          {/* Secondary actions row */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleMaybeLater}
              className="flex-1 h-9 rounded-full text-xs font-medium border-slate-200 dark:border-white/[0.08] text-[#444746] dark:text-[#9aa0a6] hover:bg-slate-50 dark:hover:bg-white/[0.04] cursor-pointer"
            >
              {t("starPrompt.maybeLater")}
            </Button>
            <Button
              variant="ghost"
              onClick={handleDontAskAgain}
              className="flex-1 h-9 rounded-full text-xs font-medium text-[#747775] dark:text-[#5f6368] hover:text-[#444746] dark:hover:text-[#9aa0a6] hover:bg-slate-50 dark:hover:bg-white/[0.04] cursor-pointer"
            >
              {t("starPrompt.dontAskAgain")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
