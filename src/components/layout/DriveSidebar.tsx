import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { Cloud } from "lucide-react";
import { NewActionButton } from "./NewActionButton";
import { cn } from "@/lib/utils";

interface DriveSidebarProps {
  navItems: Array<{
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    path: string;
    badge: number | null;
    dropTarget: string | null;
  }>;
  formattedUsedSize: string;
  isMobile: boolean;
  setSidebarOpen: (open: boolean) => void;
  draggedItemIds: string[];
  actionableSidebarPaths: Set<string>;
  sidebarDragOverPath: string | null;
  setSidebarDragOverPath: (path: string | null) => void;
  handleSidebarDragOver: (e: React.DragEvent, path: string) => void;
  handleSidebarDragEnter: (e: React.DragEvent, path: string) => void;
  handleSidebarDragLeave: (e: React.DragEvent) => void;
  handleSidebarDrop: (e: React.DragEvent, path: string) => void;
}

export const DriveSidebar = React.memo(function DriveSidebar({
  navItems,
  formattedUsedSize,
  isMobile,
  setSidebarOpen,
  draggedItemIds,
  actionableSidebarPaths,
  sidebarDragOverPath,
  setSidebarDragOverPath,
  handleSidebarDragOver,
  handleSidebarDragEnter,
  handleSidebarDragLeave,
  handleSidebarDrop,
}: DriveSidebarProps) {
  const location = useLocation();
  const { t } = useTranslation("drive");

  return (
    <div className="flex flex-col h-full bg-background select-none">
      {/* Google Drive "+ New" button */}
      <div className="px-4 pt-3 pb-3">
        <NewActionButton />
      </div>

      {/* Navigation items: Google Drive full-rounded pills */}
      <nav className="flex-1 px-3 space-y-1">
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
              onClick={() => isMobile && setSidebarOpen(false)}
              onDragOver={(e) => handleSidebarDragOver(e, item.path)}
              onDragEnter={(e) => handleSidebarDragEnter(e, item.path)}
              onDragLeave={handleSidebarDragLeave}
              onDrop={(e) => handleSidebarDrop(e, item.path)}
              onMouseEnter={() => {
                if (draggedItemIds.length > 0 && actionableSidebarPaths.has(item.path)) {
                  setSidebarDragOverPath(item.path);
                }
              }}
              onMouseLeave={() => {
                if (draggedItemIds.length > 0 && sidebarDragOverPath === item.path) {
                  setSidebarDragOverPath(null);
                }
              }}
              data-drop-target={item.dropTarget ?? undefined}
              className={cn(
                "flex items-center gap-3.5 px-4 h-10 rounded-full text-sm font-medium transition-colors select-none cursor-pointer",
                isActive
                  ? "bg-[#c2e7ff] text-[#001d35] font-semibold dark:bg-[#004a77] dark:text-[#c2e7ff]"
                  : sidebarDragOverPath === item.path
                  ? "bg-[#c2e7ff]/70 text-[#001d35] dark:bg-[#004a77]/70 dark:text-[#c2e7ff]"
                  : "text-[#444746] dark:text-[#c4c7c5] hover:bg-[#e9eef6] dark:hover:bg-[#282a2c] hover:text-[#1f1f1f] dark:hover:text-[#e3e3e3]"
              )}
            >
              <Icon
                className={cn(
                  "h-4.5 w-4.5 shrink-0",
                  isActive
                    ? "text-[#001d35] dark:text-[#c2e7ff]"
                    : "text-[#444746] dark:text-[#c4c7c5]"
                )}
              />
              <span className="flex-1 truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Storage panel: Google Drive Cloud Storage meter */}
      <div className="px-4 pb-4 pt-3 space-y-2.5 select-none border-t border-slate-200/50 dark:border-slate-800/40">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#444746] dark:text-[#c4c7c5]">
          <Cloud className="h-4.5 w-4.5 text-[#0b57d0] dark:text-[#a8c7fa]" />
          <span>{t("sidebar.storage")}</span>
        </div>

        {/* Google style linear progress bar */}
        <div className="w-full h-1 bg-[#e0e2ec] dark:bg-[#36373a] rounded-full overflow-hidden">
          <div className="h-full bg-[#0b57d0] dark:bg-[#a8c7fa] rounded-full w-2" />
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-[#444746] dark:text-[#c4c7c5]">
            <Trans
              t={t}
              i18nKey="sidebar.usedOfUnlimited"
              values={{ size: formattedUsedSize }}
              components={{ strong: <strong className="font-semibold text-[#1f1f1f] dark:text-[#e3e3e3]" /> }}
            />
          </span>
          <span className="text-[11px] text-[#0b57d0] dark:text-[#a8c7fa] font-medium">
            {t("sidebar.telegramCloudStorage")}
          </span>
        </div>
      </div>
    </div>
  );
});
