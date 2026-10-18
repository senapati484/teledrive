import { Sun, Moon, Laptop, Check, Languages } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";
import { SUPPORTED_LANGUAGES } from "@/i18n";

export default function AppearanceSection() {
  const { t, i18n } = useTranslation("settings");
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);

  const themeOptions = [
    {
      label: t("appearance.themes.light.label"),
      value: "light" as const,
      icon: Sun,
      description: t("appearance.themes.light.description"),
      preview: {
        bg: "bg-[#F8FAFD]",
        surface: "bg-white border-slate-200",
        sidebar: "bg-[#F8FAFD] border-slate-200/70",
        accent: "bg-[#0B57D0]",
      },
    },
    {
      label: t("appearance.themes.dark.label"),
      value: "dark" as const,
      icon: Moon,
      description: t("appearance.themes.dark.description"),
      preview: {
        bg: "bg-[#131314]",
        surface: "bg-[#1E1F20] border-slate-800",
        sidebar: "bg-[#131314] border-slate-800",
        accent: "bg-[#A8C7FA]",
      },
    },
    {
      label: t("appearance.themes.system.label"),
      value: "system" as const,
      icon: Laptop,
      description: t("appearance.themes.system.description"),
      preview: {
        bg: "bg-gradient-to-r from-[#F8FAFD] to-[#131314]",
        surface: "bg-gradient-to-r from-white to-[#1E1F20] border-slate-300 dark:border-slate-700",
        sidebar: "bg-gradient-to-r from-[#F8FAFD] to-[#131314]",
        accent: "bg-[#0B57D0]",
      },
    },
  ];

  return (
    <div className="space-y-6 select-none">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">
          {t("appearance.title")}
        </h2>
        <p className="text-sm text-[#444746] dark:text-[#C4C7C5]">
          {t("appearance.description")}
        </p>
      </div>

      <div className="p-6 border border-slate-200/90 dark:border-slate-800 rounded-2xl bg-white dark:bg-[#1E1F20] shadow-xs space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
            {t("appearance.themeMode.title")}
          </h3>
          <p className="text-xs text-[#747775] dark:text-[#8E918F] mt-0.5">
            {t("appearance.themeMode.description")}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          {themeOptions.map((opt) => {
            const Icon = opt.icon;
            const isSelected = theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                className={cn(
                  "p-4 rounded-xl flex flex-col items-start gap-3 border text-left transition-all duration-200 cursor-pointer relative group",
                  isSelected
                    ? "bg-[#C2E7FF]/25 dark:bg-[#004A77]/30 border-[#0B57D0] dark:border-[#A8C7FA] shadow-xs"
                    : "bg-[#F0F4F9]/60 dark:bg-[#282A2C]/60 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C]"
                )}
                onClick={() => setTheme(opt.value)}
              >
                {/* Visual mini UI mock preview */}
                <div className={cn("w-full h-16 rounded-lg p-1.5 flex gap-1.5 border overflow-hidden", opt.preview.surface)}>
                  <div className={cn("w-1/4 h-full rounded border flex flex-col gap-1 p-1", opt.preview.sidebar)}>
                    <div className={cn("h-1.5 w-full rounded-full", opt.preview.accent)} />
                    <div className="h-1 w-3/4 rounded-full bg-slate-300/60 dark:bg-slate-600/60" />
                    <div className="h-1 w-1/2 rounded-full bg-slate-300/40 dark:bg-slate-600/40" />
                  </div>
                  <div className={cn("flex-1 h-full rounded flex flex-col justify-between p-1.5", opt.preview.bg)}>
                    <div className="flex gap-1">
                      <div className="h-1.5 w-6 rounded bg-slate-300/70 dark:bg-slate-600/70" />
                      <div className="h-1.5 w-4 rounded bg-slate-300/40 dark:bg-slate-600/40" />
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      <div className="h-4 rounded bg-slate-200/80 dark:bg-slate-700/80" />
                      <div className="h-4 rounded bg-slate-200/80 dark:bg-slate-700/80" />
                    </div>
                  </div>
                </div>

                {/* Title & selection indicator */}
                <div className="flex items-center justify-between w-full pt-0.5">
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4", isSelected ? "text-[#0B57D0] dark:text-[#A8C7FA]" : "text-[#444746] dark:text-[#C4C7C5]")} />
                    <span className={cn("text-xs font-semibold", isSelected ? "text-[#001D35] dark:text-[#C2E7FF]" : "text-[#1F1F1F] dark:text-[#E3E3E3]")}>
                      {opt.label}
                    </span>
                  </div>

                  <div className={cn(
                    "h-4 w-4 rounded-full flex items-center justify-center transition-all",
                    isSelected ? "bg-[#0B57D0] text-white dark:bg-[#A8C7FA] dark:text-[#003258]" : "border border-slate-300 dark:border-slate-600"
                  )}>
                    {isSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                  </div>
                </div>

                <p className="text-[11px] text-[#747775] dark:text-[#8E918F] leading-tight line-clamp-2">
                  {opt.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-6 border border-slate-200/90 dark:border-slate-800 rounded-2xl bg-white dark:bg-[#1E1F20] shadow-xs space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
            {t("common:language.title")}
          </h3>
          <p className="text-xs text-[#747775] dark:text-[#8E918F] mt-0.5">
            {t("common:language.description")}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const isSelected = i18n.resolvedLanguage === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                lang={lang.code}
                className={cn(
                  "p-4 rounded-xl flex items-center justify-between gap-3 border text-left transition-all duration-200 cursor-pointer",
                  isSelected
                    ? "bg-[#C2E7FF]/25 dark:bg-[#004A77]/30 border-[#0B57D0] dark:border-[#A8C7FA] shadow-xs"
                    : "bg-[#F0F4F9]/60 dark:bg-[#282A2C]/60 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C]"
                )}
                onClick={() => i18n.changeLanguage(lang.code)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Languages className={cn("h-4 w-4 shrink-0", isSelected ? "text-[#0B57D0] dark:text-[#A8C7FA]" : "text-[#444746] dark:text-[#C4C7C5]")} />
                  <span className={cn("text-xs font-semibold truncate", isSelected ? "text-[#001D35] dark:text-[#C2E7FF]" : "text-[#1F1F1F] dark:text-[#E3E3E3]")}>
                    {lang.label}
                  </span>
                </div>

                <div className={cn(
                  "h-4 w-4 shrink-0 rounded-full flex items-center justify-center transition-all",
                  isSelected ? "bg-[#0B57D0] text-white dark:bg-[#A8C7FA] dark:text-[#003258]" : "border border-slate-300 dark:border-slate-600"
                )}>
                  {isSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Info Callout */}
      <div className="p-4 rounded-2xl bg-[#F0F4F9] dark:bg-[#282A2C] border border-slate-200/60 dark:border-slate-700/60 text-xs text-[#444746] dark:text-[#C4C7C5] leading-relaxed">
        💡 <Trans t={t} i18nKey="appearance.callout" components={{ strong: <strong /> }} />
      </div>
    </div>
  );
}
