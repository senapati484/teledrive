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
import { toast } from "sonner";
import { APP_VERSION } from "@/lib/telegram/config";
import { runtimeGetVersion, runtimeOpenUrl } from "@/lib/runtime/bridge";

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
    lower.includes("thumbnail") ||
    lower.includes("archive") ||
    lower.includes("viewer") ||
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
    lower.includes("encrypt") ||
    lower.includes("tde1") ||
    lower.includes("zero-knowledge") ||
    lower.includes("segur") ||
    lower.includes("cifrad") ||
    lower.includes("chiffr") ||
    lower.includes("sicher") ||
    lower.includes("verschlüss") ||
    lower.includes("safe") ||
    lower.includes("vault") ||
    lower.includes("harden") ||
    lower.includes("fortalec") ||
    lower.includes("renforce") ||
    lower.includes("усил") ||
    lower.includes("шифр") ||
    lower.includes("सुरक्षा") ||
    lower.includes("एन्क्रिप्") ||
    lower.includes("keamanan") ||
    lower.includes("enkrip") ||
    lower.includes("安全") ||
    lower.includes("加密") ||
    lower.includes("暗号")
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
    lower.includes("pipeline") ||
    lower.includes("segment") ||
    lower.includes("dedup") ||
    lower.includes("checkpoint") ||
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

    runtimeGetVersion(APP_VERSION)
      .then((v) => {
        setVersion(v);
        if (v !== lastSeenVersion) {
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
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[82vw] max-w-[310px] sm:max-w-[360px] p-0 gap-0 rounded-2xl sm:rounded-3xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0c0d10] shadow-2xl shadow-black/30 dark:shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85)] max-h-[82dvh] sm:max-h-[80vh] flex flex-col overflow-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 duration-200 ease-out"
      >
        {/* ── Sleek Compact Header ── */}
        <div className="relative px-3.5 pt-3 pb-2.5 sm:px-4 sm:pt-3.5 sm:pb-2.5 border-b border-slate-100 dark:border-white/[0.06] bg-gradient-to-b from-blue-500/[0.08] via-blue-500/[0.02] to-transparent shrink-0">
          <div className="relative flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-[#0B57D0] via-[#1a73e8] to-sky-400 flex items-center justify-center shadow-xs shadow-blue-500/20 shrink-0">
                <Sparkles className="h-3.5 w-3.5 text-white stroke-[2.2]" />
              </div>
              <div className="space-y-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                  <DialogTitle className="text-xs sm:text-sm font-semibold tracking-tight text-slate-900 dark:text-white truncate">
                    {t("whatsNew.title")}
                  </DialogTitle>
                  {version && (
                    <span className="inline-flex items-center gap-1 bg-blue-500/10 dark:bg-blue-400/15 text-[#0B57D0] dark:text-[#8ab4f8] border border-blue-500/20 dark:border-blue-400/20 font-mono text-[9px] px-1.5 py-0.2 rounded-full font-semibold tracking-wide shrink-0">
                      <span className="h-1 w-1 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" />
                      {t("whatsNew.badge", { version })}
                    </span>
                  )}
                </div>
                <DialogDescription className="text-[10px] text-slate-500 dark:text-slate-400 font-normal truncate">
                  {t("whatsNew.subtitle", "Highlights in this release")}
                </DialogDescription>
              </div>
            </div>

            <button
              onClick={dismiss}
              aria-label="Close"
              className="h-6 w-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* ── Compact Sleek Feature Options (Small Options) ── */}
        <div className="px-3 py-2 sm:px-3.5 sm:py-2.5 flex-1 overflow-y-auto overscroll-contain custom-scrollbar space-y-1.5">
          {features.map((feature, i) => {
            const { title, Icon } = parseFeatureItem(feature, i);
            return (
              <div
                key={i}
                className="flex items-center gap-2 p-1.5 sm:p-2 rounded-lg bg-slate-50/70 hover:bg-slate-100/90 dark:bg-white/[0.03] dark:hover:bg-white/[0.06] border border-slate-200/50 dark:border-white/[0.05] transition-colors"
              >
                <div className="h-5.5 w-5.5 rounded-md flex items-center justify-center shrink-0 bg-blue-500/[0.08] dark:bg-blue-400/[0.10] text-blue-600 dark:text-blue-400">
                  <Icon className="h-3 w-3 stroke-[2.2]" />
                </div>
                <span className="text-[11px] sm:text-xs font-medium text-slate-800 dark:text-slate-200 leading-snug flex-1">
                  {title}
                </span>
              </div>
            );
          })}
        </div>

        {/* ── Sleek Compact Footer ── */}
        <DialogFooter className="px-3 pt-2 pb-2.5 sm:px-3.5 sm:pt-2 sm:pb-3 border-t border-slate-100 dark:border-white/[0.06] bg-slate-50/60 dark:bg-[#0c0d10] flex flex-col gap-1.5 shrink-0">
          {!starredAt && (
            <button
              type="button"
              onClick={handleStar}
              className="w-full h-7 px-2 flex items-center justify-center gap-1.5 rounded-lg bg-amber-500/[0.08] hover:bg-amber-500/[0.14] dark:bg-amber-400/[0.08] dark:hover:bg-amber-400/[0.14] border border-amber-500/20 dark:border-amber-400/20 text-amber-900 dark:text-amber-200 text-[10.5px] font-medium transition-colors cursor-pointer active:scale-[0.99]"
            >
              <Star className="h-3 w-3 fill-amber-500 text-amber-500 shrink-0" />
              <span className="truncate">{starButtonText || "Star on GitHub"}</span>
            </button>
          )}

          <Button
            onClick={dismiss}
            className="w-full h-7.5 sm:h-8 rounded-lg text-xs font-semibold bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-blue-600 dark:hover:bg-blue-500 text-white shadow-xs active:scale-[0.98] transition-all cursor-pointer border border-blue-400/20"
          >
            {t("whatsNew.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
