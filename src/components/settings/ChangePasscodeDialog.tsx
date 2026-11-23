import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppLockStore } from "@/stores/appLockStore";
import { toast } from "sonner";

interface ChangePasscodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  format?: "pin" | "alphanumeric";
}

export function ChangePasscodeDialog({
  open,
  onOpenChange,
  format = "pin",
}: ChangePasscodeDialogProps) {
  const { t } = useTranslation("settings");

  const isConfigured = useAppLockStore((s) => s.isConfigured);
  const storedConfig = useAppLockStore((s) => s.storedConfig);
  const setCustomPasscode = useAppLockStore((s) => s.setCustomPasscode);

  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const hasExistingCustom =
    isConfigured && storedConfig?.mode === "custom_passcode";

  const handleClose = () => {
    setCurrentPass("");
    setNewPass("");
    setConfirmPass("");
    setErrorMsg(null);
    setIsSubmitting(false);
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (hasExistingCustom) {
      const { verifyPasscode } = await import("@/lib/secure/appLock");
      const ok = await verifyPasscode(currentPass, storedConfig);
      if (!ok) {
        setErrorMsg(t("security.errors.wrongCurrentPass", "Current passcode is incorrect."));
        return;
      }
    }

    if (format === "pin") {
      if (!/^\d{4,6}$/.test(newPass)) {
        setErrorMsg(t("security.errors.pinFormat", "PIN must be between 4 and 6 digits."));
        return;
      }
    } else {
      if (newPass.length < 6) {
        setErrorMsg(
          t("security.errors.passphraseLength", "Passphrase must be at least 6 characters.")
        );
        return;
      }
    }

    if (newPass !== confirmPass) {
      setErrorMsg(t("security.errors.mismatch", "Passcodes do not match."));
      return;
    }

    setIsSubmitting(true);
    try {
      const ok = await setCustomPasscode(newPass, format);
      if (ok) {
        toast.success(t("security.toasts.passcodeSaved", "App lock passcode updated successfully!"));
        handleClose();
      } else {
        setErrorMsg(t("security.errors.saveFailed", "Failed to save new passcode."));
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save passcode.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="rounded-2xl max-w-sm sm:max-w-md p-6 bg-white dark:bg-[#0E1015] border border-slate-200 dark:border-white/10 shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="h-9 w-9 rounded-full bg-[#E8F0FE] dark:bg-[#0B57D0]/20 text-[#0B57D0] dark:text-[#8ab4f8] flex items-center justify-center shrink-0">
              <KeyRound className="h-5 w-5" />
            </div>
            <DialogTitle className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
              {hasExistingCustom
                ? t("security.dialog.changeTitle", "Change Passcode")
                : t("security.dialog.setTitle", "Set App Lock Passcode")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            {format === "pin"
              ? t("security.dialog.pinHint", "Enter a 4-to-6 digit numeric PIN.")
              : t("security.dialog.passphraseHint", "Enter a master passphrase.")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 my-2">
          {hasExistingCustom && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {t("security.dialog.currentPass", "Current Passcode")}
              </label>
              <Input
                type="password"
                inputMode={format === "pin" ? "numeric" : "text"}
                value={currentPass}
                onChange={(e) => setCurrentPass(e.target.value)}
                placeholder="••••"
                required
                className="h-11 rounded-xl text-sm"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {t("security.dialog.newPass", "New Passcode")}
            </label>
            <Input
              type="password"
              inputMode={format === "pin" ? "numeric" : "text"}
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder="••••"
              required
              className="h-11 rounded-xl text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {t("security.dialog.confirmPass", "Confirm New Passcode")}
            </label>
            <Input
              type="password"
              inputMode={format === "pin" ? "numeric" : "text"}
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              placeholder="••••"
              required
              className="h-11 rounded-xl text-sm"
            />
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/40 text-xs text-rose-600 dark:text-rose-300">
              {errorMsg}
            </div>
          )}

          <DialogFooter className="flex sm:flex-row gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              className="rounded-xl cursor-pointer"
            >
              {t("security.dialog.cancel", "Cancel")}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !newPass || !confirmPass}
              className="rounded-xl bg-[#0B57D0] hover:bg-[#0B57D0]/90 text-white cursor-pointer"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span>{t("security.dialog.save", "Save Passcode")}</span>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
