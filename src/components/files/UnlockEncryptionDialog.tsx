import React, { useState, useEffect } from "react";
import { Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEncryptionStore } from "@/lib/secure/e2ee";

export function UnlockEncryptionDialog() {
  const { t } = useTranslation("settings");
  const open = useEncryptionStore((s) => s.unlockPromptOpen);
  const rememberDefault = useEncryptionStore((s) => s.rememberKey);
  const unlockWithPassphrase = useEncryptionStore((s) => s.unlockWithPassphrase);
  const cancelUnlockPrompt = useEncryptionStore((s) => s.cancelUnlockPrompt);

  const [passphrase, setPassphrase] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(rememberDefault);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPassphrase("");
      setErrorMsg(null);
      setRemember(rememberDefault);
    }
  }, [open, rememberDefault]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim() || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const ok = await unlockWithPassphrase(passphrase, remember);
      if (!ok) {
        setErrorMsg(
          t("encryption.errors.wrongPassphrase", "Incorrect passphrase. Please try again.")
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || t("encryption.errors.unlockFailed", "Unable to unlock vault."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) cancelUnlockPrompt();
      }}
    >
      <DialogContent className="rounded-2xl sm:rounded-3xl max-w-sm sm:max-w-md p-6 bg-white dark:bg-[#0e1015] border border-slate-200/90 dark:border-white/[0.08] shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="h-9 w-9 rounded-full bg-[#C2E7FF]/60 dark:bg-[#004A77]/40 text-[#0B57D0] dark:text-[#8ab4f8] flex items-center justify-center shrink-0">
              <Lock className="h-4.5 w-4.5" />
            </div>
            <DialogTitle className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
              {t("encryption.unlockDialog.title", "Unlock Encrypted Files")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-[#444746] dark:text-[#C4C7C5]">
            {t(
              "encryption.unlockDialog.description",
              "Enter your Zero-Knowledge E2EE passphrase to decrypt this file locally on your device."
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="relative">
            <Input
              type={showPass ? "text" : "password"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={t("encryption.passphrasePlaceholder", "Enter encryption passphrase")}
              autoFocus
              className="rounded-xl h-11 pr-10 border-slate-300 dark:border-white/[0.08] bg-white dark:bg-[#060709]"
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              aria-label={showPass ? "Hide passphrase" : "Show passphrase"}
            >
              {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-[#444746] dark:text-[#C4C7C5] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="rounded border-slate-300 dark:border-white/20"
            />
            <span>{t("encryption.rememberOnDevice", "Remember key securely on this device")}</span>
          </label>

          {errorMsg && (
            <p className="text-xs font-medium text-red-600 dark:text-red-400">{errorMsg}</p>
          )}

          <DialogFooter className="gap-2 justify-end pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={cancelUnlockPrompt}
              className="rounded-full cursor-pointer"
            >
              {t("logout.cancel", "Cancel")}
            </Button>
            <Button
              type="submit"
              disabled={submitting || !passphrase.trim()}
              className="rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white cursor-pointer"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {t("encryption.unlockButton", "Unlock")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

