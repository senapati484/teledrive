import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  FileCode2,
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

const GITHUB_URL = "https://github.com/senapati484/teledrive";

interface ParsedFeature {
  title: string;
  description: string | null;
  Icon: typeof Sparkles;
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

  if (
    lower.includes("backup") ||
    lower.includes("mirror") ||
    lower.includes("sync") ||
    lower.includes("sincron") ||
    lower.includes("备份") ||
    lower.includes("備份") ||
    lower.includes("sauvegarde") ||
    lower.includes("sicherung") ||
    lower.includes("copia") ||
    lower.includes("pencadangan") ||
    lower.includes("резерв") ||
    lower.includes("बैकअप")
  ) {
    Icon = FolderSync;
  } else if (
    lower.includes("android") ||
    lower.includes("mobile") ||
    lower.includes("phone") ||
    lower.includes("ios") ||
    lower.includes("móvil") ||
    lower.includes("seluler") ||
    lower.includes("mobil") ||
    lower.includes("移动") ||
    lower.includes("行動") ||
    lower.includes("モバイル")
  ) {
    Icon = Smartphone;
  } else if (
    lower.includes("preview") ||
    lower.includes("code") ||
    lower.includes("editor") ||
    lower.includes("visua") ||
    lower.includes("view") ||
    lower.includes("previsual") ||
    lower.includes("vorschau") ||
    lower.includes("aperçu") ||
    lower.includes("просмотр") ||
    lower.includes("peninjau") ||
    lower.includes("预览") ||
    lower.includes("預覽") ||
    lower.includes("プレビュー") ||
    lower.includes("पूर्वावलोकन")
  ) {
    Icon = FileCode2;
  } else if (
    lower.includes("secur") ||
    lower.includes("segur") ||
    lower.includes("sicher") ||
    lower.includes("safe") ||
    lower.includes("vault") ||
    lower.includes("harden") ||
    lower.includes("fortalec") ||
    lower.includes("renforce") ||
    lower.includes("усил") ||
    lower.includes("सुरक्षा") ||
    lower.includes("keamanan") ||
    lower.includes("安全")
  ) {
    Icon = ShieldCheck;
  } else if (
    lower.includes("language") ||
    lower.includes("idioma") ||
    lower.includes("sprache") ||
    lower.includes("lang") ||
    lower.includes("multilingual") ||
    lower.includes("multilingüe") ||
    lower.includes("mehrsprach") ||
    lower.includes("multilingue") ||
    lower.includes("язык") ||
    lower.includes("bahasa") ||
    lower.includes("语言") ||
    lower.includes("語言") ||
    lower.includes("言語") ||
    lower.includes("भाषा")
  ) {
    Icon = Globe;
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
  } else if (index % 3 === 0) {
    Icon = ShieldCheck;
  }

  return { title, description, Icon };
}

export default function WhatsNewDialog() {
  const { t } = useTranslation("support");
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  const starredAt = useSupportStore((s) => s.starredAt);
  const markStarred = useSupportStore((s) => s.markStarred);

  useEffect(() => {
    // Listen for manual trigger events (e.g. from About section or console)
    const handleTrigger = () => setOpen(true);
    window.addEventListener("teledrive:show-whats-new", handleTrigger);
    (window as unknown as { showWhatsNew?: () => void }).showWhatsNew = handleTrigger;

    getVersion()
      .then((v) => {
        setVersion(v);
        // In development phase: always show so the popup window can be previewed and verified
        setOpen(true);
      })
      .catch(() => {
        // Tauri not available (dev browser mode) — fallback to current version and show
        setVersion("0.1.3");
        setOpen(true);
      });

    return () => {
      window.removeEventListener("teledrive:show-whats-new", handleTrigger);
      delete (window as unknown as { showWhatsNew?: () => void }).showWhatsNew;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = () => {
    // In development phase, do not lock out the dialog permanently so it can be re-tested
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
        className="w-[calc(100%-2rem)] sm:w-full max-w-md md:max-w-lg p-0 overflow-hidden gap-0 rounded-2xl sm:rounded-3xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0c0d10] shadow-2xl shadow-black/20 dark:shadow-[0_25px_70px_-15px_rgba(0,0,0,0.8)]"
      >
        {/* ── Ambient Header ── */}
        <div className="relative px-5 pt-5 pb-4 sm:px-6 sm:pt-6 sm:pb-5 border-b border-slate-100 dark:border-white/[0.06] bg-gradient-to-b from-blue-500/[0.08] via-blue-500/[0.02] to-transparent">
          {/* Subtle radial ambient highlight */}
          <div className="absolute -top-12 -left-12 w-36 h-36 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />

          <div className="relative flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-gradient-to-tr from-[#0B57D0] via-[#1a73e8] to-sky-400 flex items-center justify-center shadow-md shadow-blue-500/20 ring-1 ring-white/20 dark:ring-white/10 shrink-0">
                <Sparkles className="h-5 w-5 text-white stroke-[2.2]" />
              </div>
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                  <DialogTitle className="text-sm sm:text-base font-bold tracking-tight text-slate-900 dark:text-white">
                    {t("whatsNew.title")}
                  </DialogTitle>
                  {version && (
                    <span className="inline-flex items-center gap-1 bg-blue-500/10 dark:bg-blue-400/15 text-[#0B57D0] dark:text-[#8ab4f8] border border-blue-500/20 dark:border-blue-400/20 font-mono text-[10px] sm:text-[11px] px-2 py-0.5 rounded-full font-semibold tracking-wide shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" />
                      {t("whatsNew.badge", { version })}
                    </span>
                  )}
                </div>
                <DialogDescription className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-normal">
                  {t("whatsNew.starCta")}
                </DialogDescription>
              </div>
            </div>

            <button
              onClick={dismiss}
              aria-label="Close"
              className="h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0 -mt-1 -mr-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Feature list with rich layout & responsive scrolling ── */}
        <div className="px-4 py-3.5 sm:px-6 sm:py-4 max-h-[44vh] sm:max-h-[48vh] overflow-y-auto custom-scrollbar space-y-2">
          {features.map((feature, i) => {
            const { title, description, Icon } = parseFeatureItem(feature, i);
            return (
              <div
                key={i}
                className="group flex items-start gap-3 p-3 sm:p-3.5 rounded-xl bg-slate-50/60 hover:bg-slate-100/80 dark:bg-white/[0.025] dark:hover:bg-white/[0.045] border border-slate-200/60 dark:border-white/[0.06] transition-all duration-150"
              >
                <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 border mt-0.5 bg-blue-500/[0.08] dark:bg-blue-400/[0.08] border-blue-500/15 dark:border-blue-400/15 text-blue-600 dark:text-blue-400 transition-transform duration-200 group-hover:scale-105">
                  <Icon className="h-4 w-4 stroke-[2]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                      {title}
                    </span>
                    <span className="h-4 w-4 rounded-full bg-blue-500/10 dark:bg-blue-400/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                      <Check className="h-2.5 w-2.5 stroke-[3]" />
                    </span>
                  </div>
                  {description && (
                    <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-1 break-words">
                      {description}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer with refined star support & action button ── */}
        <DialogFooter className="px-4 py-3.5 sm:px-6 sm:py-4 border-t border-slate-100 dark:border-white/[0.06] bg-slate-50/50 dark:bg-white/[0.015] flex flex-col gap-2.5 rounded-b-2xl sm:rounded-b-3xl">
          {!starredAt && (
            <div className="flex items-center justify-between gap-3 p-2.5 sm:p-3 rounded-xl bg-slate-100/70 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/[0.06]">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-7 w-7 rounded-lg bg-amber-500/10 text-amber-500 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <Star className="h-3.5 w-3.5 fill-current" />
                </div>
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                  {t("whatsNew.starCta")}
                </p>
              </div>
              <Button
                onClick={handleStar}
                size="sm"
                variant="outline"
                className="h-7.5 px-3 rounded-lg text-xs font-semibold bg-white dark:bg-white/[0.06] hover:bg-slate-50 dark:hover:bg-white/[0.12] text-slate-800 dark:text-white border-slate-200 dark:border-white/[0.10] shadow-xs active:scale-95 transition-all cursor-pointer shrink-0"
              >
                <Star className="h-3 w-3 mr-1 text-amber-500 dark:text-amber-400 fill-current" />
                {t("whatsNew.starButton")}
              </Button>
            </div>
          )}

          <Button
            onClick={dismiss}
            className="w-full h-10 rounded-xl text-xs sm:text-sm font-semibold bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-blue-600 dark:hover:bg-blue-500 text-white shadow-md shadow-blue-500/20 active:scale-[0.98] transition-all cursor-pointer border border-blue-400/20"
          >
            {t("whatsNew.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
