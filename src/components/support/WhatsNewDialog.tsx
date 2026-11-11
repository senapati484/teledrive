import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Eye,
  FileCode2,
  FolderSync,
  Globe,
  Layers,
  MousePointerClick,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { APP_VERSION } from "@/lib/telegram/config";
import { runtimeGetVersion, runtimeOpenUrl } from "@/lib/runtime/bridge";
import { parseFeatureItem, type WhatsNewIconKey } from "@/lib/support/whatsNewLogic";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSupportStore } from "@/stores/supportStore";

const GITHUB_URL = "https://github.com/senapati484/teledrive";

const ICON_CONFIG: Record<
  WhatsNewIconKey,
  {
    icon: typeof Sparkles;
    containerClass: string;
  }
> = {
  security: {
    icon: ShieldCheck,
    containerClass:
      "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400 border border-emerald-500/20 dark:border-emerald-400/25",
  },
  transfer: {
    icon: Layers,
    containerClass:
      "bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400 border border-sky-500/20 dark:border-sky-400/25",
  },
  speed: {
    icon: Zap,
    containerClass:
      "bg-amber-500/10 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400 border border-amber-500/20 dark:border-amber-400/25",
  },
  preview: {
    icon: Eye,
    containerClass:
      "bg-purple-500/10 text-purple-600 dark:bg-purple-400/15 dark:text-purple-400 border border-purple-500/20 dark:border-purple-400/25",
  },
  sync: {
    icon: FolderSync,
    containerClass:
      "bg-blue-500/10 text-[#0B57D0] dark:bg-blue-400/15 dark:text-[#8ab4f8] border border-blue-500/20 dark:border-blue-400/25",
  },
  mobile: {
    icon: Smartphone,
    containerClass:
      "bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-400 border border-indigo-500/20 dark:border-indigo-400/25",
  },
  code: {
    icon: FileCode2,
    containerClass:
      "bg-rose-500/10 text-rose-600 dark:bg-rose-400/15 dark:text-rose-400 border border-rose-500/20 dark:border-rose-400/25",
  },
  language: {
    icon: Globe,
    containerClass:
      "bg-teal-500/10 text-teal-600 dark:bg-teal-400/15 dark:text-teal-400 border border-teal-500/20 dark:border-teal-400/25",
  },
  dnd: {
    icon: MousePointerClick,
    containerClass:
      "bg-cyan-500/10 text-cyan-600 dark:bg-cyan-400/15 dark:text-cyan-400 border border-cyan-500/20 dark:border-cyan-400/25",
  },
  sparkle: {
    icon: Sparkles,
    containerClass:
      "bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400 border border-blue-500/20 dark:border-blue-400/25",
  },
};

export default function WhatsNewDialog() {
  const { t } = useTranslation("support");
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  const lastSeenVersion = useSupportStore((s) => s.lastSeenVersion);
  const starredAt = useSupportStore((s) => s.starredAt);
  const markWhatsNewSeen = useSupportStore((s) => s.markWhatsNewSeen);
  const markStarred = useSupportStore((s) => s.markStarred);

  useEffect(() => {
    let cancelled = false;
    // Listen for manual trigger events (e.g. from About section or console)
    const handleTrigger = () => setOpen(true);
    window.addEventListener("teledrive:show-whats-new", handleTrigger);
    (window as unknown as { showWhatsNew?: () => void }).showWhatsNew = handleTrigger;

    runtimeGetVersion(APP_VERSION).then((v) => {
      if (cancelled) return;
      setVersion(v);
      if (v !== lastSeenVersion) {
        setOpen(true);
      }
    });

    return () => {
      cancelled = true;
      window.removeEventListener("teledrive:show-whats-new", handleTrigger);
      delete (window as unknown as { showWhatsNew?: () => void }).showWhatsNew;
    };
  }, [lastSeenVersion]);

  const dismiss = () => {
    markWhatsNewSeen(version ?? APP_VERSION);
    setOpen(false);
  };

  const handleStar = async () => {
    try {
      await runtimeOpenUrl(GITHUB_URL);
    } catch {
      toast.error("Failed to open link.");
    }
    markStarred();
    dismiss();
  };

  const rawFeatures = t("whatsNew.features", { returnObjects: true });
  const features: string[] = Array.isArray(rawFeatures) ? rawFeatures : [];

  // Strip leading emoji to avoid double stars in button
  const rawStarButton = t("whatsNew.starButton");
  const starButtonText = rawStarButton.replace(/^[⭐\s]+/, "").trim() || rawStarButton;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent
        showCloseButton={false}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-[480px] sm:max-w-[500px] p-0 gap-0 rounded-3xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0c0d12] shadow-2xl shadow-slate-900/15 dark:shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85)] max-h-[86dvh] sm:max-h-[84vh] flex flex-col overflow-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 duration-200 ease-out"
      >
        {/* ── Header ── */}
        <div className="relative px-5 pt-5 pb-4 sm:px-6 sm:pt-6 sm:pb-4.5 border-b border-slate-100 dark:border-white/[0.06] bg-gradient-to-b from-blue-500/[0.04] via-blue-500/[0.01] to-transparent shrink-0">
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-tr from-[#0B57D0] via-[#1a73e8] to-sky-400 flex items-center justify-center shadow-md shadow-blue-500/20 shrink-0 mt-0.5">
                <Sparkles className="h-5 w-5 text-white stroke-[2]" />
              </div>
              <div className="space-y-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <DialogTitle className="text-base sm:text-[17px] font-bold tracking-tight text-slate-900 dark:text-white leading-snug">
                    {t("whatsNew.title")}
                  </DialogTitle>
                  {version && (
                    <span className="inline-flex items-center gap-1.5 bg-blue-500/10 dark:bg-blue-400/15 text-[#0B57D0] dark:text-[#8ab4f8] border border-blue-500/20 dark:border-blue-400/25 font-mono text-[11px] px-2.5 py-0.5 rounded-full font-semibold tracking-wide shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" />
                      {t("whatsNew.badge", { version })}
                    </span>
                  )}
                </div>
                <DialogDescription className="text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 font-normal leading-snug">
                  {t("whatsNew.subtitle", "Highlights in this release")}
                </DialogDescription>
              </div>
            </div>

            <button
              onClick={dismiss}
              aria-label="Close"
              className="h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0 -mr-1 -mt-0.5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Feature Highlights List ── */}
        <div className="px-3.5 py-3 sm:px-5 sm:py-3.5 flex-1 overflow-y-auto overscroll-contain custom-scrollbar space-y-1">
          {features.map((feature, i) => {
            const { title, description, iconKey } = parseFeatureItem(feature, i);
            const conf = ICON_CONFIG[iconKey] ?? ICON_CONFIG.sparkle;
            const Icon = conf.icon;
            return (
              <div
                key={i}
                className="group relative flex items-start gap-3.5 p-2.5 sm:p-3 rounded-2xl transition-all duration-150 hover:bg-slate-50/90 dark:hover:bg-white/[0.04]"
              >
                <div
                  className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 transition-transform duration-150 group-hover:scale-105 shadow-2xs ${conf.containerClass}`}
                >
                  <Icon className="h-4.5 w-4.5 stroke-[2]" />
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="text-[13px] sm:text-[13.5px] font-semibold text-slate-900 dark:text-slate-100 leading-snug tracking-[-0.01em]">
                    {title}
                  </div>
                  {description && (
                    <p className="text-[11.5px] sm:text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-normal">
                      {description}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer Actions ── */}
        <DialogFooter className="px-5 py-3.5 sm:px-6 sm:py-4 border-t border-slate-100 dark:border-white/[0.06] bg-slate-50/50 dark:bg-white/[0.01] flex flex-col-reverse sm:flex-row gap-2.5 shrink-0">
          {!starredAt && (
            <button
              type="button"
              onClick={handleStar}
              className="w-full sm:flex-1 h-10 px-4 flex items-center justify-center gap-2 rounded-xl border border-slate-200/90 dark:border-white/10 bg-white hover:bg-slate-50 dark:bg-white/[0.03] dark:hover:bg-white/[0.07] text-slate-700 dark:text-slate-200 text-xs sm:text-[13px] font-semibold transition-all cursor-pointer active:scale-[0.98] shadow-2xs hover:border-slate-300 dark:hover:border-white/20"
            >
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500 shrink-0" />
              <span className="truncate">{starButtonText || "Star on GitHub"}</span>
            </button>
          )}

          <Button
            onClick={dismiss}
            className="w-full sm:flex-1 h-10 rounded-xl text-xs sm:text-[13px] font-semibold bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-blue-600 dark:hover:bg-blue-500 text-white shadow-xs active:scale-[0.98] transition-all cursor-pointer border border-blue-400/20"
          >
            {t("whatsNew.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
