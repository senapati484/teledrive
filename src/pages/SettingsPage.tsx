import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Smartphone, Eye, HardDrive, Info, Shield } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Button } from "@/components/ui/button";
import TelegramAccountSection from "@/components/settings/TelegramAccountSection";
import AppearanceSection from "@/components/settings/AppearanceSection";
import StorageSection from "@/components/settings/StorageSection";
import BackupSection from "@/components/settings/BackupSection";
import AboutSection from "@/components/settings/AboutSection";

type SectionType = "account" | "appearance" | "storage" | "backup" | "about";

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
      // Step 1: Disconnect and destroy the GramJS client singleton first.
      // Without this, initClient() reuses the stale session → AUTH_RESTART.
      const { disconnectClient } = await import("@/lib/telegram/client");
      await disconnectClient();

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
      useAuthStore.getState().logout();
      // Reset bootstrapComplete too — see TelegramAccountSection.handleDisconnect
      // for the same fix; without it, the next login's bootstrap gate is
      // already true and uploads could race the orphan scan.
      useFileStore.setState({
        files: [],
        selectedIds: [],
        selectedIdsSet: new Set(),
        currentFolder: "/",
        bootstrapComplete: false,
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
      <header className="flex items-center gap-3 px-4 md:px-6 h-16 shrink-0 bg-background border-b md:border-b-0 border-slate-200/60 dark:border-slate-800/60">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full h-10 w-10 hover:bg-[#EDF2FC] dark:hover:bg-[#282A2C] text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] cursor-pointer transition-colors"
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
          <h2 className="text-lg font-semibold tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">{t("page.title")}</h2>
        </div>
      </header>

      {/* Main settings body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Split View: Nav List */}
        {(!isMobile || !mobileShowContent) && (
          <aside className="w-full md:w-64 shrink-0 overflow-y-auto px-3 py-2 flex flex-col justify-between">
            <div className="space-y-1">
              {sections.map((sec) => {
                const Icon = sec.icon;
                const isSelected = activeSection === sec.id;
                return (
                  <button
                    key={sec.id}
                    onClick={() => (isMobile ? handleMobileSelect(sec.id) : setActiveSection(sec.id))}
                    className={`w-full flex items-center gap-3.5 px-4 h-10 rounded-full text-sm font-medium transition-colors text-left cursor-pointer ${
                      isSelected && !isMobile
                        ? "bg-[#C2E7FF] dark:bg-[#004A77] text-[#001D35] dark:text-[#C2E7FF] font-semibold"
                        : "text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3]"
                    }`}
                  >
                    <Icon className={`h-4.5 w-4.5 shrink-0 ${isSelected && !isMobile ? "text-[#0B57D0] dark:text-[#A8C7FA]" : "text-[#444746] dark:text-[#C4C7C5]"}`} />
                    <span>{sec.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Logout button pinned to bottom of sidebar */}
            <div className="pt-4 border-t border-slate-200/60 dark:border-slate-800/60 mb-2">
              <button
                onClick={() => setLogoutDialogOpen(true)}
                className="w-full flex items-center gap-3.5 px-4 h-10 rounded-full text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors text-left cursor-pointer"
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
          <div className="flex-1 overflow-hidden md:mr-4 md:mb-4 md:rounded-3xl bg-surface dark:bg-[#1E1F20] border md:border-slate-200/60 dark:border-slate-800/60 shadow-xs flex flex-col">
            <div className="flex-1 overflow-y-auto p-6 md:p-8">
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
            className="absolute inset-0 bg-black/40 backdrop-blur-xs"
            onClick={() => !isLoggingOut && setLogoutDialogOpen(false)}
          />
          {/* Dialog card */}
          <div className="relative z-10 w-full max-w-sm bg-surface dark:bg-[#282A2C] border border-slate-200 dark:border-slate-700 rounded-3xl shadow-2xl p-6 animate-in fade-in zoom-in-95 duration-200">
            {/* Icon */}
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 mx-auto mb-4">
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
                variant="outline"
                className="flex-1 rounded-full h-10 text-sm font-medium border-slate-300 dark:border-slate-600 hover:bg-[#F0F4F9] dark:hover:bg-[#333537]"
                disabled={isLoggingOut}
                onClick={() => setLogoutDialogOpen(false)}
              >
                {t("logout.cancel")}
              </Button>
              <Button
                className="flex-1 rounded-full h-10 text-sm font-medium bg-rose-600 hover:bg-rose-700 text-white border-0 shadow-sm"
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
    </div>
  );
}
