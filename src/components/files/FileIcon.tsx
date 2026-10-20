import React from "react";
import {
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  FileArchive,
  FileSpreadsheet,
  File,
} from "lucide-react";
import { FolderIcon } from "./FolderIcon";
import { cn } from "@/lib/utils";
import { getFileIconType } from "@/lib/files/fileUtils";

interface FileIconProps {
  name?: string;
  mime: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  bare?: boolean;
}

export const FileIcon = React.memo(function FileIcon({
  name = "",
  mime,
  size = "md",
  className,
  bare = false,
}: FileIconProps) {
  const sizeClasses = {
    sm: "h-4.5 w-4.5",
    md: "h-8 w-8",
    lg: "h-10 w-10",
  };

  const currentSizeClass = sizeClasses[size];

  if (mime === "inode/directory" || mime === "application/x-directory") {
    return <FolderIcon size={size} className={className} />;
  }

  // Google Workspace file types & brand colors
  const getIconProps = () => {
    const iconType = getFileIconType(name, mime);

    switch (iconType) {
      case "folder":
        return {
          Icon: FolderIcon,
          textColor: "text-[#444746] dark:text-[#c4c7c5]",
          bgColor: "bg-slate-100 dark:bg-[#161719]",
        };

      case "image":
        return {
          Icon: FileImage,
          textColor: "text-[#ea4335] dark:text-[#f28b82]",
          bgColor: "bg-red-50 dark:bg-red-950/25",
        };

      case "video":
        return {
          Icon: FileVideo,
          textColor: "text-[#ea4335] dark:text-[#f28b82]",
          bgColor: "bg-red-50 dark:bg-red-950/25",
        };

      case "audio":
        return {
          Icon: FileAudio,
          textColor: "text-[#a142f4] dark:text-[#d7aefb]",
          bgColor: "bg-purple-50 dark:bg-purple-950/25",
        };

      case "pdf":
        return {
          Icon: FileText,
          textColor: "text-[#ea4335] dark:text-[#f28b82]",
          bgColor: "bg-red-50 dark:bg-red-950/25",
        };

      case "spreadsheet":
        return {
          Icon: FileSpreadsheet,
          textColor: "text-[#1e8e3e] dark:text-[#81c995]",
          bgColor: "bg-emerald-50 dark:bg-emerald-950/25",
        };

      case "presentation":
        return {
          Icon: FileText,
          textColor: "text-[#f9ab00] dark:text-[#fdd663]",
          bgColor: "bg-amber-50 dark:bg-amber-950/25",
        };

      case "code":
        return {
          Icon: FileCode,
          textColor: "text-[#1a73e8] dark:text-[#8ab4f8]",
          bgColor: "bg-blue-50 dark:bg-blue-950/25",
        };

      case "archive":
        return {
          Icon: FileArchive,
          textColor: "text-[#f29900] dark:text-[#fdd663]",
          bgColor: "bg-amber-50 dark:bg-amber-950/25",
        };

      case "document":
        return {
          Icon: FileText,
          textColor: "text-[#1a73e8] dark:text-[#8ab4f8]",
          bgColor: "bg-blue-50 dark:bg-blue-950/25",
        };

      case "file":
      default:
        return {
          Icon: File,
          textColor: "text-[#5f6368] dark:text-[#9aa0a6]",
          bgColor: "bg-slate-100 dark:bg-[#161719]",
        };
    }
  };

  const { Icon, textColor, bgColor } = getIconProps();

  if (bare || size === "sm") {
    return (
      <Icon
        className={cn(currentSizeClass, textColor, "shrink-0", className)}
        strokeWidth={size === "sm" ? 2 : 1.75}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-xl transition-all duration-200 shrink-0",
        size === "lg" ? "p-3" : "p-2",
        bgColor,
        textColor,
        className
      )}
    >
      <Icon className={currentSizeClass} strokeWidth={1.75} />
    </div>
  );
});
