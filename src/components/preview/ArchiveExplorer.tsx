import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  Folder,
  FolderArchive,
  Search,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { save as tauriSaveDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { FileIcon } from "@/components/files/FileIcon";
import { CsvTableViewer } from "./CsvTableViewer";
import { PdfViewer } from "./PdfViewer";
import { RichDocumentSheet } from "./RichDocumentSheet";
import { SyntaxHighlighter } from "./SyntaxHighlighter";
import {
  AUDIO_EXTS,
  IMAGE_EXTS,
  RICH_DOCUMENT_EXTS,
  UNRENDERABLE_IMAGE_EXTS,
  VIDEO_EXTS,
  decodeTextBuffer,
  getFileExtension,
  getMediaMimeType,
} from "@/lib/files/fileUtils";
import {
  ArchiveEntryInfo,
  extractDocumentPreview,
} from "@/lib/files/richPreviewExtractors";
import { getPlatform } from "@/lib/platform";
import { isWebRuntime, triggerBrowserBlobDownload } from "@/lib/runtime/bridge";
import { saveBinaryFile } from "@/lib/storage/safeFileWriter";

interface Props {
  fileName: string;
  archiveSize: number;
  entries: ArchiveEntryInfo[];
  isDark: boolean;
  onOpenSystemApp: () => void;
  onDownloadArchive: () => void;
}

type InnerPreviewState =
  | { kind: "image"; name: string; url: string }
  | { kind: "video"; name: string; url: string; mime: string }
  | { kind: "audio"; name: string; url: string; mime: string }
  | { kind: "pdf"; name: string; bytes: Uint8Array }
  | { kind: "table"; name: string; content: string; isTsv: boolean }
  | { kind: "doc"; name: string; html: string }
  | { kind: "text"; name: string; text: string }
  | { kind: "binary"; name: string; size: number; message: string };

const MAX_INLINE_ENTRY_BYTES = 25 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  return `${parseFloat((bytes / Math.pow(k, idx)).toFixed(1))} ${units[idx]}`;
}

export function ArchiveExplorer({
  fileName,
  archiveSize,
  entries,
  isDark,
  onOpenSystemApp,
  onDownloadArchive,
}: Props) {
  const { t } = useTranslation("preview");
  const [query, setQuery] = useState("");
  const [innerPreview, setInnerPreview] = useState<InnerPreviewState | null>(null);

  useEffect(() => {
    return () => {
      if (innerPreview && "url" in innerPreview && innerPreview.url.startsWith("blob:")) {
        URL.revokeObjectURL(innerPreview.url);
      }
    };
  }, [innerPreview]);

  const sortedEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? entries.filter((entry) => entry.path.toLowerCase().includes(q))
      : entries;
    return [...list].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  }, [entries, query]);

  const fileCount = useMemo(
    () => entries.filter((entry) => !entry.isDir).length,
    [entries]
  );

  const totalExtractedBytes = useMemo(
    () => entries.reduce((sum, entry) => sum + (entry.isDir ? 0 : entry.size), 0),
    [entries]
  );

  const handlePreviewEntry = (entry: ArchiveEntryInfo) => {
    if (entry.isDir || !entry.extract) return;
    const baseName = entry.path.split("/").pop() || entry.path;
    if (entry.size > MAX_INLINE_ENTRY_BYTES) {
      setInnerPreview({
        kind: "binary",
        name: baseName,
        size: entry.size,
        message: t(
          "archive.entryTooLarge",
          "File exceeds 25 MB inline preview limit. Use Extract to save it locally."
        ),
      });
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = entry.extract();
    } catch (err: any) {
      toast.error(err?.message || t("archive.extractFailed", "Could not read archive entry."));
      return;
    }

    const ext = getFileExtension(baseName);
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);

    if (ext === "pdf") {
      setInnerPreview({ kind: "pdf", name: baseName, bytes: copy });
      return;
    }
    if ((IMAGE_EXTS.has(ext) && !UNRENDERABLE_IMAGE_EXTS.has(ext)) || ext === "svg") {
      const mime = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
      const url = URL.createObjectURL(new Blob([copy.buffer], { type: mime }));
      setInnerPreview({ kind: "image", name: baseName, url });
      return;
    }
    if (VIDEO_EXTS.has(ext)) {
      const mime = getMediaMimeType(baseName, "", "video");
      const url = URL.createObjectURL(new Blob([copy.buffer], { type: mime }));
      setInnerPreview({ kind: "video", name: baseName, url, mime });
      return;
    }
    if (AUDIO_EXTS.has(ext)) {
      const mime = getMediaMimeType(baseName, "", "audio");
      const url = URL.createObjectURL(new Blob([copy.buffer], { type: mime }));
      setInnerPreview({ kind: "audio", name: baseName, url, mime });
      return;
    }
    if (ext === "csv" || ext === "tsv") {
      const decoded = decodeTextBuffer(copy);
      setInnerPreview({
        kind: "table",
        name: baseName,
        content: decoded.isText ? decoded.text : new TextDecoder().decode(copy),
        isTsv: ext === "tsv",
      });
      return;
    }
    if (RICH_DOCUMENT_EXTS.has(ext)) {
      try {
        const doc = extractDocumentPreview(copy, baseName);
        setInnerPreview({ kind: "doc", name: baseName, html: doc.content });
        return;
      } catch {
        // fall through to text/binary handling
      }
    }

    const decoded = decodeTextBuffer(copy);
    if (decoded.isText) {
      setInnerPreview({ kind: "text", name: baseName, text: decoded.text });
      return;
    }

    setInnerPreview({
      kind: "binary",
      name: baseName,
      size: bytes.length,
      message: t(
        "archive.binaryEntryNotice",
        "Binary entry cannot be displayed directly. Extract it to view locally."
      ),
    });
  };

  const handleSaveEntry = async (entry: ArchiveEntryInfo) => {
    if (entry.isDir || !entry.extract) return;
    const baseName = (entry.path.split("/").pop() || "extracted.bin").replace(/[/\\?%*:|"<>]/g, "_");
    try {
      const bytes = entry.extract();
      if (isWebRuntime() || getPlatform() === "android") {
        const copy = new Uint8Array(bytes.length);
        copy.set(bytes);
        triggerBrowserBlobDownload(new Blob([copy.buffer]), baseName);
        toast.success(t("toast.saved", { name: baseName, defaultValue: `"${baseName}" saved successfully!` }));
        return;
      }
      const targetPath = await tauriSaveDialog({ defaultPath: baseName });
      if (!targetPath) return;
      await saveBinaryFile(targetPath, bytes);
      toast.success(t("toast.saved", { name: baseName, defaultValue: `"${baseName}" saved successfully!` }));
    } catch (err: any) {
      toast.error(err?.message || t("archive.extractFailed", "Could not extract file."));
    }
  };

  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden"
      style={{ background: isDark ? "#0a0b0d" : "#f4f6fa" }}
    >
      {/* Archive summary header */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#111214] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {innerPreview ? (
            <button
              onClick={() => setInnerPreview(null)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>{t("archive.backToList", "Back to files")}</span>
            </button>
          ) : (
            <div className="h-8 w-8 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
              <FolderArchive className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
              {innerPreview ? innerPreview.name : fileName}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t("archive.summary", {
                count: fileCount,
                unpacked: formatBytes(totalExtractedBytes),
                packed: formatBytes(archiveSize),
                defaultValue: `${fileCount} files · ${formatBytes(totalExtractedBytes)} unpacked (${formatBytes(archiveSize)} compressed)`,
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!innerPreview && (
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("archive.searchPlaceholder", "Filter archive files…")}
                className="pl-8 pr-7 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-[#161719] text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 w-44 sm:w-56"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          <button
            onClick={onOpenSystemApp}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0b57d0] hover:bg-[#0842a0] text-white cursor-pointer"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>{t("archive.openInSystem", "Open in System App")}</span>
          </button>
          <button
            onClick={onDownloadArchive}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("archive.download", "Download")}</span>
          </button>
        </div>
      </div>

      {/* Inner preview OR Archive entries list */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {innerPreview ? (
          innerPreview.kind === "text" ? (
            <SyntaxHighlighter
              code={innerPreview.text}
              fileName={innerPreview.name}
              className="absolute inset-0"
            />
          ) : innerPreview.kind === "table" ? (
            <div className="absolute inset-0">
              <CsvTableViewer
                content={innerPreview.content}
                isTsv={innerPreview.isTsv}
                isDark={isDark}
              />
            </div>
          ) : innerPreview.kind === "doc" ? (
            <RichDocumentSheet htmlContent={innerPreview.html} isDark={isDark} />
          ) : innerPreview.kind === "pdf" ? (
            <div className="absolute inset-0">
              <PdfViewer
                data={innerPreview.bytes}
                fileName={innerPreview.name}
                onOpenSystemApp={onOpenSystemApp}
              />
            </div>
          ) : innerPreview.kind === "image" ? (
            <div className="w-full h-full flex items-center justify-center p-6 overflow-auto">
              <img
                src={innerPreview.url}
                alt={innerPreview.name}
                className="max-w-full max-h-full object-contain rounded-lg shadow-md"
              />
            </div>
          ) : innerPreview.kind === "video" ? (
            <div className="w-full h-full flex items-center justify-center p-6 bg-black">
              <video src={innerPreview.url} controls autoPlay className="max-w-full max-h-full rounded-lg" />
            </div>
          ) : innerPreview.kind === "audio" ? (
            <div className="w-full h-full flex items-center justify-center p-6">
              <audio src={innerPreview.url} controls autoPlay className="w-full max-w-md" />
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
              <FileIcon name={innerPreview.name} mime="" size="lg" />
              <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                {innerPreview.name} ({formatBytes(innerPreview.size)})
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm">
                {innerPreview.message}
              </p>
            </div>
          )
        ) : (
          <div className="h-full overflow-y-auto px-3 sm:px-6 py-4">
            <div className="max-w-4xl mx-auto rounded-2xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#111214] overflow-hidden shadow-xs">
              {sortedEntries.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                  {t("archive.noMatchingEntries", "No files match your filter.")}
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                  {sortedEntries.map((entry) => (
                    <div
                      key={entry.path}
                      className={`flex items-center justify-between gap-3 px-4 py-2.5 text-xs ${
                        entry.isDir
                          ? "text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-white/[0.01]"
                          : "hover:bg-slate-50 dark:hover:bg-white/[0.03] cursor-pointer"
                      }`}
                      onClick={() => !entry.isDir && handlePreviewEntry(entry)}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {entry.isDir ? (
                          <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                        ) : (
                          <FileIcon name={entry.path} mime="" size="sm" bare />
                        )}
                        <span className="truncate font-mono text-[12px] text-slate-800 dark:text-slate-200">
                          {entry.path}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {!entry.isDir && (
                          <>
                            <span className="font-mono text-[11px] text-slate-400 w-16 text-right">
                              {formatBytes(entry.size)}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleSaveEntry(entry);
                              }}
                              title={t("archive.extractFile", "Extract file")}
                              className="p-1.5 rounded-lg hover:bg-slate-200/70 dark:hover:bg-white/[0.08] text-slate-500 dark:text-slate-300 cursor-pointer"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

