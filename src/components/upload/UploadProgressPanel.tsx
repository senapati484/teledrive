import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFileStore } from "@/stores/fileStore";
import { useTransferStore } from "@/stores/transferStore";
import {
  Upload,
  Download,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  X,
  RefreshCw,
  Pause,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { retryUploadItem } from "@/lib/upload/uploadManager";
import {
  pauseDownload,
  resumeDownload,
  cancelDownload,
  downloadFileFromTelegram,
} from "@/lib/telegram/downloader";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

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
  const downloads = useTransferStore((state) => state.downloads);
  const removeDownload = useTransferStore((state) => state.removeDownload);
  const clearFinishedDownloads = useTransferStore(
    (state) => state.clearFinishedDownloads
  );
  const [isMinimized, setIsMinimized] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const { t } = useTranslation("drive");

  useEffect(() => {
    if (uploadQueue.length > 0 || downloads.length > 0) {
      setIsVisible(true);
    }
  }, [uploadQueue.length, downloads.length]);

  if (!isVisible || (uploadQueue.length === 0 && downloads.length === 0)) {
    return null;
  }

  const uploadingCount = uploadQueue.filter(
    (item) => item.status === "uploading"
  ).length;
  const activeDownloads = downloads.filter(
    (item) =>
      item.status === "downloading" ||
      item.status === "paused" ||
      item.status === "saving"
  );
  const uploadDone = uploadQueue.filter((item) => item.status === "done").length;
  const uploadError = uploadQueue.filter(
    (item) => item.status === "error"
  ).length;
  const downloadDone = downloads.filter((item) => item.status === "done").length;
  const downloadError = downloads.filter(
    (item) => item.status === "error"
  ).length;

  const activeCount = uploadingCount + activeDownloads.length;
  const doneCount = uploadDone + downloadDone;
  const errorCount = uploadError + downloadError;
  const totalCount = uploadQueue.length + downloads.length;

  const isAllFinished = doneCount + errorCount + downloads.filter(
    (item) => item.status === "cancelled"
  ).length === totalCount;

  const progressItems = [
    ...uploadQueue.map((item) => (item.status === "done" ? 100 : item.progress)),
    ...downloads.map((item) =>
      item.status === "done" ? 100 : item.progress
    ),
  ];
  const overallProgressPercent = progressItems.length
    ? Math.round(
        progressItems.reduce((acc, value) => acc + value, 0) /
          progressItems.length
      )
    : 0;

  const handleClose = () => {
    const hasActive = activeCount > 0;
    clearQueue();
    clearFinishedDownloads();
    if (!hasActive) setIsVisible(false);
  };

  return (
    <div
      className={cn(
        "fixed bottom-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px)+12px)] md:bottom-6 right-3 md:right-6 z-50 w-88 max-w-[calc(100vw-24px)] bg-white dark:bg-[#111214] border border-slate-200/90 dark:border-white/[0.06] shadow-2xl rounded-2xl overflow-hidden transition-all duration-300 transform select-none",
        isMinimized ? "h-13" : "h-96"
      )}
    >
      <div
        className="flex items-center justify-between px-4 py-3 bg-[#f0f4f9] dark:bg-[#161719] text-[#1f1f1f] dark:text-[#e3e3e3] select-none cursor-pointer border-b border-slate-200/80 dark:border-white/[0.04]"
        onClick={() => setIsMinimized(!isMinimized)}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {isAllFinished ? (
            errorCount > 0 ? (
              <XCircle className="h-4.5 w-4.5 text-red-500 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            )
          ) : isMinimized ? (
            <CircularProgress value={overallProgressPercent} />
          ) : (
            <Loader2 className="h-4.5 w-4.5 text-[#0b57d0] dark:text-[#a8c7fa] animate-spin shrink-0" />
          )}
          <span className="text-xs font-medium truncate pr-2">
            {activeCount > 0
              ? t("transfers.active", { count: activeCount })
              : errorCount > 0
                ? t("transfers.failed", { count: errorCount })
                : t("transfers.complete", { count: doneCount })}
          </span>
        </div>

        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => setIsMinimized(!isMinimized)}
            className="h-8 w-8 sm:h-7 sm:w-7 flex items-center justify-center text-[#444746] hover:text-[#1f1f1f] dark:text-[#c4c7c5] dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-[#1f2124] rounded-full transition-colors cursor-pointer border-0 bg-transparent outline-none"
            title={isMinimized ? t("upload.expand") : t("upload.collapse")}
          >
            {isMinimized ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="h-8 w-8 sm:h-7 sm:w-7 flex items-center justify-center text-[#444746] hover:text-[#1f1f1f] dark:text-[#c4c7c5] dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-[#1f2124] rounded-full transition-colors cursor-pointer border-0 bg-transparent outline-none"
            title={t("upload.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="flex flex-col h-[calc(100%-48px)] overflow-y-auto divide-y divide-slate-100 dark:divide-white/[0.03] bg-white dark:bg-[#111214]">
          {downloads.length > 0 && (
            <div className="px-3.5 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[#747775] dark:text-[#8e918f]">
              {t("transfers.downloads")}
            </div>
          )}
          {downloads.map((item) => {
            const isActive =
              item.status === "downloading" ||
              item.status === "paused" ||
              item.status === "saving";
            return (
              <div
                key={item.id}
                className="relative flex flex-col gap-1.5 p-3.5 hover:bg-[#f0f4f9]/50 dark:hover:bg-[#1f2124]/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Download className="h-3.5 w-3.5 text-[#0b57d0] dark:text-[#a8c7fa] shrink-0" />
                    <span className="text-xs font-medium text-[#1f1f1f] dark:text-[#e3e3e3] truncate pr-2">
                      {item.name}
                    </span>
                  </div>

                  <div
                    className="flex items-center gap-2 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {item.status === "done" && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    )}
                    {item.status === "error" && (
                      <span title={item.error}>
                        <XCircle className="h-4 w-4 text-red-500" />
                      </span>
                    )}
                    {(item.status === "downloading" ||
                      item.status === "paused") && (
                      <span className="text-[11px] font-semibold text-[#0b57d0] dark:text-[#a8c7fa]">
                        {item.progress}%
                      </span>
                    )}

                    {item.status === "error" && (
                      <button
                        onClick={() => {
                          removeDownload(item.id);
                          void downloadFileFromTelegram(
                            item.channelId,
                            item.messageId,
                            item.name
                          ).catch((err) => console.error(err));
                        }}
                        className="text-[#0b57d0] dark:text-[#a8c7fa] hover:text-[#0842a0] dark:hover:text-[#d3e3fd] p-1 rounded cursor-pointer min-h-[28px] min-w-[28px] flex items-center justify-center"
                        title={t("transfers.retry")}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    )}

                    {(item.status === "downloading" ||
                      item.status === "paused") && (
                      <button
                        onClick={() =>
                          item.status === "paused"
                            ? resumeDownload(item.id)
                            : pauseDownload(item.id)
                        }
                        className="text-[#0b57d0] dark:text-[#a8c7fa] hover:text-[#0842a0] dark:hover:text-[#d3e3fd] p-1 rounded cursor-pointer min-h-[28px] min-w-[28px] flex items-center justify-center"
                        title={
                          item.status === "paused"
                            ? t("transfers.resume")
                            : t("transfers.pause")
                        }
                      >
                        {item.status === "paused" ? (
                          <Play className="h-3.5 w-3.5" />
                        ) : (
                          <Pause className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}

                    {isActive && (
                      <button
                        onClick={() => cancelDownload(item.id)}
                        className="text-[#747775] hover:text-[#1f1f1f] dark:hover:text-white p-1 rounded cursor-pointer min-h-[28px] min-w-[28px] flex items-center justify-center"
                        title={t("transfers.cancel")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}

                    {!isActive && (
                      <button
                        onClick={() => removeDownload(item.id)}
                        className="text-[#747775] hover:text-[#1f1f1f] dark:hover:text-white p-1 rounded cursor-pointer min-h-[28px] min-w-[28px] flex items-center justify-center"
                        title={t("transfers.remove")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#444746] dark:text-[#8e918f]">
                  <span>
                    {item.receivedBytes > 0 && item.size > 0 ? (
                      <>
                        {formatBytes(item.receivedBytes)}
                        <span className="text-[#c4c7c5] dark:text-[#5f6368] mx-1">/</span>
                        {formatBytes(item.size)}
                      </>
                    ) : item.size > 0 ? (
                      formatBytes(item.size)
                    ) : (
                      t(
                        item.status === "paused"
                          ? "transfers.paused"
                          : item.status === "done"
                            ? "transfers.done"
                            : item.status === "error"
                              ? "transfers.failedStatus"
                              : item.status === "cancelled"
                                ? "transfers.cancelled"
                                : "transfers.downloading"
                      )
                    )}
                  </span>
                  {item.status === "downloading" && (
                    <span className="flex items-center gap-1.5 text-[#0b57d0] dark:text-[#a8c7fa] text-[10px] font-medium">
                      {item.speed !== undefined && (
                        <span>{formatBytes(item.speed)}/s</span>
                      )}
                      {item.speed !== undefined && item.eta !== undefined && (
                        <span className="text-[#747775] dark:text-[#5f6368]">·</span>
                      )}
                      {item.eta !== undefined && (
                        <span className="text-[#444746] dark:text-[#8e918f]">
                          {formatEta(item.eta)} left
                        </span>
                      )}
                    </span>
                  )}
                </div>

                {(item.status === "downloading" ||
                  item.status === "paused" ||
                  item.status === "saving") && (
                  <Progress
                    value={item.progress}
                    className="h-1 bg-slate-100 dark:bg-[#161719] text-[#0b57d0] [&>div]:bg-[#0b57d0] dark:[&>div]:bg-[#a8c7fa] rounded-full"
                  />
                )}
              </div>
            );
          })}

          {uploadQueue.length > 0 && (
            <div className="px-3.5 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[#747775] dark:text-[#8e918f]">
              {t("transfers.uploads")}
            </div>
          )}
          {uploadQueue.map((item) => (
            <div
              key={item.id}
              className="relative flex flex-col gap-1.5 p-3.5 hover:bg-[#f0f4f9]/50 dark:hover:bg-[#1f2124]/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Upload className="h-3.5 w-3.5 text-[#0b57d0] dark:text-[#a8c7fa] shrink-0" />
                  <span className="text-xs font-medium text-[#1f1f1f] dark:text-[#e3e3e3] truncate pr-2">
                    {item.name}
                  </span>
                </div>

                <div
                  className="flex items-center gap-2 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
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
                    <span className="text-[10px] text-[#444746] dark:text-[#c4c7c5] font-medium bg-[#f0f4f9] dark:bg-[#161719] border dark:border-white/[0.04] px-2 py-0.5 rounded-full">
                      {t("upload.queued")}
                    </span>
                  )}

                  {item.status === "error" && (
                    <button
                      onClick={() => retryUploadItem(item.id)}
                      className="text-[#0b57d0] dark:text-[#a8c7fa] hover:text-[#0842a0] dark:hover:text-[#d3e3fd] p-1 rounded cursor-pointer min-h-[28px] min-w-[28px] flex items-center justify-center"
                      title={t("upload.retry")}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {item.status !== "uploading" && (
                    <button
                      onClick={() => removeFromQueue(item.id)}
                      className="text-[#747775] hover:text-[#1f1f1f] dark:hover:text-white p-1 rounded cursor-pointer min-h-[28px] min-w-[28px] flex items-center justify-center"
                      title={t("upload.remove") || "Remove"}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-[#444746] dark:text-[#8e918f]">
                {item.status === "uploading" &&
                item.uploadedBytes !== undefined ? (
                  <span>
                    {formatBytes(item.uploadedBytes)}
                    <span className="text-[#c4c7c5] dark:text-[#5f6368] mx-1">/</span>
                    {formatBytes(item.size)}
                  </span>
                ) : (
                  <span>{formatBytes(item.size)}</span>
                )}
                {item.status === "uploading" && (
                  <span className="flex items-center gap-1.5 text-[#0b57d0] dark:text-[#a8c7fa] text-[10px] font-medium">
                    {item.speed !== undefined && (
                      <span>{formatBytes(item.speed)}/s</span>
                    )}
                    {item.speed !== undefined && item.eta !== undefined && (
                      <span className="text-[#747775] dark:text-[#5f6368]">·</span>
                    )}
                    {item.eta !== undefined && (
                      <span className="text-[#444746] dark:text-[#8e918f]">
                        {formatEta(item.eta)} left
                      </span>
                    )}
                  </span>
                )}
              </div>

              {item.status === "uploading" && (
                <Progress
                  value={item.progress}
                  className="h-1 bg-slate-100 dark:bg-[#161719] text-[#0b57d0] [&>div]:bg-[#0b57d0] dark:[&>div]:bg-[#a8c7fa] rounded-full"
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
