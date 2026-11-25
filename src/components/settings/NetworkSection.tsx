import { Globe } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import ProxySettingsPanel from "./ProxySettingsPanel";

export default function NetworkSection() {
  const { t } = useTranslation("settings");

  return (
    <div className="space-y-6 select-none max-w-2xl">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3] flex items-center gap-2">
          <Globe className="h-5 w-5 text-[#0B57D0] dark:text-[#8ab4f8]" />
          <span>{t("network.title", "Network & Proxy")}</span>
        </h2>
        <p className="text-sm text-[#444746] dark:text-[#C4C7C5]">
          {t(
            "network.description",
            "Connect to Telegram through an MTProxy, SOCKS5, or HTTP proxy. Applies immediately without restarting."
          )}
        </p>
      </div>

      <div className="p-6 border border-slate-200/90 dark:border-white/[0.08] rounded-2xl bg-white dark:bg-[#0c0d0f] shadow-xs">
        <ProxySettingsPanel />
      </div>

      <div className="text-xs text-[#444746] dark:text-[#C4C7C5] bg-[#0B57D0]/5 dark:bg-[#8ab4f8]/5 p-4 rounded-xl border border-[#0B57D0]/15 dark:border-[#8ab4f8]/15 leading-relaxed">
        <Trans
          i18nKey="network.callout"
          ns="settings"
          defaults="<strong>Direct vs Proxy:</strong> TeleDrive saves proxy secrets locally with private file permissions and automatically preserves your Telegram session when switching between direct and proxy mode."
          components={{
            strong: (
              <strong className="font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]" />
            ),
          }}
        />
      </div>
    </div>
  );
}
