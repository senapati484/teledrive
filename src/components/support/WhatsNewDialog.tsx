import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  FolderSync,
  Globe,
  MousePointerClick,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  X,
  Zap,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSupportStore } from "@/stores/supportStore";
import { cn } from "@/lib/utils";

const GITHUB_URL = "https://github.com/senapati484/teledrive";

interface ParsedFeature {
  title: string;
  description: string | null;
  Icon: typeof Sparkles;
  badgeColor: string;
}

function parseFeatureItem(featureText: string, index: number): ParsedFeature {
  let title = featureText;
  let description: string | null = null;

  for (const sep of [" — ", "——", " - ", " – "]) {
    if (featureText.includes(sep)) {
      const parts = featureText.split(sep);
      title = parts[0].trim();
      description = parts.slice(1).join(sep).trim();
      break;
    }
  }

  const lower = featureText.toLowerCase();
  let Icon = Sparkles;
  let badgeColor =
    "text-blue-600 dark:text-blue-400 bg-blue-500/10 dark:bg-blue-400/10 border-blue-500/20";

  if (
    lower.includes("backup") ||
    lower.includes("mirror") ||
    lower.includes("备份") ||
    lower.includes("備份") ||
    lower.includes("sauvegarde") ||
    lower.includes("sicherung") ||
    lower.includes("copia")
  ) {
    Icon = FolderSync;
    badgeColor =
      "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 dark:bg-indigo-400/10 border-indigo-500/20";
  } else if (
    lower.includes("language") ||
    lower.includes("idioma") ||
    lower.includes("sprache") ||
    lower.includes("lang") ||
    lower.includes("语言") ||
    lower.includes("語言") ||
    lower.includes("言語") ||
    lower.includes("भाषा")
  ) {
    Icon = Globe;
    badgeColor =
      "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-400/10 border-emerald-500/20";
  } else if (
    lower.includes("drag") ||
    lower.includes("drop") ||
    lower.includes("arrastar") ||
    lower.includes("glisser") ||
    lower.includes("拖拽") ||
    lower.includes("拖曳") ||
    lower.includes("gestione")
  ) {
    Icon = MousePointerClick;
    badgeColor =
      "text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 dark:bg-cyan-400/10 border-cyan-500/20";
  } else if (
    lower.includes("fast") ||
    lower.includes("speed") ||
    lower.includes("cache") ||
    lower.includes("cold") ||
    lower.includes("rápido") ||
    lower.includes("schnell") ||
    lower.includes("vitesse") ||
    lower.includes("加速") ||
    lower.includes("缓存") ||
    lower.includes("快")
  ) {
    Icon = Zap;
    badgeColor =
      "text-amber-600 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-400/10 border-amber-500/20";
  } else if (
    lower.includes("android") ||
    lower.includes("mobile") ||
    lower.includes("phone") ||
    lower.includes("ios") ||
    lower.includes("móvil")
  ) {
    Icon = Smartphone;
    badgeColor =
      "text-violet-600 dark:text-violet-400 bg-violet-500/10 dark:bg-violet-400/10 border-violet-500/20";
  } else if (index % 3 === 0) {
    Icon = ShieldCheck;
    badgeColor =
      "text-sky-600 dark:text-sky-400 bg-sky-500/10 dark:bg-sky-400/10 border-sky-500/20";
  }

  return { title, description, Icon, badgeColor };
}

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

  const rawFeatures = t("whatsNew.features", { returnObjects: true });
  const features: string[] = Array.isArray(rawFeatures) ? rawFeatures : [];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent
        showCloseButton={false}
        className="w-[calc(100%-2rem)] sm:w-full max-w-lg p-0 overflow-hidden gap-0 rounded-2xl sm:rounded-3xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0e1015] shadow-2xl shadow-black/20 dark:shadow-[0_25px_70px_-15px_rgba(0,0,0,0.7)]"
      >
        {/* ── Custom Dismiss Button ── */}
        <button
          onClick={dismiss}
          aria-label="Close"
          className="absolute top-4 right-4 z-20 h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        {/* ── Ambient Header ── */}
        <div className="relative px-6 pt-6 pb-4 sm:px-7 sm:pt-7 sm:pb-5 border-b border-slate-100 dark:border-white/[0.06] bg-gradient-to-b from-blue-500/[0.08] via-blue-500/[0.02] to-transparent">
          {/* Subtle radial ambient highlight */}
          <div className="absolute -top-12 -left-12 w-40 h-40 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />

          <div className="relative flex items-center gap-3.5 pr-8">
            <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-2xl bg-gradient-to-tr from-[#0B57D0] via-[#1a73e8] to-sky-400 flex items-center justify-center shadow-lg shadow-blue-500/25 ring-1 ring-white/20 dark:ring-white/10 shrink-0">
              <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 text-white stroke-[2.2]" />
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                  {t("whatsNew.title")}
                </DialogTitle>
                {version && (
                  <span className="inline-flex items-center gap-1 bg-blue-500/10 dark:bg-blue-400/15 text-[#0B57D0] dark:text-[#8ab4f8] border border-blue-500/20 dark:border-blue-400/20 font-mono text-[11px] sm:text-xs px-2.5 py-0.5 rounded-full font-semibold tracking-wide shrink-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" />
                    {t("whatsNew.badge", { version })}
                  </span>
                )}
              </div>
              <DialogDescription className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-normal">
                {t("whatsNew.starCta")}
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* ── Feature list with rich layout & responsive scrolling ── */}
        <div className="px-5 py-4 sm:px-7 sm:py-5 max-h-[48vh] sm:max-h-[50vh] overflow-y-auto custom-scrollbar space-y-2.5">
          {features.map((feature, i) => {
            const { title, description, Icon, badgeColor } = parseFeatureItem(feature, i);
            return (
              <div
                key={i}
                className="group flex items-start gap-3 p-3 sm:p-3.5 rounded-xl bg-slate-50/70 hover:bg-slate-100/90 dark:bg-white/[0.025] dark:hover:bg-white/[0.05] border border-slate-200/60 dark:border-white/[0.06] transition-all duration-150"
              >
                <div
                  className={cn(
                    "h-8 w-8 sm:h-8.5 sm:w-8.5 rounded-lg flex items-center justify-center shrink-0 border mt-0.5 transition-transform duration-200 group-hover:scale-105",
                    badgeColor
                  )}
                >
                  <Icon className="h-4 w-4 stroke-[2]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                      {title}
                    </span>
                    <span className="h-4 w-4 rounded-full bg-emerald-500/10 dark:bg-emerald-400/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <Check className="h-2.5 w-2.5 stroke-[3]" />
                    </span>
                  </div>
                  {description && (
                    <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
                      {description}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer with high-contrast action & star support ── */}
        <DialogFooter className="px-5 py-4 sm:px-7 sm:py-4.5 border-t border-slate-100 dark:border-white/[0.06] bg-slate-50/50 dark:bg-white/[0.015] flex flex-col gap-3 rounded-b-2xl sm:rounded-b-3xl">
          {!starredAt && (
            <div className="flex items-center justify-between gap-3 p-2.5 sm:p-3 rounded-xl bg-gradient-to-r from-amber-500/[0.08] via-amber-500/[0.04] to-transparent border border-amber-500/20 dark:border-amber-400/20">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-7 w-7 rounded-lg bg-amber-500/20 dark:bg-amber-400/20 flex items-center justify-center shrink-0">
                  <Star className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 fill-amber-500" />
                </div>
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                  {t("whatsNew.starCta")}
                </p>
              </div>
              <Button
                onClick={handleStar}
                size="sm"
                className="h-8 px-3 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white shadow-sm shadow-amber-500/20 active:scale-[0.98] transition-all cursor-pointer shrink-0 border-0"
              >
                <Star className="h-3 w-3 mr-1 fill-current" />
                {t("whatsNew.starButton")}
              </Button>
            </div>
          )}

          <Button
            onClick={dismiss}
            className="w-full h-10 sm:h-10.5 rounded-xl text-xs sm:text-sm font-semibold bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-blue-600 dark:hover:bg-blue-500 text-white shadow-md shadow-blue-500/20 active:scale-[0.98] transition-all cursor-pointer border-0"
          >
            {t("whatsNew.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
