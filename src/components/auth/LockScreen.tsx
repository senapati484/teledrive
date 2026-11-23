import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Lock,
  Fingerprint,
  ShieldAlert,
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { useAppLockStore } from "@/stores/appLockStore";
import { useAuthStore } from "@/stores/authStore";
import { PinKeypad } from "./PinKeypad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function LockScreen() {
  const { t } = useTranslation("settings");

  const isLocked = useAppLockStore((s) => s.isLocked);
  const enabled = useAppLockStore((s) => s.enabled);
  const mode = useAppLockStore((s) => s.mode);
  const passcodeFormat = useAppLockStore((s) => s.passcodeFormat);
  const pinLength = useAppLockStore((s) => s.pinLength);
  const lockoutRemainingSec = useAppLockStore((s) => s.lockoutRemainingSec);
  const biometricsType = useAppLockStore((s) => s.biometricsType);
  const unlockWithBiometrics = useAppLockStore((s) => s.unlockWithBiometrics);
  const unlockWithPasscode = useAppLockStore((s) => s.unlockWithPasscode);
  const resetAppLockOnLogout = useAppLockStore((s) => s.resetAppLockOnLogout);

  const phoneNumber = useAuthStore((s) => s.phoneNumber);
  const logout = useAuthStore((s) => s.logout);

  const [pinDigits, setPinDigits] = useState<string[]>([]);
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shake, setShake] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [forgotDialogOpen, setForgotDialogOpen] = useState(false);

  const autoBiometricsTriggered = useRef(false);

  // Auto-trigger biometric prompt on mount if in biometric mode
  useEffect(() => {
    if (isLocked && enabled && mode === "device_biometric" && !autoBiometricsTriggered.current) {
      autoBiometricsTriggered.current = true;
      const timer = setTimeout(() => {
        void unlockWithBiometrics();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isLocked, enabled, mode, unlockWithBiometrics]);

  // Trigger shake animation on error
  const triggerShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  }, []);

  // Handle PIN digit input
  const handleDigit = useCallback(
    async (digit: string) => {
      if (isSubmitting || lockoutRemainingSec > 0) return;
      setErrorMessage(null);

      const targetLength = pinLength || 4;
      const nextDigits = [...pinDigits, digit];
      if (nextDigits.length <= targetLength) {
        setPinDigits(nextDigits);

        // Auto-submit when target PIN length is reached
        if (nextDigits.length === targetLength) {
          setIsSubmitting(true);
          const pinStr = nextDigits.join("");
          const res = await unlockWithPasscode(pinStr);

          if (!res.success) {
            triggerShake();
            setTimeout(() => {
              setPinDigits([]);
              setIsSubmitting(false);
            }, 300);

            if (res.error === "cooldown") {
              setErrorMessage(
                t("security.lockScreen.cooldown", {
                  seconds: res.lockoutSec ?? 30,
                  defaultValue: `Too many attempts. Try again in ${res.lockoutSec ?? 30}s.`,
                })
              );
            } else {
              setErrorMessage(
                t("security.lockScreen.wrongPin", "Incorrect PIN. Please try again.")
              );
            }
          } else {
            setPinDigits([]);
            setIsSubmitting(false);
          }
        }
      }
    },
    [pinDigits, isSubmitting, lockoutRemainingSec, pinLength, unlockWithPasscode, triggerShake, t]
  );

  const handlePinSubmit = useCallback(async () => {
    if (pinDigits.length < 4 || isSubmitting || lockoutRemainingSec > 0) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    const pinStr = pinDigits.join("");
    const res = await unlockWithPasscode(pinStr);

    if (!res.success) {
      triggerShake();
      setTimeout(() => {
        setPinDigits([]);
        setIsSubmitting(false);
      }, 300);

      if (res.error === "cooldown") {
        setErrorMessage(
          t("security.lockScreen.cooldown", {
            seconds: res.lockoutSec ?? 30,
            defaultValue: `Too many attempts. Try again in ${res.lockoutSec ?? 30}s.`,
          })
        );
      } else {
        setErrorMessage(
          t("security.lockScreen.wrongPin", "Incorrect PIN. Please try again.")
        );
      }
    } else {
      setPinDigits([]);
      setIsSubmitting(false);
    }
  }, [pinDigits, isSubmitting, lockoutRemainingSec, unlockWithPasscode, triggerShake, t]);

  const handleBackspace = useCallback(() => {
    if (isSubmitting || pinDigits.length === 0) return;
    setErrorMessage(null);
    setPinDigits((prev) => prev.slice(0, prev.length - 1));
  }, [isSubmitting, pinDigits.length]);

  const handlePassphraseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim() || isSubmitting || lockoutRemainingSec > 0) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    const res = await unlockWithPasscode(passphrase.trim());

    if (!res.success) {
      triggerShake();
      setIsSubmitting(false);
      if (res.error === "cooldown") {
        setErrorMessage(
          t("security.lockScreen.cooldown", {
            seconds: res.lockoutSec ?? 30,
            defaultValue: `Too many attempts. Try again in ${res.lockoutSec ?? 30}s.`,
          })
        );
      } else {
        setErrorMessage(
          t("security.lockScreen.wrongPasscode", "Incorrect passcode. Please try again.")
        );
      }
    } else {
      setPassphrase("");
      setIsSubmitting(false);
    }
  };

  const handleForgotConfirm = async () => {
    setForgotDialogOpen(false);
    await resetAppLockOnLogout();
    const { logoutTelegram } = await import("@/lib/telegram/logout");
    await logoutTelegram().catch(() => {});
    logout();
  };

  if (!isLocked || !enabled) return null;

  const biometryLabel =
    biometricsType === "touch_id"
      ? t("security.lockScreen.touchId", "Unlock with Touch ID")
      : biometricsType === "face_id"
      ? t("security.lockScreen.faceId", "Unlock with Face ID")
      : biometricsType === "windows_hello"
      ? t("security.lockScreen.windowsHello", "Unlock with Windows Hello")
      : t("security.lockScreen.deviceCreds", "Unlock with Device Password");

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between p-6 sm:p-10 select-none bg-white/90 dark:bg-[#090A0D]/95 backdrop-blur-3xl animate-in fade-in duration-200 overflow-y-auto max-h-screen">
      {/* Top TeleDrive emblem & header */}
      <div className="w-full flex items-center justify-between max-w-sm sm:max-w-md">
        <div className="flex items-center gap-2.5">
          <img
            src="/teledrive.png"
            alt="TeleDrive"
            className="h-8 w-8 object-contain shrink-0 drop-shadow-sm"
          />
          <span className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">
            TeleDrive
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/[0.08] text-xs font-medium text-slate-600 dark:text-slate-300">
          <Lock className="h-3 w-3 text-[#0B57D0] dark:text-[#8ab4f8]" />
          <span>{t("security.lockScreen.lockedBadge", "Locked")}</span>
        </div>
      </div>

      {/* Main Lock Content */}
      <div
        className={cn(
          "w-full max-w-sm sm:max-w-md flex flex-col items-center text-center my-auto",
          shake && "animate-shake"
        )}
      >
        {/* Animated Avatar / Lock Icon */}
        <div className="relative mb-5">
          <div className="h-20 w-20 rounded-full bg-[#E8F0FE] dark:bg-[#0B57D0]/20 text-[#0B57D0] dark:text-[#8ab4f8] flex items-center justify-center shadow-inner">
            {mode === "device_biometric" ? (
              <Fingerprint className="h-10 w-10 stroke-[1.6]" />
            ) : (
              <Lock className="h-9 w-9 stroke-[1.8]" />
            )}
          </div>
        </div>

        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white mb-1">
          {t("security.lockScreen.title", "TeleDrive is Locked")}
        </h1>

        {phoneNumber && (
          <p className="text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400 mb-6">
            {phoneNumber}
          </p>
        )}

        {/* Lockout alert */}
        {lockoutRemainingSec > 0 && (
          <div className="w-full mb-6 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 flex items-center gap-2.5 text-rose-700 dark:text-rose-300 text-xs text-left">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {t("security.lockScreen.cooldown", {
                seconds: lockoutRemainingSec,
                defaultValue: `Too many failed attempts. Try again in ${lockoutRemainingSec}s.`,
              })}
            </span>
          </div>
        )}

        {/* Error message */}
        {errorMessage && lockoutRemainingSec === 0 && (
          <div className="w-full mb-4 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-amber-700 dark:text-amber-300 text-xs">
            {errorMessage}
          </div>
        )}

        {/* Biometrics Mode */}
        {mode === "device_biometric" && (
          <div className="w-full flex flex-col items-center gap-3">
            <Button
              type="button"
              disabled={isSubmitting || lockoutRemainingSec > 0}
              onClick={() => void unlockWithBiometrics()}
              className="w-full h-12 rounded-full bg-[#0B57D0] hover:bg-[#0B57D0]/90 text-white font-medium text-sm flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-all active:scale-98"
            >
              <Fingerprint className="h-5 w-5" />
              <span>{biometryLabel}</span>
            </Button>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {t(
                "security.lockScreen.biometricHint",
                "Touch your fingerprint sensor or enter your device password."
              )}
            </p>
          </div>
        )}

        {/* Custom Passcode Mode */}
        {mode === "custom_passcode" && passcodeFormat === "pin" && (
          <div className="w-full flex flex-col items-center">
            {/* Dynamic Dot Indicators */}
            <div className="flex items-center gap-4 mb-8">
              {Array.from({ length: pinLength || 4 }).map((_, idx) => {
                const filled = pinDigits.length > idx;
                return (
                  <div
                    key={idx}
                    className={cn(
                      "h-4 w-4 rounded-full transition-all duration-200 ease-out",
                      filled
                        ? "bg-[#0B57D0] dark:bg-[#8ab4f8] scale-110 shadow-xs"
                        : "border-2 border-slate-300 dark:border-white/20 bg-transparent scale-100"
                    )}
                  />
                );
              })}
            </div>

            {/* Virtual Keypad */}
            <PinKeypad
              onDigit={handleDigit}
              onBackspace={handleBackspace}
              onSubmit={handlePinSubmit}
              disabled={isSubmitting || lockoutRemainingSec > 0}
            />
          </div>
        )}

        {/* Custom Passcode Mode (Alphanumeric) */}
        {mode === "custom_passcode" && passcodeFormat === "alphanumeric" && (
          <form onSubmit={handlePassphraseSubmit} className="w-full space-y-4">
            <div className="relative">
              <Input
                type={showPassphrase ? "text" : "password"}
                placeholder={t("security.lockScreen.enterPassphrase", "Enter master passphrase")}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoFocus
                disabled={isSubmitting || lockoutRemainingSec > 0}
                className="h-12 pl-4 pr-11 rounded-xl text-sm border-slate-300 dark:border-white/10"
              />
              <button
                type="button"
                onClick={() => setShowPassphrase(!showPassphrase)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || !passphrase.trim() || lockoutRemainingSec > 0}
              className="w-full h-11 rounded-xl bg-[#0B57D0] hover:bg-[#0B57D0]/90 text-white font-medium text-sm flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span>{t("security.lockScreen.unlockBtn", "Unlock")}</span>
              )}
            </Button>
          </form>
        )}
      </div>

      {/* Footer / Forgot Passcode recovery action */}
      <div className="w-full flex items-center justify-center max-w-sm sm:max-w-md">
        <button
          type="button"
          onClick={() => setForgotDialogOpen(true)}
          className="text-xs font-medium text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer transition-colors"
        >
          {t("security.lockScreen.forgot", "Forgot passcode?")}
        </button>
      </div>

      {/* Forgot Passcode Recovery Modal */}
      <Dialog open={forgotDialogOpen} onOpenChange={setForgotDialogOpen}>
        <DialogContent className="rounded-2xl max-w-md p-6 bg-white dark:bg-[#0E1015] border border-slate-200 dark:border-white/10 shadow-2xl">
          <DialogHeader>
            <div className="flex items-center gap-2.5 mb-1.5">
              <div className="h-9 w-9 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center shrink-0">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <DialogTitle className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                {t("security.lockScreen.forgotTitle", "Forgot Your Passcode?")}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              {t(
                "security.lockScreen.forgotDescription",
                "To protect your privacy, TeleDrive cannot recover a forgotten passcode. Resetting it will sign you out of this device and remove the lock. All your files and backups remain completely safe and untouched in your Telegram cloud."
              )}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex sm:flex-row gap-2 mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setForgotDialogOpen(false)}
              className="rounded-xl cursor-pointer"
            >
              {t("security.lockScreen.cancel", "Cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleForgotConfirm}
              className="rounded-xl cursor-pointer"
            >
              {t("security.lockScreen.resetAndLogout", "Sign Out & Reset Lock")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
