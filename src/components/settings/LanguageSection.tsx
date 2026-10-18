import { Trans, useTranslation } from "react-i18next";
import { Check, Languages } from "lucide-react";
import { SUPPORTED_LANGUAGES } from "@/i18n";
import { cn } from "@/lib/utils";

export default function LanguageSection() {
  const { t, i18n } = useTranslation(["settings", "common"]);

  const currentLanguage = i18n.resolvedLanguage || i18n.language || "en";

  return (
    <div className="space-y-6 select-none">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">
          {t("language.title")}
        </h2>
        <p className="text-sm text-[#444746] dark:text-[#C4C7C5]">
          {t("language.description")}
        </p>
      </div>

      <div className="p-6 border border-slate-200/90 dark:border-slate-800 rounded-2xl bg-white dark:bg-[#1E1F20] shadow-xs space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
            {t("language.activeLanguage")}
          </h3>
          <p className="text-xs text-[#747775] dark:text-[#8E918F] mt-0.5">
            {t("language.cardDescription")}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const isSelected = currentLanguage === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                lang={lang.code}
                className={cn(
                  "p-4 rounded-xl flex items-center justify-between gap-3 border text-left transition-all duration-200 cursor-pointer",
                  isSelected
                    ? "bg-[#C2E7FF]/25 dark:bg-[#004A77]/30 border-[#0B57D0] dark:border-[#A8C7FA] shadow-xs ring-1 ring-[#0B57D0]/20 dark:ring-[#A8C7FA]/20"
                    : "bg-[#F0F4F9]/60 dark:bg-[#282A2C]/60 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C]"
                )}
                onClick={() => i18n.changeLanguage(lang.code)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={cn(
                      "h-9 w-9 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                      isSelected
                        ? "bg-[#0B57D0]/10 dark:bg-[#A8C7FA]/20 text-[#0B57D0] dark:text-[#A8C7FA]"
                        : "bg-slate-200/60 dark:bg-slate-800/80 text-[#444746] dark:text-[#C4C7C5]"
                    )}
                  >
                    <Languages className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0">
                    <span
                      className={cn(
                        "text-xs font-semibold block truncate",
                        isSelected ? "text-[#001D35] dark:text-[#C2E7FF]" : "text-[#1F1F1F] dark:text-[#E3E3E3]"
                      )}
                    >
                      {lang.label}
                    </span>
                    <span className="text-[10px] text-[#747775] dark:text-[#8E918F] uppercase tracking-wider font-mono">
                      {lang.code}
                    </span>
                  </div>
                </div>

                <div
                  className={cn(
                    "h-5 w-5 shrink-0 rounded-full flex items-center justify-center transition-all",
                    isSelected
                      ? "bg-[#0B57D0] text-white dark:bg-[#A8C7FA] dark:text-[#003258]"
                      : "border border-slate-300 dark:border-slate-600"
                  )}
                >
                  {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Info Callout */}
      <div className="p-4 rounded-2xl bg-[#F0F4F9] dark:bg-[#282A2C] border border-slate-200/60 dark:border-slate-700/60 text-xs text-[#444746] dark:text-[#C4C7C5] leading-relaxed">
        💡 <Trans t={t} i18nKey="language.callout" components={{ strong: <strong /> }} />
      </div>
    </div>
  );
}
