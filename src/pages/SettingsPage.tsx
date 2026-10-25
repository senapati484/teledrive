import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronRight, Smartphone, Eye, HardDrive, Info, Shield, Languages } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Button } from "@/components/ui/button";
import TelegramAccountSection from "@/components/settings/TelegramAccountSection";
import AppearanceSection from "@/components/settings/AppearanceSection";
import LanguageSection from "@/components/settings/LanguageSection";
import StorageSection from "@/components/settings/StorageSection";
import BackupSection from "@/components/settings/BackupSection";
import AboutSection from "@/components/settings/AboutSection";
import RecoveryDialog from "@/components/settings/RecoveryDialog";

type SectionType = "account" | "appearance" | "language" | "storage" | "backup" | "about";

export default function SettingsPage() {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Default active section is Telegram Account
  const [activeSection, setActiveSection] = useState<SectionType>("account");

  // For mobile navigation flow: nav list -> tap -> shows content screen with a back button to nav list
  const [mobileShowContent, setMobileShowContent] = useState(false);

  const sections = [
    {
      id: "account" as const,
      label: t("nav.account"),
      icon: Smartphone,
      component: TelegramAccountSection,
    },
    {
      id: "backup" as const,
      label: t("nav.backup"),
      icon: Shield,
      component: BackupSection,
    },
    {
      id: "appearance" as const,
      label: t("nav.appearance"),
      icon: Eye,
      component: AppearanceSection,
    },
    {
      id: "language" as const,
      label: t("nav.language"),
      icon: Languages,
      component: LanguageSection,
    },
    {
      id: "storage" as const,
      label: t("nav.storage"),
      icon: HardDrive,
      component: StorageSection,
    },
    {
      id: "about" as const,
      label: t("nav.about"),
      icon: Info,
      component: AboutSection,
    },
  ];

  const ActiveComponent = sections.find((s) => s.id === activeSection)?.component || TelegramAccountSection;

  const handleMobileSelect = (secId: SectionType) => {
    setActiveSection(secId);
    setMobileShowContent(true);
  };

  // Logout state
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      // Step 0: Push any queued index state while the client is still alive.
      // A failed flush keeps the queue/stuck state for a later retry.
      const { flushAllQueues } = await import("@/lib/storage/indexQueue");
      const flushResults = await flushAllQueues();
      const flushFailed = flushResults.filter((r) => r.status === "failed");
      if (flushFailed.length > 0) {
        console.error("Index flush failed on logout:", flushFailed);
      }

      // Step 1: Log out on the server first so Telegram returns a future auth
      // token, then disconnect and destroy the GramJS client singleton.
      const { logoutTelegram } = await import("@/lib/telegram/logout");
      await logoutTelegram();

      // Step 2: Clear the Rust session file — but KEEP the phone number.
      //
      // We call `clear_session_only` (not `clear_session`) so the session file
      // becomes { session: null, phone: "+91..." }.
      //
      // Why keep the phone?
      //   Channel IDs are stored in the vault under per-phone keys:
      //     "telegram_channel_id_+918653420095"
      //     "telegram_channel_id_+14155551234"
      //   On the next login, bootstrapTeleDrive(phone) looks up THAT account's
      //   channel and finds all previously uploaded files — even if a different
      //   account was used in between.
      //
      // Why NOT delete channel IDs?
      //   They are NOT credentials. Deleting them forces a dialog search on
      //   next login where GramJS returns BigInt IDs in a different format,
      //   causing metadataStore to fail to resolve the channel → empty drive.
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("clear_session_only").catch((e: any) =>
        console.warn("clear_session_only failed (non-fatal):", e)
      );

      // Step 3: Also wipe the vault's secondary session backup.
      //         Leave VAULT_KEY_PHONE and all channel ID entries intact.
      const { deleteSecret, VAULT_KEY_SESSION } = await import("@/lib/secure/vault");
      await deleteSecret(VAULT_KEY_SESSION).catch(() => {});

      // Step 4: Reset in-memory stores
      const { useAuthStore } = await import("@/stores/authStore");
      const { useFileStore } = await import("@/stores/fileStore");
      const { stopIndexRetries } = await import("@/lib/telegram/bootstrap");
      useAuthStore.getState().logout({ preserveCache: flushFailed.length > 0 });
      stopIndexRetries();
      // Reset both gates — see TelegramAccountSection.handleDisconnect.
      useFileStore.setState({
        files: [],
        selectedIds: [],
        selectedIdsSet: new Set(),
        currentFolder: "/",
        bootstrapComplete: false,
        indexLoadState: "loading",
        indexLoadError: null,
      });

      // (Backend license session removed — nothing to wipe)
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      setIsLoggingOut(false);
      navigate("/auth", { replace: true });
    }
  };


  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground select-none">
      {/* Topbar Settings Header */}
      <header className="flex items-center gap-3 px-4 md:px-6 h-[calc(3.5rem+var(--safe-area-top,2.5rem))] md:h-16 pt-[var(--safe-area-top,2.5rem)] md:pt-0 shrink-0 bg-background border-b md:border-b-0 border-slate-200/60 dark:border-white/[0.04]">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full h-10 w-10 hover:bg-[#EDF2FC] dark:hover:bg-[#1f2124] text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] cursor-pointer transition-colors"
          onClick={() => {
            if (isMobile && mobileShowContent) {
              setMobileShowContent(false);
            } else {
              navigate("/drive/my-drive");
            }
          }}
          title={t("page.backToDrive")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2.5">
          <img src="/teledrive.png" alt="TeleDrive" className="h-7 w-7 object-contain" />
          <h2 className="text-lg font-semibold tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">
            {isMobile && mobileShowContent
              ? sections.find((s) => s.id === activeSection)?.label ?? t("page.title")
              : t("page.title")}
          </h2>
        </div>
      </header>

      {/* Main settings body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Split View: Nav List */}
        {(!isMobile || !mobileShowContent) && (
          <aside className="w-full md:w-64 shrink-0 overflow-y-auto px-3 py-2 pb-[max(var(--safe-area-bottom,1.5rem),1.5rem)] md:pb-2 flex flex-col justify-between">
            <div className="space-y-1">
              {sections.map((sec) => {
                const Icon = sec.icon;
                const isSelected = activeSection === sec.id;
                return (
                  <button
                    key={sec.id}
                    onClick={() => (isMobile ? handleMobileSelect(sec.id) : setActiveSection(sec.id))}
                    className={`w-full flex items-center justify-between gap-3.5 px-4 h-12 md:h-10 rounded-2xl md:rounded-full text-sm font-medium transition-colors text-left cursor-pointer ${
                      isSelected && !isMobile
                        ? "bg-[#C2E7FF] dark:bg-[#004A77]/60 text-[#001D35] dark:text-[#C2E7FF] font-semibold"
                        : "text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F0F4F9] dark:hover:bg-white/[0.04] active:bg-[#F0F4F9] dark:active:bg-white/[0.06] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3]"
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <Icon className={`h-5 w-5 md:h-4.5 md:w-4.5 shrink-0 ${isSelected && !isMobile ? "text-[#0B57D0] dark:text-[#8ab4f8]" : "text-[#444746] dark:text-[#C4C7C5]"}`} />
                      <span className="truncate">{sec.label}</span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-[#747775]/60 dark:text-[#9aa0a6]/60 shrink-0 md:hidden" />
                  </button>
                );
              })}
            </div>

            {/* Logout button pinned to bottom of sidebar */}
            <div className="pt-4 border-t border-slate-200/60 dark:border-white/[0.04] mb-2">
              <button
                onClick={() => setLogoutDialogOpen(true)}
                className="w-full flex items-center gap-3.5 px-4 h-12 md:h-10 rounded-2xl md:rounded-full text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors text-left cursor-pointer"
              >
                <svg
                  className="h-4.5 w-4.5 shrink-0 text-rose-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                <span>{t("logout.button")}</span>
              </button>
            </div>
          </aside>
        )}

        {/* Settings Panel Content Area */}
        {(!isMobile || mobileShowContent) && (
          <div className="flex-1 overflow-hidden md:mr-4 md:mb-4 md:rounded-3xl bg-surface dark:bg-surface border-0 md:border md:border-slate-200/60 md:dark:border-white/[0.04] shadow-xs flex flex-col">
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 pb-[max(var(--safe-area-bottom,1.5rem),1.5rem)] md:pb-8">
              <div key={activeSection} className="max-w-3xl animate-fade-in">
                <ActiveComponent />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Logout Confirmation Dialog */}
      {logoutDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-xs"
            onClick={() => !isLoggingOut && setLogoutDialogOpen(false)}
          />
          {/* Dialog card */}
          <div className="relative z-10 w-full max-w-sm bg-white dark:bg-[#0d0e11] border border-slate-200 dark:border-white/[0.08] rounded-3xl shadow-2xl p-6 animate-in fade-in zoom-in-95 duration-200">
            {/* Icon */}
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 mx-auto mb-4">
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            </div>

            <h3 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3] text-center mb-1.5">
              {t("logout.title")}
            </h3>
            <p className="text-sm text-[#444746] dark:text-[#C4C7C5] text-center leading-relaxed mb-6">
              {t("logout.description")}
            </p>

            <div className="flex gap-3">
              <Button
                variant="ghost"
                className="flex-1 rounded-full h-10 text-sm font-medium border border-slate-300 dark:border-white/[0.08] text-slate-700 dark:text-slate-200 hover:bg-[#F0F4F9] dark:hover:bg-white/[0.06] cursor-pointer"
                disabled={isLoggingOut}
                onClick={() => setLogoutDialogOpen(false)}
              >
                {t("logout.cancel")}
              </Button>
              <Button
                className="flex-1 rounded-full h-10 text-sm font-medium bg-red-600 hover:bg-red-700 dark:bg-red-600/90 dark:hover:bg-red-600 text-white border-0 shadow-sm cursor-pointer disabled:opacity-40"
                disabled={isLoggingOut}
                onClick={handleLogout}
              >
                {isLoggingOut ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    {t("logout.loggingOut")}
                  </span>
                ) : (
                  t("logout.confirm")
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
      <RecoveryDialog />
    </div>
  );
}
