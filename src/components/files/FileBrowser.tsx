import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import {
  Grid,
  List,
  FolderPlus,
  Upload,
  ChevronRight,
  Home,
  Star,
  Trash2,
  X,
  FolderOpen,
  Folder,
  FileCheck,
  RotateCcw,
  ArrowUpDown,
  Eye,
  Download,
  Edit2,
  Archive,
  CheckCircle,
  Check,
  Plus,
  MoreHorizontal,
  Shield,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { TeleFile } from "@/lib/types";
import { useFileStore } from "@/stores/fileStore";
import { useUIStore } from "@/stores/uiStore";
import { useFileActions } from "@/hooks/useFileActions";
import { FileIcon } from "./FileIcon";
import { FolderIcon } from "./FolderIcon";
import { FileContextMenu } from "./FileContextMenu";
import { FileActionsMenu } from "./FileActionsMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { fuzzySearch } from "@/lib/search/searchEngine";
import { getFileCategory } from "@/lib/files/fileUtils";
import { isEditableFile } from "@/lib/files/editableTypes";
import { useFileBrowserDragAndDrop } from "@/hooks/useFileBrowserDragAndDrop";
import { collapseDuplicateFolders, dedupeByContentKey, dedupeByMessageId, folderIdForPath } from "@/lib/storage/metadataStore";
import { isBackupItem, BACKUP_ROOT, BACKUP_ROOT_PREFIX } from "@/lib/backup/visibility";
import { toast } from "sonner";
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

// ---------------------------------------------------------------------------
// Utility: human-readable file size
// ---------------------------------------------------------------------------
function formatFileSize(bytes: unknown): string {
  const n = Number(bytes);
  if (!n || !isFinite(n) || n <= 0) return "—";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((n / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// ---------------------------------------------------------------------------
// Utility: human-readable file type
// ---------------------------------------------------------------------------
function getFileType(file: TeleFile, t: TFunction<"files">): string {
  const isDir = isDirectory(file);
  if (isDir) return t("browser.fileType.folder");
  
  const ext = file.name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf": return t("browser.fileType.pdf");
    case "jpg":
    case "jpeg":
    case "png":
    case "webp":
    case "gif":
    case "svg":
      return t("browser.fileType.image");
    case "mp4":
    case "mkv":
    case "mov":
    case "avi":
    case "webm":
      return t("browser.fileType.video");
    case "mp3":
    case "wav":
    case "m4a":
    case "ogg":
    case "flac":
      return t("browser.fileType.audio");
    case "txt":
    case "md":
    case "rtf":
      return t("browser.fileType.text");
    case "zip":
    case "tar":
    case "gz":
    case "rar":
    case "7z":
      return t("browser.fileType.archive");
    case "doc":
    case "docx":
      return t("browser.fileType.word");
    case "xls":
    case "xlsx":
    case "csv":
      return t("browser.fileType.spreadsheet");
    case "ppt":
    case "pptx":
      return t("browser.fileType.presentation");
    case "html":
    case "css":
    case "js":
    case "ts":
    case "tsx":
    case "json":
    case "py":
    case "rs":
    case "go":
    case "c":
    case "cpp":
      return t("browser.fileType.sourceCode");
    default:
      return ext ? t("browser.fileType.generic", { ext: ext.toUpperCase() }) : t("browser.fileType.file");
  }
}

function isDirectory(file: TeleFile): boolean {
  return file.mime === "inode/directory" || file.mime === "application/x-directory";
}

// Stable empty array reference — used as a fallback for `indexedFiles` so
// consumers (and React deps) see the SAME identity on every render instead
// of allocating a fresh `[]` each time. Avoids spurious downstream re-runs.
const EMPTY_FILES: readonly TeleFile[] = Object.freeze([]) as readonly TeleFile[];




interface FileBrowserProps {
  folderPath?: string;
  mode?: "drive" | "starred" | "recent" | "trash" | "search" | "archived" | "backups";
  searchQuery?: string;
}

export function FileBrowser({ folderPath = "/", mode = "drive", searchQuery = "" }: FileBrowserProps) {
  const { t, i18n } = useTranslation("files");
  const navigate = useNavigate();
  const files = useFileStore((state) => state.files);
  const selectedIds = useFileStore((state) => state.selectedIds);
  const selectedIdsSet = useFileStore((state) => state.selectedIdsSet);
  const isLoading = useFileStore((state) => state.isLoading);
  const setFolder = useFileStore((state) => state.setFolder);
  const toggleSelect = useFileStore((state) => state.toggleSelect);
  const setSelectedIds = useFileStore((state) => state.setSelectedIds);
  const clearSelection = useFileStore((state) => state.clearSelection);

  const {
    viewMode,
    setViewMode,
    sortBy,
    setSortBy,
    filterType,
    setFilterType,
  } = useUIStore();
  const {
    createFolder,
    renameFile,
    toggleStar,
    moveToTrash,
    restoreFromTrash,
    archiveFile,
    unarchiveFile,
    deletePermanently,
    emptyTrash,
    isOperating,
    moveMultipleToTrash,
    restoreMultipleFromTrash,
    deleteMultiplePermanently,
    toggleOffline,
    moveMultipleFilesOrFolders,
  } = useFileActions();

  const isMobile = useIsMobile();
  const touchTimeoutRef = useRef<any>(null);
  const [mobileContextFile, setMobileContextFile] = useState<TeleFile | null>(null);

  const {
    dragOverId,
    draggedId,
    internalDrag,
    isDraggingActive,
    suppressClickRef,
    handlePointerDown,
    handleDragOverCard,
    handleDrop,
    handleGlobalDragOver,
    handleGlobalDrop,
  } = useFileBrowserDragAndDrop({
    files,
    folderPath,
    isMobile,
    selectedIds,
    selectedIdsSet,
    clearSelection,
    moveMultipleFilesOrFolders,
  });

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<TeleFile | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const [emptyTrashDialogOpen, setEmptyTrashDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TeleFile | null>(null);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  // Progressive render limit for memory & DOM performance on large directories
  const INITIAL_RENDER_LIMIT = 80;
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER_LIMIT);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 300) {
      setRenderLimit((prev) => prev + 50);
    }
  }, []);

  // Update current folder path in store on mount/change
  useEffect(() => {
    if (mode === "drive") {
      const currentFolder = useFileStore.getState().currentFolder;
      if (currentFolder !== folderPath) {
        setFolder(folderPath);
      }
    }
  }, [folderPath, mode, setFolder]);

  // ── Memoized derived data ───────────────────────────────────────────────

  const sortLabel = useMemo(() => {
    switch (sortBy) {
      case "name_asc": return t("browser.sort.short.nameAsc");
      case "name_desc": return t("browser.sort.short.nameDesc");
      case "date_desc": return t("browser.sort.short.newest");
      case "date_asc": return t("browser.sort.short.oldest");
      case "size_desc": return t("browser.sort.short.largest");
      case "size_asc": return t("browser.sort.short.smallest");
      default: return t("browser.sort.short.nameAsc");
    }
  }, [sortBy, t]);

  const activeSortBy = useMemo(
    () => (mode === "recent" && sortBy === "name_asc" ? "date_desc" : sortBy),
    [mode, sortBy],
  );

  useEffect(() => {
    setRenderLimit(INITIAL_RENDER_LIMIT);
  }, [folderPath, mode, filterType, searchQuery, activeSortBy]);

  const activeFiles = useMemo(
    () =>
      files
        .filter((file) => !file.trashed && !file.archived)
        // Backup items (files AND their reconstructed parent folder entries)
        // live under `/TeleDrive Backups/<device>/...`. Hide them from every
        // mode EXCEPT the dedicated `backups` view — keeps My Drive /
        // Recent / Starred / Archived / Search free of backup noise even
        // if the user stars or otherwise interacts with a backup entry.
        // See src/lib/backup/visibility.ts for the predicate.
        .filter((file) => mode === "backups" || !isBackupItem(file)),
    [files, mode],
  );

  /**
   * Render-layer dedup. Even though `metadataStore.healAndSave` collapses
   * duplicates on cold start, the in-memory `state.files` can still contain
   * folder duplicates between cold starts because:
   *   - `setRemoteDelta` only calls `dedupeByMessageId` (skips folders).
   *   - `loadIndexIncremental` doesn't call any folder-collapse helper.
   *   - The user-visible `createFolder` path uses random ids, not the
   *     canonical `folderIdForPath`, so a folder can exist under both ids.
   *
   * Without this pass, two folder entries with the same full path but
   * different ids render as two separate cards (each keyed by `folder.id`).
   * The fix mirrors `healAndSave`: dedupeByMessageId → dedupeByContentKey
   * → collapseDuplicateFolders. The output `useMemo`s downstream stay
   * structurally the same; only the input is cleaner.
   */
  const dedupedActiveFiles = useMemo(
    () => collapseDuplicateFolders(dedupeByContentKey(dedupeByMessageId(activeFiles))),
    [activeFiles],
  );

  const folderEntriesIndex = useMemo(() => {
    const index = new Map<string, TeleFile[]>();
    for (const file of dedupedActiveFiles) {
      const bucket = index.get(file.folderPath);
      if (bucket) {
        bucket.push(file);
      } else {
        index.set(file.folderPath, [file]);
      }
    }
    return index;
  }, [dedupedActiveFiles]);

  // Compute ONLY the slice that the current `mode` actually needs.
// Previously this allocated four filtered arrays eagerly (starred/recent/
// archived/trash) on every render, costing 3×O(N) wasted work when only
// one of them was being read by `displayFiles`. Now we compute exactly
// one slice — and we only pay for folderEntriesIndex.get(folderPath) when
// the user is on a drive/folder view.
  const indexedFiles = useMemo(() => {
    switch (mode) {
      case "drive":
        return folderEntriesIndex.get(folderPath) ?? EMPTY_FILES;
      case "starred":
        return dedupedActiveFiles.filter((file) => file.starred);
      case "recent":
        return dedupedActiveFiles;
      case "trash":
        // Trash bypasses `activeFiles` (it deliberately keeps trashed
        // items), so apply the backup-exclusion filter inline to keep
        // the leak-stop uniform across modes. The `mode === "backups"`
        // branch below handles its own slice, so by construction this
        // case only runs when the user is on the Trash view, where
        // backups should still be hidden.
        return files.filter(
          (file) => file.trashed && !isBackupItem(file),
        );
      case "archived":
        return files.filter((file) => file.archived && !file.trashed);
      case "backups":
        // Drive-style bucket lookup at `folderPath`. The reconstructor
        // creates parent folder entries on bootstrap, so the direct-
        // child bucket is normally enough — and lets us keep the
        // folder-as-card UX that matches My Drive.
        //
        // IMPORTANT: do NOT `.filter(isBackupItem)` the bucket here.
        // The device folder entry that lives at `folderPath ===
        // "/TeleDrive Backups"` exactly (no trailing slash) is
        // legitimately a backup item, and an earlier version of this
        // predicate used a strict `.startsWith("/TeleDrive Backups/")`
        // that silently stripped it. The `activeFiles` slice above
        // already drops non-backup entries for non-backups modes, so
        // nothing non-backup should reach this branch — and if any
        // did, `dedupedActiveFiles` is already the trimmed set.
        //
        // Fallback: if the direct-child bucket is empty BUT there ARE
        // backup items somewhere under `folderPath`, the user's
        // localStorage cache must be missing the intermediate folder
        // entries (cold-start race or older pre-reconstructor cache).
        // Walk descendants and synthesise one folder entry per
        // immediate child segment, so the user can still drill into
        // their backups instead of seeing an empty listing.
        {
          const direct = folderEntriesIndex.get(folderPath);
          if (direct && direct.length > 0) {
            return direct;
          }
          const prefix = folderPath.endsWith("/") ? folderPath : `${folderPath}/`;
          const descendants = dedupedActiveFiles.filter(
            (f) => isBackupItem(f) && f.folderPath.startsWith(prefix),
          );
          if (descendants.length === 0) return EMPTY_FILES;
          // Synthesise immediate-child folder entries by collecting
          // the first path segment after `prefix` for every
          // descendant. Files whose own folderPath === folderPath
          // (i.e. they live directly in this folder) are passed
          // through verbatim.
          const synthMap = new Map<string, TeleFile>();
          const directChildren: TeleFile[] = [];
          for (const f of descendants) {
            if (f.folderPath === folderPath) {
              directChildren.push(f);
              continue;
            }
            const rest = f.folderPath.substring(prefix.length);
            const seg = rest.split("/")[0];
            if (!seg) continue;
            if (!synthMap.has(seg)) {
              synthMap.set(seg, {
                // Synthetic folder — id derived from the full path so
                // it survives a reconstructMissingFolders pass later
                // without colliding with the real folder entry.
                id: folderIdForPath(`${folderPath}/${seg}`),
                name: seg,
                size: 0,
                mime: "inode/directory",
                folderPath,
                messageId: 0,
                channelId: f.channelId,
                uploadedAt: f.uploadedAt,
                starred: false,
                trashed: false,
                archived: false,
              });
            }
          }
          // Stable alphabetical sort so the synthesised listing
          // doesn't shuffle between renders. Direct files are also
          // folded in so the user sees files-in-folder alongside
          // folders-in-folder (matching the native folder browser).
          const folders = Array.from(synthMap.values()).sort((a, b) =>
            a.name.localeCompare(b.name),
          );
          return [...folders, ...directChildren];
        }
      default:
        // search mode — fuzzySearch handles its own filtering; pass dedupedActiveFiles.
        return dedupedActiveFiles;
    }
  }, [mode, folderEntriesIndex, folderPath, dedupedActiveFiles, files]);

  // Full filtered + sorted display list — optimized for folder navigation
  const { displayFiles, folders, regularFiles } = useMemo(() => {
    let filtered: TeleFile[];

    if (mode === "search") {
      filtered = fuzzySearch(dedupedActiveFiles, searchQuery);
    } else {
      // Always copy before sorting so we never mutate the bucket arrays
      // inside folderEntriesIndex (which are themselves memoized; mutating
      // them silently corrupts the cache for the next render).
      filtered = [...indexedFiles];
    }

    const visibleFiles =
      filterType === "All"
        ? filtered
        : filtered.filter((f) => !isDirectory(f) && getFileCategory(f.name, f.mime) === filterType);

    visibleFiles.sort((a, b) => {
      const aIsDir = isDirectory(a);
      const bIsDir = isDirectory(b);
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      switch (activeSortBy) {
        case "name_asc": return a.name.localeCompare(b.name);
        case "name_desc": return b.name.localeCompare(a.name);
        case "date_asc": return (a.lastOpenedAt || a.uploadedAt) - (b.lastOpenedAt || b.uploadedAt);
        case "date_desc": return (b.lastOpenedAt || b.uploadedAt) - (a.lastOpenedAt || a.uploadedAt);
        case "size_asc": return a.size - b.size;
        case "size_desc": return b.size - a.size;
        default: return a.name.localeCompare(b.name);
      }
    });

    const nextFolders: TeleFile[] = [];
    const nextRegularFiles: TeleFile[] = [];
    for (const file of visibleFiles) {
      if (isDirectory(file)) {
        nextFolders.push(file);
      } else {
        nextRegularFiles.push(file);
      }
    }

    return {
      displayFiles: visibleFiles,
      folders: nextFolders,
      regularFiles: nextRegularFiles,
    };
  }, [dedupedActiveFiles, activeSortBy, filterType, indexedFiles, mode, searchQuery]);

  // Breadcrumbs — only recompute when folderPath/mode change.
  // For `mode === "backups"` the link prefix is the Backups route so the
  // user stays inside the Backups view while drilling down. The first
  // crumb is always "Backups" and links back to /drive/backups (the
  // device-root listing).
  const breadcrumbs = useMemo(() => {
    if (mode === "backups") {
      // At the Backups root we don't emit any crumbs — the hardcoded
      // "Backups" link is rendered just above the breadcrumb map, and
      // emitting another "Backups" crumb here would print
      // "Backups > Backups" in the trail. Empty array suppresses the
      // extra chevron + pill.
      if (!folderPath || folderPath === "/TeleDrive Backups") {
        return [];
      }
      // segments[0] is the literal "TeleDrive Backups" — the synthetic
      // namespace root. The hardcoded "Backups" link above represents
      // it, so we skip it and start building crumbs from segments[1]
      // (the device segment) onwards.
      const segments = folderPath.split("/").filter(Boolean);
      const crumbs: { name: string; link: string }[] = [];
      let accumPath = "";
      for (let i = 1; i < segments.length; i++) {
        accumPath += `/${segments[i]}`;
        crumbs.push({
          name: segments[i],
          link: `/drive/backups/folder${accumPath}`,
        });
      }
      return crumbs;
    }
    if (folderPath === "/") return [];
    const segments = folderPath.split("/").filter(Boolean);
    let accumPath = "";
    return segments.map((seg) => {
      accumPath += `/${seg}`;
      return { name: seg, link: `/drive/folder${accumPath}` };
    });
  }, [folderPath, mode]);

  // Header title — only recompute when mode/folderPath/searchQuery change
  const headerTitle = useMemo(() => {
    switch (mode) {
      case "starred": return t("browser.header.starred");
      case "recent": return t("browser.header.recent");
      case "trash": return t("browser.header.trash");
      case "archived": return t("browser.header.archived");
      case "backups":
        // The Backups view is rooted at `/TeleDrive Backups/<device>/...`,
        // so render the device segment as the header. Falls back to the
        // generic "Backups" label when the user is at the top level.
        if (folderPath === "/TeleDrive Backups") return t("browser.header.backups");
        if (folderPath && folderPath.startsWith("/TeleDrive Backups/")) {
          const segments = folderPath.split("/").filter(Boolean);
          return segments[segments.length - 1] || t("browser.header.backups");
        }
        return t("browser.header.backups");
      case "search": return t("browser.header.searchResults", { query: searchQuery });
      default:
        if (folderPath !== "/") {
          const segments = folderPath.split("/").filter(Boolean);
          return segments[segments.length - 1] || t("browser.header.myDrive");
        }
        return t("browser.header.myDrive");
    }
  }, [mode, folderPath, searchQuery, t]);

  // ── Memoized callbacks ──────────────────────────────────────────────────

  const toastPreview = useCallback((file: TeleFile) => {
    window.dispatchEvent(new CustomEvent("teledrive-preview-file", { detail: file }));
  }, []);

  const handleEdit = useCallback((file: TeleFile) => {
    window.dispatchEvent(new CustomEvent("teledrive-edit-file", { detail: file }));
  }, []);

  const handleDownload = useCallback((file: TeleFile) => {
    window.dispatchEvent(new CustomEvent("teledrive-download-file", { detail: file }));
  }, []);

  const handleOpenSystemApp = useCallback(async (file: TeleFile) => {
    try {
      const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
      const { openPath } = await import("@tauri-apps/plugin-opener");
      const { exists } = await import("@tauri-apps/plugin-fs");
      const { downloadFileToBuffer } = await import("@/lib/telegram/downloader");
      const { saveBinaryFile } = await import("@/lib/storage/safeFileWriter");
      const { readOfflineCache, isCachedOffline } = await import("@/lib/storage/offlineStorage");

      const cacheDir = await appLocalDataDir();
      const safeName = file.name.replace(/[/\\?%*:|"<>]/g, "_").trim() || "file";
      const tempFilePath = await join(cacheDir, `temp_${file.id}_${safeName}`);

      let fileReady = false;
      try {
        fileReady = await exists(tempFilePath);
      } catch (_) {
        fileReady = false;
      }

      if (!fileReady) {
        if (file.offline && (await isCachedOffline(file.id))) {
          const offlineBuf = await readOfflineCache(file.id);
          await saveBinaryFile(tempFilePath, offlineBuf);
        } else {
          toast.info(t("browser.systemApp.preparing", { name: file.name }));
          const buf = await downloadFileToBuffer(file.channelId, file.messageId);
          await saveBinaryFile(tempFilePath, buf);
        }
      }

      try {
        await openPath(tempFilePath);
      } catch (openerErr) {
        console.warn("plugin-opener failed, invoking native open_file_in_system_viewer:", openerErr);
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("open_file_in_system_viewer", { path: tempFilePath });
      }
      toast.success(t("browser.systemApp.opened", { name: file.name }));
    } catch (err: any) {
      console.error("Failed to open file in system app:", err);
      toast.error(t("browser.systemApp.failed", { error: err.message || t("browser.systemApp.unknownError") }));
    }
  }, [t]);

  const triggerUpload = useCallback(() => {
    window.dispatchEvent(new CustomEvent("teledrive-trigger-upload"));
  }, []);


  const handleItemDoubleClick = useCallback((file: TeleFile) => {
    if (suppressClickRef.current) return;
    const isDir = file.mime === "inode/directory" || file.mime === "application/x-directory";
    if (isDir) {
      clearSelection();
      const fullPath = file.folderPath === "/" ? `/${file.name}` : `${file.folderPath}/${file.name}`;
      // Backups folders live under `/TeleDrive Backups/...`; route them
      // through the dedicated Backups sub-route so the user stays in
      // the read-only Backups view rather than landing on a 404.
      //
      // The wildcard after `/drive/backups/folder/` carries the path
      // RELATIVE to BACKUP_ROOT — e.g. `Mac (macOS)/Documents`, not the
      // full `/TeleDrive Backups/Mac (macOS)/Documents`. BackupsFolderPage
      // prepends BACKUP_ROOT when reconstructing the folderPath, so a
      // duplicated prefix here would produce a non-existent bucket and
      // the user would see an empty listing.
      if (mode === "backups") {
        const relative =
          fullPath === BACKUP_ROOT
            ? ""
            : fullPath.startsWith(BACKUP_ROOT_PREFIX)
            ? fullPath.substring(BACKUP_ROOT_PREFIX.length)
            : fullPath.replace(/^\/+/, "");
        navigate(`/drive/backups/folder${relative ? `/${relative}` : ""}`);
      } else {
        navigate(`/drive/folder${fullPath}`);
      }
    } else {
      toastPreview(file);
    }
  }, [clearSelection, navigate, toastPreview, mode]);

  const handleItemClick = useCallback((e: React.MouseEvent, file: TeleFile) => {
    if (suppressClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
    }
    const isDir = file.mime === "inode/directory" || file.mime === "application/x-directory";
    // On mobile touch devices without active multi-selection, single-tap a directory to navigate directly
    if (isMobile && selectedIds.length === 0 && isDir) {
      handleItemDoubleClick(file);
      return;
    }
    toggleSelect(file.id);
  }, [isMobile, selectedIds.length, handleItemDoubleClick, toggleSelect]);

  // Dialog actions
  const handleCreateFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newFolderName.trim()) {
      createFolder(newFolderName);
      setNewFolderName("");
      setCreateDialogOpen(false);
    }
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (renameTarget && newFileName.trim()) {
      renameFile(renameTarget.id, newFileName);
      setNewFileName("");
      setRenameTarget(null);
      setRenameDialogOpen(false);
    }
  };

  const openRenameDialog = useCallback((file: TeleFile) => {
    setRenameTarget(file);
    setNewFileName(file.name);
    setRenameDialogOpen(true);
  }, []);

  // Listen to keyboard shortcut events
  useEffect(() => {
    const handleRenameEvent = (e: Event) => {
      const file = (e as CustomEvent).detail as TeleFile;
      if (file) {
        openRenameDialog(file);
      }
    };
    
    const handleDeleteSelected = () => {
      if (selectedIds.length > 0) {
        setBulkDeleteDialogOpen(true);
      }
    };

    const handleCreateFolderTrigger = () => {
      setCreateDialogOpen(true);
    };

    window.addEventListener("teledrive-rename-file-event", handleRenameEvent);
    window.addEventListener("teledrive-delete-selected", handleDeleteSelected);
    window.addEventListener("teledrive-trigger-create-folder", handleCreateFolderTrigger);
    return () => {
      window.removeEventListener("teledrive-rename-file-event", handleRenameEvent);
      window.removeEventListener("teledrive-delete-selected", handleDeleteSelected);
      window.removeEventListener("teledrive-trigger-create-folder", handleCreateFolderTrigger);
    };
  }, [openRenameDialog, deletePermanently, selectedIds, clearSelection]);

  const handleTouchStartItem = (file: TeleFile) => {
    if (!isMobile) return;
    if (touchTimeoutRef.current) window.clearTimeout(touchTimeoutRef.current);
    touchTimeoutRef.current = window.setTimeout(() => {
      setMobileContextFile(file);
    }, 600);
  };

  const handleTouchEndItem = () => {
    if (touchTimeoutRef.current) {
      window.clearTimeout(touchTimeoutRef.current);
      touchTimeoutRef.current = null;
    }
  };

  // Bulk actions
  const handleBulkTrash = async () => {
    await moveMultipleToTrash(selectedIds);
    clearSelection();
  };

  const handleBulkRestore = async () => {
    await restoreMultipleFromTrash(selectedIds);
    clearSelection();
  };

  const handleBulkDelete = () => {
    setBulkDeleteDialogOpen(true);
  };

  const confirmBulkDelete = async () => {
    setBulkDeleteDialogOpen(false);
    await deleteMultiplePermanently(selectedIds);
    clearSelection();
  };

  // Render helpers (headerTitle is now memoized above)

  const renderEmptyState = () => {
    let title = t("browser.emptyState.drive.title");
    let subtitle = t("browser.emptyState.drive.subtitle");
    let Icon = FolderOpen;

    if (mode === "starred") {
      title = t("browser.emptyState.starred.title");
      subtitle = t("browser.emptyState.starred.subtitle");
      Icon = Star;
    } else if (mode === "recent") {
      title = t("browser.emptyState.recent.title");
      subtitle = t("browser.emptyState.recent.subtitle");
      Icon = FileCheck;
    } else if (mode === "trash") {
      title = t("browser.emptyState.trash.title");
      subtitle = t("browser.emptyState.trash.subtitle");
      Icon = Trash2;
    } else if (mode === "archived") {
      title = t("browser.emptyState.archived.title");
      subtitle = t("browser.emptyState.archived.subtitle");
      Icon = Archive;
    } else if (mode === "search") {
      title = t("browser.emptyState.search.title");
      subtitle = t("browser.emptyState.search.subtitle", { query: searchQuery });
      Icon = FolderOpen;
    } else if (mode === "backups") {
      title = t("browser.emptyState.backups.title");
      subtitle = t("browser.emptyState.backups.subtitle");
      Icon = Shield;
    } else if (folderPath !== "/") {
      title = t("browser.emptyState.folder.title");
      subtitle = t("browser.emptyState.folder.subtitle");
      Icon = Folder;
    }

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto animate-slide-up-fade">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-brand-100/40 dark:bg-brand-950/20 blur-xl rounded-full scale-150 animate-pulse" />
          <Icon className="relative h-16 w-16 text-brand-500/80 stroke-[1.5]" />
        </div>

        <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 mb-1">
          {title}
        </h3>

        <p className="text-xs text-muted-foreground mb-6 leading-relaxed">
          {subtitle}
        </p>

        {mode === "drive" && (
          <div className="flex gap-3 justify-center">
            <Button
              onClick={triggerUpload}
              className="rounded-xl bg-brand-500 hover:bg-brand-600 font-semibold px-5 text-sm shadow-sm"
            >
              <Upload className="mr-2 h-4 w-4" />
              {t("browser.emptyState.uploadFiles")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(true)}
              className="rounded-xl font-semibold px-5 text-sm border-slate-200 dark:border-slate-800"
            >
              <FolderPlus className="mr-2 h-4 w-4" />
              {t("browser.emptyState.newFolder")}
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn("flex flex-col h-full p-4 md:p-6 lg:p-7 space-y-4", isDraggingActive && "dragging-active")}>
      {/* File Browser Header Toolbar: Google Drive style */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-slate-200/70 dark:border-slate-800/60 pb-3 shrink-0">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-[#1f1f1f] dark:text-[#e3e3e3]">
            {headerTitle}
          </h1>
          {(mode === "drive" || mode === "backups") && breadcrumbs.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-[#444746] dark:text-[#c4c7c5] overflow-x-auto whitespace-nowrap py-0.5">
              {mode === "drive" ? (
                <Link
                  to="/drive/my-drive"
                  onClick={clearSelection}
                  onDragOver={(e) => handleDragOverCard(e, "crumb_home")}
                  onDrop={(e) => handleDrop(e, "/")}
                  data-drop-path="/"
                  className={cn(
                    "flex items-center gap-1 hover:text-[#0b57d0] dark:hover:text-[#a8c7fa] transition-colors font-medium text-[#444746] dark:text-[#c4c7c5] px-1.5 py-0.5 rounded-md",
                    isDraggingActive && "pointer-events-none-children",
                    dragOverId === "crumb_home" && "bg-[#c2e7ff] text-[#001d35] dark:bg-[#004a77] dark:text-[#c2e7ff]"
                  )}
                >
                  <Home className="h-3.5 w-3.5 shrink-0" />
                  <span>{t("browser.header.myDrive")}</span>
                </Link>
              ) : (
                <Link
                  to="/drive/backups"
                  onClick={clearSelection}
                  className={cn(
                    "flex items-center gap-1 hover:text-[#0b57d0] dark:hover:text-[#a8c7fa] transition-colors font-medium text-[#444746] dark:text-[#c4c7c5] px-1.5 py-0.5 rounded-md",
                    isDraggingActive && "pointer-events-none-children",
                  )}
                >
                  <Shield className="h-3.5 w-3.5 shrink-0" />
                  <span>{t("browser.header.backups")}</span>
                </Link>
              )}

              {breadcrumbs.map((crumb, idx) => (
                <div key={crumb.link} className="flex items-center gap-1 shrink-0">
                  <ChevronRight className="h-3.5 w-3.5 text-[#747775] dark:text-[#8e918f] shrink-0" />
                  {idx === breadcrumbs.length - 1 ? (
                    <span className="font-semibold text-[#1f1f1f] dark:text-[#e3e3e3] px-2 py-0.5 rounded-md bg-[#f0f4f9] dark:bg-[#282a2c]">
                      {crumb.name}
                    </span>
                  ) : (
                    <Link
                      to={crumb.link}
                      onClick={clearSelection}
                      onDragOver={mode !== "backups" ? (e) => handleDragOverCard(e, `crumb_${crumb.link}`) : undefined}
                      onDrop={mode !== "backups" ? (e) => {
                        const drivePrefix = "/drive/folder";
                        const backupsPrefix = "/drive/backups/folder";
                        let targetPath: string;
                        if (crumb.link.startsWith(backupsPrefix)) {
                          targetPath = crumb.link.substring(backupsPrefix.length);
                        } else {
                          targetPath = crumb.link.substring(drivePrefix.length);
                        }
                        handleDrop(e, targetPath);
                      } : undefined}
                      data-drop-path={
                        mode === "backups"
                          ? undefined
                          : ((crumb.link.startsWith("/drive/backups/folder")
                            ? crumb.link.substring("/drive/backups/folder".length)
                            : crumb.link.substring("/drive/folder".length)) || "/")
                      }
                      className={cn(
                        "hover:text-[#0b57d0] dark:hover:text-[#a8c7fa] transition-colors font-medium text-[#444746] dark:text-[#c4c7c5] px-1.5 py-0.5 rounded-md",
                        isDraggingActive && "pointer-events-none-children",
                        dragOverId === `crumb_${crumb.link}` && "bg-[#c2e7ff] text-[#001d35] dark:bg-[#004a77] dark:text-[#c2e7ff]"
                      )}
                    >
                      {crumb.name}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 self-end sm:self-auto sm:mt-1">
          {mode === "trash" && displayFiles.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEmptyTrashDialogOpen(true)}
              className="h-8.5 rounded-full text-xs border-red-300 text-red-600 dark:border-red-900/60 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 font-medium cursor-pointer mr-1"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {t("browser.emptyTrashButton")}
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
            className="h-9 w-9 rounded-full hover:bg-[#e9eef6] dark:hover:bg-[#282a2c] text-[#444746] dark:text-[#c4c7c5] cursor-pointer"
            title={viewMode === "grid" ? t("browser.switchToListView") : t("browser.switchToGridView")}
          >
            {viewMode === "grid" ? (
              <List className="h-4.5 w-4.5" />
            ) : (
              <Grid className="h-4.5 w-4.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Read-only banner for Backups */}
      {mode === "backups" && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-2xl border border-emerald-200/80 dark:border-emerald-800/40 bg-emerald-50/70 dark:bg-emerald-950/20 text-xs text-emerald-900 dark:text-emerald-200 shrink-0">
          <Shield className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="flex-1 min-w-0 leading-relaxed">
            <p className="font-bold">{t("browser.backupsBanner.title")}</p>
            <p className="mt-0.5 text-emerald-900/80 dark:text-emerald-300/80">
              <Trans
                t={t}
                i18nKey="browser.backupsBanner.description"
                components={{
                  settingsPath: <span className="font-mono text-[11px] bg-emerald-100/70 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded" />,
                }}
              />
            </p>
          </div>
        </div>
      )}

      {/* Filters and Sorting: Google Drive filter chips & sort */}
      <div className="flex flex-wrap items-center justify-between gap-3 py-0.5 shrink-0 select-none">
        {/* Category Filter Chips */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar scroll-smooth py-0.5 max-w-full">
          {[
            { value: "All", labelKey: "browser.filters.all" },
            { value: "Documents", labelKey: "browser.filters.documents" },
            { value: "Images", labelKey: "browser.filters.images" },
            { value: "Videos", labelKey: "browser.filters.videos" },
            { value: "Audio", labelKey: "browser.filters.audio" },
          ].map(({ value: filter, labelKey }) => {
            const isActive = filterType === filter;
            return (
              <button
                key={filter}
                type="button"
                onClick={() => setFilterType(filter)}
                className={cn(
                  "px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-all duration-150 cursor-pointer whitespace-nowrap active:scale-95 inline-flex items-center gap-1.5",
                  isActive
                    ? "bg-[#c2e7ff] text-[#001d35] border-transparent font-semibold dark:bg-[#004a77] dark:text-[#c2e7ff] shadow-xs"
                    : "bg-white dark:bg-[#1e1f20] border-slate-300/70 dark:border-slate-700/70 text-[#444746] dark:text-[#c4c7c5] hover:bg-[#f0f4f9] dark:hover:bg-[#282a2c] hover:text-[#1f1f1f] dark:hover:text-[#e3e3e3]"
                )}
              >
                {isActive && <Check className="h-3.5 w-3.5 text-[#001d35] dark:text-[#c2e7ff]" />}
                {t(labelKey)}
              </button>
            );
          })}
        </div>

        {/* Sort Dropdown */}
        <div className="flex items-center gap-2 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-lg text-xs font-medium text-[#444746] dark:text-[#c4c7c5] hover:bg-[#f0f4f9] dark:hover:bg-[#282a2c] border border-slate-300/70 dark:border-slate-700/70 px-3 flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                <span>{t("browser.sort.label", { sort: sortLabel })}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-48 rounded-xl p-1 bg-white dark:bg-[#282a2c] border border-slate-200 dark:border-slate-800 shadow-xl z-50"
            >
              {[
                { value: "name_asc", labelKey: "browser.sort.options.nameAsc" },
                { value: "name_desc", labelKey: "browser.sort.options.nameDesc" },
                { value: "date_desc", labelKey: "browser.sort.options.dateDesc" },
                { value: "date_asc", labelKey: "browser.sort.options.dateAsc" },
                { value: "size_desc", labelKey: "browser.sort.options.sizeDesc" },
                { value: "size_asc", labelKey: "browser.sort.options.sizeAsc" },
              ].map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setSortBy(opt.value)}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 text-xs rounded-lg cursor-pointer hover:bg-[#f0f4f9] dark:hover:bg-[#333537] text-[#1f1f1f] dark:text-[#e3e3e3]",
                    sortBy === opt.value && "font-bold text-[#0b57d0] dark:text-[#a8c7fa] bg-[#c2e7ff]/30 dark:bg-[#004a77]/30"
                  )}
                >
                  <span>{t(opt.labelKey)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Main Files Display Area */}
      {isLoading ? (
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4 overflow-y-auto">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-3 animate-pulse space-y-3"
            >
              <div className="h-10 w-10 bg-slate-200 dark:bg-slate-800 rounded-xl" />
              <div className="space-y-1.5">
                <div className="h-3 w-3/4 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="h-2 w-1/2 bg-slate-200 dark:bg-slate-800 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : displayFiles.length === 0 ? (
        renderEmptyState()
      ) : viewMode === "grid" ? (
        /* GRID VIEW */
        <div
          className="flex-1 overflow-y-auto min-h-0 select-none pb-20 pr-1 space-y-8"
          onDragOver={handleGlobalDragOver}
          onDrop={handleGlobalDrop}
          onScroll={handleScroll}
        >
          {/* Folders Section */}
          {folders.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-semibold text-[#444746] dark:text-[#c4c7c5] tracking-wide block">
                {folders.length > renderLimit
                  ? t("browser.sections.foldersPartial", { shown: Math.min(folders.length, renderLimit), total: folders.length })
                  : t("browser.sections.folders")}
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 px-0.5">
                {folders.slice(0, renderLimit).map((folder, index) => {
                  const isSelected = selectedIdsSet.has(folder.id);
                  const isBeingDragged = draggedId !== null && (draggedId === folder.id || (isSelected && selectedIdsSet.has(draggedId)));
                  return (
                    <FileContextMenu
                      key={folder.id}
                      file={folder}
                      onPreview={toastPreview}
                      onEdit={handleEdit}
                      onDownload={handleDownload}
                      onRename={openRenameDialog}
                      onStarToggle={toggleStar}
                      onTrash={moveToTrash}
                      onDeletePermanently={setDeleteTarget}
                      onArchive={archiveFile}
                      onUnarchive={unarchiveFile}
                    >
                      <div
                        onClick={(e) => handleItemClick(e, folder)}
                        onDoubleClick={() => handleItemDoubleClick(folder)}
                        onMouseDown={(e) => handlePointerDown(e, folder, "folder-grid")}
                        onTouchStart={() => handleTouchStartItem(folder)}
                        onTouchEnd={handleTouchEndItem}
                        onTouchMove={handleTouchEndItem}
                        data-folder-id={folder.id}
                        style={{ animationDelay: `${Math.min(index, 15) * 20}ms` }}
                        className={cn(
                          "group relative flex items-center justify-between gap-3 h-12 px-3.5 rounded-xl transition-all duration-150 cursor-pointer select-none border border-transparent hover:border-slate-300/80 dark:hover:border-slate-700/80",
                          isSelected
                            ? "bg-[#c2e7ff] text-[#001d35] dark:bg-[#004a77] dark:text-[#c2e7ff] font-medium shadow-xs border-transparent"
                            : dragOverId === folder.id
                            ? "bg-[#c2e7ff]/60 dark:bg-[#004a77]/60 ring-2 ring-[#0b57d0]"
                            : "bg-[#f0f4f9] dark:bg-[#282a2c] hover:bg-[#e1e7ef] dark:hover:bg-[#333537] text-[#1f1f1f] dark:text-[#e3e3e3]",
                          isBeingDragged && "opacity-40"
                        )}
                      >
                        {/* Drop-target "+" badge */}
                        {dragOverId === folder.id && isDraggingActive && (
                          <span className="absolute -right-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[#0b57d0] text-white shadow-md ring-2 ring-white dark:ring-[#1e1f20] pointer-events-none animate-folder-drop-badge">
                            <Plus className="h-3.5 w-3.5" />
                          </span>
                        )}
                        <div className="flex items-center gap-3 min-w-0 flex-1 pointer-events-none">
                          <FolderIcon
                            size="sm"
                            className={cn(
                              "h-5 w-5 shrink-0 transition-transform duration-200 group-hover:scale-105",
                              isSelected
                                ? "text-[#001d35] dark:text-[#c2e7ff]"
                                : "text-[#444746] dark:text-[#c4c7c5]"
                            )}
                          />
                          <span className="text-xs md:text-sm font-medium truncate">
                            {folder.name}
                          </span>
                        </div>
                        <div className="shrink-0 ml-auto opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity" data-no-drag onClick={(e) => e.stopPropagation()}>
                          <FileActionsMenu
                            file={folder}
                            onPreview={toastPreview}
                            onEdit={handleEdit}
                            onDownload={handleDownload}
                            onRename={openRenameDialog}
                            onStarToggle={toggleStar}
                            onTrash={moveToTrash}
                            onDeletePermanently={setDeleteTarget}
                            onArchive={archiveFile}
                            onUnarchive={unarchiveFile}
                          />
                        </div>
                      </div>
                    </FileContextMenu>
                  );
                })}
              </div>
            </div>
          )}

          {/* Files Section */}
          {regularFiles.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-semibold text-[#444746] dark:text-[#c4c7c5] tracking-wide block">
                {regularFiles.length > renderLimit
                  ? t("browser.sections.filesPartial", { shown: Math.min(regularFiles.length, renderLimit), total: regularFiles.length })
                  : t("browser.sections.files")}
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4 px-0.5">
                {regularFiles.slice(0, renderLimit).map((file, index) => {
                  const isSelected = selectedIdsSet.has(file.id);
                  return (
                    <FileContextMenu
                      key={file.id}
                      file={file}
                      onPreview={toastPreview}
                      onOpenInSystemApp={handleOpenSystemApp}
                      onEdit={handleEdit}
                      onDownload={handleDownload}
                      onRename={openRenameDialog}
                      onStarToggle={toggleStar}
                      onTrash={moveToTrash}
                      onDeletePermanently={setDeleteTarget}
                      onArchive={archiveFile}
                      onUnarchive={unarchiveFile}
                      onOfflineToggle={toggleOffline}
                    >
                      <div
                        onClick={(e) => handleItemClick(e, file)}
                        onDoubleClick={() => handleItemDoubleClick(file)}
                        onMouseDown={(e) => handlePointerDown(e, file, "file-grid")}
                        onTouchStart={() => handleTouchStartItem(file)}
                        onTouchEnd={handleTouchEndItem}
                        onTouchMove={handleTouchEndItem}
                        style={{ animationDelay: `${Math.min(folders.length + index, 15) * 20}ms` }}
                        className={cn(
                          "group relative flex flex-col rounded-2xl transition-all duration-150 cursor-pointer overflow-hidden text-left select-none h-52 bg-white dark:bg-[#1e1f20] hover:bg-[#f8fafd] dark:hover:bg-[#282a2c] border border-slate-200/90 dark:border-slate-800/90 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md",
                          isSelected
                            ? "bg-[#c2e7ff]/30 dark:bg-[#004a77]/30 ring-2 ring-[#0b57d0] dark:ring-[#a8c7fa] border-transparent shadow-xs"
                            : "",
                          (draggedId !== null && (draggedId === file.id || (isSelected && selectedIdsSet.has(draggedId)))) && "opacity-40"
                        )}
                      >
                        {/* Top bar with mini typed icon, title, and action menu */}
                        <div className="flex items-center justify-between gap-1.5 px-3.5 pt-3 pb-1 shrink-0">
                          <div className="flex items-center gap-2 min-w-0 flex-1 pointer-events-none">
                            <FileIcon name={file.name} mime={file.mime} size="sm" bare className="shrink-0" />
                            <p className="text-xs font-medium text-[#1f1f1f] dark:text-[#e3e3e3] truncate">
                              {file.name}
                            </p>
                          </div>
                          <div className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity" data-no-drag onClick={(e) => e.stopPropagation()}>
                            <FileActionsMenu
                              file={file}
                              onPreview={toastPreview}
                              onEdit={handleEdit}
                              onDownload={handleDownload}
                              onRename={openRenameDialog}
                              onStarToggle={toggleStar}
                              onTrash={moveToTrash}
                              onDeletePermanently={setDeleteTarget}
                              onArchive={archiveFile}
                              onUnarchive={unarchiveFile}
                              onOfflineToggle={toggleOffline}
                            />
                          </div>
                        </div>

                        {/* Centered Preview Canvas */}
                        <div className="flex-1 bg-[#f8fafd] dark:bg-[#131314]/80 mx-2.5 my-1 rounded-xl border border-slate-100 dark:border-slate-800/80 flex items-center justify-center relative overflow-hidden pointer-events-none">
                          {file.thumbnailUrl ? (
                            <img
                              src={file.thumbnailUrl}
                              alt={file.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-16 h-20 bg-white dark:bg-[#202124] rounded-md shadow-xs border border-slate-200/80 dark:border-slate-700/80 p-2 flex flex-col items-center justify-between pointer-events-none select-none">
                              <div className="w-full space-y-1 mt-0.5 opacity-40">
                                <div className="h-0.5 bg-slate-300 dark:bg-slate-600 rounded-full w-full" />
                                <div className="h-0.5 bg-slate-300 dark:bg-slate-600 rounded-full w-4/5" />
                                <div className="h-0.5 bg-slate-300 dark:bg-slate-600 rounded-full w-3/5" />
                              </div>
                              <div className="my-auto py-0.5">
                                <FileIcon name={file.name} mime={file.mime} size="md" bare />
                              </div>
                              <div className="w-full space-y-1 mb-0.5 opacity-30">
                                <div className="h-0.5 bg-slate-300 dark:bg-slate-600 rounded-full w-full" />
                                <div className="h-0.5 bg-slate-300 dark:bg-slate-600 rounded-full w-2/3" />
                              </div>
                            </div>
                          )}

                          {file.starred && (
                            <Star className="absolute top-2 right-2 h-4 w-4 fill-amber-400 text-amber-400 drop-shadow-xs" />
                          )}
                          {file.offline && (
                            <CheckCircle className="absolute top-2 left-2 h-4 w-4 text-emerald-500 fill-emerald-500/20 shrink-0" />
                          )}
                        </div>

                        {/* Bottom details footer */}
                        <div className="px-3.5 py-2 flex items-center justify-between text-[11px] text-[#747775] dark:text-[#8e918f] pointer-events-none shrink-0 font-normal">
                          <span>{formatFileSize(file.size)}</span>
                          <span>{new Date(file.uploadedAt).toLocaleDateString(i18n.language, { month: "short", day: "numeric" })}</span>
                        </div>
                      </div>
                    </FileContextMenu>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* LIST VIEW */
        <div
          className="flex-1 overflow-y-auto min-h-0 select-none pb-20 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl bg-white dark:bg-[#1e1f20] shadow-xs"
          onDragOver={handleGlobalDragOver}
          onDrop={handleGlobalDrop}
          onScroll={handleScroll}
        >
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-[#444746] dark:text-[#8e918f] select-none bg-slate-50/70 dark:bg-[#202124]/50">
                <th className="py-3 px-4 w-12 text-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === displayFiles.length && displayFiles.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(displayFiles.map((f) => f.id));
                      } else {
                        clearSelection();
                      }
                    }}
                    className="h-4 w-4 rounded-sm border-slate-300 dark:border-slate-700 text-[#0b57d0] focus:ring-[#0b57d0]/20 dark:bg-slate-900 transition-colors cursor-pointer"
                  />
                </th>
                <th className="py-3 px-4 font-semibold">{t("browser.columns.name")}</th>
                <th className="py-3 px-4 hidden sm:table-cell font-semibold">{t("browser.columns.type")}</th>
                <th className="py-3 px-4 hidden md:table-cell font-semibold">{t("browser.columns.fileSize")}</th>
                <th className="py-3 px-4 hidden lg:table-cell font-semibold">{t("browser.columns.lastModified")}</th>
                <th className="py-3 px-4 w-14"></th>
              </tr>
            </thead>
            <tbody>
              {displayFiles.slice(0, renderLimit).map((file, index) => {
                const isSelected = selectedIdsSet.has(file.id);
                const isDir = file.mime === "inode/directory" || file.mime === "application/x-directory";
                
                return (
                  <FileContextMenu
                    key={file.id}
                    file={file}
                    onPreview={toastPreview}
                    onOpenInSystemApp={handleOpenSystemApp}
                    onEdit={handleEdit}
                    onDownload={handleDownload}
                    onRename={openRenameDialog}
                    onStarToggle={toggleStar}
                    onTrash={moveToTrash}
                    onDeletePermanently={setDeleteTarget}
                    onArchive={archiveFile}
                    onUnarchive={unarchiveFile}
                    onOfflineToggle={toggleOffline}
                  >
                    <tr
                      onClick={(e) => handleItemClick(e, file)}
                      onDoubleClick={() => handleItemDoubleClick(file)}
                      onMouseDown={(e) => handlePointerDown(e, file, "list-row")}
                      onTouchStart={() => handleTouchStartItem(file)}
                      onTouchEnd={handleTouchEndItem}
                      onTouchMove={handleTouchEndItem}
                      {...(isDir ? { 'data-folder-id': file.id } : {})}
                      style={{ animationDelay: `${Math.min(index, 15) * 20}ms` }}
                      className={cn(
                        "group border-b border-slate-100 dark:border-slate-800/50 hover:bg-[#f0f4f9] dark:hover:bg-[#282a2c] cursor-pointer transition-colors duration-100 h-12",
                        isSelected && "bg-[#c2e7ff]/40 dark:bg-[#004a77]/35 text-[#001d35] dark:text-[#c2e7ff]",
                        dragOverId === file.id && isDir && "bg-[#c2e7ff]/70 dark:bg-[#004a77]/70 ring-2 ring-[#0b57d0]",
                        (draggedId !== null && (draggedId === file.id || (isSelected && selectedIdsSet.has(draggedId)))) && "opacity-40"
                      )}
                    >
                      <td className="py-3 px-4 text-center" data-no-drag onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(file.id)}
                          className="h-4 w-4 rounded-sm border-slate-300 dark:border-slate-700 text-[#0b57d0] focus:ring-[#0b57d0]/20 dark:bg-slate-900 transition-colors cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 font-medium text-[#1f1f1f] dark:text-[#e3e3e3] text-xs md:text-sm">
                        <div className="flex items-center gap-3 pointer-events-none">
                          <FileIcon name={file.name} mime={file.mime} size="sm" className="shrink-0" />
                          <span className="truncate max-w-[200px] sm:max-w-xs">{file.name}</span>
                          {file.starred && (
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 shrink-0 ml-0.5" />
                          )}
                          {file.offline && (
                            <CheckCircle className="h-3.5 w-3.5 text-emerald-500 fill-emerald-500/20 shrink-0 ml-0.5" />
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 hidden sm:table-cell text-xs text-[#444746] dark:text-[#8e918f] pointer-events-none">
                        {getFileType(file, t)}
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell text-xs text-[#444746] dark:text-[#8e918f] pointer-events-none">
                        {isDir ? "—" : formatFileSize(file.size)}
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell text-xs text-[#444746] dark:text-[#8e918f] pointer-events-none">
                        {new Date(file.uploadedAt).toLocaleDateString(i18n.language)}
                      </td>
                      <td className="py-3 px-4 text-center" data-no-drag onClick={(e) => e.stopPropagation()}>
                        <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                          <FileActionsMenu
                            file={file}
                            onPreview={toastPreview}
                            onEdit={handleEdit}
                            onDownload={handleDownload}
                            onRename={openRenameDialog}
                            onStarToggle={toggleStar}
                            onTrash={moveToTrash}
                            onDeletePermanently={setDeleteTarget}
                            onArchive={archiveFile}
                            onUnarchive={unarchiveFile}
                            onOfflineToggle={toggleOffline}
                          />
                        </div>
                      </td>
                    </tr>
                  </FileContextMenu>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {internalDrag && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-50 pointer-events-none rounded-2xl shadow-2xl"
          style={{
            left: internalDrag.x - internalDrag.offsetX,
            top: internalDrag.y - internalDrag.offsetY,
            width: internalDrag.width,
            height: internalDrag.height,
          }}
        >
          {internalDrag.previewVariant === "folder-grid" ? (
            <div className="h-full rounded-xl border border-brand-200/90 bg-white/96 dark:border-slate-700/90 dark:bg-slate-900/96 backdrop-blur-md px-3.5 pr-3.5 flex items-center justify-between gap-3 shadow-[0_16px_32px_-20px_rgba(15,23,42,0.45)]">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <Folder className="h-5 w-5 text-brand-500 fill-brand-500/10 shrink-0 stroke-[1.5]" />
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                  {internalDrag.previewFile.name}
                </span>
              </div>
              <MoreHorizontal className="h-4 w-4 text-slate-400 shrink-0" />
            </div>
          ) : internalDrag.previewVariant === "list-row" ? (
            <div className="h-full rounded-xl border border-slate-200/90 dark:border-slate-800/90 bg-white/96 dark:bg-slate-900/96 backdrop-blur-md flex items-center gap-3 px-4 shadow-[0_16px_32px_-20px_rgba(15,23,42,0.45)]">
              <FileIcon
                name={internalDrag.previewFile.name}
                mime={internalDrag.previewFile.mime}
                size="sm"
                className="shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                  {internalDrag.previewFile.name}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {internalDrag.ids.length > 1 ? t("browser.dragPreview.items", { count: internalDrag.ids.length }) : formatFileSize(internalDrag.previewFile.size)}
                </p>
              </div>
              <MoreHorizontal className="h-4 w-4 text-slate-400 shrink-0" />
            </div>
          ) : (
            <div className="h-full rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white/96 dark:bg-slate-950/96 backdrop-blur-md overflow-hidden shadow-[0_20px_40px_-24px_rgba(15,23,42,0.5)]">
              <div className="flex-1 h-[calc(100%-51px)] min-h-0 bg-slate-50/70 dark:bg-slate-900/40 flex items-center justify-center p-4 border-b border-slate-100 dark:border-slate-800/50">
                <FileIcon name={internalDrag.previewFile.name} mime={internalDrag.previewFile.mime} size="lg" />
              </div>
              <div className="h-[51px] px-3 py-2.5 bg-white/96 dark:bg-slate-950/96">
                <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                  {internalDrag.previewFile.name}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                  {internalDrag.ids.length > 1 ? t("browser.dragPreview.items", { count: internalDrag.ids.length }) : formatFileSize(internalDrag.previewFile.size)}
                </p>
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}

      {/* Floating Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 flex items-center gap-4 bg-white/95 dark:bg-[#282a2c]/95 text-[#1f1f1f] dark:text-[#e3e3e3] px-5 py-2.5 rounded-full shadow-2xl border border-slate-300/80 dark:border-slate-700/80 backdrop-blur-md animate-slide-up select-none">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold bg-[#0b57d0] dark:bg-[#a8c7fa] px-2.5 py-0.5 rounded-full text-white dark:text-[#003258]">{selectedIds.length}</span>
            <span className="text-xs font-medium whitespace-nowrap text-[#1f1f1f] dark:text-[#e3e3e3]">{t("browser.bulkBar.selected", { count: selectedIds.length })}</span>
          </div>
          <div className="h-4 w-px bg-slate-300/80 dark:bg-slate-700/80" />
          
          <div className="flex items-center gap-1.5">
            {mode === "trash" ? (
              <>
                <button
                  type="button"
                  onClick={handleBulkRestore}
                  className="h-8.5 w-8.5 rounded-full flex items-center justify-center text-[#444746] dark:text-[#c4c7c5] hover:text-[#0b57d0] dark:hover:text-[#a8c7fa] hover:bg-[#f0f4f9] dark:hover:bg-[#333537] transition-colors cursor-pointer border-0 bg-transparent outline-none"
                  title={t("browser.bulkBar.restoreSelected")}
                >
                  <RotateCcw className="h-4.5 w-4.5" />
                </button>
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  className="h-8.5 w-8.5 rounded-full flex items-center justify-center text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors cursor-pointer border-0 bg-transparent outline-none"
                  title={t("browser.bulkBar.deletePermanently")}
                >
                  <Trash2 className="h-4.5 w-4.5" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleBulkTrash}
                  className="h-8.5 w-8.5 rounded-full flex items-center justify-center text-[#444746] dark:text-[#c4c7c5] hover:text-red-600 dark:hover:text-red-400 hover:bg-[#f0f4f9] dark:hover:bg-[#333537] transition-colors cursor-pointer border-0 bg-transparent outline-none"
                  title={t("browser.bulkBar.moveSelectedToTrash")}
                >
                  <Trash2 className="h-4.5 w-4.5" />
                </button>
              </>
            )}
            
            <button
              type="button"
              onClick={clearSelection}
              className="h-8.5 w-8.5 rounded-full flex items-center justify-center text-[#747775] dark:text-[#8e918f] hover:text-[#1f1f1f] dark:hover:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537] transition-colors cursor-pointer border-0 bg-transparent outline-none"
              title={t("browser.bulkBar.clearSelection")}
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
      )}

      {/* dialog for creating folder */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="rounded-3xl max-w-sm p-6 bg-white dark:bg-[#1e1f20] border border-slate-200/80 dark:border-slate-800 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-[#1f1f1f] dark:text-[#e3e3e3]">{t("browser.dialogs.createFolder.title")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateFolderSubmit} className="space-y-5 pt-2">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder={t("browser.dialogs.createFolder.placeholder")}
              autoFocus
              className="rounded-xl h-11 px-3.5 border-slate-300 dark:border-slate-700 bg-white dark:bg-[#131314] text-[#1f1f1f] dark:text-[#e3e3e3] focus-visible:ring-2 focus-visible:ring-[#0b57d0]/30"
            />
            <DialogFooter className="gap-2 sm:gap-2 justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateDialogOpen(false)}
                className="rounded-full h-9.5 px-4 text-xs font-medium text-[#0b57d0] dark:text-[#a8c7fa] hover:bg-[#f0f4f9] dark:hover:bg-[#282a2c] cursor-pointer"
              >
                {t("browser.dialogs.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={!newFolderName.trim()}
                className="rounded-full h-9.5 px-5 bg-[#0b57d0] hover:bg-[#0842a0] dark:bg-[#a8c7fa] dark:text-[#003258] text-white text-xs font-semibold shadow-xs cursor-pointer border-0"
              >
                {t("browser.dialogs.createFolder.submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* dialog for renaming file */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="rounded-3xl max-w-sm p-6 bg-white dark:bg-[#1e1f20] border border-slate-200/80 dark:border-slate-800 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-[#1f1f1f] dark:text-[#e3e3e3]">{t("browser.dialogs.rename.title")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRenameSubmit} className="space-y-5 pt-2">
            <Input
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder={t("browser.dialogs.rename.placeholder")}
              autoFocus
              className="rounded-xl h-11 px-3.5 border-slate-300 dark:border-slate-700 bg-white dark:bg-[#131314] text-[#1f1f1f] dark:text-[#e3e3e3] focus-visible:ring-2 focus-visible:ring-[#0b57d0]/30"
            />
            <DialogFooter className="gap-2 sm:gap-2 justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRenameDialogOpen(false)}
                className="rounded-full h-9.5 px-4 text-xs font-medium text-[#0b57d0] dark:text-[#a8c7fa] hover:bg-[#f0f4f9] dark:hover:bg-[#282a2c] cursor-pointer"
              >
                {t("browser.dialogs.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={!newFileName.trim()}
                className="rounded-full h-9.5 px-5 bg-[#0b57d0] hover:bg-[#0842a0] dark:bg-[#a8c7fa] dark:text-[#003258] text-white text-xs font-semibold shadow-xs cursor-pointer border-0"
              >
                {t("browser.dialogs.rename.submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Mobile Context Menu Bottom Sheet */}
      {isMobile && (
        <Sheet open={!!mobileContextFile} onOpenChange={(open) => !open && setMobileContextFile(null)}>
          <SheetContent side="bottom" className="rounded-t-2xl px-6 py-5 max-h-[420px] bg-white dark:bg-slate-900 border-t dark:border-slate-800">
            {mobileContextFile && (
              <div className="space-y-4 select-none">
                <div className="flex items-center gap-3 border-b pb-3">
                  <FileIcon name={mobileContextFile.name} mime={mobileContextFile.mime} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                      {mobileContextFile.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {mobileContextFile.mime === "inode/directory" || mobileContextFile.mime === "application/x-directory"
                        ? t("browser.fileType.folder")
                        : formatFileSize(mobileContextFile.size)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-1 pb-6">
                  {mobileContextFile.mime !== "inode/directory" && mobileContextFile.mime !== "application/x-directory" && !mobileContextFile.trashed && (
                    <button
                      onClick={() => {
                        setMobileContextFile(null);
                        toastPreview(mobileContextFile);
                      }}
                      className="flex items-center gap-3 px-3 py-3 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold text-slate-700 dark:text-slate-200 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <Eye className="h-4 w-4 text-slate-500" />
                      <span>{t("menu.preview")}</span>
                    </button>
                  )}
                  {mobileContextFile.mime !== "inode/directory" && mobileContextFile.mime !== "application/x-directory" && !mobileContextFile.trashed && isEditableFile(mobileContextFile) && (
                    <button
                      onClick={() => {
                        const f = mobileContextFile;
                        setMobileContextFile(null);
                        handleEdit(f);
                      }}
                      className="flex items-center gap-3 px-3 py-3 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold text-slate-700 dark:text-slate-200 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <Edit2 className="h-4 w-4 text-slate-500" />
                      <span>{t("menu.edit")}</span>
                    </button>
                  )}
                  {mobileContextFile.mime !== "inode/directory" && mobileContextFile.mime !== "application/x-directory" && !mobileContextFile.trashed && (
                    <button
                      onClick={() => {
                        setMobileContextFile(null);
                        handleDownload(mobileContextFile);
                      }}
                      className="flex items-center gap-3 px-3 py-3 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold text-slate-700 dark:text-slate-200 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <Download className="h-4 w-4 text-slate-500" />
                      <span>{t("menu.download")}</span>
                    </button>
                  )}
                  {mobileContextFile.mime !== "inode/directory" && mobileContextFile.mime !== "application/x-directory" && !mobileContextFile.trashed && (
                    <button
                      onClick={() => {
                        const f = mobileContextFile;
                        setMobileContextFile(null);
                        toggleOffline(f);
                      }}
                      className="flex items-center justify-between px-3 py-3 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold text-slate-700 dark:text-slate-200 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <div className="flex items-center gap-3">
                        <CheckCircle className={`h-4 w-4 ${mobileContextFile.offline ? "text-green-500 fill-green-500/20" : "text-slate-500"}`} />
                        <span>{t("menu.availableOffline")}</span>
                      </div>
                      {mobileContextFile.offline && <Check className="h-4 w-4 text-green-500 shrink-0" />}
                    </button>
                  )}
                  {!mobileContextFile.trashed && (
                    <button
                      onClick={() => {
                        setMobileContextFile(null);
                        openRenameDialog(mobileContextFile);
                      }}
                      className="flex items-center gap-3 px-3 py-3 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold text-slate-700 dark:text-slate-200 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <Edit2 className="h-4 w-4 text-slate-500" />
                      <span>{t("menu.rename")}</span>
                    </button>
                  )}
                  {!mobileContextFile.trashed && (
                    <button
                      onClick={() => {
                        setMobileContextFile(null);
                        toggleStar(mobileContextFile);
                      }}
                      className="flex items-center gap-3 px-3 py-3 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold text-slate-700 dark:text-slate-200 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <Star className={`h-4 w-4 ${mobileContextFile.starred ? "fill-amber-400 text-amber-400" : "text-slate-500"}`} />
                      <span>{mobileContextFile.starred ? t("browser.mobileMenu.removeFromStarred") : t("browser.mobileMenu.addToStarred")}</span>
                    </button>
                  )}
                  {mobileContextFile.trashed ? (
                    <button
                      onClick={async () => {
                        setMobileContextFile(null);
                        await restoreFromTrash(mobileContextFile);
                      }}
                      className="flex items-center gap-3 px-3 py-3 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold text-slate-700 dark:text-slate-200 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <RotateCcw className="h-4 w-4 text-slate-500" />
                      <span>{t("menu.restore")}</span>
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        setMobileContextFile(null);
                        await moveToTrash(mobileContextFile);
                      }}
                      className="flex items-center gap-3 px-3 py-3 text-sm rounded-xl hover:bg-red-50 dark:hover:bg-red-950/20 text-left font-semibold text-red-600 dark:text-red-400 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <Trash2 className="h-4 w-4 text-slate-500" />
                      <span>{t("menu.moveToTrash")}</span>
                    </button>
                  )}
                  {mobileContextFile.trashed && (
                    <button
                      onClick={() => {
                        const f = mobileContextFile;
                        setMobileContextFile(null);
                        setDeleteTarget(f);
                      }}
                      className="flex items-center gap-3 px-3 py-3 text-sm rounded-xl hover:bg-red-50 dark:hover:bg-red-950/20 text-left font-semibold text-red-600 dark:text-red-400 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>{t("menu.deletePermanently")}</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </SheetContent>
        </Sheet>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Empty Trash confirmation dialog (replaces window.confirm)           */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={emptyTrashDialogOpen} onOpenChange={setEmptyTrashDialogOpen}>
        <DialogContent className="rounded-3xl max-w-sm p-6 bg-white dark:bg-[#1e1f20] border border-slate-200/80 dark:border-slate-800 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-[#1f1f1f] dark:text-[#e3e3e3] flex items-center gap-2">
              <Trash2 className="h-4.5 w-4.5 text-red-600" />
              {t("browser.dialogs.emptyTrash.title")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-[#444746] dark:text-[#8e918f] leading-relaxed mt-1">
            <Trans
              t={t}
              i18nKey="browser.dialogs.emptyTrash.description"
              count={displayFiles.length}
              components={{ strong: <strong /> }}
            />
          </p>
          <DialogFooter className="mt-5 flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full h-9 px-4 text-xs font-medium text-[#444746] dark:text-[#c4c7c5] hover:bg-[#f0f4f9] dark:hover:bg-[#282a2c] cursor-pointer"
              onClick={() => setEmptyTrashDialogOpen(false)}
            >
              {t("browser.dialogs.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={isOperating}
              className="rounded-full h-9 px-5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-xs cursor-pointer border-0"
              onClick={async () => {
                setEmptyTrashDialogOpen(false);
                await emptyTrash();
                clearSelection();
              }}
            >
              {isOperating ? t("browser.dialogs.deleting") : t("browser.dialogs.emptyTrash.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* Individual item permanent delete confirmation dialog               */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="rounded-3xl max-w-sm p-6 bg-white dark:bg-[#1e1f20] border border-slate-200/80 dark:border-slate-800 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-[#1f1f1f] dark:text-[#e3e3e3] flex items-center gap-2">
              <Trash2 className="h-4.5 w-4.5 text-red-600" />
              {t("browser.dialogs.deleteItem.title")}
            </DialogTitle>
          </DialogHeader>
          {deleteTarget && (
            <p className="text-xs text-[#444746] dark:text-[#8e918f] leading-relaxed mt-1">
              <Trans
                t={t}
                i18nKey={
                  deleteTarget.mime !== "inode/directory" && deleteTarget.mime !== "application/x-directory"
                    ? "browser.dialogs.deleteItem.descriptionFile"
                    : "browser.dialogs.deleteItem.descriptionFolder"
                }
                values={{ name: deleteTarget.name }}
                components={{ strong: <strong /> }}
              />
            </p>
          )}
          <DialogFooter className="mt-5 flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full h-9 px-4 text-xs font-medium text-[#444746] dark:text-[#c4c7c5] hover:bg-[#f0f4f9] dark:hover:bg-[#282a2c] cursor-pointer"
              onClick={() => setDeleteTarget(null)}
            >
              {t("browser.dialogs.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={isOperating}
              className="rounded-full h-9 px-5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-xs cursor-pointer border-0"
              onClick={async () => {
                if (deleteTarget) {
                  const targetId = deleteTarget.id;
                  setDeleteTarget(null);
                  await deletePermanently(targetId);
                }
              }}
            >
              {isOperating ? t("browser.dialogs.deleting") : t("browser.dialogs.deleteForever")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ------------------------------------------------------------------ */}
      {/* Bulk permanent delete confirmation dialog                           */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <DialogContent className="rounded-3xl max-w-sm p-6 bg-white dark:bg-[#1e1f20] border border-slate-200/80 dark:border-slate-800 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-[#1f1f1f] dark:text-[#e3e3e3] flex items-center gap-2">
              <Trash2 className="h-4.5 w-4.5 text-red-600" />
              {t("browser.dialogs.bulkDelete.title")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-[#444746] dark:text-[#8e918f] leading-relaxed mt-1">
            <Trans
              t={t}
              i18nKey="browser.dialogs.bulkDelete.description"
              count={selectedIds.length}
              components={{ strong: <strong /> }}
            />
          </p>
          <DialogFooter className="mt-5 flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full h-9 px-4 text-xs font-medium text-[#444746] dark:text-[#c4c7c5] hover:bg-[#f0f4f9] dark:hover:bg-[#282a2c] cursor-pointer"
              onClick={() => setBulkDeleteDialogOpen(false)}
            >
              {t("browser.dialogs.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={isOperating}
              className="rounded-full h-9 px-5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-xs cursor-pointer border-0"
              onClick={confirmBulkDelete}
            >
              {isOperating ? t("browser.dialogs.deleting") : t("browser.dialogs.deleteForever")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
