import { useCallback, useEffect, useState } from "react";
import { Minimize2, Power, SlidersHorizontal } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { isTauriRuntime } from "@/lib/runtime/bridge";
import {
  getDesktopStartupSettings,
  setLaunchAtLogin,
  setStartMinimizedToTray,
  type DesktopStartupState,
} from "@/lib/runtime/desktopStartup";

export default function GeneralSection() {
  const { t } = useTranslation("settings");
  const [state, setState] = useState<DesktopStartupState>({
    supported: true,
    launchAtLogin: false,
    startMinimizedToTray: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<"launchAtLogin" | "startMinimizedToTray" | null>(null);

  const syncSettings = useCallback(async (showSpinner = false) => {
    if (showSpinner) setIsLoading(true);
    try {
      const next = await getDesktopStartupSettings();
      setState(next);
    } catch (err) {
      logger.warn("Failed to load desktop startup settings:", err);
    } finally {
      if (showSpinner) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void syncSettings(true);

    // Re-query the OS startup entry whenever Settings regains focus so changes
    // made in Task Manager / macOS Login Items / desktop autostart are reflected live.
    const handleRefresh = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void syncSettings(false);
    };

    window.addEventListener("focus", handleRefresh);
    document.addEventListener("visibilitychange", handleRefresh);

    let unlistenFocus: (() => void) | null = null;
    let cancelled = false;
    if (isTauriRuntime()) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) =>
          getCurrentWindow().onFocusChanged(({ payload: focused }) => {
            if (focused) void syncSettings(false);
          })
        )
        .then((unlisten) => {
          if (cancelled) unlisten();
          else unlistenFocus = unlisten;
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleRefresh);
      document.removeEventListener("visibilitychange", handleRefresh);
      if (unlistenFocus) unlistenFocus();
    };
  }, [syncSettings]);

  const handleToggleLaunchAtLogin = async () => {
    if (isLoading || savingKey !== null) return;
    const nextEnabled = !state.launchAtLogin;
    setSavingKey("launchAtLogin");
    try {
      const updated = await setLaunchAtLogin(nextEnabled);
      setState(updated);
      toast.success(
        updated.launchAtLogin
          ? t("general.toasts.launchAtLoginEnabled", "TeleDrive will launch automatically at login.")
          : t("general.toasts.launchAtLoginDisabled", "Removed TeleDrive from login startup.")
      );
    } catch (err) {
      logger.error("Failed to toggle launch at login:", err);
      toast.error(
        t("general.toasts.launchAtLoginFailed", "Could not update launch at login setting.")
      );
      await syncSettings(false);
    } finally {
      setSavingKey(null);
    }
  };

  const handleToggleStartMinimized = async () => {
    if (isLoading || savingKey !== null) return;
    const nextEnabled = !state.startMinimizedToTray;
    setSavingKey("startMinimizedToTray");
    try {
      const updated = await setStartMinimizedToTray(nextEnabled);
      setState(updated);
      toast.success(
        updated.startMinimizedToTray
          ? t("general.toasts.startMinimizedEnabled", "TeleDrive will start minimized in the system tray.")
          : t("general.toasts.startMinimizedDisabled", "TeleDrive will open the main window on startup.")
      );
    } catch (err) {
      logger.error("Failed to toggle start minimized to tray:", err);
      toast.error(
        t("general.toasts.startMinimizedFailed", "Could not update startup window setting.")
      );
      await syncSettings(false);
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6 select-none max-w-2xl">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3] flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-[#0B57D0] dark:text-[#8ab4f8]" />
          <span>{t("general.title", "General")}</span>
        </h2>
        <p className="text-sm text-[#444746] dark:text-[#C4C7C5]">
          {t(
            "general.description",
            "Configure how TeleDrive starts with your computer and runs in the system tray."
          )}
        </p>
      </div>

      <div className="p-6 border border-slate-200/90 dark:border-white/[0.08] rounded-2xl bg-white dark:bg-[#0c0d0f] shadow-xs space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
            {t("general.startup.title", "Startup & System Tray")}
          </h3>
          <p className="text-xs text-[#747775] dark:text-[#8E918F] mt-0.5">
            {t(
              "general.startup.description",
              "Control login autostart and background tray behavior independently."
            )}
          </p>
        </div>

        <div className="divide-y divide-slate-200/70 dark:divide-white/[0.06]">
          {/* Launch at login */}
          <div className="pb-4 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-9 w-9 rounded-xl bg-[#0B57D0]/10 dark:bg-[#8ab4f8]/10 text-[#0B57D0] dark:text-[#8ab4f8] flex items-center justify-center shrink-0 mt-0.5">
                <Power className="h-4.5 w-4.5" />
              </div>
              <div className="space-y-0.5">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  {t("general.startup.launchAtLogin.title", "Launch at login")}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {t(
                    "general.startup.launchAtLogin.description",
                    "Automatically start TeleDrive when you sign in so scheduled device backups and folder sync stay active."
                  )}
                </p>
              </div>
            </div>

            {isLoading ? (
              <div className="h-6 w-11 shrink-0 rounded-full bg-slate-200 dark:bg-white/10 animate-pulse" />
            ) : (
              <button
                type="button"
                role="switch"
                aria-checked={state.launchAtLogin}
                aria-label={t("general.startup.launchAtLogin.title", "Launch at login")}
                disabled={savingKey !== null}
                onClick={() => void handleToggleLaunchAtLogin()}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden disabled:opacity-60 disabled:cursor-not-allowed",
                  state.launchAtLogin ? "bg-[#0B57D0]" : "bg-slate-300 dark:bg-white/20"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                    state.launchAtLogin ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            )}
          </div>

          {/* Start minimized to tray */}
          <div className="pt-4 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0 mt-0.5">
                <Minimize2 className="h-4.5 w-4.5" />
              </div>
              <div className="space-y-0.5">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  {t("general.startup.startMinimized.title", "Start minimized to tray")}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {t(
                    "general.startup.startMinimized.description",
                    "Keep the main window hidden in the system tray when TeleDrive launches instead of interrupting your desktop."
                  )}
                </p>
              </div>
            </div>

            {isLoading ? (
              <div className="h-6 w-11 shrink-0 rounded-full bg-slate-200 dark:bg-white/10 animate-pulse" />
            ) : (
              <button
                type="button"
                role="switch"
                aria-checked={state.startMinimizedToTray}
                aria-label={t("general.startup.startMinimized.title", "Start minimized to tray")}
                disabled={savingKey !== null}
                onClick={() => void handleToggleStartMinimized()}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden disabled:opacity-60 disabled:cursor-not-allowed",
                  state.startMinimizedToTray ? "bg-[#0B57D0]" : "bg-slate-300 dark:bg-white/20"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                    state.startMinimizedToTray ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Info Callout */}
      <div className="p-4 rounded-2xl bg-[#F0F4F9] dark:bg-[#060709] border border-slate-200/60 dark:border-white/[0.06] text-xs text-[#444746] dark:text-[#C4C7C5] leading-relaxed">
        💡{" "}
        <Trans
          t={t}
          i18nKey="general.callout"
          defaults="<strong>Background Tray Operation:</strong> When TeleDrive starts silently, it remains active in your system tray with scheduled backups and sync running. Click the tray icon or launch TeleDrive again to bring the window forward."
          components={{ strong: <strong /> }}
        />
      </div>
    </div>
  );
}
