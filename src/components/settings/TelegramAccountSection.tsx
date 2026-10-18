import { useState, useEffect } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Smartphone,
  Database,
  RefreshCw,
  Copy,
  Check,
  Info,
  ShieldCheck,
  Cloud,
  LogOut,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import {
  deleteSecret,
  getSecret,
  VAULT_KEY_SESSION,
  VAULT_KEY_CHANNEL_ID,
  channelIdKey,
} from "@/lib/secure/vault";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";

export default function TelegramAccountSection() {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const phoneNumber = useAuthStore((state) => state.phoneNumber);
  const logout = useAuthStore((state) => state.logout);

  const [channelId, setChannelId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const handleCopyChannelId = () => {
    if (!channelId) return;
    navigator.clipboard.writeText(channelId);
    setCopiedId(true);
    toast.success(t("account.toasts.channelIdCopied"));
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleSyncNow = async () => {
    if (!channelId || isSyncing) return;
    setIsSyncing(true);
    try {
      const { runSyncTickOnce } = await import("@/lib/sync/remoteSync");
      const changed = await runSyncTickOnce(channelId);
      if (changed) {
        toast.success(t("account.toasts.syncSuccess"));
      } else {
        toast.info(t("account.toasts.alreadyUpToDate"));
      }
    } catch (err: any) {
      toast.error(err?.message || t("account.toasts.syncFailed"));
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    async function loadChannel() {
      if (!phoneNumber) return;
      const phoneKey = channelIdKey(phoneNumber);
      let savedChannel = await getSecret(phoneKey);
      if (!savedChannel) {
        savedChannel = await getSecret(VAULT_KEY_CHANNEL_ID);
      }
      if (savedChannel) {
        setChannelId(savedChannel);
      }
    }
    if (isAuthenticated && phoneNumber) {
      loadChannel();
    }
  }, [isAuthenticated, phoneNumber]);

  const handleDisconnect = async () => {
    try {
      const { disconnectClient } = await import("@/lib/telegram/client");
      await disconnectClient();

      await invoke("clear_session_only").catch((e: any) =>
        console.warn("clear_session_only failed:", e)
      );

      await deleteSecret(VAULT_KEY_SESSION).catch(() => {});

      logout();
      const { useFileStore } = await import("@/stores/fileStore");
      useFileStore.setState({
        files: [],
        selectedIds: [],
        selectedIdsSet: new Set(),
        currentFolder: "/",
        bootstrapComplete: false,
      });

      toast.success(t("account.toasts.disconnected"));
      navigate("/auth");
    } catch (err) {
      console.error("Failed to disconnect:", err);
      toast.error(t("account.toasts.disconnectFailed"));
    }
  };

  return (
    <div className="space-y-6 select-none">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">
          {t("account.title")}
        </h2>
        <p className="text-sm text-[#444746] dark:text-[#C4C7C5]">
          {t("account.description")}
        </p>
      </div>

      {!isAuthenticated ? (
        <div className="p-8 border border-slate-200/90 dark:border-slate-800 rounded-2xl bg-white dark:bg-[#1E1F20] text-center shadow-xs">
          <div className="h-12 w-12 rounded-full bg-[#EDF2FC] dark:bg-[#282A2C] flex items-center justify-center text-[#0B57D0] dark:text-[#A8C7FA] mx-auto mb-3">
            <Smartphone className="h-6 w-6 stroke-[1.75]" />
          </div>
          <h4 className="font-semibold text-[#1F1F1F] dark:text-[#E3E3E3] text-sm">
            {t("account.notConnected.title")}
          </h4>
          <p className="text-xs text-[#444746] dark:text-[#C4C7C5] max-w-sm mx-auto mt-1 mb-5 leading-relaxed">
            {t("account.notConnected.description")}
          </p>
          <Button
            className="rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white dark:bg-[#A8C7FA] dark:hover:bg-[#D3E3FD] dark:text-[#062E6F] font-medium px-6 h-10 text-xs shadow-xs cursor-pointer"
            onClick={() => navigate("/auth")}
          >
            {t("account.notConnected.connect")}
          </Button>
        </div>
      ) : (
        <div className="space-y-4 animate-fade-in">
          {/* Card 1: User Profile & Session */}
          <div className="p-5 border border-slate-200/90 dark:border-slate-800 rounded-2xl bg-white dark:bg-[#1E1F20] shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="h-11 w-11 rounded-full bg-[#C2E7FF]/60 dark:bg-[#004A77]/50 border border-[#0B57D0]/20 flex items-center justify-center text-[#0B57D0] dark:text-[#A8C7FA] shrink-0">
                <Smartphone className="h-5 w-5" />
              </div>
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[#1F1F1F] dark:text-[#E3E3E3] text-sm tracking-tight">
                    {phoneNumber}
                  </span>
                  <span className="inline-flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-medium text-[11px] px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                    <ShieldCheck className="h-3 w-3" />
                    {t("account.activeSession")}
                  </span>
                </div>
                <p className="text-xs text-[#444746] dark:text-[#C4C7C5]">
                  {t("account.connectedVia")}
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="rounded-full text-xs font-medium border-slate-200 dark:border-slate-700 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 shrink-0 w-full sm:w-auto cursor-pointer h-9 px-4 gap-1.5"
              onClick={handleDisconnect}
            >
              <LogOut className="h-3.5 w-3.5" />
              {t("account.disconnect")}
            </Button>
          </div>

          {/* Card 2: Active Storage Channel */}
          <div className="p-5 border border-slate-200/90 dark:border-slate-800 rounded-2xl bg-white dark:bg-[#1E1F20] shadow-xs space-y-4">
            <div className="flex items-start gap-3.5">
              <div className="h-11 w-11 rounded-full bg-[#C2E7FF]/60 dark:bg-[#004A77]/50 border border-[#0B57D0]/20 flex items-center justify-center text-[#0B57D0] dark:text-[#A8C7FA] shrink-0 mt-0.5">
                <Database className="h-5 w-5" />
              </div>
              <div className="space-y-2 flex-1 min-w-0">
                <div>
                  <h4 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                    {t("account.channel.title")}
                  </h4>
                  <p className="text-xs text-[#444746] dark:text-[#C4C7C5] leading-relaxed mt-0.5">
                    {t("account.channel.description")}
                  </p>
                </div>

                {/* Structured Channel Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <div className="p-3 rounded-xl bg-[#F0F4F9] dark:bg-[#282A2C] border border-slate-200/60 dark:border-slate-700/60 space-y-1">
                    <span className="text-[11px] font-medium text-[#747775] dark:text-[#8E918F] block">
                      {t("account.channel.name")}
                    </span>
                    <div className="flex items-center gap-1.5 font-medium text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">
                      <Cloud className="h-3.5 w-3.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
                      <span>TeleDrive Storage</span>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[#F0F4F9] dark:bg-[#282A2C] border border-slate-200/60 dark:border-slate-700/60 space-y-1">
                    <span className="text-[11px] font-medium text-[#747775] dark:text-[#8E918F] block">
                      {t("account.channel.id")}
                    </span>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3] truncate">
                        {channelId || t("account.channel.loading")}
                      </span>
                      {channelId && (
                        <button
                          type="button"
                          onClick={handleCopyChannelId}
                          className="h-6 w-6 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] transition-colors cursor-pointer"
                          title={t("account.channel.copyId")}
                        >
                          {copiedId ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2.5 pt-1 border-t border-slate-100 dark:border-slate-800">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full text-xs font-medium border-slate-300 dark:border-slate-700 hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] cursor-pointer flex items-center gap-1.5 h-9 px-4"
                disabled={isSyncing}
                onClick={handleSyncNow}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />
                {isSyncing ? t("account.syncing") : t("account.syncNow")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full text-xs font-medium border-slate-300 dark:border-slate-700 hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] cursor-pointer h-9 px-4"
                onClick={() => setIsDialogOpen(true)}
              >
                {t("account.switchChannel")}
              </Button>
            </div>
          </div>

          {/* Architecture Callout */}
          <div className="p-4 rounded-2xl bg-[#F0F4F9] dark:bg-[#282A2C] border border-slate-200/60 dark:border-slate-700/60 flex items-start gap-3 text-xs text-[#444746] dark:text-[#C4C7C5] leading-relaxed">
            <Info className="h-4.5 w-4.5 text-[#0B57D0] dark:text-[#A8C7FA] shrink-0 mt-0.5" />
            <div>
              <Trans
                t={t}
                i18nKey="account.architecture"
                components={{ strong: <strong className="text-[#1F1F1F] dark:text-[#E3E3E3]" /> }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Change storage channel dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="rounded-3xl max-w-md bg-white dark:bg-[#282A2C] border border-slate-200 dark:border-slate-700 p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
              {t("account.switchDialog.title")}
            </DialogTitle>
            <DialogDescription className="text-xs text-[#444746] dark:text-[#C4C7C5]">
              {t("account.switchDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-xs text-amber-800 dark:text-amber-300 leading-relaxed font-medium">
            ⚠️ <Trans t={t} i18nKey="account.switchDialog.warning" components={{ strong: <strong /> }} />
          </div>
          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button
              variant="outline"
              className="rounded-full text-xs font-medium border-slate-300 dark:border-slate-600 hover:bg-[#F0F4F9] dark:hover:bg-[#333537]"
              onClick={() => setIsDialogOpen(false)}
            >
              {t("account.switchDialog.cancel")}
            </Button>
            <Button
              className="rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white dark:bg-[#A8C7FA] dark:hover:bg-[#D3E3FD] dark:text-[#062E6F] font-medium text-xs ml-2 cursor-pointer"
              onClick={async () => {
                setIsDialogOpen(false);
                try {
                  if (phoneNumber) {
                    await deleteSecret(channelIdKey(phoneNumber)).catch(() => {});
                  }
                  await deleteSecret(VAULT_KEY_CHANNEL_ID).catch(() => {});
                  setChannelId(null);
                  toast.success(t("account.toasts.channelReset"));
                } catch (err) {
                  console.error("Failed to reset storage channel:", err);
                  toast.error(t("account.toasts.channelResetFailed"));
                }
              }}
            >
              {t("account.switchDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
