import React, { useEffect, useState } from "react";
import { Lock, LockOpen, ShieldCheck, AlertTriangle, Eye, EyeOff, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEncryptionStore } from "@/lib/secure/e2ee";

export default function EncryptionSection() {
  const { t } = useTranslation("settings");
  const {
    initialized,
    configured,
    unlocked,
    encryptNewUploads,
    rememberKey,
    initFromVault,
    setupPassphrase,
    unlockWithPassphrase,
    lock,
    setEncryptNewUploads,
    setRememberKey,
    disableEncryption,
  } = useEncryptionStore();

  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [rememberChoice, setRememberChoice] = useState(true);
  const [encryptChoice, setEncryptChoice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);

  useEffect(() => {
    if (!initialized) {
      void initFromVault();
    }
  }, [initialized, initFromVault]);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passphrase.length < 6) {
      toast.error(
        t("encryption.errors.tooShort", "Passphrase must be at least 6 characters long.")
      );
      return;
    }
    if (passphrase !== confirmPassphrase) {
      toast.error(t("encryption.errors.mismatch", "Passphrases do not match."));
      return;
    }
    setBusy(true);
    try {
      await setupPassphrase(passphrase, {
        encryptNewUploads: encryptChoice,
        rememberKey: rememberChoice,
      });
      setPassphrase("");
      setConfirmPassphrase("");
      toast.success(
        t("encryption.toasts.enabled", "Zero-Knowledge Encryption enabled for uploads.")
      );
    } catch (err: any) {
      toast.error(err?.message || t("encryption.errors.setupFailed", "Failed to set up encryption."));
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim()) return;
    setBusy(true);
    try {
      const ok = await unlockWithPassphrase(passphrase, rememberChoice);
      if (!ok) {
        toast.error(
          t("encryption.errors.wrongPassphrase", "Incorrect passphrase. Please try again.")
        );
        return;
      }
      setPassphrase("");
      toast.success(t("encryption.toasts.unlocked", "Encryption vault unlocked."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 select-none">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">
          {t("encryption.title", "Zero-Knowledge Encryption (E2EE)")}
        </h2>
        <p className="text-sm text-[#444746] dark:text-[#C4C7C5]">
          {t(
            "encryption.description",
            "Encrypt files locally using AES-256-GCM before any bytes leave your device. Files appear unreadable inside Telegram."
          )}
        </p>
      </div>

      <div className="p-6 border border-slate-200/90 dark:border-white/[0.06] rounded-2xl bg-white dark:bg-[#0c0d0f] shadow-xs space-y-5 animate-fade-in">
        {!configured ? (
          <form onSubmit={handleSetup} className="space-y-4">
            <div className="flex items-start gap-3.5">
              <div className="h-10 w-10 rounded-full bg-[#C2E7FF]/60 dark:bg-[#004A77]/40 text-[#0B57D0] dark:text-[#8ab4f8] flex items-center justify-center shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {t("encryption.setupTitle", "Set Your Encryption Passphrase")}
                </h3>
                <p className="text-xs text-[#747775] dark:text-[#8E918F]">
                  {t(
                    "encryption.setupHint",
                    "TeleDrive never sends or stores your passphrase remotely. Keep a backup — lost passphrases cannot be recovered."
                  )}
                </p>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <div className="relative">
                <Input
                  type={showPass ? "text" : "password"}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder={t("encryption.newPassphrasePlaceholder", "Create passphrase (min. 6 characters)")}
                  className="rounded-xl h-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Input
                type={showPass ? "text" : "password"}
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                placeholder={t("encryption.confirmPassphrasePlaceholder", "Confirm passphrase")}
                className="rounded-xl h-10"
              />

              <label className="flex items-center gap-2 text-xs text-[#444746] dark:text-[#C4C7C5] cursor-pointer">
                <input
                  type="checkbox"
                  checked={encryptChoice}
                  onChange={(e) => setEncryptChoice(e.target.checked)}
                />
                <span>{t("encryption.encryptNewByDefault", "Encrypt all newly uploaded files automatically")}</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-[#444746] dark:text-[#C4C7C5] cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberChoice}
                  onChange={(e) => setRememberChoice(e.target.checked)}
                />
                <span>{t("encryption.rememberOnDevice", "Remember key securely on this device")}</span>
              </label>
            </div>

            <Button
              type="submit"
              disabled={busy || !passphrase}
              className="rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white cursor-pointer"
            >
              <KeyRound className="h-4 w-4 mr-2" />
              {t("encryption.enableButton", "Enable Encryption")}
            </Button>
          </form>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div
                  className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
                    unlocked
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {unlocked ? <LockOpen className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                    {unlocked
                      ? t("encryption.statusUnlocked", "Encryption Vault Unlocked")
                      : t("encryption.statusLocked", "Encryption Vault Locked")}
                  </h3>
                  <p className="text-xs text-[#747775] dark:text-[#8E918F]">
                    {unlocked
                      ? t("encryption.unlockedSubtitle", "Encrypted files decrypt transparently on preview and download.")
                      : t("encryption.lockedSubtitle", "Enter your passphrase to unlock or upload encrypted files.")}
                  </p>
                </div>
              </div>

              {unlocked && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    await lock();
                    toast.info(t("encryption.toasts.locked", "Encryption vault locked."));
                  }}
                  className="rounded-full cursor-pointer"
                >
                  <Lock className="h-3.5 w-3.5 mr-1.5" />
                  {t("encryption.lockButton", "Lock Vault")}
                </Button>
              )}
            </div>

            {!unlocked && (
              <form onSubmit={handleUnlock} className="flex flex-col sm:flex-row gap-2.5 pt-1">
                <Input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder={t("encryption.passphrasePlaceholder", "Enter encryption passphrase")}
                  className="rounded-xl h-10 flex-1"
                />
                <Button
                  type="submit"
                  disabled={busy || !passphrase.trim()}
                  className="rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white cursor-pointer"
                >
                  {t("encryption.unlockButton", "Unlock")}
                </Button>
              </form>
            )}

            <div className="space-y-3 border-t border-slate-200/70 dark:border-white/[0.06] pt-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                    {t("encryption.encryptNewTitle", "Encrypt new uploads")}
                  </p>
                  <p className="text-[11px] text-[#747775] dark:text-[#8E918F]">
                    {t("encryption.encryptNewHelp", "New files upload inside an AES-256-GCM envelope with anonymized channel names.")}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={encryptNewUploads ? "default" : "outline"}
                  onClick={() => void setEncryptNewUploads(!encryptNewUploads)}
                  className="rounded-full cursor-pointer shrink-0"
                >
                  {encryptNewUploads
                    ? t("encryption.on", "Enabled")
                    : t("encryption.off", "Disabled")}
                </Button>
              </div>

              {unlocked && (
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                      {t("encryption.rememberTitle", "Remember key on this device")}
                    </p>
                    <p className="text-[11px] text-[#747775] dark:text-[#8E918F]">
                      {t("encryption.rememberHelp", "Auto-unlocks your vault when opening TeleDrive on this device.")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={rememberKey ? "default" : "outline"}
                    onClick={() => void setRememberKey(!rememberKey)}
                    className="rounded-full cursor-pointer shrink-0"
                  >
                    {rememberKey
                      ? t("encryption.on", "Enabled")
                      : t("encryption.off", "Disabled")}
                  </Button>
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDisableConfirmOpen(true)}
                  className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-full cursor-pointer"
                >
                  {t("encryption.disableButton", "Disable Encryption Setup")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={disableConfirmOpen} onOpenChange={setDisableConfirmOpen}>
        <DialogContent className="rounded-2xl max-w-md bg-white dark:bg-[#0e1015] border border-slate-200/90 dark:border-white/[0.08]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
              <AlertTriangle className="h-4.5 w-4.5 text-amber-500" />
              {t("encryption.disableDialog.title", "Disable Local Encryption Vault?")}
            </DialogTitle>
            <DialogDescription className="text-xs text-[#444746] dark:text-[#C4C7C5]">
              {t(
                "encryption.disableDialog.description",
                "Existing encrypted files in Telegram remain encrypted and will ask for your original passphrase whenever opened."
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDisableConfirmOpen(false)}
              className="rounded-full cursor-pointer"
            >
              {t("logout.cancel", "Cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={async () => {
                setDisableConfirmOpen(false);
                await disableEncryption();
                toast.info(t("encryption.toasts.disabled", "Local encryption setup cleared."));
              }}
              className="rounded-full cursor-pointer"
            >
              {t("encryption.disableConfirm", "Disable")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

