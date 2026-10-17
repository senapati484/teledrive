import React from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Eye,
  Download,
  Edit2,
  Pencil,
  FolderInput,
  Star,
  Trash2,
  RotateCcw,
  Archive,
  ArchiveRestore,
  CheckCircle,
  Check,
  ExternalLink,
} from "lucide-react";
import { TeleFile } from "@/lib/types";
import { isEditableFile } from "@/lib/files/editableTypes";
import { useTranslation } from "react-i18next";

interface FileContextMenuProps {
  file: TeleFile;
  children: React.ReactNode;
  onPreview: (file: TeleFile) => void;
  onDownload: (file: TeleFile) => void;
  onOpenInSystemApp?: (file: TeleFile) => void;
  onEdit?: (file: TeleFile) => void;
  onRename: (file: TeleFile) => void;
  onStarToggle: (file: TeleFile) => void;
  onTrash: (file: TeleFile) => void;
  onMoveTo?: (file: TeleFile) => void;
  onDeletePermanently?: (file: TeleFile) => void;
  onArchive?: (file: TeleFile) => void;
  onUnarchive?: (file: TeleFile) => void;
  onOfflineToggle?: (file: TeleFile) => void;
}

export const FileContextMenu = React.memo(function FileContextMenu({
  file,
  children,
  onPreview,
  onDownload,
  onOpenInSystemApp,
  onEdit,
  onRename,
  onStarToggle,
  onTrash,
  onMoveTo,
  onDeletePermanently,
  onArchive,
  onUnarchive,
  onOfflineToggle,
}: FileContextMenuProps) {
  const { t } = useTranslation("files");
  const isDirectory = file.mime === "inode/directory" || file.mime === "application/x-directory";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52 rounded-2xl p-1.5 bg-white dark:bg-[#282a2c] border border-slate-200/80 dark:border-slate-800 shadow-xl z-50">
        {!isDirectory && !file.trashed && !file.archived && (
          <ContextMenuItem
            onClick={() => onPreview(file)}
            className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
          >
            <Eye className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5] shrink-0" strokeWidth={1.75} />
            <span>{t("menu.preview")}</span>
          </ContextMenuItem>
        )}
        {!isDirectory && !file.trashed && !file.archived && onOpenInSystemApp && (
          <ContextMenuItem
            onClick={() => onOpenInSystemApp(file)}
            className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
          >
            <ExternalLink className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5] shrink-0" strokeWidth={1.75} />
            <span>{t("menu.openInSystemApp")}</span>
          </ContextMenuItem>
        )}
        {!isDirectory && !file.trashed && !file.archived && onEdit && isEditableFile(file) && (
          <ContextMenuItem
            onClick={() => onEdit(file)}
            className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
          >
            <Pencil className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5] shrink-0" strokeWidth={1.75} />
            <span>{t("menu.edit")}</span>
          </ContextMenuItem>
        )}
        {!isDirectory && !file.trashed && !file.archived && (
          <ContextMenuItem
            onClick={() => onDownload(file)}
            className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
          >
            <Download className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5] shrink-0" strokeWidth={1.75} />
            <span>{t("menu.download")}</span>
          </ContextMenuItem>
        )}
        {!isDirectory && !file.trashed && !file.archived && onOfflineToggle && (
          <ContextMenuItem
            onClick={() => onOfflineToggle(file)}
            className="flex items-center justify-between px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle className={`h-4 w-4 shrink-0 ${file.offline ? "text-emerald-500 fill-emerald-500/20" : "text-[#444746] dark:text-[#c4c7c5]"}`} strokeWidth={1.75} />
              <span>{t("menu.availableOffline")}</span>
            </div>
            {file.offline && <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
          </ContextMenuItem>
        )}

        {!file.trashed && !file.archived && (
          <ContextMenuItem
            onClick={() => onRename(file)}
            className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
          >
            <Edit2 className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5] shrink-0" strokeWidth={1.75} />
            <span>{t("menu.rename")}</span>
          </ContextMenuItem>
        )}

        {onMoveTo && !file.trashed && !file.archived && (
          <ContextMenuItem
            onClick={() => onMoveTo(file)}
            className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
          >
            <FolderInput className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5] shrink-0" strokeWidth={1.75} />
            <span>{t("menu.moveTo")}</span>
          </ContextMenuItem>
        )}

        {!file.trashed && !file.archived && (
          <ContextMenuItem
            onClick={() => onStarToggle(file)}
            className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
          >
            <Star className={`h-4 w-4 shrink-0 ${file.starred ? "fill-amber-400 text-amber-400" : "text-[#444746] dark:text-[#c4c7c5]"}`} strokeWidth={1.75} />
            <span>{file.starred ? t("menu.removeStar") : t("menu.addStar")}</span>
          </ContextMenuItem>
        )}

        {/* Archive / Unarchive */}
        {!file.trashed && !file.archived && onArchive && (
          <>
            <ContextMenuSeparator className="-mx-1.5 my-1 bg-slate-200/70 dark:bg-slate-800/80" />
            <ContextMenuItem
              onClick={() => onArchive(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
            >
              <Archive className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5] shrink-0" strokeWidth={1.75} />
              <span>{t("menu.archive")}</span>
            </ContextMenuItem>
          </>
        )}
        {file.archived && onUnarchive && (
          <ContextMenuItem
            onClick={() => onUnarchive(file)}
            className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
          >
            <ArchiveRestore className="h-4 w-4 text-[#0b57d0] dark:text-[#a8c7fa] shrink-0" strokeWidth={1.75} />
            <span>{t("menu.unarchive")}</span>
          </ContextMenuItem>
        )}

        {/* Trash / Restore / Delete Permanently */}
        {file.trashed ? (
          <>
            <ContextMenuSeparator className="-mx-1.5 my-1 bg-slate-200/70 dark:bg-slate-800/80" />
            <ContextMenuItem
              onClick={() => onTrash(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
            >
              <RotateCcw className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5] shrink-0" strokeWidth={1.75} />
              <span>{t("menu.restore")}</span>
            </ContextMenuItem>
            {onDeletePermanently && (
              <>
                <ContextMenuSeparator className="-mx-1.5 my-1 bg-slate-200/70 dark:bg-slate-800/80" />
                <ContextMenuItem
                  onClick={() => onDeletePermanently(file)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20"
                >
                  <Trash2 className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span>{t("menu.deletePermanently")}</span>
                </ContextMenuItem>
              </>
            )}
          </>
        ) : !file.archived ? (
          <>
            <ContextMenuSeparator className="-mx-1.5 my-1 bg-slate-200/70 dark:bg-slate-800/80" />
            <ContextMenuItem
              onClick={() => onTrash(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20"
            >
              <Trash2 className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{t("menu.moveToTrash")}</span>
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
});
