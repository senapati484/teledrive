import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
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

  const lastSeenVersion = useSupportStore((s) => s.lastSeenVersion);
  const starredAt = useSupportStore((s) => s.starredAt);
  const markWhatsNewSeen = useSupportStore((s) => s.markWhatsNewSeen);
  const markStarred = useSupportStore((s) => s.markStarred);

  useEffect(() => {
    // Listen for manual trigger events (e.g. from About section or console)
    const handleTrigger = () => setOpen(true);
    window.addEventListener("teledrive:show-whats-new", handleTrigger);
    (window as unknown as { showWhatsNew?: () => void }).showWhatsNew = handleTrigger;

    getVersion()
      .then((v) => {
        setVersion(v);
        if (v !== lastSeenVersion) {
          setOpen(true);
        }
      })
      .catch(() => {
        // Tauri not available (dev browser mode)
        const fallbackVersion = "0.1.3";
        setVersion(fallbackVersion);
        if (fallbackVersion !== lastSeenVersion) {
          setOpen(true);
        }
      });

    return () => {
      window.removeEventListener("teledrive:show-whats-new", handleTrigger);
      delete (window as unknown as { showWhatsNew?: () => void }).showWhatsNew;
    };
  }, [lastSeenVersion]);

  const dismiss = () => {
    if (version) {
      markWhatsNewSeen(version);
    }
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

  // Strip leading emoji to avoid double stars in button
  const rawStarButton = t("whatsNew.starButton");
  const starButtonText = rawStarButton.replace(/^[⭐\s]+/, "").trim() || rawStarButton;

  // Clean prompt text without redundant emoji
  const rawStarCta = t("whatsNew.starCta");
  const starCtaText = rawStarCta.replace(/[⭐✨]/g, "").trim() || rawStarCta;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent
        showCloseButton={false}
        className="w-full max-w-none sm:max-w-md md:max-w-lg p-0 gap-0 inset-x-0 bottom-0 top-auto left-0 right-0 translate-x-0 translate-y-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 rounded-t-[28px] rounded-b-none sm:rounded-3xl border-x-0 border-b-0 sm:border border-t border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0c0d10] shadow-2xl shadow-black/25 dark:shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85)] max-h-[88dvh] sm:max-h-[85vh] flex flex-col overflow-hidden data-open:slide-in-from-bottom data-closed:slide-out-to-bottom sm:data-open:zoom-in-95 sm:data-closed:zoom-out-95 duration-250 ease-out"
      >
        {/* ── Mobile sheet drag handle ── */}
        <div className="pt-2.5 pb-1 flex justify-center sm:hidden shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-white/20" />
        </div>

        {/* ── Ambient Header ── */}
        <div className="relative px-5 pt-3 pb-4 sm:px-6 sm:pt-6 sm:pb-5 border-b border-slate-100 dark:border-white/[0.06] bg-gradient-to-b from-blue-500/[0.08] via-blue-500/[0.02] to-transparent shrink-0">
          <div className="absolute -top-12 -left-12 w-36 h-36 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />

          <div className="relative flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-gradient-to-tr from-[#0B57D0] via-[#1a73e8] to-sky-400 flex items-center justify-center shadow-md shadow-blue-500/20 ring-1 ring-white/20 dark:ring-white/10 shrink-0">
                <Sparkles className="h-5 w-5 text-white stroke-[2.2]" />
              </div>
              <div className="space-y-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <DialogTitle className="text-sm sm:text-base font-bold tracking-tight text-slate-900 dark:text-white truncate">
                    {t("whatsNew.title")}
                  </DialogTitle>
                  {version && (
                    <span className="inline-flex items-center gap-1 bg-blue-500/10 dark:bg-blue-400/15 text-[#0B57D0] dark:text-[#8ab4f8] border border-blue-500/20 dark:border-blue-400/20 font-mono text-[10px] sm:text-[11px] px-2 py-0.5 rounded-full font-semibold tracking-wide shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" />
                      {t("whatsNew.badge", { version })}
                    </span>
                  )}
                </div>
                <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 font-normal truncate">
                  {t("whatsNew.subtitle", "Highlights and mobile improvements in this release")}
                </DialogDescription>
              </div>
            </div>

            <button
              onClick={dismiss}
              aria-label="Close"
              className="h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0 -mr-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Feature list with rich layout & responsive scrolling ── */}
        <div className="px-4 py-3 sm:px-6 sm:py-4 flex-1 overflow-y-auto overscroll-contain custom-scrollbar space-y-2.5">
          {features.map((feature, i) => {
            const { title, description, Icon } = parseFeatureItem(feature, i);
            return (
              <div
                key={i}
                className="flex items-start gap-3 p-3 sm:p-3.5 rounded-xl sm:rounded-2xl bg-slate-50/70 hover:bg-slate-100/90 dark:bg-white/[0.03] dark:hover:bg-white/[0.05] border border-slate-200/70 dark:border-white/[0.06] transition-colors"
              >
                <div className="h-8.5 w-8.5 sm:h-9 sm:w-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 bg-blue-500/[0.08] dark:bg-blue-400/[0.10] border border-blue-500/15 dark:border-blue-400/15 text-blue-600 dark:text-blue-400">
                  <Icon className="h-4.5 w-4.5 stroke-[2]" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-[13px] sm:text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug break-words">
                    {title}
                  </div>
                  {description && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed break-words">
                      {description}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer with safe-area padding & responsive star support ── */}
        <DialogFooter className="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom,16px))] sm:px-6 sm:py-4 border-t border-slate-100 dark:border-white/[0.06] bg-slate-50/60 dark:bg-[#0c0d10] flex flex-col gap-2.5 shrink-0">
          {!starredAt && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-2.5 sm:p-3 rounded-xl sm:rounded-2xl bg-amber-500/[0.06] dark:bg-amber-400/[0.05] border border-amber-500/20 dark:border-amber-400/15">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-7 w-7 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <Star className="h-3.5 w-3.5 fill-current" />
                </div>
                <p className="text-xs font-medium text-amber-950 dark:text-amber-100 truncate">
                  {starCtaText}
                </p>
              </div>
              <Button
                onClick={handleStar}
                size="sm"
                variant="outline"
                className="h-8 px-3 rounded-lg text-xs font-semibold bg-white dark:bg-white/[0.08] hover:bg-amber-100/60 dark:hover:bg-amber-400/10 text-amber-900 dark:text-amber-200 border-amber-500/30 dark:border-amber-400/25 shadow-xs active:scale-95 transition-all cursor-pointer shrink-0 w-full sm:w-auto flex items-center justify-center gap-1.5"
              >
                <Star className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400 fill-current shrink-0" />
                <span>{starButtonText}</span>
              </Button>
            </div>
          )}

          <Button
            onClick={dismiss}
            className="w-full h-11 sm:h-10 rounded-xl sm:rounded-2xl text-xs sm:text-sm font-semibold bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-blue-600 dark:hover:bg-blue-500 text-white shadow-md shadow-blue-500/20 active:scale-[0.98] transition-all cursor-pointer border border-blue-400/20"
          >
            {t("whatsNew.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
