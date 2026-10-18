import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFileStore } from "@/stores/fileStore";
import {
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

/**
 * Circular progress indicator for the minimized header state.
 */
function CircularProgress({ value }: { value: number }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (value / 100) * circumference;

  return (
    <svg className="h-4.5 w-4.5 transform -rotate-90 shrink-0">
      <circle
        cx="9"
        cy="9"
        r={radius}
        className="stroke-slate-200 dark:stroke-slate-800"
        strokeWidth="2"
        fill="transparent"
      />
      <circle
        cx="9"
        cy="9"
        r={radius}
        className="stroke-brand-500 transition-all duration-300"
        strokeWidth="2"
        fill="transparent"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function UploadProgressPanel() {
  const uploadQueue = useFileStore((state) => state.uploadQueue);
  const clearQueue = useFileStore((state) => state.clearQueue);
  const removeFromQueue = useFileStore((state) => state.removeFromQueue);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const { t } = useTranslation("drive");

  // Auto-show when queue has items
  useEffect(() => {
    if (uploadQueue.length > 0) {
      setIsVisible(true);
    }
  }, [uploadQueue.length]);

  if (!isVisible || uploadQueue.length === 0) return null;

  const totalCount = uploadQueue.length;
  const doneCount = uploadQueue.filter((item) => item.status === "done").length;
  const errorCount = uploadQueue.filter((item) => item.status === "error").length;
  const uploadingCount = uploadQueue.filter((item) => item.status === "uploading").length;
  
  const isAllFinished = doneCount + errorCount === totalCount;

  // Calculate overall upload progress
  const totalProgress = uploadQueue.reduce((acc, item) => acc + (item.status === "done" ? 100 : item.progress), 0);
  const overallProgressPercent = Math.round(totalProgress / totalCount);

  const handleClose = () => {
    setIsVisible(false);
    clearQueue();
  };

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-50 w-88 max-w-[calc(100vw-32px)] bg-white dark:bg-[#1e1f20] border border-slate-200/90 dark:border-slate-800 shadow-2xl rounded-2xl overflow-hidden transition-all duration-300 transform select-none",
        isMinimized ? "h-13" : "h-96"
      )}
    >
      {/* Header */}
      <div 
        className="flex items-center justify-between px-4 py-3 bg-[#f0f4f9] dark:bg-[#282a2c] text-[#1f1f1f] dark:text-[#e3e3e3] select-none cursor-pointer border-b border-slate-200/80 dark:border-slate-800" 
        onClick={() => setIsMinimized(!isMinimized)}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {isAllFinished ? (
            errorCount > 0 ? (
              <XCircle className="h-4.5 w-4.5 text-red-500 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            )
          ) : (
            isMinimized ? (
              <CircularProgress value={overallProgressPercent} />
            ) : (
              <Loader2 className="h-4.5 w-4.5 text-[#0b57d0] dark:text-[#a8c7fa] animate-spin shrink-0" />
            )
          )}
          <span className="text-xs font-medium truncate pr-2">
            {isAllFinished
              ? errorCount > 0
                ? t("upload.failed", { count: errorCount })
                : t("upload.complete", { count: doneCount })
              : t("upload.uploadingItems", { count: uploadingCount, percent: overallProgressPercent })}
          </span>
        </div>
        
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setIsMinimized(!isMinimized)}
            className="h-7 w-7 flex items-center justify-center text-[#444746] hover:text-[#1f1f1f] dark:text-[#c4c7c5] dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700/60 rounded-full transition-colors cursor-pointer border-0 bg-transparent outline-none"
            title={isMinimized ? t("upload.expand") : t("upload.collapse")}
          >
            {isMinimized ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="h-7 w-7 flex items-center justify-center text-[#444746] hover:text-[#1f1f1f] dark:text-[#c4c7c5] dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700/60 rounded-full transition-colors cursor-pointer border-0 bg-transparent outline-none"
            title={t("upload.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Upload Item List */}
      {!isMinimized && (
        <div className="flex flex-col h-[calc(100%-48px)] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-[#1e1f20]">
          {uploadQueue.map((item) => (
            <div key={item.id} className="relative flex flex-col gap-1.5 p-3.5 hover:bg-[#f0f4f9]/50 dark:hover:bg-[#282a2c]/50 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Upload className="h-3.5 w-3.5 text-[#0b57d0] dark:text-[#a8c7fa] shrink-0" />
                  <span className="text-xs font-medium text-[#1f1f1f] dark:text-[#e3e3e3] truncate pr-2">
                    {item.name}
                  </span>
                </div>
                
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {item.status === "done" && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  )}
                  {item.status === "error" && (
                    <span title={item.error}>
                      <XCircle className="h-4 w-4 text-red-500" />
                    </span>
                  )}
                  {item.status === "uploading" && (
                    <span className="text-[11px] font-semibold text-[#0b57d0] dark:text-[#a8c7fa]">
                      {item.progress}%
                    </span>
                  )}
                  {item.status === "pending" && (
                    <span className="text-[10px] text-[#444746] dark:text-[#c4c7c5] font-medium bg-[#f0f4f9] dark:bg-[#282a2c] px-2 py-0.5 rounded-full">
                      {t("upload.queued")}
                    </span>
                  )}
                  
                  {/* Remove button for completed/errored items */}
                  {item.status !== "uploading" && (
                    <button
                      onClick={() => removeFromQueue(item.id)}
                      className="text-[#747775] hover:text-[#1f1f1f] dark:hover:text-white p-0.5 rounded cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              
              <div className="flex items-center justify-between text-[11px] text-[#444746] dark:text-[#8e918f]">
                <span>{(item.size / (1024 * 1024)).toFixed(2)} MB</span>
                {item.status === "uploading" && (
                  <span className="text-[#0b57d0] dark:text-[#a8c7fa] text-[10px]">{t("upload.uploading")}</span>
                )}
              </div>

              {/* Progress bar */}
              {item.status === "uploading" && (
                <Progress 
                  value={item.progress} 
                  className="h-1 bg-slate-100 dark:bg-slate-800 text-[#0b57d0] [&>div]:bg-[#0b57d0] dark:[&>div]:bg-[#a8c7fa] rounded-full" 
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
