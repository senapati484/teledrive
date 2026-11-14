import { lazy, Suspense, useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/authStore";
import { useFileStore } from "./stores/fileStore";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { restoreSession } from "./lib/telegram/restoreSession";
import { bootstrapTeleDrive } from "./lib/telegram/bootstrap";
import { Toaster } from "@/components/ui/sonner";
import { invoke } from "@tauri-apps/api/core";
import { logVaultState } from "./lib/runtime/bridge";
import DriveBrowserPage from "./pages/DriveBrowserPage";
import RecentPage from "./pages/RecentPage";
import StarredPage from "./pages/StarredPage";
import TrashPage from "./pages/TrashPage";
import ArchivedPage from "./pages/ArchivedPage";
import SearchPage from "./pages/SearchPage";
import BackupsPage from "./pages/BackupsPage";
import BackupsFolderPage from "./pages/BackupsFolderPage";

// Lazy pages
const DriveLayout = lazy(() => import("./components/layout/DriveLayout"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const RemoteSyncOrchestrator = lazy(() => import("./components/RemoteSyncOrchestrator"));
const StarPromptDialog = lazy(() => import("./components/support/StarPromptDialog"));
const WhatsNewDialog = lazy(() => import("./components/support/WhatsNewDialog"));
import { useSupportStore } from "./stores/supportStore";
import { useEncryptionStore } from "./lib/secure/e2ee";
import { UnlockEncryptionDialog } from "./components/files/UnlockEncryptionDialog";
import {
  hasCachedFilesHint,
  loadCachedFilesSnapshot,
} from "./lib/storage/localIndexCache";

// Full-screen spinner fallback
function LoadingFallback() {
  return (
    <div className="flex h-[100dvh] min-h-[100dvh] w-screen items-center justify-center bg-background select-none">
      <Loader2 className="h-8 w-8 animate-spin text-[#0B57D0] dark:text-[#A8C7FA]" />
    </div>
  );
}

// Splash Screen Loader
function SplashLoader({
  status,
  progress,
}: {
  status: string;
  progress?: number;
}) {
  const { t } = useTranslation("drive");
  const hasDeterminate = typeof progress === "number" && progress > 0;

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] w-screen flex-col items-center justify-center bg-background text-foreground gap-4 select-none">
      <div className="flex flex-col items-center gap-4">
        <img
          src="/teledrive.png"
          alt={t("logoAlt")}
          className="h-16 w-16 object-contain shrink-0 drop-shadow-sm"
        />
        <div className="flex items-center gap-2.5 text-[#444746] dark:text-[#C4C7C5] font-medium bg-surface dark:bg-[#111214] border border-slate-200/80 dark:border-white/[0.04] px-5 py-2 rounded-full shadow-xs">
          <Loader2 className="h-4 w-4 animate-spin text-[#0B57D0] dark:text-[#A8C7FA]" />
          <span className="text-xs">{status}</span>
        </div>

        {/* Google style linear progress bar */}
        <div className="w-56 sm:w-64 h-1.5 rounded-full bg-slate-200/80 dark:bg-white/10 overflow-hidden relative shadow-inner">
          {hasDeterminate ? (
            <div
              className="h-full rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] transition-all duration-300 ease-out"
              style={{ width: `${Math.min(100, Math.max(progress, 8))}%` }}
            />
          ) : (
            <div className="h-full w-2/5 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] animate-indeterminate" />
          )}
        </div>
        {hasDeterminate && (
          <span className="text-[10px] font-mono font-medium text-slate-500 dark:text-slate-400">
            {Math.round(progress)}%
          </span>
        )}
      </div>
    </div>
  );
}

// Protected Route Guard
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/auth" replace />;
}

// Guest/Auth Route Guard
function GuestRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return !isAuthenticated ? <>{children}</> : <Navigate to="/drive/my-drive" replace />;
}

import { useTheme } from "./hooks/useTheme";

function App() {
  useTheme(); // Initialize theme logic
  const [isRestoring, setIsRestoring] = useState(true);
  const [splashProgress, setSplashProgress] = useState(20);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { t } = useTranslation("drive");
  const [status, setStatus] = useState(() => t("splash.connecting"));

  useEffect(() => {
    useSupportStore.getState().initFirstLaunch();
    void useEncryptionStore.getState().initFromVault();
    let active = true;
    async function initSession() {
      try {
        setSplashProgress(25);
        // Fast local check first:
        const stored = await invoke<{ session: string | null; phone: string | null }>(
          "load_session"
        );
        const sessionString = stored?.session ?? null;
        const phoneNumber   = stored?.phone   ?? "";

        if (sessionString && active) {
          // Pre-authenticate the user immediately so route guards resolve and layouts mount
          useAuthStore.getState().setSession(sessionString, phoneNumber);
          setSplashProgress(45);
          setStatus(t("splash.restoringSession", "Restoring session..."));

          const hasCacheHint = hasCachedFilesHint();

          // Hydrate large-drive IndexedDB snapshot before revealing DriveLayout
          // (~2-5ms local read) so there is zero empty-folder flash on restart.
          if (hasCacheHint && useFileStore.getState().files.length === 0) {
            const cachedSnapshot = await loadCachedFilesSnapshot().catch(() => []);
            if (active && cachedSnapshot.length > 0) {
              setSplashProgress(65);
              useFileStore.getState().hydrateCachedFiles(cachedSnapshot);
            }
          }

          const hasHydratedFiles = useFileStore.getState().files.length > 0;
          if (hasHydratedFiles || hasCacheHint) {
            setSplashProgress(100);
            setIsRestoring(false);
          }

          // Trigger Telegram connection and remote sync without keeping the
          // splash screen blocked on full multi-chunk index downloads.
          (async () => {
            useFileStore.getState().setSyncing(true);
            try {
              if (active) {
                setSplashProgress(80);
                setStatus(t("splash.connecting", "Connecting to Telegram..."));
              }
              const restored = await restoreSession();
              if (active && restored) {
                // Auth confirmed — show DriveLayout skeleton immediately while
                // bootstrapTeleDrive fetches and decodes the remote index.
                setSplashProgress(100);
                setIsRestoring(false);
                await bootstrapTeleDrive(undefined, phoneNumber);
              }
            } catch (err) {
              console.error("Background session restoration/bootstrap failed:", err);
            } finally {
              if (active) {
                useFileStore.getState().setSyncing(false);
                setSplashProgress(100);
                setIsRestoring(false);
              }
            }
          })();
        } else {
          // No stored session, go to login page (bypass splash loader)
          if (active) {
            setSplashProgress(100);
            setIsRestoring(false);
          }
        }
      } catch (err: any) {
        console.error("Failed to restore session on app launch:", err);
        await logVaultState(
          `BOOTSTRAP_ERR: ${err?.message || JSON.stringify(err)}\nStack: ${err?.stack || "no_stack"}`
        );
        if (active) {
          setSplashProgress(100);
          setIsRestoring(false);
        }
      }
    }
    initSession();
    return () => {
      active = false;
    };
  }, []);

  if (isRestoring) {
    return <SplashLoader status={status} progress={splashProgress} />;
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          {/* Redirect root to /drive */}
          <Route path="/" element={<Navigate to="/drive/my-drive" replace />} />

          {/* Guest routes (Auth) */}
          <Route
            path="/auth"
            element={
              <GuestRoute>
                <AuthPage />
              </GuestRoute>
            }
          />

          {/* Protected routes */}
          <Route
            path="/drive"
            element={
              <ProtectedRoute>
                <DriveLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="my-drive" replace />} />
            <Route path="my-drive" element={<DriveBrowserPage root />} />
            <Route path="recent" element={<RecentPage />} />
            <Route path="starred" element={<StarredPage />} />
            <Route path="trash" element={<TrashPage />} />
            <Route path="archived" element={<ArchivedPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="folder/*" element={<DriveBrowserPage />} />
            {/* Device-backup entry points — available to all users. */}
            <Route path="backups" element={<BackupsPage />} />
            <Route path="backups/folder/*" element={<BackupsFolderPage />} />
          </Route>

          {/* Settings protected route */}
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />

          {/* Catch-all */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
      {/* Live multi-device sync coordinator. Headless component
          that runs only while authenticated + bootstrapped. */}
      <Suspense fallback={null}>
        <RemoteSyncOrchestrator />
      </Suspense>
      {/* Support & update dialogs */}
      {isAuthenticated && (
        <Suspense fallback={null}>
          <StarPromptDialog />
          <WhatsNewDialog />
        </Suspense>
      )}
      <UnlockEncryptionDialog />
      <Toaster />
    </BrowserRouter>
  );
}

export default App;
