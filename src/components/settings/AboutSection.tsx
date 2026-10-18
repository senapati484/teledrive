import { useState, useEffect } from "react";
import { Bug, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

const GithubIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    stroke="currentColor"
    strokeWidth="2.5"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  </svg>
);
import { getVersion } from "@tauri-apps/api/app";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function AboutSection() {
  const { t } = useTranslation("settings");
  const [version, setVersion] = useState("0.1.1");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    async function fetchVersion() {
      try {
        const appVersion = await getVersion();
        setVersion(appVersion);
      } catch (err) {
        console.warn("Failed to load app version from Tauri:", err);
      }
    }
    fetchVersion();
  }, []);

  const handleOpenLink = async (url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      await openUrl(url);
    } catch (err) {
      console.error("Failed to open URL:", err);
      toast.error(t("about.toasts.openLinkFailed"));
    }
  };

  const handleCheckUpdates = () => {
    setChecking(true);
    setTimeout(() => {
      setChecking(false);
      toast.success(t("about.toasts.upToDate"), {
        description: t("about.toasts.latestVersion", { version }),
      });
    }, 800);
  };

  return (
    <div className="space-y-6 select-none">
      <div>
        <h3 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">{t("about.title")}</h3>
        <p className="text-sm text-[#444746] dark:text-[#C4C7C5] mt-1">
          {t("about.description")}
        </p>
      </div>

      <div className="p-6 bg-white dark:bg-[#1E1F20] border border-slate-200/90 dark:border-slate-800 rounded-2xl space-y-5 shadow-xs">
        <div className="flex items-center gap-3.5">
          <img
            src="/teledrive.png"
            alt={t("about.logoAlt")}
            className="h-12 w-12 object-contain rounded-2xl shrink-0 border border-slate-200/80 dark:border-slate-700/80 p-0.5 bg-white dark:bg-[#282A2C]"
          />
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h4 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">TeleDrive</h4>
              <span className="bg-blue-50 dark:bg-blue-950/40 text-[#0B57D0] dark:text-[#A8C7FA] border border-blue-200/60 dark:border-blue-800/60 font-mono text-xs px-2.5 py-0.5 rounded-full font-medium">
                v{version}
              </span>
            </div>
            <p className="text-xs text-[#747775]">
              {t("about.tagline")}
            </p>
          </div>
        </div>

        <p className="text-xs text-[#444746] dark:text-[#C4C7C5] leading-relaxed">
          {t("about.summary")}
        </p>

        <div className="flex flex-wrap gap-2.5 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenLink("https://github.com/senapati484/teledrive")}
            className="rounded-full text-xs font-medium gap-2 border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer h-9 px-4"
          >
            <GithubIcon className="h-4 w-4" />
            {t("about.githubRepository")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenLink("https://github.com/senapati484/teledrive/issues")}
            className="rounded-full text-xs font-medium gap-2 border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer h-9 px-4"
          >
            <Bug className="h-4 w-4 text-[#444746] dark:text-[#C4C7C5]" />
            {t("about.reportIssue")}
          </Button>
        </div>

        <div className="pt-4 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between flex-wrap gap-3">
          <div className="text-xs text-[#747775]">
            {t("about.architecture")}
          </div>
          <Button
            onClick={handleCheckUpdates}
            disabled={checking}
            className="rounded-full text-xs font-medium bg-[#0B57D0] hover:bg-[#0842A0] text-white dark:bg-[#A8C7FA] dark:hover:bg-[#D3E3FD] dark:text-[#062E6F] px-5 h-9 cursor-pointer transition-colors shadow-xs"
          >
            {checking ? t("about.checkingUpdates") : t("about.checkUpdates")}
          </Button>
        </div>
      </div>

      {/* Disclaimer Section Callout */}
      <div className="flex gap-3.5 p-4 rounded-2xl bg-slate-50 dark:bg-[#282A2C]/50 border border-slate-200/70 dark:border-slate-800 text-[#444746] dark:text-[#C4C7C5]">
        <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
        <div className="space-y-1 text-xs leading-relaxed">
          <h5 className="font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">{t("about.disclaimer.title")}</h5>
          <p>
            {t("about.disclaimer.body")}
          </p>
        </div>
      </div>
    </div>
  );
}
