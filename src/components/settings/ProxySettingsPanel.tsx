import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, getErrorMessage } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { useAuthStore } from "@/stores/authStore";
import { reconnectActiveClient } from "@/lib/telegram/client";
import {
  DEFAULT_PROXY_SETTINGS,
  decodeMtproxySecret,
  getProxySettings,
  parseProxyLink,
  saveProxySettings,
  testProxyConnection,
  validateProxySettings,
  type ProxySettings,
  type ProxyType,
  type TestProxyResult,
} from "@/lib/telegram/proxy";

interface ProxySettingsPanelProps {
  compact?: boolean;
  onSaved?: (saved: ProxySettings) => void | Promise<void>;
}

const DEFAULT_PORTS: Record<ProxyType, number> = {
  mtproxy: 443,
  socks5: 1080,
  http: 8080,
};

export default function ProxySettingsPanel({
  compact = false,
  onSaved,
}: ProxySettingsPanelProps) {
  const { t } = useTranslation("settings");
  const [draft, setDraft] = useState<ProxySettings>({ ...DEFAULT_PROXY_SETTINGS });
  const [linkInput, setLinkInput] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<TestProxyResult | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const loaded = await getProxySettings();
        if (active) {
          setDraft(loaded);
        }
      } catch (err) {
        logger.warn("Failed to load proxy settings:", err);
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const mtproxyModeLabel = useMemo(() => {
    if (draft.proxyType !== "mtproxy" || !draft.secret.trim()) return null;
    try {
      const decoded = decodeMtproxySecret(draft.secret);
      if (decoded.fakeTlsDomain) {
        return t("network.secretModes.fakeTls", "Fake-TLS ({{domain}})", {
          domain: decoded.fakeTlsDomain,
        });
      }
      if (decoded.padded) {
        return t("network.secretModes.padded", "Random Padding (dd)");
      }
      return t("network.secretModes.standard", "Standard (16-byte)");
    } catch {
      return null;
    }
  }, [draft.proxyType, draft.secret, t]);

  const updateDraft = (patch: Partial<ProxySettings>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setTestResult(null);
  };

  const handleSelectProtocol = (nextType: ProxyType) => {
    setDraft((prev) => {
      const prevDefault = DEFAULT_PORTS[prev.proxyType];
      const nextPort =
        prev.port === prevDefault || !prev.port ? DEFAULT_PORTS[nextType] : prev.port;
      return { ...prev, proxyType: nextType, port: nextPort };
    });
    setTestResult(null);
  };

  const handleImportLink = () => {
    try {
      const parsed = parseProxyLink(linkInput);
      setDraft((prev) => ({
        ...prev,
        ...parsed,
        enabled: true,
      }));
      setLinkInput("");
      setTestResult(null);
      toast.success(
        t("network.toasts.linkImported", "Proxy settings imported from link.")
      );
    } catch (err) {
      const message = getErrorMessage(err);
      setTestResult({ ok: false, latencyMs: 0, message });
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      if (navigator.clipboard?.readText) {
        const clip = await navigator.clipboard.readText();
        if (clip.trim()) {
          setLinkInput(clip.trim());
          const parsed = parseProxyLink(clip.trim());
          setDraft((prev) => ({ ...prev, ...parsed, enabled: true }));
          setLinkInput("");
          setTestResult(null);
          toast.success(
            t("network.toasts.linkImported", "Proxy settings imported from link.")
          );
          return;
        }
      }
    } catch {
      // Clipboard read may be denied by browser/OS focus policy; let user paste manually
    }
  };

  const handleTestConnection = async () => {
    const validationErr = validateProxySettings(draft);
    if (validationErr) {
      setTestResult({ ok: false, latencyMs: 0, message: validationErr });
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testProxyConnection({ ...draft, enabled: true });
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        latencyMs: 0,
        message: getErrorMessage(err),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (draft.enabled) {
      const validationErr = validateProxySettings(draft);
      if (validationErr) {
        setTestResult({ ok: false, latencyMs: 0, message: validationErr });
        return;
      }
    }

    setIsSaving(true);
    try {
      const saved = await saveProxySettings(draft);
      setDraft(saved);

      const authState = useAuthStore.getState();
      const fallbackCreds =
        authState.apiId && authState.apiHash
          ? {
              apiId: authState.apiId,
              apiHash: authState.apiHash,
              sessionString: authState.sessionString ?? undefined,
            }
          : undefined;

      try {
        await reconnectActiveClient(fallbackCreds);
        await onSaved?.(saved);
        toast.success(
          saved.enabled
            ? t("network.toasts.savedConnected", "Proxy saved and Telegram reconnected.")
            : t("network.toasts.directRestored", "Proxy disabled. Switched back to direct connection.")
        );
      } catch (reconnectErr) {
        const msg = getErrorMessage(reconnectErr);
        logger.warn("Proxy saved but client reconnect failed:", reconnectErr);
        setTestResult({ ok: false, latencyMs: 0, message: msg });
        toast.error(
          t("network.toasts.savedReconnectFailed", "Proxy saved, but connecting failed: {{error}}", {
            error: msg,
          })
        );
      }
    } catch (err) {
      const msg = getErrorMessage(err);
      setTestResult({ ok: false, latencyMs: 0, message: msg });
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground gap-2 text-xs">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t("network.loading", "Loading proxy configuration...")}</span>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4 select-none", compact ? "text-xs" : "")}>
      {/* Enable toggle row */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-slate-50/70 dark:bg-white/[0.02] px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-[#0B57D0]/10 dark:bg-[#8ab4f8]/10 text-[#0B57D0] dark:text-[#8ab4f8] flex items-center justify-center shrink-0">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              {t("network.enableProxy.title", "Use custom proxy")}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {t(
                "network.enableProxy.description",
                "Route all Telegram sign-in, file transfers, and sync traffic through your proxy."
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          aria-label={t("network.enableProxy.title", "Use custom proxy")}
          disabled={isSaving || isTesting}
          onClick={() => updateDraft({ enabled: !draft.enabled })}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden disabled:opacity-60",
            draft.enabled ? "bg-[#0B57D0]" : "bg-slate-300 dark:bg-white/20"
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out",
              draft.enabled ? "translate-x-5" : "translate-x-0"
            )}
          />
        </button>
      </div>

      {/* Paste tg://proxy or proxy URL */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
          {t("network.importLink.label", "Quick import link")}
        </label>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && linkInput.trim()) {
                e.preventDefault();
                handleImportLink();
              }
            }}
            placeholder={t(
              "network.importLink.placeholder",
              "Paste tg://proxy?..., t.me/proxy?..., socks5://... or http://..."
            )}
            className="h-9 text-xs font-mono"
          />
          {linkInput.trim() ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-9 shrink-0"
              onClick={handleImportLink}
            >
              {t("network.importLink.apply", "Import")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 gap-1.5"
              onClick={() => void handlePasteFromClipboard()}
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
              <span>{t("network.importLink.paste", "Paste")}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Protocol selector */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
          {t("network.protocol.label", "Proxy protocol")}
        </label>
        <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-white/[0.04] border border-slate-200/70 dark:border-white/[0.06]">
          {(
            [
              { id: "mtproxy" as const, label: t("network.protocol.mtproxy", "MTProxy") },
              { id: "socks5" as const, label: t("network.protocol.socks5", "SOCKS5") },
              { id: "http" as const, label: t("network.protocol.http", "HTTP") },
            ] as const
          ).map((item) => {
            const active = draft.proxyType === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectProtocol(item.id)}
                className={cn(
                  "h-8 rounded-lg text-xs font-medium transition-all cursor-pointer",
                  active
                    ? "bg-white dark:bg-[#1a1c20] text-[#0B57D0] dark:text-[#8ab4f8] shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Host & Port */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2 space-y-1.5">
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
            {t("network.fields.host", "Server host or IP")}
          </label>
          <Input
            type="text"
            value={draft.host}
            onChange={(e) => updateDraft({ host: e.target.value })}
            placeholder="proxy.example.com"
            autoComplete="off"
            spellCheck={false}
            className="h-9 text-xs font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
            {t("network.fields.port", "Port")}
          </label>
          <Input
            type="number"
            min={1}
            max={65535}
            value={draft.port || ""}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              updateDraft({ port: Number.isNaN(val) ? 0 : Math.min(65535, Math.max(0, val)) });
            }}
            placeholder={String(DEFAULT_PORTS[draft.proxyType])}
            className="h-9 text-xs font-mono"
          />
        </div>
      </div>

      {/* Protocol-specific credentials */}
      {draft.proxyType === "mtproxy" ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              {t("network.fields.secret", "MTProxy secret")}
            </label>
            {mtproxyModeLabel && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#0B57D0]/10 dark:bg-[#8ab4f8]/10 text-[#0B57D0] dark:text-[#8ab4f8]">
                {mtproxyModeLabel}
              </span>
            )}
          </div>
          <div className="relative">
            <Input
              type={showSecret ? "text" : "password"}
              value={draft.secret}
              onChange={(e) => updateDraft({ secret: e.target.value })}
              placeholder={t(
                "network.fields.secretPlaceholder",
                "Hex (32 chars, dd..., or ee... Fake-TLS) or base64"
              )}
              autoComplete="off"
              spellCheck={false}
              className="h-9 pr-9 text-xs font-mono"
            />
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              aria-label={
                showSecret
                  ? t("network.fields.hideSecret", "Hide secret")
                  : t("network.fields.showSecret", "Show secret")
              }
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              {t("network.fields.username", "Username (optional)")}
            </label>
            <Input
              type="text"
              value={draft.username}
              onChange={(e) => updateDraft({ username: e.target.value })}
              autoComplete="off"
              className="h-9 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              {t("network.fields.password", "Password (optional)")}
            </label>
            <div className="relative">
              <Input
                type={showSecret ? "text" : "password"}
                value={draft.password}
                onChange={(e) => updateDraft({ password: e.target.value })}
                autoComplete="off"
                className="h-9 pr-9 text-xs"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                aria-label={
                  showSecret
                    ? t("network.fields.hidePassword", "Hide password")
                    : t("network.fields.showPassword", "Show password")
                }
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Test result feedback banner */}
      {testResult && (
        <div
          className={cn(
            "flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs",
            testResult.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
          )}
        >
          {testResult.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          <span className="leading-relaxed break-words">{testResult.message}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isTesting || isSaving}
          onClick={() => void handleTestConnection()}
          className="h-9 gap-1.5"
        >
          {isTesting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wifi className="h-3.5 w-3.5" />
          )}
          <span>
            {isTesting
              ? t("network.actions.testing", "Testing...")
              : t("network.actions.test", "Test connection")}
          </span>
        </Button>

        <Button
          type="button"
          size="sm"
          disabled={isSaving || isTesting}
          onClick={() => void handleSave()}
          className="h-9 bg-[#0B57D0] hover:bg-[#0947b0] text-white gap-1.5"
        >
          {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>
            {isSaving
              ? t("network.actions.saving", "Applying...")
              : t("network.actions.save", "Save & Apply")}
          </span>
        </Button>
      </div>
    </div>
  );
}
