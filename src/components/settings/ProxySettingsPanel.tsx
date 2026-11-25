import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ClipboardPaste,
  Globe,
  Loader2,
  WifiOff,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { useAuthStore } from "@/stores/authStore";
import { reconnectActiveClient } from "@/lib/telegram/client";
import {
  autoDetectAndSaveProxy,
  clearProxy,
  getProxySettings,
  isProxySupported,
  type ProxySettings,
  type ProxyType,
} from "@/lib/telegram/proxy";

interface ProxySettingsPanelProps {
  compact?: boolean;
  onSaved?: (saved: ProxySettings) => void | Promise<void>;
}

type ConnectionStatus = "idle" | "detecting" | "connected" | "direct";

const PROTOCOL_LABEL: Record<ProxyType, string> = {
  mtproxy: "MTProxy",
  socks5: "SOCKS5",
  http: "HTTP",
};

export default function ProxySettingsPanel({
  compact = false,
  onSaved,
}: ProxySettingsPanelProps) {
  const { t } = useTranslation("settings");

  const [linkInput, setLinkInput] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [connectedProtocol, setConnectedProtocol] = useState<ProxyType | null>(null);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Load persisted proxy settings on mount */
  useEffect(() => {
    if (!isProxySupported()) {
      setIsLoading(false);
      return;
    }
    let active = true;
    void getProxySettings()
      .then((s) => {
        if (!active) return;
        if (s.enabled) {
          setProxyEnabled(true);
          setConnectedProtocol(s.proxyType);
          setStatus("connected");
        } else {
          setProxyEnabled(false);
          setStatus("direct");
        }
      })
      .catch((err) => {
        logger.warn("Failed to load proxy settings:", err);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  /** Reconnect client after proxy config changes */
  const triggerReconnect = async (saved: ProxySettings) => {
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
    } catch (err) {
      logger.warn("Client reconnect after proxy change failed:", err);
    }
    await onSaved?.(saved);
  };

  /** Auto-detect, test, and save proxy from a pasted link */
  const applyProxyLink = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    setStatus("detecting");
    setLinkInput("");

    try {
      const saved = await autoDetectAndSaveProxy(trimmed);
      setProxyEnabled(true);
      setConnectedProtocol(saved.proxyType);
      setStatus("connected");
      toast.success(
        t(
          "network.toasts.connected",
          "Connected via {{protocol}}",
          { protocol: PROTOCOL_LABEL[saved.proxyType] }
        )
      );
      await triggerReconnect(saved);
    } catch (err) {
      // Auto-detect failed — fall back to direct silently
      logger.warn("Proxy auto-detect failed, using direct connection:", err);
      setProxyEnabled(false);
      setConnectedProtocol(null);
      setStatus("direct");
      toast.info(
        t("network.toasts.directFallback", "Proxy not reachable. Using direct connection.")
      );
    }
  };

  /** Paste from clipboard and immediately apply */
  const handlePaste = async () => {
    try {
      if (navigator.clipboard?.readText) {
        const clip = await navigator.clipboard.readText();
        if (clip.trim()) {
          await applyProxyLink(clip.trim());
          return;
        }
      }
    } catch {
      // Clipboard access denied — focus input so user can paste manually
    }
    inputRef.current?.focus();
  };

  /** Clear proxy and go back to direct */
  const handleClear = async () => {
    setStatus("detecting");
    try {
      const cleared = await clearProxy();
      setProxyEnabled(false);
      setConnectedProtocol(null);
      setStatus("direct");
      toast.success(t("network.toasts.directRestored", "Using direct connection."));
      await triggerReconnect(cleared);
    } catch (err) {
      logger.warn("Failed to clear proxy:", err);
      setStatus(proxyEnabled ? "connected" : "direct");
    }
  };

  if (!isProxySupported()) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground gap-2 text-xs">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t("network.loading", "Loading...")}</span>
      </div>
    );
  }

  const isDetecting = status === "detecting";

  return (
    <div className={cn("space-y-4 select-none", compact ? "text-xs" : "")}>
      {/* Status badge */}
      <div className="flex items-center gap-2">
        {isDetecting ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        ) : proxyEnabled ? (
          <Globe className="h-4 w-4 text-emerald-500" />
        ) : (
          <Globe className="h-4 w-4 text-slate-400" />
        )}
        <span
          className={cn(
            "text-xs font-medium",
            isDetecting
              ? "text-slate-400"
              : proxyEnabled
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-slate-500 dark:text-slate-400"
          )}
        >
          {isDetecting
            ? t("network.status.detecting", "Connecting…")
            : proxyEnabled && connectedProtocol
            ? t("network.status.connected", "{{protocol}} proxy active", {
                protocol: PROTOCOL_LABEL[connectedProtocol],
              })
            : t("network.status.direct", "Direct connection")}
        </span>

        {/* Connected indicator dot */}
        {!isDetecting && proxyEnabled && (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 ml-auto shrink-0" />
        )}
        {!isDetecting && !proxyEnabled && (
          <WifiOff className="h-3.5 w-3.5 text-slate-400 ml-auto shrink-0" />
        )}
      </div>

      {/* Proxy link input */}
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          type="text"
          value={linkInput}
          onChange={(e) => setLinkInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && linkInput.trim()) {
              e.preventDefault();
              void applyProxyLink(linkInput);
            }
          }}
          placeholder={t(
            "network.importLink.placeholder",
            "Paste a proxy link: tg://proxy?..., socks5://..., http://..."
          )}
          disabled={isDetecting}
          className="h-9 text-xs font-mono"
        />
        {linkInput.trim() ? (
          <Button
            type="button"
            size="sm"
            className="h-9 shrink-0 bg-[#0B57D0] hover:bg-[#0947b0] text-white"
            disabled={isDetecting}
            onClick={() => void applyProxyLink(linkInput)}
          >
            {isDetecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              t("network.importLink.apply", "Connect")
            )}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0 gap-1.5"
            disabled={isDetecting}
            onClick={() => void handlePaste()}
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            <span>{t("network.importLink.paste", "Paste")}</span>
          </Button>
        )}
      </div>

      {/* Clear proxy button — only shown when proxy is active */}
      {proxyEnabled && !isDetecting && (
        <button
          type="button"
          onClick={() => void handleClear()}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400 transition-colors cursor-pointer"
        >
          <X className="h-3 w-3" />
          <span>{t("network.clearProxy", "Remove proxy and use direct connection")}</span>
        </button>
      )}
    </div>
  );
}
