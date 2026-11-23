import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Shield,
  Fingerprint,
  KeyRound,
  ChevronDown,
  Check,
  Info,
} from "lucide-react";
import { useAppLockStore } from "@/stores/appLockStore";
import { ChangePasscodeDialog } from "./ChangePasscodeDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function SecuritySection() {
  const { t } = useTranslation("settings");

  const enabled = useAppLockStore((s) => s.enabled);
  const mode = useAppLockStore((s) => s.mode);
  const autoLockMinutes = useAppLockStore((s) => s.autoLockMinutes);
  const lockOnMinimize = useAppLockStore((s) => s.lockOnMinimize);
  const privacyShield = useAppLockStore((s) => s.privacyShield);

  const enableDeviceBiometrics = useAppLockStore((s) => s.enableDeviceBiometrics);
  const disableAppLock = useAppLockStore((s) => s.disableAppLock);
  const updateSettings = useAppLockStore((s) => s.updateSettings);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [passcodeFormat, setPasscodeFormat] = useState<"pin" | "alphanumeric">("pin");

  const handleToggleEnable = async () => {
    if (enabled) {
      await disableAppLock();
      toast.success(t("security.toasts.disabled", "App lock disabled."));
    } else {
      // Default to enabling device biometrics / OS password
      const ok = await enableDeviceBiometrics();
      if (ok) {
        toast.success(t("security.toasts.enabled", "App lock enabled!"));
      } else {
        // If biometrics failed or cancelled, prompt for custom PIN
        setPasscodeFormat("pin");
        setDialogOpen(true);
      }
    }
  };

  const handleSelectBiometrics = async () => {
    if (mode === "device_biometric") return;
    const ok = await enableDeviceBiometrics();
    if (ok) {
      toast.success(t("security.toasts.switchedBio", "Using device credentials & biometrics."));
    }
  };

  const handleSelectCustom = () => {
    setPasscodeFormat("pin");
    setDialogOpen(true);
  };

  const cadenceOptions = [
    { value: 0, label: t("security.cadence.immediate", "Immediately when minimized") },
    { value: 1, label: t("security.cadence.1m", "After 1 minute of inactivity") },
    { value: 5, label: t("security.cadence.5m", "After 5 minutes of inactivity (Recommended)") },
    { value: 15, label: t("security.cadence.15m", "After 15 minutes of inactivity") },
    { value: 60, label: t("security.cadence.1h", "After 1 hour of inactivity") },
    { value: -1, label: t("security.cadence.never", "Never (Only manual lock)") },
  ];

  const currentCadenceLabel =
    cadenceOptions.find((c) => c.value === autoLockMinutes)?.label ??
    cadenceOptions[2].label;

  return (
    <div className="space-y-6 select-none max-w-2xl">
      {/* Title Header */}
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3] flex items-center gap-2">
          <Shield className="h-5 w-5 text-[#0B57D0] dark:text-[#8ab4f8]" />
          <span>{t("security.title", "Security & App Lock")}</span>
        </h2>
        <p className="text-sm text-[#444746] dark:text-[#C4C7C5]">
          {t("security.description", "Protect TeleDrive on this device when you step away.")}
        </p>
      </div>

      {/* Master Toggle Card */}
      <div className="p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0c0d0f] shadow-xs flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">
            {t("security.enableLock", "Enable App Lock")}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {t(
              "security.enableLockDesc",
              "Require authentication whenever TeleDrive is launched or idle."
            )}
          </div>
        </div>

        {/* Toggle Switch */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={handleToggleEnable}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden",
            enabled ? "bg-[#0B57D0]" : "bg-slate-300 dark:bg-white/20"
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
              enabled ? "translate-x-5" : "translate-x-0"
            )}
          />
        </button>
      </div>

      {/* Configuration Options (Visible only when App Lock is enabled) */}
      {enabled && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#747775] dark:text-[#8e918f] px-1">
            {t("security.methodHeader", "Unlock Method")}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Option 1: Device Credentials / Biometrics */}
            <div
              onClick={handleSelectBiometrics}
              className={cn(
                "p-4 rounded-xl border text-left cursor-pointer transition-all duration-150 flex flex-col justify-between relative",
                mode === "device_biometric"
                  ? "border-[#0B57D0] bg-[#E8F0FE]/30 dark:bg-[#0B57D0]/10 dark:border-[#8ab4f8]"
                  : "border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-[#0c0d0f] hover:border-slate-300 dark:hover:border-white/[0.15]"
              )}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="h-8 w-8 rounded-lg bg-[#0B57D0]/10 text-[#0B57D0] dark:text-[#8ab4f8] flex items-center justify-center">
                    <Fingerprint className="h-5 w-5" />
                  </div>
                  {mode === "device_biometric" && (
                    <div className="h-5 w-5 rounded-full bg-[#0B57D0] text-white flex items-center justify-center">
                      <Check className="h-3.5 w-3.5" />
                    </div>
                  )}
                </div>
                <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <span>{t("security.methods.biometricTitle", "Device Password & Biometrics")}</span>
                  <span className="text-[10px] font-semibold text-[#0B57D0] dark:text-[#8ab4f8] bg-[#0B57D0]/10 dark:bg-[#8ab4f8]/10 px-1.5 py-0.5 rounded-full">
                    {t("security.methods.biometricRecommended", "Recommended")}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  {t(
                    "security.methods.biometricDesc",
                    "Unlock using Touch ID, Face ID, Windows Hello, or your computer login password. No new password to memorize."
                  )}
                </p>
              </div>
            </div>

            {/* Option 2: Custom Passcode */}
            <div
              onClick={handleSelectCustom}
              className={cn(
                "p-4 rounded-xl border text-left cursor-pointer transition-all duration-150 flex flex-col justify-between relative",
                mode === "custom_passcode"
                  ? "border-[#0B57D0] bg-[#E8F0FE]/30 dark:bg-[#0B57D0]/10 dark:border-[#8ab4f8]"
                  : "border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-[#0c0d0f] hover:border-slate-300 dark:hover:border-white/[0.15]"
              )}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="h-8 w-8 rounded-lg bg-slate-100 dark:bg-white/[0.06] text-slate-700 dark:text-slate-300 flex items-center justify-center">
                    <KeyRound className="h-4.5 w-4.5" />
                  </div>
                  {mode === "custom_passcode" && (
                    <div className="h-5 w-5 rounded-full bg-[#0B57D0] text-white flex items-center justify-center">
                      <Check className="h-3.5 w-3.5" />
                    </div>
                  )}
                </div>
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  {t("security.methods.customTitle", "Custom TeleDrive Passcode")}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  {t(
                    "security.methods.customDesc",
                    "Set a dedicated 4–6 digit numeric PIN or alphanumeric password specifically for TeleDrive."
                  )}
                </p>
              </div>

              {mode === "custom_passcode" && (
                <div className="mt-3 pt-2 border-t border-slate-200/60 dark:border-white/[0.06]">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDialogOpen(true);
                    }}
                    className="h-7 text-[11px] rounded-lg cursor-pointer"
                  >
                    {t("security.methods.changePasscode", "Change Passcode")}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Auto-Lock Cadence Settings */}
          <div className="p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0c0d0f] shadow-xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#747775] dark:text-[#8e918f]">
              {t("security.cadenceHeader", "Locking Cadence")}
            </h3>

            {/* Dropdown for auto-lock minutes */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-white">
                  {t("security.cadence.title", "Auto-Lock Timeout")}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {t("security.cadence.desc", "Automatically lock after a period of inactivity.")}
                </div>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5 rounded-xl text-xs font-medium cursor-pointer"
                  >
                    <span>{currentCadenceLabel}</span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 rounded-xl">
                  {cadenceOptions.map((opt) => (
                    <DropdownMenuItem
                      key={opt.value}
                      onClick={() => void updateSettings({ autoLockMinutes: opt.value })}
                      className="text-xs cursor-pointer flex items-center justify-between"
                    >
                      <span>{opt.label}</span>
                      {autoLockMinutes === opt.value && <Check className="h-3.5 w-3.5" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="border-t border-slate-100 dark:border-white/[0.06] pt-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-white">
                  {t("security.options.lockOnMinimize", "Lock on Minimize")}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {t(
                    "security.options.lockOnMinimizeDesc",
                    "Lock immediately when the application window is minimized or hidden."
                  )}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={lockOnMinimize}
                onClick={() => void updateSettings({ lockOnMinimize: !lockOnMinimize })}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden",
                  lockOnMinimize ? "bg-[#0B57D0]" : "bg-slate-300 dark:bg-white/20"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                    lockOnMinimize ? "translate-x-4" : "translate-x-0"
                  )}
                />
              </button>
            </div>

            <div className="border-t border-slate-100 dark:border-white/[0.06] pt-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-white">
                  {t("security.options.privacyShield", "Window Privacy Shield")}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {t(
                    "security.options.privacyShieldDesc",
                    "Obfuscate content preview in Mission Control, Alt-Tab, and mobile recents."
                  )}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={privacyShield}
                onClick={() => void updateSettings({ privacyShield: !privacyShield })}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden",
                  privacyShield ? "bg-[#0B57D0]" : "bg-slate-300 dark:bg-white/20"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                    privacyShield ? "translate-x-4" : "translate-x-0"
                  )}
                />
              </button>
            </div>
          </div>

          {/* Quick Lock shortcut banner */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200/70 dark:border-white/[0.06] flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-400">
            <Info className="h-4 w-4 shrink-0 text-[#0B57D0] dark:text-[#8ab4f8]" />
            <span>
              {t(
                "security.shortcutHint",
                "Tip: You can quickly lock TeleDrive at any time by pressing Cmd+L (macOS) or Ctrl+L (Windows/Linux)."
              )}
            </span>
          </div>
        </div>
      )}

      {/* Change Passcode Modal */}
      <ChangePasscodeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        format={passcodeFormat}
      />
    </div>
  );
}
