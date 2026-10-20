import React from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  Folder,
  Star,
  FileCheck,
  Trash2,
  Archive,
  Shield,
  Upload,
  FolderPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export interface EmptyStateProps {
  mode: "drive" | "starred" | "recent" | "trash" | "archived" | "search" | "backups";
  folderPath?: string;
  searchQuery?: string;
  onUploadFiles?: () => void;
  onCreateFolder?: () => void;
}

export const EmptyState = React.memo(function EmptyState({
  mode,
  folderPath = "/",
  searchQuery = "",
  onUploadFiles,
  onCreateFolder,
}: EmptyStateProps) {
  const { t } = useTranslation("files");

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
    <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-8 text-center max-w-md mx-auto select-none animate-slide-up-fade">
      <div className="relative mb-5 sm:mb-6">
        <div className="absolute inset-0 bg-[#c2e7ff]/40 dark:bg-[#004a77]/30 blur-2xl rounded-full scale-150 animate-pulse pointer-events-none" />
        <div className="relative p-5 sm:p-6 rounded-3xl bg-[#f0f4f9] dark:bg-[#1a1a1a] border border-slate-200/80 dark:border-white/[0.04] shadow-xs">
          <Icon className="h-10 w-10 sm:h-12 sm:w-12 text-[#0b57d0] dark:text-[#a8c7fa] stroke-[1.5]" />
        </div>
      </div>

      <h3 className="text-base sm:text-lg font-semibold text-[#1f1f1f] dark:text-[#e3e3e3] mb-1.5 tracking-tight">
        {title}
      </h3>

      <p className="text-xs sm:text-sm text-[#444746] dark:text-[#8e918f] mb-6 leading-relaxed max-w-xs">
        {subtitle}
      </p>

      {mode === "drive" && (onUploadFiles || onCreateFolder) && (
        <div className="flex flex-wrap gap-2.5 sm:gap-3 justify-center">
          {onUploadFiles && (
            <Button
              onClick={onUploadFiles}
              className="rounded-full bg-[#0b57d0] hover:bg-[#0842a0] dark:bg-[#a8c7fa] dark:hover:bg-[#d2e3fc] text-white dark:text-[#003258] font-semibold px-5 h-10 text-xs sm:text-sm shadow-xs cursor-pointer active:scale-95 transition-all"
            >
              <Upload className="mr-2 h-4 w-4" />
              {t("browser.emptyState.uploadFiles")}
            </Button>
          )}
          {onCreateFolder && (
            <Button
              variant="outline"
              onClick={onCreateFolder}
              className="rounded-full font-semibold px-4.5 h-10 text-xs sm:text-sm border-slate-300 dark:border-white/[0.06] bg-white dark:bg-[#141518] text-[#1f1f1f] dark:text-[#e3e3e3] hover:bg-[#f0f4f9] dark:hover:bg-[#1f2124] cursor-pointer active:scale-95 transition-all"
            >
              <FolderPlus className="mr-2 h-4 w-4" />
              {t("browser.emptyState.newFolder")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
});
