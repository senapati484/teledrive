import { useMemo } from "react";
import { Presentation } from "lucide-react";
import { useTranslation } from "react-i18next";
import { sanitizePreviewHtml } from "@/lib/files/sanitizeHtml";
import { runtimeOpenUrl } from "@/lib/runtime/bridge";
import type { ExtractedSlide } from "@/lib/files/richPreviewExtractors";

interface RichDocumentSheetProps {
  htmlContent?: string | null;
  slides?: ExtractedSlide[] | null;
  isDark: boolean;
}

export function RichDocumentSheet({ htmlContent, slides, isDark }: RichDocumentSheetProps) {
  const { t } = useTranslation("preview");
  const safeHtml = useMemo(
    () => (htmlContent ? sanitizePreviewHtml(htmlContent) : ""),
    [htmlContent]
  );

  if (slides && slides.length > 0) {
    return (
      <div
        className="absolute inset-0 overflow-y-auto px-4 py-6 md:py-10 pointer-events-auto select-text"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: isDark ? "#202225 transparent" : "#e0e2e7 transparent",
          background: isDark ? "#000000" : "#f0f4f9",
        }}
      >
        <div className="max-w-4xl mx-auto space-y-6 pb-10">
          {slides.map((slide) => (
            <div
              key={slide.index}
              className="rounded-2xl border border-[#e0e2e7] dark:border-white/[0.06] bg-white dark:bg-[#111214] shadow-sm overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-100 dark:border-white/[0.05] bg-slate-50/70 dark:bg-[#161719]">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <Presentation className="h-3.5 w-3.5 text-orange-500" />
                  <span>{t("document.slideLabel", { number: slide.index, total: slides.length, defaultValue: `Slide ${slide.index} of ${slides.length}` })}</span>
                </div>
              </div>
              <div className="p-6 md:p-10 space-y-3 min-h-[180px] flex flex-col justify-center">
                {slide.lines.length > 0 ? (
                  slide.lines.map((line, idx) =>
                    idx === 0 ? (
                      <h2
                        key={idx}
                        className="text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-100 leading-snug"
                      >
                        {line}
                      </h2>
                    ) : (
                      <p
                        key={idx}
                        className="text-sm md:text-base text-slate-700 dark:text-slate-300 leading-relaxed pl-2 border-l-2 border-orange-500/30"
                      >
                        {line}
                      </p>
                    )
                  )
                ) : (
                  <p className="text-sm italic text-slate-400">
                    {t("document.emptySlide", "Empty slide")}
                  </p>
                )}
              </div>
              {slide.notes && (
                <div className="px-6 py-3 bg-amber-50/50 dark:bg-amber-500/[0.05] border-t border-amber-200/40 dark:border-amber-500/10 text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-semibold text-amber-700 dark:text-amber-400 mr-1.5">
                    {t("document.speakerNotes", "Notes:")}
                  </span>
                  {slide.notes}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 overflow-y-auto px-4 py-8 md:py-12 pointer-events-auto select-text flex justify-center"
      style={{
        scrollbarWidth: "thin",
        scrollbarColor: isDark ? "#202225 transparent" : "#e0e2e7 transparent",
        background: isDark ? "#000000" : "#f0f4f9",
      }}
    >
      <div
        className="w-full max-w-4xl bg-white dark:bg-[#111214] border border-[#e0e2e7] dark:border-white/[0.04] rounded-2xl shadow-sm p-8 md:p-14 my-auto min-h-full teledrive-markdown-body"
        onClick={(e) => {
          const target = (e.target as HTMLElement).closest("a");
          if (target && target.href) {
            e.preventDefault();
            try {
              const parsed = new URL(target.href);
              if (parsed.protocol === "http:" || parsed.protocol === "https:") {
                runtimeOpenUrl(target.href).catch(() =>
                  window.open(target.href, "_blank", "noopener,noreferrer")
                );
              }
            } catch {
              // ignore malformed URLs
            }
          }
        }}
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    </div>
  );
}

