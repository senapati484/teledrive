import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Star } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSupportStore } from "@/stores/supportStore";

const GITHUB_URL = "https://github.com/senapati484/teledrive";

export default function WhatsNewDialog() {
  const { t } = useTranslation("support");
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  const lastSeenVersion = useSupportStore((s) => s.lastSeenVersion);
  const starredAt = useSupportStore((s) => s.starredAt);
  const markWhatsNewSeen = useSupportStore((s) => s.markWhatsNewSeen);
  const markStarred = useSupportStore((s) => s.markStarred);

  useEffect(() => {
    getVersion()
      .then((v) => {
        setVersion(v);
        if (v !== lastSeenVersion) {
          setOpen(true);
        }
      })
      .catch(() => {
        // Tauri not available (dev browser mode) — skip.
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = () => {
    if (version) markWhatsNewSeen(version);
    setOpen(false);
  };

  const handleStar = async () => {
    try {
      await openUrl(GITHUB_URL);
    } catch {
      toast.error("Failed to open link.");
    }
    markStarred();
    dismiss();
  };

  const features: string[] = t("whatsNew.features", { returnObjects: true }) as string[];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent
        className="w-full max-w-sm p-0 overflow-hidden gap-0 rounded-2xl border border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-[#0d0e11] shadow-2xl"
      >
        {/* ── Header ── */}
        <DialogHeader className="px-6 pt-6 pb-4 gap-2 border-b border-slate-100 dark:border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#0B57D0] to-[#1a73e8] flex items-center justify-center shadow-md shadow-blue-500/20 shrink-0">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div className="space-y-0.5">
              <DialogTitle className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                {t("whatsNew.title")}
              </DialogTitle>
              {version && (
                <span className="inline-flex items-center bg-blue-50 dark:bg-blue-950/40 text-[#0B57D0] dark:text-[#8ab4f8] border border-blue-200/60 dark:border-blue-800/60 font-mono text-[11px] px-2 py-0.5 rounded-full font-medium">
                  {t("whatsNew.badge", { version })}
                </span>
              )}
            </div>
          </div>
          <DialogDescription className="sr-only">
            {t("whatsNew.title")}
          </DialogDescription>
        </DialogHeader>

        {/* ── Feature list ── */}
        <ul className="px-6 py-4 space-y-2.5">
          {features.map((feature, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-[#444746] dark:text-[#C4C7C5]">
              <span className="mt-0.5 h-4 w-4 rounded-full bg-[#C2E7FF]/60 dark:bg-[#004A77]/60 text-[#0B57D0] dark:text-[#8ab4f8] flex items-center justify-center shrink-0 text-[10px] font-semibold">
                ✓
              </span>
              <span className="leading-snug">{feature}</span>
            </li>
          ))}
        </ul>

        {/* ── Footer ── */}
        <DialogFooter className="px-6 py-4 pt-3 border-t border-slate-100 dark:border-white/[0.06] bg-slate-50/60 dark:bg-white/[0.02] flex-col gap-2 rounded-b-2xl">
          {!starredAt && (
            <div className="flex items-center justify-between w-full flex-wrap gap-2">
              <p className="text-xs text-[#747775] dark:text-[#5f6368] flex-1">
                {t("whatsNew.starCta")}
              </p>
              <Button
                onClick={handleStar}
                size="sm"
                className="rounded-full text-xs font-semibold bg-[#0B57D0] hover:bg-[#0842A0] text-white dark:bg-[#1a73e8] dark:hover:bg-[#1558b0] border-0 h-8 px-4 cursor-pointer transition-colors shrink-0"
              >
                <Star className="h-3.5 w-3.5 mr-1 fill-current" />
                {t("whatsNew.starButton")}
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            onClick={dismiss}
            className="w-full h-9 rounded-full text-xs font-medium text-[#747775] dark:text-[#5f6368] hover:text-[#444746] dark:hover:text-[#9aa0a6] hover:bg-slate-100 dark:hover:bg-white/[0.04] cursor-pointer"
          >
            {t("whatsNew.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
