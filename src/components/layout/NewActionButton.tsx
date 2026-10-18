import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FolderPlus, Upload, Folder } from "lucide-react";
import { triggerFilePicker, triggerFolderPicker } from "@/lib/upload/fileSelector";
import { cn } from "@/lib/utils";

// Google Drive multi-color Plus icon
export function GooglePlusIcon({ className }: { className?: string }) {
  return (
    <svg className={cn("h-7 w-7 shrink-0", className)} viewBox="0 0 24 24" fill="none">
      {/* Top arm (Blue) */}
      <path d="M12 4c-.83 0-1.5.67-1.5 1.5V11h3V5.5c0-.83-.67-1.5-1.5-1.5z" fill="#4285F4" />
      {/* Right arm (Red) */}
      <path d="M18.5 10.5H13v3h5.5c.83 0 1.5-.67 1.5-1.5s-.67-1.5-1.5-1.5z" fill="#EA4335" />
      {/* Bottom arm (Green) */}
      <path d="M12 20c.83 0 1.5-.67 1.5-1.5V13h-3v5.5c0 .83.67 1.5 1.5 1.5z" fill="#34A853" />
      {/* Left arm (Yellow) */}
      <path d="M5.5 10.5C4.67 10.5 4 11.17 4 12s.67 1.5 1.5 1.5H11v-3H5.5z" fill="#FBBC05" />
      {/* Center junction */}
      <rect x="10.5" y="10.5" width="3" height="3" fill="#4285F4" />
    </svg>
  );
}

interface NewActionButtonProps {
  className?: string;
  isFab?: boolean;
}

export const NewActionButton = React.memo(function NewActionButton({
  className,
  isFab = false,
}: NewActionButtonProps) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation("drive");

  const handleCreateFolder = () => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent("teledrive-trigger-create-folder"));
  };

  const handleUploadFile = () => {
    setOpen(false);
    // Defer file picker until after Radix finishes closing the menu and restoring focus
    setTimeout(() => {
      triggerFilePicker();
    }, 50);
  };

  const handleUploadFolder = () => {
    setOpen(false);
    setTimeout(() => {
      triggerFolderPicker();
    }, 50);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("newMenu.ariaLabel")}
          aria-expanded={open}
          className={cn(
            isFab
              ? "fixed bottom-20 right-5 z-40 h-14 w-14 rounded-2xl bg-white dark:bg-[#282a2c] text-[#1f1f1f] dark:text-[#e3e3e3] border border-slate-200/80 dark:border-[#3c4043]/50 shadow-xl flex items-center justify-center cursor-pointer active:scale-95 transition-all hover:shadow-2xl"
              : "inline-flex items-center gap-3.5 h-14 min-w-[124px] px-5 rounded-2xl bg-white dark:bg-[#282a2c] text-[#1f1f1f] dark:text-[#e3e3e3] border border-transparent dark:border-[#3c4043]/50 shadow-[0_1px_2px_0_rgba(60,64,67,0.3),0_1px_3px_1px_rgba(60,64,67,0.15)] hover:shadow-[0_1px_3px_0_rgba(60,64,67,0.3),0_4px_8px_3px_rgba(60,64,67,0.15)] dark:shadow-[0_1px_2px_0_rgba(0,0,0,0.5)] dark:hover:shadow-[0_2px_6px_2px_rgba(0,0,0,0.6)] hover:bg-[#f8fafd] dark:hover:bg-[#333537] transition-all duration-200 cursor-pointer select-none active:scale-[0.98]",
            className
          )}
        >
          <GooglePlusIcon />
          {!isFab && (
            <span className="text-sm font-semibold tracking-wide text-[#1f1f1f] dark:text-[#e3e3e3]">
              {t("newMenu.new")}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={isFab ? "end" : "start"}
        side={isFab ? "top" : "bottom"}
        sideOffset={8}
        className="w-56 p-1.5 rounded-2xl bg-white dark:bg-[#282a2c] border border-slate-200/90 dark:border-slate-700/80 shadow-[0_4px_16px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.6)] z-50 animate-in fade-in zoom-in-95"
      >
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            handleCreateFolder();
          }}
          className="rounded-xl text-xs font-semibold px-3.5 py-2.5 cursor-pointer hover:bg-[#f0f4f9] dark:hover:bg-[#333537] flex items-center gap-3 text-[#1f1f1f] dark:text-[#e3e3e3]"
        >
          <FolderPlus className="h-4.5 w-4.5 text-[#0b57d0] dark:text-[#a8c7fa]" />
          <span>{t("newMenu.newFolder")}</span>
        </DropdownMenuItem>
        <div className="h-px bg-slate-200/70 dark:bg-slate-700/60 my-1.5" />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            handleUploadFile();
          }}
          className="rounded-xl text-xs font-semibold px-3.5 py-2.5 cursor-pointer hover:bg-[#f0f4f9] dark:hover:bg-[#333537] flex items-center gap-3 text-[#1f1f1f] dark:text-[#e3e3e3]"
        >
          <Upload className="h-4.5 w-4.5 text-[#0b57d0] dark:text-[#a8c7fa]" />
          <span>{t("newMenu.fileUpload")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            handleUploadFolder();
          }}
          className="rounded-xl text-xs font-semibold px-3.5 py-2.5 cursor-pointer hover:bg-[#f0f4f9] dark:hover:bg-[#333537] flex items-center gap-3 text-[#1f1f1f] dark:text-[#e3e3e3]"
        >
          <Folder className="h-4.5 w-4.5 text-[#444746] dark:text-[#c4c7c5]" />
          <span>{t("newMenu.folderUpload")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
