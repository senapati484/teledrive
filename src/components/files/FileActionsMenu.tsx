import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  MoreVertical,
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
} from "lucide-react";
import { TeleFile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { isEditableFile } from "@/lib/files/editableTypes";
import { useTranslation } from "react-i18next";

interface FileActionsMenuProps {
  file: TeleFile;
  onPreview: (file: TeleFile) => void;
  onDownload: (file: TeleFile) => void;
  onEdit?: (file: TeleFile) => void;
  onRename: (file: TeleFile) => void;
  onStarToggle: (file: TeleFile) => void;
  onTrash: (file: TeleFile) => void;
  onMoveTo?: (file: TeleFile) => void;
  /** Called when user clicks "Delete Permanently" in trash mode */
  onDeletePermanently?: (file: TeleFile) => void;
  onArchive?: (file: TeleFile) => void;
  onUnarchive?: (file: TeleFile) => void;
  onOfflineToggle?: (file: TeleFile) => void;
}

export const FileActionsMenu = React.memo(function FileActionsMenu({
  file,
  onPreview,
  onDownload,
  onEdit,
  onRename,
  onStarToggle,
  onTrash,
  onMoveTo,
  onDeletePermanently,
  onArchive,
  onUnarchive,
  onOfflineToggle,
}: FileActionsMenuProps) {
  const { t } = useTranslation("files");
  const isDirectory = file.mime === "inode/directory" || file.mime === "application/x-directory";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full shrink-0 hover:bg-[#e9eef6] dark:hover:bg-[#333537] data-[state=open]:bg-[#c2e7ff]/60 dark:data-[state=open]:bg-[#004a77]/60 cursor-pointer transition-colors"
          onClick={(e) => e.stopPropagation()} // Prevent trigger select/click row
        >
          <MoreVertical className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5]" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52 rounded-2xl p-1.5 bg-white dark:bg-[#282a2c] border border-slate-200/80 dark:border-slate-800 shadow-xl ring-0 z-50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Group 1: Retrieve Actions (Preview, Edit & Download) */}
        {!isDirectory && !file.trashed && !file.archived && (
          <>
            <DropdownMenuItem
              onClick={() => onPreview(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
            >
              <Eye className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5] shrink-0" strokeWidth={1.75} />
              <span>{t("menu.preview")}</span>
            </DropdownMenuItem>
            {onEdit && isEditableFile(file) && (
              <DropdownMenuItem
                onClick={() => onEdit(file)}
                className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
              >
                <Pencil className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5] shrink-0" strokeWidth={1.75} />
                <span>{t("menu.edit")}</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => onDownload(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
            >
              <Download className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5] shrink-0" strokeWidth={1.75} />
              <span>{t("menu.download")}</span>
            </DropdownMenuItem>
            {onOfflineToggle && (
              <DropdownMenuItem
                onClick={() => onOfflineToggle(file)}
                className="flex items-center justify-between px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
              >
                <div className="flex items-center gap-2.5">
                  <CheckCircle className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    file.offline ? "text-emerald-500 fill-emerald-500/20" : "text-[#444746] dark:text-[#c4c7c5]"
                  )} strokeWidth={1.75} />
                  <span>{t("menu.availableOffline")}</span>
                </div>
                {file.offline && <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="-mx-1.5 my-1 bg-slate-200/70 dark:bg-slate-800/80" />
          </>
        )}

        {/* Group 2: Metadata Modifications (Rename, Move, Star) */}
        {!file.trashed && !file.archived && (
          <>
            <DropdownMenuItem
              onClick={() => onRename(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
            >
              <Edit2 className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5] shrink-0" strokeWidth={1.75} />
              <span>{t("menu.rename")}</span>
            </DropdownMenuItem>
            {onMoveTo && (
              <DropdownMenuItem
                onClick={() => onMoveTo(file)}
                className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
              >
                <FolderInput className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5] shrink-0" strokeWidth={1.75} />
                <span>{t("menu.moveTo")}</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => onStarToggle(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
            >
              <Star
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  file.starred
                    ? "fill-amber-400 text-amber-400"
                    : "text-[#444746] dark:text-[#c4c7c5]"
                )}
                strokeWidth={1.75}
              />
              <span>{file.starred ? t("menu.removeStar") : t("menu.addStar")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="-mx-1.5 my-1 bg-slate-200/70 dark:bg-slate-800/80" />
          </>
        )}

        {/* Group 3: Archive Operations */}
        {!file.trashed && !file.archived && onArchive && (
          <>
            <DropdownMenuItem
              onClick={() => onArchive(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
            >
              <Archive className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5] shrink-0" strokeWidth={1.75} />
              <span>{t("menu.archive")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="-mx-1.5 my-1 bg-slate-200/70 dark:bg-slate-800/80" />
          </>
        )}
        {file.archived && onUnarchive && (
          <>
            <DropdownMenuItem
              onClick={() => onUnarchive(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
            >
              <ArchiveRestore className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5] shrink-0" strokeWidth={1.75} />
              <span>{t("menu.unarchive")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="-mx-1.5 my-1 bg-slate-200/70 dark:bg-slate-800/80" />
          </>
        )}

        {/* Group 4: Trash Operations */}
        {file.trashed ? (
          <>
            <DropdownMenuItem
              onClick={() => onTrash(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#333537]"
            >
              <RotateCcw className="h-4 w-4 text-[#444746] dark:text-[#c4c7c5] shrink-0" strokeWidth={1.75} />
              <span>{t("menu.restore")}</span>
            </DropdownMenuItem>
            {onDeletePermanently && (
              <>
                <DropdownMenuSeparator className="-mx-1.5 my-1 bg-slate-200/70 dark:bg-slate-800/80" />
                <DropdownMenuItem
                  onClick={() => onDeletePermanently(file)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20"
                >
                  <Trash2 className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span>{t("menu.deletePermanently")}</span>
                </DropdownMenuItem>
              </>
            )}
          </>
        ) : (
          !file.archived && (
            <DropdownMenuItem
              onClick={() => onTrash(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20"
            >
              <Trash2 className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{t("menu.moveToTrash")}</span>
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
