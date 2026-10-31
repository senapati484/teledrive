import { useState, useEffect } from "react";
import { Bug, ShieldAlert, Globe, FlaskConical, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { APP_VERSION } from "@/lib/telegram/config";

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

const YoutubeIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="currentColor"
    {...props}
  >
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

const LINKS = {
  github: "https://github.com/senapati484/teledrive",
  issues: "https://github.com/senapati484/teledrive/issues",
  demo: "https://youtu.be/4AiMn7HSlFg",
  beta: "https://github.com/senapati484/teledrive/discussions/35",
  website: "https://www.teledrive.space",
};

export default function AboutSection() {
  const { t } = useTranslation("settings");
  const [version, setVersion] = useState(APP_VERSION);
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
    <div className="space-y-6 select-none max-w-3xl">
      <div>
        <h3 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
          {t("about.title")}
        </h3>
        <p className="text-sm text-[#444746] dark:text-[#C4C7C5] mt-1">
          {t("about.description")}
        </p>
      </div>

      <div className="p-6 bg-white dark:bg-[#0c0d0f] border border-slate-200/90 dark:border-white/[0.06] rounded-2xl space-y-5 shadow-xs">
        {/* App identity row */}
        <div className="flex items-center gap-3.5">
          <img
            src="/teledrive.png"
            alt={t("about.logoAlt")}
            className="h-12 w-12 object-contain rounded-2xl shrink-0 border border-slate-200/80 dark:border-white/[0.06] p-0.5 bg-white dark:bg-[#060709]"
          />
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h4 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                TeleDrive
              </h4>
              <span className="bg-blue-50 dark:bg-blue-950/40 text-[#0B57D0] dark:text-[#8ab4f8] border border-blue-200/60 dark:border-blue-800/60 font-mono text-xs px-2.5 py-0.5 rounded-full font-medium">
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

        {/* ── Symmetrical 3x2 / 2x3 Link grid ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
          {/* Row 1, Col 1: ⭐ Star on GitHub */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenLink(LINKS.github)}
            className="w-full rounded-full text-xs font-medium gap-2 border border-slate-300 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-200 cursor-pointer h-9 px-3.5 justify-center"
          >
            <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-400 shrink-0" />
            <span className="truncate">{t("about.starOnGithub")}</span>
          </Button>

          {/* Row 1, Col 2: 🐛 Report an Issue */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenLink(LINKS.issues)}
            className="w-full rounded-full text-xs font-medium gap-2 border border-slate-300 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-200 cursor-pointer h-9 px-3.5 justify-center"
          >
            <Bug className="h-3.5 w-3.5 text-[#444746] dark:text-[#C4C7C5] shrink-0" />
            <span className="truncate">{t("about.reportIssue")}</span>
          </Button>

          {/* Row 1, Col 3: 🐙 GitHub Repository */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenLink(LINKS.github)}
            className="w-full rounded-full text-xs font-medium gap-2 border border-slate-300 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-200 cursor-pointer h-9 px-3.5 justify-center"
          >
            <GithubIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t("about.githubRepository")}</span>
          </Button>

          {/* Row 2, Col 1: ▶️ Watch the Demo */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenLink(LINKS.demo)}
            className="w-full rounded-full text-xs font-medium gap-2 border border-slate-300 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-200 cursor-pointer h-9 px-3.5 justify-center"
          >
            <YoutubeIcon className="h-3.5 w-3.5 text-red-500 shrink-0" />
            <span className="truncate">{t("about.watchDemo")}</span>
          </Button>

          {/* Row 2, Col 2: 🧪 Join Beta Testing */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenLink(LINKS.beta)}
            className="w-full rounded-full text-xs font-medium gap-2 border border-slate-300 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-200 cursor-pointer h-9 px-3.5 justify-center"
          >
            <FlaskConical className="h-3.5 w-3.5 text-purple-500 shrink-0" />
            <span className="truncate">{t("about.joinBeta")}</span>
          </Button>

          {/* Row 2, Col 3: 🌐 Official Website */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenLink(LINKS.website)}
            className="w-full rounded-full text-xs font-medium gap-2 border border-slate-300 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-200 cursor-pointer h-9 px-3.5 justify-center"
          >
            <Globe className="h-3.5 w-3.5 text-[#0B57D0] dark:text-[#8ab4f8] shrink-0" />
            <span className="truncate">{t("about.website")}</span>
          </Button>
        </div>

        <div className="pt-4 border-t border-slate-200/80 dark:border-white/[0.06] flex items-center justify-between flex-wrap gap-3">
          <div className="text-xs text-[#747775] dark:text-[#9aa0a6]">
            {t("about.architecture")}
          </div>
          <Button
            onClick={handleCheckUpdates}
            disabled={checking}
            className="rounded-full text-xs font-semibold bg-[#0B57D0] hover:bg-[#0842A0] text-white dark:bg-[#1a73e8] dark:hover:bg-[#1558b0] dark:text-white px-5 h-9 cursor-pointer transition-colors shadow-xs border-0"
          >
            {checking ? t("about.checkingUpdates") : t("about.checkUpdates")}
          </Button>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="flex gap-3.5 p-4 rounded-2xl bg-slate-50 dark:bg-[#060709] border border-slate-200/70 dark:border-white/[0.06] text-[#444746] dark:text-[#C4C7C5]">
        <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5 text-[#0B57D0] dark:text-[#8ab4f8]" />
        <div className="space-y-1 text-xs leading-relaxed">
          <h5 className="font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
            {t("about.disclaimer.title")}
          </h5>
          <p>
            {t("about.disclaimer.body")}
          </p>
        </div>
      </div>
    </div>
  );
}
