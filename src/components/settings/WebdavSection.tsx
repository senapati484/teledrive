import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Cloud,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Server,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  getWebdavSettings,
  regenerateWebdavPassword,
  setWebdavSettings,
  type WebdavSettingsStatus,
} from "@/lib/webdav/settings";

const DEFAULT_STATUS: WebdavSettingsStatus = {
  enabled: false,
  running: false,
  port: 8747,
  username: "teledrive",
  password: "",
  url: "",
  error: null,
};

export default function WebdavSection() {
  const { t } = useTranslation("settings");
  const [status, setStatus] = useState<WebdavSettingsStatus>(DEFAULT_STATUS);
  const [port, setPort] = useState("8747");
  const [username, setUsername] = useState("teledrive");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const applyStatus = useCallback((next: WebdavSettingsStatus) => {
    setStatus(next);
    setPort(String(next.port));
    setUsername(next.username);
    setPassword(next.password);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await getWebdavSettings();
        if (active) applyStatus(next);
      } catch (err) {
        logger.warn("[webdav] Failed to load settings:", err);
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [applyStatus]);

  const save = useCallback(
    async (overrides: Partial<{ enabled: boolean }> = {}) => {
      if (isSaving) return;
      const parsedPort = Number(port.trim());
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        toast.error(t("webdav.toasts.invalidPort", "Port must be between 1 and 65535."));
        return;
      }
      setIsSaving(true);
      try {
        const next = await setWebdavSettings({
          enabled: overrides.enabled ?? status.enabled,
          port: parsedPort,
          username: username.trim() || "teledrive",
          password,
        });
        applyStatus(next);
        if (next.error) {
          toast.error(next.error);
        } else if (next.running) {
          toast.success(
            t("webdav.toasts.started", "WebDAV server is running at {{url}}", {
              url: next.url,
            })
          );
        } else {
          toast.success(t("webdav.toasts.stopped", "WebDAV server stopped."));
        }
      } catch (err) {
        logger.error("[webdav] Failed to apply settings:", err);
        toast.error(
          t("webdav.toasts.saveFailed", "Could not update the WebDAV server.")
        );
      } finally {
        setIsSaving(false);
      }
    },
    [applyStatus, isSaving, password, port, status.enabled, t, username]
  );

  const handleToggle = () => void save({ enabled: !status.enabled });

  const handleRegenerate = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const next = await regenerateWebdavPassword();
      applyStatus(next);
      toast.success(t("webdav.toasts.passwordRegenerated", "New WebDAV password generated."));
    } catch (err) {
      logger.error("[webdav] Failed to regenerate password:", err);
      toast.error(t("webdav.toasts.passwordFailed", "Could not generate a new password."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!status.url) return;
    try {
      await navigator.clipboard.writeText(status.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission can be denied; the URL stays selectable.
    }
  };

  return (
    <div className="space-y-6 select-none max-w-2xl">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3] flex items-center gap-2">
          <Cloud className="h-5 w-5 text-[#0B57D0] dark:text-[#8ab4f8]" />
          <span>{t("webdav.title", "Network Drive (WebDAV)")}</span>
        </h2>
        <p className="text-sm text-[#444746] dark:text-[#C4C7C5]">
          {t(
            "webdav.description",
            "Expose your TeleDrive as a local WebDAV endpoint and mount it as a drive letter."
          )}
        </p>
      </div>

      <div className="p-6 border border-slate-200/90 dark:border-white/[0.08] rounded-2xl bg-white dark:bg-[#0c0d0f] shadow-xs space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-[#0B57D0]/10 dark:bg-[#8ab4f8]/10 text-[#0B57D0] dark:text-[#8ab4f8] flex items-center justify-center shrink-0 mt-0.5">
              <Server className="h-4.5 w-4.5" />
            </div>
            <div className="space-y-0.5">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                {t("webdav.enable.title", "Enable local WebDAV server")}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {t(
                  "webdav.enable.description",
                  "Runs only while TeleDrive is open. Binds to 127.0.0.1 and requires HTTP Basic auth."
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
              aria-checked={status.enabled}
              aria-label={t("webdav.enable.title", "Enable local WebDAV server")}
              disabled={isSaving}
              onClick={handleToggle}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden disabled:opacity-60 disabled:cursor-not-allowed",
                status.enabled ? "bg-[#0B57D0]" : "bg-slate-300 dark:bg-white/20"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                  status.enabled ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="webdav-port">{t("webdav.fields.port", "Port")}</Label>
            <Input
              id="webdav-port"
              inputMode="numeric"
              value={port}
              disabled={isSaving}
              onChange={(event) => setPort(event.target.value.replace(/[^\d]/g, ""))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="webdav-username">{t("webdav.fields.username", "Username")}</Label>
            <Input
              id="webdav-username"
              value={username}
              autoComplete="off"
              disabled={isSaving}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="webdav-password">{t("webdav.fields.password", "Password")}</Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                id="webdav-password"
                type={showPassword ? "text" : "password"}
                value={password}
                autoComplete="new-password"
                disabled={isSaving}
                className="pr-10"
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
                aria-label={t("webdav.fields.togglePassword", "Show or hide password")}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={isSaving}
              onClick={() => void handleRegenerate()}
              title={t("webdav.fields.regenerate", "Generate a new password")}
            >
              <KeyRound className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {t(
              "webdav.fields.passwordHint",
              "An empty password is replaced with a random 24-character password the first time the server starts."
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={isSaving || isLoading} onClick={() => void save()}>
            <RefreshCw className={cn("h-4 w-4 mr-2", isSaving && "animate-spin")} />
            {t("webdav.actions.apply", "Apply")}
          </Button>
          <span
            className={cn(
              "text-xs font-medium px-2 py-1 rounded-full",
              status.running
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-slate-500/10 text-slate-600 dark:text-slate-300"
            )}
          >
            {status.running
              ? t("webdav.status.running", "Running")
              : t("webdav.status.stopped", "Stopped")}
          </span>
        </div>

        {status.error ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{status.error}</span>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label>{t("webdav.mountUrl", "Mount URL")}</Label>
          <div className="flex items-center gap-2">
            <Input readOnly value={status.url || `http://127.0.0.1:${port}/`} />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void handleCopyUrl()}
              disabled={!status.url}
              title={t("webdav.actions.copyUrl", "Copy URL")}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {t(
              "webdav.mountHint",
              "Use this URL with RaiDrive or NetDrive on Windows, or `rclone mount` with WinFsp. See docs/WEBDAV.md for exact steps."
            )}
          </p>
        </div>
      </div>

      <div className="p-4 rounded-2xl border border-slate-200/90 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.02] text-xs text-slate-600 dark:text-slate-300 space-y-1">
        <p className="font-semibold text-slate-800 dark:text-slate-100">
          {t("webdav.security.title", "Security notes")}
        </p>
        <p>
          {t(
            "webdav.security.body",
            "The server listens on 127.0.0.1 only and rejects browser-originated requests. Traffic between the mount client and TeleDrive is plain HTTP on the loopback interface; do not forward the port or bind it to a LAN address."
          )}
        </p>
      </div>
    </div>
  );
}
