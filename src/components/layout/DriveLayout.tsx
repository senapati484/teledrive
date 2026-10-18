import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  HardDrive,
  Clock,
  Star,
  Trash2,
  Settings,
  Menu,
  Loader2,
  Archive,
  AlertTriangle,
  RefreshCw,
  Cloud,
  Shield,
  Upload,
  Sun,
  Moon,
} from "lucide-react";
import { DriveSidebar } from "./DriveSidebar";
import { NewActionButton } from "./NewActionButton";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { useFileStore } from "@/stores/fileStore";
import { useFileActions } from "@/hooks/useFileActions";
import { useIsMobile } from "@/hooks/useIsMobile";
import SearchBar from "./SearchBar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

import { cn } from "@/lib/utils";
import { bootstrapTeleDrive } from "@/lib/telegram/bootstrap";
import { isBackupItem } from "@/lib/backup/visibility";
import { triggerFilePicker, triggerFolderPicker } from "@/lib/upload/fileSelector";
import { addFilesToUploadQueue } from "@/lib/upload/uploadManager";
import { UploadProgressPanel } from "@/components/upload/UploadProgressPanel";
import { BackupProgressOverlay } from "@/components/backup/BackupProgressOverlay";
import { downloadFileFromTelegram } from "@/lib/telegram/downloader";
import { FilePreviewModal } from "@/components/preview/FilePreviewModal";
import { TeleFile } from "@/lib/types";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useIsPro } from "@/hooks/useIsPro";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getModKey } from "@/lib/os";

const DND_PAYLOAD_MIME = "application/x-teledrive-item-ids";

const IndexQueuePill = React.memo(function IndexQueuePill() {
  const isSyncing = useFileStore((state) => state.isSyncing);
  const indexQueueState = useFileStore((state) => state.indexQueueState);
  const indexQueueRetryInSec = useFileStore((state) => state.indexQueueRetryInSec);
  const indexQueueError = useFileStore((state) => state.indexQueueError);
  const { t } = useTranslation("drive");

  if (
    indexQueueState !== "failed" &&
    indexQueueState !== "retrying" &&
    (!isSyncing || indexQueueState !== "saving") &&
    indexQueueState !== "syncing-remote" &&
    indexQueueState !== "backup-running"
  ) {
    return null;
  }

  return (
    <div
      title={
        indexQueueState === "failed"
          ? indexQueueError ?? t("indexQueue.saveFailedTitle")
          : indexQueueState === "retrying" && indexQueueError
          ? indexQueueError
          : indexQueueState === "syncing-remote"
          ? t("indexQueue.liveSyncTitle")
          : indexQueueState === "backup-running"
          ? t("indexQueue.backupSnapshotTitle")
          : undefined
      }
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full select-none animate-in fade-in duration-200 border text-xs",
        indexQueueState === "failed"
          ? "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700/50 text-amber-800 dark:text-amber-200"
          : indexQueueState === "syncing-remote" || indexQueueState === "backup-running"
          ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-200"
          : "bg-[#edf2fc] dark:bg-[#282a2c] border-transparent text-[#444746] dark:text-[#c4c7c5]"
      )}
    >
      {indexQueueState === "failed" ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      ) : indexQueueState === "syncing-remote" ? (
        <Cloud className="h-3.5 w-3.5 shrink-0" />
      ) : indexQueueState === "backup-running" ? (
        <Shield className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0b57d0] shrink-0" />
      )}
      <span className="text-[11px] font-semibold">
        {indexQueueState === "failed"
          ? t("indexQueue.saveFailed")
          : indexQueueState === "retrying" && indexQueueRetryInSec > 0
          ? t("indexQueue.retryingIn", { seconds: indexQueueRetryInSec })
          : indexQueueState === "syncing-remote"
          ? t("indexQueue.synced")
          : indexQueueState === "backup-running"
          ? t("indexQueue.backupInProgress")
          : t("indexQueue.syncing")}
      </span>
      {indexQueueState === "failed" && (
        <button
          type="button"
          onClick={() => {
            const fn = (window as any).__teledriveRetryIndex;
            const phone = useAuthStore.getState().phoneNumber;
            if (typeof fn === "function" && phone) {
              import("@/lib/secure/vault").then(({ getSecret, channelIdKey, VAULT_KEY_CHANNEL_ID }) =>
                getSecret(channelIdKey(phone))
                  .then((cid) => cid || getSecret(VAULT_KEY_CHANNEL_ID))
                  .then((cid) => cid && fn(cid))
                  .catch(() => fn(phone))
              );
            }
          }}
          className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-200/80 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100 text-[10px] font-semibold uppercase tracking-wide cursor-pointer"
        >
          <RefreshCw className="h-3 w-3" />
          {t("indexQueue.retry")}
        </button>
      )}
    </div>
  );
});

export default function DriveLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const { t } = useTranslation("drive");
  const phoneNumber = useAuthStore((state) => state.phoneNumber);
  const modKey = useMemo(() => getModKey(), []);
  
  const {
    moveMultipleFilesOrFolders,
    moveMultipleToTrash,
    archiveMultiple,
    starMultiple,
  } = useFileActions();

  const [previewFile, setPreviewFile] = useState<TeleFile | null>(null);
  const [previewInitialEditMode, setPreviewInitialEditMode] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  const [isDragging, setIsDragging] = useState(false);
  const [sidebarDragOverPath, setSidebarDragOverPath] = useState<string | null>(null);
  const dragCounter = useRef(0);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const actionableSidebarPaths = useMemo(
    () => new Set(["/drive/my-drive", "/drive/starred", "/drive/archived", "/drive/trash"]),
    [],
  );

  const handleSidebarDragOver = useCallback((e: React.DragEvent, path: string) => {
    if (actionableSidebarPaths.has(path)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }, [actionableSidebarPaths]);

  const handleSidebarDragEnter = useCallback((e: React.DragEvent, path: string) => {
    if (actionableSidebarPaths.has(path)) {
      e.preventDefault();
      setSidebarDragOverPath(path);
    }
  }, [actionableSidebarPaths]);

  const handleSidebarDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear highlight when actually leaving the sidebar item (not entering a child)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setSidebarDragOverPath(null);
  }, []);

  const handleSidebarDrop = useCallback(async (e: React.DragEvent, path: string) => {
    e.preventDefault();
    setSidebarDragOverPath(null);

    let fileIds = useFileStore.getState().draggedItemIds;
    if (!fileIds || fileIds.length === 0) {
      try {
        const raw = e.dataTransfer.getData(DND_PAYLOAD_MIME) || e.dataTransfer.getData("text/plain");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) {
            fileIds = parsed;
          }
        }
      } catch {
        fileIds = [];
      }
    }

    useFileStore.getState().clearDraggedItemIds();

    if (!fileIds || fileIds.length === 0) return;

    if (path === "/drive/my-drive") {
      await moveMultipleFilesOrFolders(fileIds, "/");
    } else if (path === "/drive/starred") {
      await starMultiple(fileIds);
    } else if (path === "/drive/trash") {
      await moveMultipleToTrash(fileIds);
    } else if (path === "/drive/archived") {
      await archiveMultiple(fileIds);
    }

    useFileStore.getState().clearSelection();
  }, [actionableSidebarPaths, archiveMultiple, moveMultipleFilesOrFolders, moveMultipleToTrash, starMultiple]);

  // Pull-to-refresh states
  const [pullProgress, setPullProgress] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartRef = useRef(0);

  // Intercept browser/webview back button (popstate)
  useEffect(() => {
    const handlePopState = () => {
      // If any modal is active, close them and consume the back action
      if (shortcutsOpen || mobileActionsOpen || previewFile) {
        setShortcutsOpen(false);
        setMobileActionsOpen(false);
        setPreviewFile(null);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [shortcutsOpen, mobileActionsOpen, previewFile]);

  // Hook up keyboard shortcuts
  useKeyboardShortcuts({
    onToggleHelp: () => {
      setShortcutsOpen((prev) => {
        const next = !prev;
        if (next) {
          window.history.pushState({ modal: "shortcuts" }, "");
        }
        return next;
      });
    },
  });

  // Register upload, download, preview, and refresh listeners
  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    // Only show upload overlay for actual OS file drags, not internal TeleDrive item moves
    const hasOsFiles = e.dataTransfer.items && Array.from(e.dataTransfer.items).some(item => item.kind === "file");
    if (hasOsFiles) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Show "move" cursor (no "+" badge on macOS) for internal TeleDrive drags.
    // Show "copy" cursor ("+" badge) for OS file uploads — that's the correct UX.
    const isInternalDrag = useFileStore.getState().draggedItemIds.length > 0;
    e.dataTransfer.dropEffect = isInternalDrag ? "move" : "copy";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    // Only handle OS file uploads here — internal TeleDrive moves use stopPropagation
    // so they never reach this handler. draggedItemIds will be empty for OS file drops.
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      addFilesToUploadQueue(Array.from(droppedFiles));
    }
  };


  useEffect(() => {
    const handleUploadTrigger = () => {
      triggerFilePicker();
    };

    const handleFolderUploadTrigger = () => {
      triggerFolderPicker();
    };

    const handleDownloadTrigger = (e: Event) => {
      const file = (e as CustomEvent).detail as TeleFile;
      if (file) {
        downloadFileFromTelegram(file.channelId, file.messageId, file.name).catch((err) => {
          console.error("Download failed:", err);
        });
      }
    };

    const handlePreviewTrigger = (e: Event) => {
      const file = (e as CustomEvent).detail as TeleFile;
      if (file) {
        setPreviewInitialEditMode(false);
        setPreviewFile(file);
        window.history.pushState({ modal: "preview" }, "");
      }
    };

    const handleEditTrigger = (e: Event) => {
      const file = (e as CustomEvent).detail as TeleFile;
      if (file) {
        setPreviewInitialEditMode(true);
        setPreviewFile(file);
        window.history.pushState({ modal: "preview" }, "");
      }
    };

    const handleRefreshFiles = async () => {
      try {
        await bootstrapTeleDrive(undefined, phoneNumber ?? "");
      } catch (err) {
        console.error("Refresh failed:", err);
      }
    };

    const handleInternalSidebarDrop = async (e: Event) => {
      const detail = (e as CustomEvent<{ target: string; fileIds: string[] }>).detail;
      if (!detail?.target || !Array.isArray(detail.fileIds) || detail.fileIds.length === 0) return;

      if (detail.target === "/drive/my-drive") {
        await moveMultipleFilesOrFolders(detail.fileIds, "/");
      } else if (detail.target === "/drive/starred") {
        await starMultiple(detail.fileIds);
      } else if (detail.target === "/drive/trash") {
        await moveMultipleToTrash(detail.fileIds);
      } else if (detail.target === "/drive/archived") {
        await archiveMultiple(detail.fileIds);
      }

      useFileStore.getState().clearSelection();
    };

    window.addEventListener("teledrive-trigger-upload", handleUploadTrigger);
    window.addEventListener("teledrive-trigger-folder-upload", handleFolderUploadTrigger);
    window.addEventListener("teledrive-download-file", handleDownloadTrigger);
    window.addEventListener("teledrive-preview-file", handlePreviewTrigger);
    window.addEventListener("teledrive-edit-file", handleEditTrigger);
    window.addEventListener("teledrive-refresh-files", handleRefreshFiles);
    window.addEventListener("teledrive-sidebar-drop-action", handleInternalSidebarDrop);
    
    return () => {
      window.removeEventListener("teledrive-trigger-upload", handleUploadTrigger);
      window.removeEventListener("teledrive-trigger-folder-upload", handleFolderUploadTrigger);
      window.removeEventListener("teledrive-download-file", handleDownloadTrigger);
      window.removeEventListener("teledrive-preview-file", handlePreviewTrigger);
      window.removeEventListener("teledrive-edit-file", handleEditTrigger);
      window.removeEventListener("teledrive-refresh-files", handleRefreshFiles);
      window.removeEventListener("teledrive-sidebar-drop-action", handleInternalSidebarDrop);
    };
  }, [archiveMultiple, moveMultipleFilesOrFolders, moveMultipleToTrash, phoneNumber, starMultiple]);

  const handleTouchStart = (e: React.TouchEvent) => {
    const mainEl = e.currentTarget;
    if (mainEl.scrollTop === 0) {
      touchStartRef.current = e.touches[0].clientY;
    } else {
      touchStartRef.current = 0;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartRef.current === 0 || isRefreshing) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - touchStartRef.current;
    
    if (deltaY > 0) {
      const progress = Math.min(Math.round((deltaY / 120) * 100), 100);
      setPullProgress(progress);
      
      if (deltaY > 10) {
        if (e.cancelable) e.preventDefault();
      }
    }
  };

  const handleTouchEnd = async () => {
    if (touchStartRef.current === 0 || isRefreshing) return;
    touchStartRef.current = 0;
    
    if (pullProgress >= 80) {
      setIsRefreshing(true);
      setPullProgress(100);
      try {
        await bootstrapTeleDrive(undefined, phoneNumber ?? "");
      } catch (err) {
        console.error("Failed to refresh:", err);
      } finally {
        setIsRefreshing(false);
        setPullProgress(0);
      }
    } else {
      setPullProgress(0);
    }
  };

  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);

  const files = useFileStore((state) => state.files);
  const draggedItemIds = useFileStore((state) => state.draggedItemIds);

  useEffect(() => {
    if (draggedItemIds.length === 0) {
      setSidebarDragOverPath(null);
    }
  }, [draggedItemIds]);

  // Only sum active (non-trashed) file sizes; guard against NaN from BigInt
  const safeSize = (raw: unknown): number => {
    const n = Number(raw);
    return isFinite(n) && n >= 0 ? n : 0;
  };
  // Memoize the storage footer sum. Was running an O(N) filter + reduce on
  // every DriveLayout render (which is every `files` change — including
  // unrelated mutations like selection toggles and queue countdowns).
  const totalSizeBytes = useMemo(() => {
    let total = 0;
    for (const f of files) {
      if (!f.trashed && f.mime !== "inode/directory") {
        total += safeSize(f.size);
      }
    }
    return total;
  }, [files]);

  const formatBytes = (bytes: number) => {
    if (!bytes || !isFinite(bytes) || bytes <= 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formattedUsedSize = formatBytes(totalSizeBytes);

  // Pro-only features (Backups sidebar entry, brand text) flip reactively
  // on plan changes. The selector hook re-renders the layout whenever the
  // Razorpay webhook succeeds and `plan` flips from FREE → PRO.
  const isPro = useIsPro();

  // Extract phone initials (e.g. "+91 9876..." -> "+9")
  const getInitials = (phone: string | null) => {
    if (!phone) return "TD";
    const cleaned = phone.replace(/[^0-9+]/g, "");
    if (cleaned.startsWith("+")) {
      return cleaned.slice(0, 2);
    }
    return cleaned.slice(0, 2).toUpperCase() || "TD";
  };

  const { archivedCount, starredCount, trashCount, totalCount, backupCount } = useMemo(() => {
    let archived = 0;
    let starred = 0;
    let trash = 0;
    let total = 0;
    let backup = 0;

    for (const file of files) {
      if (file.trashed) {
        trash += 1;
        continue;
      }

      if (file.archived) {
        archived += 1;
        continue;
      }

      if (isBackupItem(file)) {
        // Mirror the badge semantics used by the other sidebar entries:
        // count non-trashed backup files. Folder entries inside the
        // backup namespace are included so the badge reflects the
        // total navigable count, matching the way My Drive counts
        // its subfolders + files together.
        backup += 1;
        continue;
      }

      total += 1;
      if (file.starred) starred += 1;
    }

    return {
      archivedCount: archived,
      starredCount: starred,
      trashCount: trash,
      totalCount: total,
      backupCount: backup,
    };
  }, [files]);

  const navItems = useMemo(() => {
    const items: Array<{
      label: string;
      icon: typeof HardDrive;
      path: string;
      badge: number | null;
      dropTarget: string | null;
    }> = [
      { label: t("nav.myDrive"),  icon: HardDrive, path: "/drive/my-drive",  badge: totalCount, dropTarget: "nav:/drive/my-drive" },
      { label: t("nav.recent"),   icon: Clock,      path: "/drive/recent", dropTarget: null, badge: null },
      { label: t("nav.starred"),  icon: Star,       path: "/drive/starred",   badge: starredCount, dropTarget: "nav:/drive/starred" },
      { label: t("nav.archived"), icon: Archive,    path: "/drive/archived",  badge: archivedCount, dropTarget: "nav:/drive/archived" },
      { label: t("nav.trash"),    icon: Trash2,     path: "/drive/trash",     badge: trashCount, dropTarget: "nav:/drive/trash" },
    ];
    // Device-backup entry is Pro-only — fully hidden for FREE users
    // (per the project decision: Pro features are not visible in the
    // frontend for free users, not just gated with an upgrade banner).
    // The route itself is also guarded by RequirePro in App.tsx so a
    // direct URL still redirects to /drive/my-drive.
    // Sits at the bottom of the personal-drive group so it reads as a
    // sibling section rather than primary navigation. No dropTarget —
    // backups are read-only, so internal drag-to-sidebar moves don't
    // apply. The mobile bottom nav (lines below) reuses this array.
    if (isPro) {
      items.push({ label: t("nav.backups"), icon: Shield, path: "/drive/backups", badge: backupCount, dropTarget: null });
    }
    return items;
  }, [archivedCount, starredCount, totalCount, trashCount, backupCount, isPro, t]);

  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex flex-col h-screen overflow-hidden bg-background text-foreground relative"
    >
      {/* Drag & Drop full screen overlay: Google Drive styled */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#edf2fc]/90 dark:bg-[#1e1f20]/90 backdrop-blur-sm border-2 border-dashed border-[#0b57d0] m-4 rounded-3xl animate-in fade-in zoom-in-95 duration-200 select-none pointer-events-none">
          <div className="flex flex-col items-center gap-4 text-[#0b57d0] dark:text-[#a8c7fa]">
            <div className="p-5 rounded-full bg-white dark:bg-[#282a2c] shadow-lg border border-slate-200/80 dark:border-slate-700 transition-transform duration-300 scale-105">
              <Upload className="h-10 w-10 text-[#0b57d0] dark:text-[#a8c7fa]" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-[#1f1f1f] dark:text-[#e3e3e3]">{t("dropOverlay.title")}</h2>
            <p className="text-sm font-medium text-[#444746] dark:text-[#c4c7c5]">{t("dropOverlay.description")}</p>
          </div>
        </div>
      )}
      
      {/* Topbar: Google Workspace styled */}
      <header className="relative z-40 flex items-center justify-between px-4 h-16 shrink-0 bg-background border-b md:border-b-0 border-slate-200/60 dark:border-slate-800/60 select-none">
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          {isMobile && (
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-[#e9eef6] dark:hover:bg-[#282a2c] text-[#444746] dark:text-[#c4c7c5] cursor-pointer">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[var(--sidebar-width)] p-0 pt-6 bg-background">
                <div className="px-5 py-2 flex items-center gap-2.5 mb-2">
                  <img
                    src="/teledrive.png"
                    alt={t("logoAlt")}
                    className="h-7 w-7 object-contain rounded-lg shadow-sm"
                  />
                  <span className="text-xl font-bold tracking-tight text-[#1f1f1f] dark:text-[#e3e3e3]">
                    TeleDrive
                  </span>
                </div>
                <DriveSidebar
                  navItems={navItems}
                  formattedUsedSize={formattedUsedSize}
                  isMobile={isMobile}
                  setSidebarOpen={setSidebarOpen}
                  draggedItemIds={draggedItemIds}
                  actionableSidebarPaths={actionableSidebarPaths}
                  sidebarDragOverPath={sidebarDragOverPath}
                  setSidebarDragOverPath={setSidebarDragOverPath}
                  handleSidebarDragOver={handleSidebarDragOver}
                  handleSidebarDragEnter={handleSidebarDragEnter}
                  handleSidebarDragLeave={handleSidebarDragLeave}
                  handleSidebarDrop={handleSidebarDrop}
                />
              </SheetContent>
            </Sheet>
          )}

          {/* Logo / Title */}
          <Link to="/drive/my-drive" className="flex items-center gap-2.5 group">
            <img
              src="/teledrive.png"
              alt={t("logoAlt")}
              className="h-8 w-8 object-contain rounded-lg shadow-xs shrink-0 transition-transform duration-200 group-hover:scale-105"
            />
            <span className="hidden sm:inline-block text-xl font-semibold tracking-tight text-[#1f1f1f] dark:text-[#e3e3e3]">
              TeleDrive
            </span>
          </Link>
        </div>

        {/* Search bar wrapper */}
        <div className="flex-1 max-w-2xl mx-4 md:mx-8">
          <SearchBar />
        </div>

        {/* Right side items */}
        <div className="flex items-center gap-1.5 md:gap-2.5 shrink-0">
          {/* Index queue state pill */}
          <IndexQueuePill />

          {/* Quick theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="h-10 w-10 rounded-full hover:bg-[#e9eef6] dark:hover:bg-[#282a2c] text-[#444746] dark:text-[#c4c7c5] cursor-pointer"
            title={theme === "dark" ? t("header.switchToLight") : t("header.switchToDark")}
          >
            {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </Button>

          {/* Settings button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/settings")}
            className="h-10 w-10 rounded-full hover:bg-[#e9eef6] dark:hover:bg-[#282a2c] text-[#444746] dark:text-[#c4c7c5] hidden md:flex cursor-pointer"
            title={t("header.settings")}
          >
            <Settings className="h-5 w-5" />
          </Button>

          {/* Avatar */}
          <Avatar className="h-9 w-9 border border-slate-200 dark:border-slate-800 cursor-pointer hover:opacity-90 transition-opacity" onClick={() => navigate("/settings")}>
            <AvatarFallback className="bg-gradient-to-tr from-[#0b57d0] to-[#1a73e8] text-white font-semibold text-xs select-none">
              {getInitials(phoneNumber)}
            </AvatarFallback>
          </Avatar>
        </div>
      </header>

      {/* Offline banner */}
      {!isOnline && (
        <div className="bg-amber-500 text-white text-xs font-semibold py-1.5 px-4 flex items-center justify-center gap-2 select-none animate-fade-in shrink-0">
          <svg className="h-4 w-4 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-3.536 4.978 4.978 0 011.414-3.536m0 0L8.464 8.464" />
          </svg>
          <span>{t("offlineBanner")}</span>
        </div>
      )}

      {/* Main shell: Google Drive Canvas + Surface sheet */}
      <div className="flex flex-1 overflow-hidden bg-background">
        {/* Sidebar (Desktop) */}
        {!isMobile && (
          <aside className="w-[var(--sidebar-width)] bg-background shrink-0 z-10 flex flex-col">
            <DriveSidebar
              navItems={navItems}
              formattedUsedSize={formattedUsedSize}
              isMobile={isMobile}
              setSidebarOpen={setSidebarOpen}
              draggedItemIds={draggedItemIds}
              actionableSidebarPaths={actionableSidebarPaths}
              sidebarDragOverPath={sidebarDragOverPath}
              setSidebarDragOverPath={setSidebarDragOverPath}
              handleSidebarDragOver={handleSidebarDragOver}
              handleSidebarDragEnter={handleSidebarDragEnter}
              handleSidebarDragLeave={handleSidebarDragLeave}
              handleSidebarDrop={handleSidebarDrop}
            />
          </aside>
        )}

        {/* Main Content Area: Google Drive Rounded Surface Sheet Container */}
        <main
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="flex-1 overflow-y-auto bg-surface dark:bg-[#1e1f20] md:mr-4 md:mb-4 md:rounded-3xl border border-slate-200/80 dark:border-[#2d2f31] shadow-xs pb-[calc(var(--mobile-nav-height)+16px)] md:pb-6 relative z-10"
        >
          {/* Mobile FAB */}
          {isMobile && <NewActionButton isFab />}
          {/* Pull to refresh spinner */}
          {(pullProgress > 0 || isRefreshing) && (
            <div
              className="absolute left-1/2 -translate-x-1/2 z-50 flex items-center justify-center bg-white dark:bg-slate-900 border dark:border-slate-800 shadow-md rounded-full transition-all"
              style={{
                top: `${12 + (pullProgress / 100) * 32}px`,
                width: "36px",
                height: "36px",
                opacity: pullProgress / 100,
                transform: `translate(-50%, 0) rotate(${pullProgress * 3.6}deg)`,
              }}
            >
              <Loader2 className={cn("h-4.5 w-4.5 text-brand-500", isRefreshing && "animate-spin")} />
            </div>
          )}
          <div className="animate-slide-up-fade min-h-full w-full">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Bottom Nav (Mobile) */}
      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 h-[var(--mobile-nav-height)] border-t border-slate-200/80 dark:border-slate-800/80 bg-white/95 dark:bg-[#1e1f20]/95 backdrop-blur-md flex items-center justify-around z-40 pb-[env(safe-area-inset-bottom)] select-none">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              location.pathname === item.path ||
              (item.path === "/drive/my-drive" && location.pathname.startsWith("/drive/folder/")) ||
              (item.path === "/drive/backups" && location.pathname.startsWith("/drive/backups"));
            return (
              <Link
                key={item.label}
                to={item.path}
                className={cn(
                  "flex flex-col items-center justify-center w-16 h-full transition-colors cursor-pointer",
                  isActive
                    ? "text-[#0b57d0] dark:text-[#a8c7fa] font-semibold"
                    : "text-[#444746] dark:text-[#c4c7c5]"
                )}
              >
                <div className={cn(
                  "px-3.5 py-0.5 rounded-full mb-0.5 transition-colors",
                  isActive && "bg-[#c2e7ff] dark:bg-[#004a77]"
                )}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-[10px] tracking-tight">{item.label}</span>
              </Link>
            );
          })}
          
          {/* Settings tab for mobile bottom nav */}
          <Link
            to="/settings"
            className={cn(
              "flex flex-col items-center justify-center w-16 h-full transition-colors cursor-pointer",
              location.pathname === "/settings"
                ? "text-[#0b57d0] dark:text-[#a8c7fa] font-semibold"
                : "text-[#444746] dark:text-[#c4c7c5]"
            )}
          >
            <div className={cn(
              "px-3.5 py-0.5 rounded-full mb-0.5 transition-colors",
              location.pathname === "/settings" && "bg-[#c2e7ff] dark:bg-[#004a77]"
            )}>
              <Settings className="h-5 w-5" />
            </div>
            <span className="text-[10px] tracking-tight">{t("nav.settings")}</span>
          </Link>
        </nav>
      )}
      <FilePreviewModal
        file={previewFile}
        initialEditMode={previewInitialEditMode}
        onClose={() => {
          setPreviewFile(null);
          setPreviewInitialEditMode(false);
          if (window.history.state?.modal === "preview") {
            window.history.back();
          }
        }}
      />
      <UploadProgressPanel />
      <BackupProgressOverlay />

      {/* Keyboard Shortcuts Dialog */}
      <Dialog open={shortcutsOpen} onOpenChange={(open) => {
        setShortcutsOpen(open);
        if (!open && window.history.state?.modal === "shortcuts") {
          window.history.back();
        }
      }}>
        <DialogContent className="rounded-3xl max-w-lg p-6 bg-white dark:bg-[#1e1f20] border border-slate-200/80 dark:border-slate-800 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-[#1f1f1f] dark:text-[#e3e3e3]">
              {t("shortcuts.title")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2 select-none">
            <div>
              <h4 className="text-xs font-semibold text-[#444746] dark:text-[#c4c7c5] tracking-wide mb-3">{t("shortcuts.navigationGroup")}</h4>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#444746] dark:text-[#c4c7c5]">{t("shortcuts.focusSearch")}</span>
                  <kbd className="px-2 py-0.5 bg-[#f0f4f9] dark:bg-[#282a2c] border border-slate-300/70 dark:border-slate-700 rounded-md text-[10px] font-semibold text-[#1f1f1f] dark:text-[#e3e3e3]">{t("shortcuts.focusSearchKeys", { modKey })}</kbd>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#444746] dark:text-[#c4c7c5]">{t("shortcuts.clearSelection")}</span>
                  <kbd className="px-2 py-0.5 bg-[#f0f4f9] dark:bg-[#282a2c] border border-slate-300/70 dark:border-slate-700 rounded-md text-[10px] font-semibold text-[#1f1f1f] dark:text-[#e3e3e3]">Esc</kbd>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#444746] dark:text-[#c4c7c5]">{t("shortcuts.scrollToTop")}</span>
                  <kbd className="px-2 py-0.5 bg-[#f0f4f9] dark:bg-[#282a2c] border border-slate-300/70 dark:border-slate-700 rounded-md text-[10px] font-semibold text-[#1f1f1f] dark:text-[#e3e3e3]">g g</kbd>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#444746] dark:text-[#c4c7c5]">{t("shortcuts.scrollToBottom")}</span>
                  <kbd className="px-2 py-0.5 bg-[#f0f4f9] dark:bg-[#282a2c] border border-slate-300/70 dark:border-slate-700 rounded-md text-[10px] font-semibold text-[#1f1f1f] dark:text-[#e3e3e3]">g l</kbd>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#444746] dark:text-[#c4c7c5]">{t("shortcuts.showHelp")}</span>
                  <kbd className="px-2 py-0.5 bg-[#f0f4f9] dark:bg-[#282a2c] border border-slate-300/70 dark:border-slate-700 rounded-md text-[10px] font-semibold text-[#1f1f1f] dark:text-[#e3e3e3]">?</kbd>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-[#444746] dark:text-[#c4c7c5] tracking-wide mb-3">{t("shortcuts.selectionGroup")}</h4>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#444746] dark:text-[#c4c7c5]">{t("shortcuts.selectAll")}</span>
                  <kbd className="px-2 py-0.5 bg-[#f0f4f9] dark:bg-[#282a2c] border border-slate-300/70 dark:border-slate-700 rounded-md text-[10px] font-semibold text-[#1f1f1f] dark:text-[#e3e3e3]">{modKey}A</kbd>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#444746] dark:text-[#c4c7c5]">{t("shortcuts.moveToTrash")}</span>
                  <kbd className="px-2 py-0.5 bg-[#f0f4f9] dark:bg-[#282a2c] border border-slate-300/70 dark:border-slate-700 rounded-md text-[10px] font-semibold text-[#1f1f1f] dark:text-[#e3e3e3]">Del / Backspace</kbd>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#444746] dark:text-[#c4c7c5]">{t("shortcuts.rename")}</span>
                  <kbd className="px-2 py-0.5 bg-[#f0f4f9] dark:bg-[#282a2c] border border-slate-300/70 dark:border-slate-700 rounded-md text-[10px] font-semibold text-[#1f1f1f] dark:text-[#e3e3e3]">F2</kbd>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#444746] dark:text-[#c4c7c5]">{t("shortcuts.download")}</span>
                  <kbd className="px-2 py-0.5 bg-[#f0f4f9] dark:bg-[#282a2c] border border-slate-300/70 dark:border-slate-700 rounded-md text-[10px] font-semibold text-[#1f1f1f] dark:text-[#e3e3e3]">{modKey}D</kbd>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
