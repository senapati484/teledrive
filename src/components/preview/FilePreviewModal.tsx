/**
 * FilePreviewModal.tsx
 * Full-screen file preview + editor modal.
 * Fully theme-aware: adapts topbar, status bar, surfaces, and text to dark/light.
 *
 * Read mode  → SyntaxHighlighter (highlight.js, lazy, theme-aware)
 * Edit mode  → CodeEditor (CodeMirror 6, lazy, theme-aware via Compartment)
 * Binary     → native <img>, <video>, <audio>, <iframe>
 */
import { useState, useEffect, useCallback, useMemo, useRef, Component, ReactNode } from "react";
import {
  X,
  Download,
  Loader2,
  File as FallbackIcon,
  Pencil,
  Save,
  X as XIcon,
  CheckCircle2,
  FileCode2,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  FileSpreadsheet,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  Grid3X3,
  Info,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  SkipForward,
  SkipBack,
  Eye,
  Code,
  Copy,
  Check,
  WrapText,
  FolderArchive,
  Sparkles,
  FileJson,
  Type,
} from "lucide-react";
import { TeleFile } from "@/lib/types";
import { downloadFileToBuffer, downloadFileFromTelegram } from "@/lib/telegram/downloader";
import { updateFileLocal, deleteTelegramMessage } from "@/lib/storage/metadataStore";
import { uploadFileToTelegram } from "@/lib/telegram/uploader";
import { enqueueSave } from "@/lib/storage/indexQueue";
import { readOfflineCache } from "@/lib/storage/offlineStorage";
import { saveBinaryFile } from "@/lib/storage/safeFileWriter";
import { useFileStore } from "@/stores/fileStore";
import { Button } from "@/components/ui/button";
import { marked } from "marked";
import { isEditableFile } from "@/lib/files/editableTypes";
import { detectLang } from "@/lib/files/langDetect";
import { useDarkMode } from "@/hooks/useDarkMode";
import { SyntaxHighlighter } from "./SyntaxHighlighter";
import { CodeEditor } from "./CodeEditor";
import { CsvTableViewer } from "./CsvTableViewer";
import { PdfViewer } from "./PdfViewer";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

// ─── PDF-specific Error Boundary (isolates PDF crashes from the rest of the modal)
class PdfErrorBoundary extends Component<{ children: ReactNode; onRetry?: () => void }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: Error) { console.error("[PdfErrorBoundary] PDF viewer crashed:", err); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#1a1b1e] text-white p-6 text-center select-none">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 mb-4">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
          </div>
          <h3 className="text-base font-semibold mb-2">{i18n.t("preview:pdfErrorBoundary.title")}</h3>
          <p className="text-sm text-slate-400 mb-5">{i18n.t("preview:pdfErrorBoundary.description")}</p>
          <button
            onClick={() => { this.setState({ hasError: false }); this.props.onRetry?.(); }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors cursor-pointer"
          >
            {i18n.t("preview:pdfErrorBoundary.retry")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import DOMPurify from "dompurify";
import { open as openUrl } from "@tauri-apps/plugin-shell";

// ─── O2 Code Editor — runnable language map ────────────────────────────────
// Maps our hljsLang alias → O2's route value.
// Only languages O2 can actually execute/render are listed here.
const O2_LANG_MAP: Record<string, string> = {
  python:     "python",
  javascript: "javascript",
  typescript: "typescript",
  cpp:        "cpp",
  c:          "c",
  java:       "java",
  rust:       "rust",
  go:         "go",
  php:        "php",
  ruby:       "ruby",
  sql:        "sql",
  html:       "html",
};

// ─── File-type icon ────────────────────────────────────────────────────────

function FileTypeIcon({ mime, name }: { mime: string; name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const isPdf = ext === "pdf" || mime === "application/pdf" || (mime && mime.toLowerCase().includes("pdf"));
  if (isPdf) return <FileText className="h-4 w-4 text-red-500 shrink-0" />;
  if (mime.startsWith("image/") || ext === "svg") return <ImageIcon className="h-4 w-4 text-purple-500 shrink-0" />;
  if (mime.startsWith("video/")) return <Film className="h-4 w-4 text-pink-500 shrink-0" />;
  if (mime.startsWith("audio/")) return <Music className="h-4 w-4 text-teal-500 shrink-0" />;
  if (["csv", "tsv", "xls", "xlsx"].includes(ext)) return <FileSpreadsheet className="h-4 w-4 text-emerald-500 shrink-0" />;
  if (["zip", "tar", "gz", "tgz", "rar", "7z", "bz2", "xz"].includes(ext)) return <FolderArchive className="h-4 w-4 text-amber-500 shrink-0" />;
  if (["json", "jsonc", "json5"].includes(ext)) return <FileJson className="h-4 w-4 text-yellow-500 shrink-0" />;
  if (["md", "markdown"].includes(ext)) return <FileText className="h-4 w-4 text-blue-500 shrink-0" />;
  if (isEditableFile({ mime, name } as TeleFile)) return <FileCode2 className="h-4 w-4 text-blue-500 shrink-0" />;
  return <FileText className="h-4 w-4 text-slate-400 shrink-0" />;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatTime(seconds: number): string {
  if (isNaN(seconds)) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_TAGS: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "a", "ul", "ol", "li", "blockquote",
      "code", "pre", "table", "thead", "tbody", "tr", "th", "td",
      "strong", "em", "del", "hr", "br", "img", "span", "div", "sup", "sub",
      "details", "summary", "input"
    ],
    ALLOWED_ATTR: [
      "href", "src", "alt", "title", "class", "target", "rel", "type", "checked", "disabled"
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "base", "link", "style"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "style"],
  });
}

// ─── Props ────────────────────────────────────────────────────────────────

interface Props {
  file: TeleFile | null;
  initialEditMode?: boolean;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────

export function FilePreviewModal({ file, initialEditMode = false, onClose }: Props) {
  const { t } = useTranslation("preview");
  const isDark = useDarkMode();

  // ── Download / load state ────────────────────────────────────────────────
  const [loading, setLoading]         = useState(false);
  const [progress, setProgress]       = useState(0);
  const [error, setError]             = useState<string | null>(null);
  const [contentUrl, setContentUrl]   = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [markdownHtml, setMarkdownHtml] = useState<string | null>(null);

  // ── Multi-format View Mode states ───────────────────────────────────────
  const [mdViewMode, setMdViewMode]     = useState<"preview" | "source">("preview");
  const [csvViewMode, setCsvViewMode]   = useState<"table" | "source">("table");
  const [svgViewMode, setSvgViewMode]   = useState<"image" | "code">("image");
  const [wrapLines, setWrapLines]       = useState(false);
  const [codeFontSize, setCodeFontSize] = useState(13);
  const [copiedCode, setCopiedCode]     = useState(false);

  // ── Edit state ──────────────────────────────────────────────────────────
  const [isEditMode, setIsEditMode]   = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving]       = useState(false);
  const [saveStatus, setSaveStatus]   = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [cursorPos, setCursorPos]     = useState({ line: 1, col: 1 });

  // ── Image preview states ──────────────────────────────────────────────────
  const [zoom, setZoom]               = useState(1);
  const [pan, setPan]                 = useState({ x: 0, y: 0 });
  const [rotation, setRotation]       = useState(0);
  const [showGrid, setShowGrid]       = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [dimensions, setDimensions]   = useState<{ width: number; height: number } | null>(null);
  const [isDragging, setIsDragging]   = useState(false);
  const [dragStart, setDragStart]     = useState({ x: 0, y: 0 });
  const pdfBufferRef                  = useRef<Uint8Array | null>(null);
  const [pdfData, setPdfData]         = useState<Uint8Array | null>(null);

  // ── Video preview states & refs ──────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoVolume, setVideoVolume] = useState(1);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [videoSpeed, setVideoSpeed] = useState(1);
  const [isVideoFullscreen, setIsVideoFullscreen] = useState(false);
  const [showVideoControls, setShowVideoControls] = useState(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  // ── Audio preview states & refs ──────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioVolume, setAudioVolume] = useState(1);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [audioSpeed, setAudioSpeed] = useState(1);
  const [showAudioSpeedMenu, setShowAudioSpeedMenu] = useState(false);

  // Video autohide controls effect
  const lastActiveRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!file || !file.mime.startsWith("video/")) return;
    const handleMouseMove = () => {
      setShowVideoControls(true);
      lastActiveRef.current = Date.now();
    };
    const container = videoContainerRef.current;
    if (container) {
      container.addEventListener("mousemove", handleMouseMove);
      container.addEventListener("mouseleave", () => setShowVideoControls(false));
    }
    const interval = setInterval(() => {
      if (Date.now() - lastActiveRef.current > 2000 && isVideoPlaying) {
        setShowVideoControls(false);
        setShowSpeedMenu(false);
      }
    }, 500);
    return () => {
      if (container) {
        container.removeEventListener("mousemove", handleMouseMove);
      }
      clearInterval(interval);
    };
  }, [file, isVideoPlaying]);

  // Video fullscreen handler
  const handleVideoFullscreen = useCallback(() => {
    const container = videoContainerRef.current;
    const video = videoRef.current;
    if (!container || !video) return;

    const doc = document as any;
    const cElem = container as any;
    const vElem = video as any;

    const isFS = !!(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    );

    const requestFSOnVideo = () => {
      try {
        if (vElem.requestFullscreen) {
          vElem.requestFullscreen().catch((err: any) => {
            console.error("video.requestFullscreen failed:", err);
          });
        } else if (vElem.webkitRequestFullscreen) {
          vElem.webkitRequestFullscreen();
        } else if (vElem.webkitRequestFullScreen) {
          vElem.webkitRequestFullScreen();
        } else if (vElem.webkitEnterFullscreen) {
          try {
            vElem.webkitEnterFullscreen();
          } catch (e) {
            console.error("webkitEnterFullscreen threw:", e);
          }
        }
      } catch (err) {
        console.error("All video fullscreen methods failed:", err);
      }
    };

    if (!isFS) {
      try {
        if (cElem.requestFullscreen) {
          cElem.requestFullscreen().catch((err: any) => {
            console.warn("Container fullscreen rejected, trying video directly:", err);
            requestFSOnVideo();
          });
        } else if (cElem.webkitRequestFullscreen) {
          cElem.webkitRequestFullscreen();
        } else if (cElem.webkitRequestFullScreen) {
          cElem.webkitRequestFullScreen();
        } else if (cElem.mozRequestFullScreen) {
          cElem.mozRequestFullScreen();
        } else if (cElem.msRequestFullscreen) {
          cElem.msRequestFullscreen();
        } else {
          requestFSOnVideo();
        }
      } catch (err) {
        console.warn("Container fullscreen threw error, trying video directly:", err);
        requestFSOnVideo();
      }
    } else {
      try {
        if (doc.exitFullscreen) {
          doc.exitFullscreen().catch(console.error);
        } else if (doc.webkitExitFullscreen) {
          doc.webkitExitFullscreen();
        } else if (doc.webkitCancelFullScreen) {
          doc.webkitCancelFullScreen();
        } else if (doc.mozCancelFullScreen) {
          doc.mozCancelFullScreen();
        } else if (doc.msExitFullscreen) {
          doc.msExitFullscreen();
        }
      } catch (err) {
        console.error("Failed to exit fullscreen:", err);
      }
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      const doc = document as any;
      const isFS = !!(
        doc.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.mozFullScreenElement ||
        doc.msFullscreenElement
      );
      setIsVideoFullscreen(isFS);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    document.addEventListener("mozfullscreenchange", onFullscreenChange);
    document.addEventListener("MSFullscreenChange", onFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      document.removeEventListener("mozfullscreenchange", onFullscreenChange);
      document.removeEventListener("MSFullscreenChange", onFullscreenChange);
    };
  }, []);

  // Video control handlers
  const togglePlayVideo = useCallback(() => {
    if (!videoRef.current) return;
    if (isVideoPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(console.error);
    }
  }, [isVideoPlaying]);

  const handleVideoTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    setVideoCurrentTime(videoRef.current.currentTime);
  }, []);

  const handleVideoLoadedMetadata = useCallback(() => {
    if (!videoRef.current) return;
    setVideoDuration(videoRef.current.duration);
  }, []);

  const handleVideoSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const val = parseFloat(e.target.value);
    videoRef.current.currentTime = val;
    setVideoCurrentTime(val);
  }, []);

  const handleVideoVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const val = parseFloat(e.target.value);
    videoRef.current.volume = val;
    setVideoVolume(val);
    if (val > 0) {
      videoRef.current.muted = false;
      setIsVideoMuted(false);
    }
  }, []);

  const toggleVideoMute = useCallback(() => {
    if (!videoRef.current) return;
    const nextMuted = !isVideoMuted;
    videoRef.current.muted = nextMuted;
    setIsVideoMuted(nextMuted);
  }, [isVideoMuted]);

  const handleVideoSpeedChange = useCallback((speed: number) => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = speed;
    setVideoSpeed(speed);
    setShowSpeedMenu(false);
  }, []);

  const skipVideo = useCallback((amount: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.min(
      Math.max(videoRef.current.currentTime + amount, 0),
      videoRef.current.duration || 0
    );
  }, []);

  // Audio control handlers
  const togglePlayAudio = useCallback(() => {
    if (!audioRef.current) return;
    if (isAudioPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(console.error);
    }
  }, [isAudioPlaying]);

  const handleAudioTimeUpdate = useCallback(() => {
    if (!audioRef.current) return;
    setAudioCurrentTime(audioRef.current.currentTime);
  }, []);

  const handleAudioLoadedMetadata = useCallback(() => {
    if (!audioRef.current) return;
    setAudioDuration(audioRef.current.duration);
  }, []);

  const handleAudioSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const val = parseFloat(e.target.value);
    audioRef.current.currentTime = val;
    setAudioCurrentTime(val);
  }, []);

  const handleAudioVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const val = parseFloat(e.target.value);
    audioRef.current.volume = val;
    setAudioVolume(val);
    if (val > 0) {
      audioRef.current.muted = false;
      setIsAudioMuted(false);
    }
  }, []);

  const toggleAudioMute = useCallback(() => {
    if (!audioRef.current) return;
    const nextMuted = !isAudioMuted;
    audioRef.current.muted = nextMuted;
    setIsAudioMuted(nextMuted);
  }, [isAudioMuted]);

  const handleAudioSpeedChange = useCallback((speed: number) => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = speed;
    setAudioSpeed(speed);
    setShowAudioSpeedMenu(false);
  }, []);

  const skipAudio = useCallback((amount: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.min(
      Math.max(audioRef.current.currentTime + amount, 0),
      audioRef.current.duration || 0
    );
  }, []);

  const zoomIn = useCallback(() => setZoom(z => Math.min(z + 0.25, 4)), []);
  const zoomOut = useCallback(() => setZoom(z => Math.max(z - 0.25, 0.25)), []);
  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  }, []);
  const rotateClockwise = useCallback(() => setRotation(r => (r + 90) % 360), []);
  const rotateCounterClockwise = useCallback(() => setRotation(r => (r - 90) % 360), []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click drag
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    // Only zoom when over the image container
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(z => Math.min(Math.max(z * factor, 0.25), 4));
  }, []);

  // ── Theme-derived surface colors (Google Drive Material 3) ───────────────
  const colors = useMemo(() => isDark ? {
    bg:         "#131314",
    topbar:     "#1e1f20",
    statusbar:  "#1e1f20",
    border:     "#333537",
    text:       "#e3e3e3",
    muted:      "#8e918f",
    hover:      "#282a2c",
    badgeBg:    "#282a2c",
    badgeText:  "#c4c7c5",
    badgeBdr:   "#333537",
    editBadgeBg:"rgba(168,199,250,0.15)",
    editBadgeText:"#a8c7fa",
    editBadgeBdr:"rgba(168,199,250,0.3)",
    progressTrack:"#282a2c",
    errorBg:    "rgba(239,68,68,0.08)",
    errorBdr:   "rgba(239,68,68,0.2)",
    errorText:  "#f87171",
    fallbackBg: "#1e1f20",
    fallbackBdr:"#333537",
    dotGrid:    "#282a2c",
  } : {
    bg:         "#f8fafd",
    topbar:     "#ffffff",
    statusbar:  "#ffffff",
    border:     "#e0e2e7",
    text:       "#1f1f1f",
    muted:      "#444746",
    hover:      "#f0f4f9",
    badgeBg:    "#f0f4f9",
    badgeText:  "#444746",
    badgeBdr:   "#e0e2e7",
    editBadgeBg:"rgba(11,87,208,0.08)",
    editBadgeText:"#0b57d0",
    editBadgeBdr:"rgba(11,87,208,0.25)",
    progressTrack:"#e0e2e7",
    errorBg:    "rgba(239,68,68,0.06)",
    errorBdr:   "rgba(239,68,68,0.18)",
    errorText:  "#dc2626",
    fallbackBg: "#ffffff",
    fallbackBdr:"#e0e2e7",
    dotGrid:    "#e0e2e7",
  }, [isDark]);

  // ── Update lastOpenedAt ──────────────────────────────────────────────────
  useEffect(() => {
    if (file) {
      const store = useFileStore.getState();
      store.setFiles(updateFileLocal(store.files, file.id, { lastOpenedAt: Date.now() }));
    }
  }, [file]);

  // ── Load file on change ──────────────────────────────────────────────────
  useEffect(() => {
    if (!file) {
      if (contentUrl) URL.revokeObjectURL(contentUrl);
      setContentUrl(null); setTextContent(null); setMarkdownHtml(null);
      setError(null); setIsEditMode(false); setEditContent(""); setSaveStatus("idle");
      pdfBufferRef.current = null;
      setPdfData(null);
      return;
    }

    let current = true;

    (async () => {
      setLoading(true); setProgress(0); setError(null);
      setTextContent(null); setContentUrl(null); setMarkdownHtml(null);
      setMdViewMode("preview"); setCsvViewMode("table"); setSvgViewMode("image");
      setWrapLines(false); setCopiedCode(false);
      pdfBufferRef.current = null;
      setPdfData(null);

      try {
        let buffer: Uint8Array;
        if (file.offline) {
          setProgress(50);
          try {
            buffer = await readOfflineCache(file.id);
            setProgress(100);
            console.log(`[FilePreviewModal] Loaded "${file.name}" from local offline cache.`);
          } catch (offlineErr) {
            console.warn(`[FilePreviewModal] Failed to read offline cache for "${file.name}", falling back to download:`, offlineErr);
            buffer = await downloadFileToBuffer(
              file.channelId, file.messageId,
              (pct) => { if (current) setProgress(pct); }
            );
          }
        } else {
          buffer = await downloadFileToBuffer(
            file.channelId, file.messageId,
            (pct) => { if (current) setProgress(pct); }
          );
        }
        if (!current) return;

        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        const mimeLower = (file.mime || "").toLowerCase();
        const isSvgFile = file.name.toLowerCase().endsWith(".svg") || mimeLower === "image/svg+xml";
        const isPdfFile = ext === "pdf" || mimeLower === "application/pdf" || mimeLower.includes("pdf");

        if (isPdfFile) {
          pdfBufferRef.current = buffer;
          setPdfData(buffer);
        }

        // Always create Blob URL for media, pdf, and SVG visual rendering
        if (
          file.mime.startsWith("image/") ||
          file.mime.startsWith("video/") ||
          file.mime.startsWith("audio/") ||
          isPdfFile ||
          isSvgFile
        ) {
          const blobMime = isPdfFile ? "application/pdf" : isSvgFile ? "image/svg+xml" : file.mime;
          const blob = new Blob([buffer as any], { type: blobMime });
          if (current) {
            setContentUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return URL.createObjectURL(blob);
            });
          }
        }

        const isTextMime = (
          mimeLower.startsWith("text/") ||
          mimeLower.includes("javascript") || mimeLower.includes("typescript") ||
          mimeLower.includes("json") || mimeLower.includes("xml") ||
          mimeLower.includes("yaml") || mimeLower.includes("x-sh") ||
          mimeLower.includes("x-python")
        );

        // Check if buffer contains null bytes in the first 1KB (binary check)
        let hasNullByte = false;
        const checkBytes = buffer.subarray(0, Math.min(buffer.length, 1024));
        for (let b = 0; b < checkBytes.length; b++) {
          if (checkBytes[b] === 0) {
            hasNullByte = true;
            break;
          }
        }

        const shouldDecodeText = (
          isTextMime ||
          isEditableFile(file) ||
          (!hasNullByte && !mimeLower.startsWith("image/") && !mimeLower.startsWith("video/") && !mimeLower.startsWith("audio/") && !isPdfFile) ||
          isSvgFile
        );

        if (shouldDecodeText) {
          // Guard for massive text files (> 3MB) to prevent editor memory exhaustion
          const MAX_TEXT_PREVIEW_BYTES = 3 * 1024 * 1024;
          let isTruncated = false;
          let sliceBuffer = buffer;
          if (buffer.length > MAX_TEXT_PREVIEW_BYTES) {
            sliceBuffer = buffer.subarray(0, MAX_TEXT_PREVIEW_BYTES);
            isTruncated = true;
          }

          let text = new TextDecoder().decode(sliceBuffer);
          // Normalize line endings to LF (\n) to ensure consistent line counting and rendering
          text = text.replace(/\r\n|\r/g, "\n");
          if (isTruncated) {
            text += `\n\n${t("truncatedNotice")}`;
          }
          if (!current) return;
          setTextContent(text);

          if (mimeLower === "text/markdown" || file.name.toLowerCase().endsWith(".md") || file.name.toLowerCase().endsWith(".markdown")) {
            const html = await marked.parse(text);
            if (current) setMarkdownHtml(sanitizeHtml(html));
          }

          if (initialEditMode && current) {
            setEditContent(text);
            setIsEditMode(true);
          }
        } else if (!contentUrl && !file.mime.startsWith("image/") && !file.mime.startsWith("video/") && !file.mime.startsWith("audio/") && !isPdfFile) {
          const blob = new Blob([buffer as any], { type: file.mime || "application/octet-stream" });
          if (current) {
            setContentUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return URL.createObjectURL(blob);
            });
          }
        }
      } catch (err: any) {
        if (current) {
          if (!navigator.onLine && !file.offline) {
            setError(t("errors.offlineUnavailable"));
          } else {
            setError(err.message || t("errors.downloadFailed"));
          }
        }
      } finally {
        if (current) setLoading(false);
      }
    })();

    return () => {
      current = false;
    };
  }, [file]);

  useEffect(() => {
    return () => {
      if (contentUrl) {
        URL.revokeObjectURL(contentUrl);
      }
    };
  }, [contentUrl]);

  // ── Handlers (memoized) ──────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (file) {
      downloadFileFromTelegram(file.channelId, file.messageId, file.name).catch((err) => {
        console.error("Download failed:", err);
      });
    }
  }, [file]);

  const handleOpenInSystemApp = useCallback(async () => {
    if (!file) return;
    try {
      const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
      const { openPath } = await import("@tauri-apps/plugin-opener");
      const { exists } = await import("@tauri-apps/plugin-fs");
      const { readOfflineCache, isCachedOffline } = await import("@/lib/storage/offlineStorage");

      const cacheDir = await appLocalDataDir();
      const safeName = file.name.replace(/[/\\?%*:|"<>]/g, "_").trim() || "document.pdf";
      const tempFilePath = await join(cacheDir, `temp_${file.id}_${safeName}`);

      let fileReady = false;
      try {
        fileReady = await exists(tempFilePath);
      } catch (_) {
        fileReady = false;
      }

      if (!fileReady) {
        if (pdfBufferRef.current) {
          await saveBinaryFile(tempFilePath, pdfBufferRef.current);
        } else if (file.offline && (await isCachedOffline(file.id))) {
          const offlineBuf = await readOfflineCache(file.id);
          await saveBinaryFile(tempFilePath, offlineBuf);
        } else {
          toast.info(t("toast.preparingSystemViewer"));
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
      toast.success(t("toast.openedInSystemViewer"));
    } catch (err: any) {
      console.error("Failed to open document in system app:", err);
      toast.error(t("toast.systemViewerFailed"));
      downloadFileFromTelegram(file.channelId, file.messageId, file.name).catch(() => {});
    }
  }, [file, t]);

  const handleEnterEdit = useCallback(() => {
    setEditContent(textContent ?? "");
    setIsEditMode(true);
    setSaveStatus("idle");
  }, [textContent]);

  const handleCancelEdit = useCallback(() => {
    setIsEditMode(false);
    setEditContent("");
    setSaveStatus("idle");
  }, []);

  const handleSave = useCallback(async () => {
    if (!file || isSaving) return;
    setIsSaving(true); setSaveStatus("saving");

    let optimisticFiles: TeleFile[] | null = null;
    let pushedSnapshot = false;

    try {
      const bytes = new TextEncoder().encode(editContent);
      const newFile = new File([bytes], file.name, { type: file.mime });

      // 1) Upload the new bytes to Telegram.
      const message = await uploadFileToTelegram(
        file.channelId, file.name, bytes.length, newFile, file.folderPath ?? "/", () => {}
      );

      const updated: TeleFile = {
        ...file,
        messageId: message.id,
        size: bytes.length,
        uploadedAt: Date.now(),
      };

      // 2) Build the optimistic files array (replaces the old entry by id).
      //    Push a snapshot BEFORE mutating so we can roll back on hard error.
      optimisticFiles = useFileStore
        .getState()
        .files.map((f) => (f.id === file.id ? updated : f));
      useFileStore.getState().pushSnapshot();
      pushedSnapshot = true;
      useFileStore.getState().setFiles(optimisticFiles);

      // 3) Persist through the shared IndexQueue. Transient errors (FLOOD_WAIT,
      //    timeout, network) are swallowed by the queue and retried — we keep
      //    the optimistic UI. Hard errors reject; we roll back below.
      await enqueueSave(file.channelId, optimisticFiles);
      // Commit succeeded — discard the snapshot.
      useFileStore.getState().popSnapshot();
      pushedSnapshot = false;

      // 4) Fire-and-forget delete of the old Telegram message. We do this
      //    AFTER the index commit so a slow delete doesn't block the UI,
      //    and a failure here doesn't roll back the index update.
      if (file.messageId && file.messageId !== message.id) {
        deleteTelegramMessage(file.channelId, file.messageId).catch((err) => {
          console.warn(
            `[FilePreviewModal] Could not delete old message ${file.messageId} for "${file.name}":`,
            err?.message || err
          );
        });
      }

      setTextContent(editContent);
      if (file.name.endsWith(".md")) {
        setMarkdownHtml(sanitizeHtml(await marked.parse(editContent)));
      } else {
        setMarkdownHtml(null);
      }

      setIsEditMode(false);
      setEditContent("");
      setSaveStatus("saved");
      toast.success(t("toast.saved", { name: file.name }));
    } catch (err: any) {
      // Hard error path: roll back the optimistic files array.
      if (pushedSnapshot) {
        const snap = useFileStore.getState().popSnapshot();
        if (snap) useFileStore.getState().setFiles(snap);
        else if (optimisticFiles) {
          // No snapshot — revert by re-applying the old entry.
          const rolled = useFileStore
            .getState()
            .files.map((f) => (f.id === file.id ? file : f));
          useFileStore.getState().setFiles(rolled);
        }
      }
      setSaveStatus("error");
      toast.error(t("toast.saveFailed", { message: err.message ?? t("toast.unknownError") }));
    } finally {
      setIsSaving(false);
    }
  }, [file, editContent, isSaving, t]);

  // ── O2 Code Editor integration ──────────────────────────────────────────
  const handleOpenInO2 = useCallback(async () => {
    const code = isEditMode ? editContent : (textContent ?? "");
    const lInfo = detectLang(file?.name ?? "");
    const o2Lang = O2_LANG_MAP[lInfo.hljsLang];
    if (!o2Lang) return;
    // Encode code as UTF-8 base64 for URL transport
    const encoded = btoa(unescape(encodeURIComponent(code)));
    const url = `https://o2code.vercel.app/${o2Lang}?code=${encoded}&run=true`;
    
    try {
      await openUrl(url);
    } catch (err) {
      console.error("Failed to open URL in native browser:", err);
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [file, textContent, editContent, isEditMode]);

  const handleCopyContent = useCallback(() => {
    const current = isEditMode ? editContent : (textContent ?? "");
    if (!current) return;
    navigator.clipboard.writeText(current);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
    toast.success(t("toast.copied"));
  }, [isEditMode, editContent, textContent, t]);

  const cycleFontSize = useCallback(() => {
    setCodeFontSize(prev => {
      if (prev === 12) return 13;
      if (prev === 13) return 15;
      if (prev === 15) return 16;
      return 12;
    });
  }, []);

  const handleFormatJson = useCallback(() => {
    try {
      const src = isEditMode ? editContent : (textContent ?? "");
      const parsed = JSON.parse(src);
      const formatted = JSON.stringify(parsed, null, 2);
      if (isEditMode) {
        setEditContent(formatted);
      } else {
        setTextContent(formatted);
      }
      toast.success(t("toast.jsonFormatted"));
    } catch (e: any) {
      toast.error(t("toast.invalidJson", { message: e.message }));
    }
  }, [isEditMode, editContent, textContent, t]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const langInfo        = detectLang(file?.name ?? "");
  const ext             = file?.name.split(".").pop()?.toLowerCase() ?? "";
  const isSvg           = ext === "svg" || (file?.mime?.toLowerCase() === "image/svg+xml");
  const isImage         = (file?.mime?.startsWith("image/") ?? false) && !isSvg;
  const isVideo         = file?.mime?.startsWith("video/") ?? false;
  const isAudio         = file?.mime?.startsWith("audio/") ?? false;
  const isPdf           = ext === "pdf" || file?.mime === "application/pdf" || (file?.mime?.toLowerCase().includes("pdf") ?? false);
  const isMarkdownFile  = ext === "md" || ext === "markdown" || (file?.mime?.toLowerCase() === "text/markdown");
  const isCsvFile       = ext === "csv" || (file?.mime?.toLowerCase() === "text/csv");
  const isTsvFile       = ext === "tsv" || (file?.mime?.toLowerCase() === "text/tab-separated-values");
  const isTableData     = (isCsvFile || isTsvFile) && textContent !== null;
  const isJsonFile      = ext === "json" || ext === "jsonc" || ext === "json5" || (file?.mime?.toLowerCase().includes("json") ?? false);
  const isArchive       = ["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "iso", "dmg"].includes(ext);

  const isMarkdownPreview = isMarkdownFile && mdViewMode === "preview" && !isEditMode;
  const isTableView       = isTableData && csvViewMode === "table" && !isEditMode;
  const isSvgImageView    = isSvg && svgViewMode === "image" && !isEditMode;
  const isCode            = textContent !== null && !isMarkdownPreview && !isTableView && !isSvgImageView;
  const canEdit           = Boolean(file && isEditableFile(file) && !loading && !error && textContent !== null);
  const canRunInO2        = textContent !== null && !loading && !error && O2_LANG_MAP[langInfo.hljsLang] !== undefined;

  const statusParts: string[] = [];
  if (langInfo.displayName && !isImage && !isVideo && !isAudio && !isPdf && !isArchive) {
    statusParts.push(langInfo.displayName);
  }
  if (isMarkdownPreview && textContent) {
    const words = textContent.trim().split(/\s+/).filter(Boolean).length;
    const readingMin = Math.max(1, Math.ceil(words / 200));
    statusParts.push(t("status.words", { count: words }));
    statusParts.push(t("status.readingTime", { count: readingMin }));
  } else if (isTableView && textContent) {
    const lines = textContent.split("\n").filter(l => l.trim().length > 0).length;
    statusParts.push(t("status.rows", { count: lines }));
  } else if (textContent !== null) {
    const lc = (isEditMode ? editContent : textContent).split("\n").length;
    statusParts.push(t("status.lines", { count: lc }));
    statusParts.push(wrapLines ? t("status.wrapOn") : t("status.wrapOff"));
    statusParts.push(`${codeFontSize}px`);
  }
  statusParts.push("UTF-8");
  if (isEditMode) statusParts.push(t("status.cursor", { line: cursorPos.line, col: cursorPos.col }));

  if (!file) return null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col animate-in fade-in duration-150"
      style={{ background: colors.bg, color: colors.text }}
    >
      {/* ── Topbar ─────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between pl-4 pr-3 shrink-0"
        style={{
          height: "44px",
          background: colors.topbar,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        {/* Left: icon + name + badges */}
        <div className="flex items-center gap-2 min-w-0 flex-1 pr-4">
          <FileTypeIcon mime={file.mime} name={file.name} />
          <span
            className="text-[13px] font-semibold truncate tracking-tight"
            style={{ color: colors.text }}
          >
            {file.name}
          </span>

          {langInfo.displayName && !isImage && !isVideo && !isAudio && !isPdf && (
            <span
              className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider"
              style={{
                background: colors.badgeBg,
                color: colors.badgeText,
                border: `1px solid ${colors.badgeBdr}`,
              }}
            >
              {langInfo.displayName}
            </span>
          )}

          {isEditMode && (
            <span
              className="shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-md uppercase tracking-widest"
              style={{
                background: colors.editBadgeBg,
                color: colors.editBadgeText,
                border: `1px solid ${colors.editBadgeBdr}`,
              }}
            >
              {t("topbar.editing")}
            </span>
          )}

          {saveStatus === "saved" && !isEditMode && (
            <span
              className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-emerald-500"
            >
              <CheckCircle2 className="h-3 w-3" />
              {t("topbar.saved")}
            </span>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1 shrink-0">
          {isEditMode ? (
            <>
              <button
                onClick={handleCancelEdit}
                disabled={isSaving}
                className="flex items-center gap-1 h-7 px-3 text-[12px] font-semibold rounded-lg cursor-pointer transition-colors duration-150 disabled:opacity-50"
                style={{ color: colors.muted }}
                onMouseEnter={e => (e.currentTarget.style.background = colors.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <XIcon className="h-3.5 w-3.5" />
                {t("topbar.cancel")}
              </button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
                className="h-7 px-3 text-[12px] font-bold bg-blue-600 hover:bg-blue-500 text-white rounded-lg cursor-pointer disabled:opacity-50 transition-colors duration-150"
              >
                {isSaving
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{t("topbar.saving")}</>
                  : <><Save className="h-3.5 w-3.5 mr-1.5" />{t("topbar.save")}</>
                }
              </Button>
            </>
          ) : (
            <>
              {/* ── View Switchers ─────────────────────────────────── */}
              {isMarkdownFile && textContent !== null && (
                <div
                  className="flex items-center p-0.5 rounded-lg border text-xs mr-1"
                  style={{ borderColor: colors.border, background: colors.badgeBg }}
                >
                  <button
                    onClick={() => setMdViewMode("preview")}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                      mdViewMode === "preview"
                        ? "bg-white dark:bg-[#333537] text-blue-600 dark:text-blue-400 shadow-xs"
                        : "text-[#444746] dark:text-[#8e918f] hover:text-black dark:hover:text-white"
                    }`}
                  >
                    <Eye className="h-3 w-3" />
                    <span className="hidden sm:inline">{t("viewMode.preview")}</span>
                  </button>
                  <button
                    onClick={() => setMdViewMode("source")}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                      mdViewMode === "source"
                        ? "bg-white dark:bg-[#333537] text-blue-600 dark:text-blue-400 shadow-xs"
                        : "text-[#444746] dark:text-[#8e918f] hover:text-black dark:hover:text-white"
                    }`}
                  >
                    <Code className="h-3 w-3" />
                    <span className="hidden sm:inline">{t("viewMode.source")}</span>
                  </button>
                </div>
              )}

              {isTableData && (
                <div
                  className="flex items-center p-0.5 rounded-lg border text-xs mr-1"
                  style={{ borderColor: colors.border, background: colors.badgeBg }}
                >
                  <button
                    onClick={() => setCsvViewMode("table")}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                      csvViewMode === "table"
                        ? "bg-white dark:bg-[#333537] text-emerald-600 dark:text-emerald-400 shadow-xs"
                        : "text-[#444746] dark:text-[#8e918f] hover:text-black dark:hover:text-white"
                    }`}
                  >
                    <FileSpreadsheet className="h-3 w-3" />
                    <span className="hidden sm:inline">{t("viewMode.table")}</span>
                  </button>
                  <button
                    onClick={() => setCsvViewMode("source")}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                      csvViewMode === "source"
                        ? "bg-white dark:bg-[#333537] text-emerald-600 dark:text-emerald-400 shadow-xs"
                        : "text-[#444746] dark:text-[#8e918f] hover:text-black dark:hover:text-white"
                    }`}
                  >
                    <Code className="h-3 w-3" />
                    <span className="hidden sm:inline">{t("viewMode.raw")}</span>
                  </button>
                </div>
              )}

              {isSvg && textContent !== null && (
                <div
                  className="flex items-center p-0.5 rounded-lg border text-xs mr-1"
                  style={{ borderColor: colors.border, background: colors.badgeBg }}
                >
                  <button
                    onClick={() => setSvgViewMode("image")}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                      svgViewMode === "image"
                        ? "bg-white dark:bg-[#333537] text-purple-600 dark:text-purple-400 shadow-xs"
                        : "text-[#444746] dark:text-[#8e918f]"
                    }`}
                  >
                    <ImageIcon className="h-3 w-3" />
                    <span className="hidden sm:inline">{t("viewMode.vector")}</span>
                  </button>
                  <button
                    onClick={() => setSvgViewMode("code")}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                      svgViewMode === "code"
                        ? "bg-white dark:bg-[#333537] text-purple-600 dark:text-purple-400 shadow-xs"
                        : "text-[#444746] dark:text-[#8e918f]"
                    }`}
                  >
                    <Code className="h-3 w-3" />
                    <span className="hidden sm:inline">{t("viewMode.code")}</span>
                  </button>
                </div>
              )}

              {/* ── Format & Code View Controls ─────────────────────── */}
              {isJsonFile && textContent !== null && (
                <button
                  onClick={handleFormatJson}
                  title={t("topbar.formatJsonTitle")}
                  className="flex items-center gap-1 h-7 px-2 text-[12px] font-semibold rounded-lg cursor-pointer transition-colors"
                  style={{ color: colors.muted }}
                  onMouseEnter={e => (e.currentTarget.style.background = colors.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  <span className="hidden md:inline">{t("topbar.format")}</span>
                </button>
              )}

              {(isCode || (isMarkdownFile && mdViewMode === "source") || (isTableData && csvViewMode === "source") || (isSvg && svgViewMode === "code")) && (
                <>
                  <button
                    onClick={() => setWrapLines(!wrapLines)}
                    title={wrapLines ? t("topbar.disableWrap") : t("topbar.enableWrap")}
                    className={`flex items-center justify-center h-7 w-8 rounded-lg cursor-pointer transition-colors ${
                      wrapLines ? "text-blue-600 bg-blue-500/10 dark:text-blue-400 dark:bg-blue-500/20" : ""
                    }`}
                    style={{ color: wrapLines ? undefined : colors.muted }}
                    onMouseEnter={e => { if (!wrapLines) e.currentTarget.style.background = colors.hover; }}
                    onMouseLeave={e => { if (!wrapLines) e.currentTarget.style.background = "transparent"; }}
                  >
                    <WrapText className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={cycleFontSize}
                    title={t("topbar.fontSizeTitle", { size: codeFontSize })}
                    className="flex items-center gap-0.5 h-7 px-2 rounded-lg cursor-pointer transition-colors text-[11px] font-mono font-medium"
                    style={{ color: colors.muted }}
                    onMouseEnter={e => (e.currentTarget.style.background = colors.hover)}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <Type className="h-3 w-3" />
                    <span>{codeFontSize}</span>
                  </button>
                </>
              )}

              {textContent !== null && (
                <button
                  onClick={handleCopyContent}
                  title={t("topbar.copyTitle")}
                  className="flex items-center justify-center h-7 w-8 rounded-lg cursor-pointer transition-colors duration-150"
                  style={{ color: colors.muted }}
                  onMouseEnter={e => (e.currentTarget.style.background = colors.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              )}

              {/* O2 Code Runner button — shown for runnable languages */}
              {canRunInO2 && (
                <button
                  onClick={handleOpenInO2}
                  title={t("topbar.runTitle")}
                  className="flex items-center gap-1.5 h-7 px-2.5 text-[12px] font-semibold rounded-lg cursor-pointer transition-all duration-150"
                  style={{ color: isDark ? "#34d399" : "#059669" }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = isDark ? "rgba(52,211,153,0.12)" : "rgba(5,150,105,0.08)";
                  }}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t("topbar.run")}</span>
                </button>
              )}

              {canEdit && (
                <button
                  onClick={handleEnterEdit}
                  title={t("topbar.editTitle")}
                  className="flex items-center gap-1.5 h-7 px-2.5 text-[12px] font-semibold rounded-lg cursor-pointer transition-colors duration-150"
                  style={{ color: colors.muted }}
                  onMouseEnter={e => (e.currentTarget.style.background = colors.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t("topbar.edit")}</span>
                </button>
              )}
              {(isImage || isSvgImageView) && (
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  title={t("topbar.toggleDetails")}
                  className={`flex items-center justify-center h-7 w-8 rounded-lg cursor-pointer transition-colors duration-150 ${showDetails ? "text-blue-500 bg-blue-500/10 dark:bg-blue-500/20" : ""}`}
                  style={{ color: showDetails ? undefined : colors.muted }}
                  onMouseEnter={e => { if (!showDetails) e.currentTarget.style.background = colors.hover; }}
                  onMouseLeave={e => { if (!showDetails) e.currentTarget.style.background = "transparent"; }}
                >
                  <Info className="h-4 w-4" />
                </button>
              )}
              {isPdf && (
                <button
                  onClick={handleOpenInSystemApp}
                  title={t("topbar.openInSystemViewerTitle")}
                  className="flex items-center gap-1.5 h-7 px-2.5 text-[12px] font-semibold rounded-lg cursor-pointer transition-colors duration-150 mr-1"
                  style={{
                    color: colors.text,
                    background: colors.badgeBg,
                    border: `1px solid ${colors.badgeBdr}`,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = colors.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = colors.badgeBg)}
                >
                  <ExternalLink className="h-3.5 w-3.5 text-blue-500" />
                  <span className="hidden sm:inline">{t("topbar.openInSystemViewer")}</span>
                </button>
              )}
              <button
                onClick={handleDownload}
                title={t("topbar.download")}
                className="flex items-center justify-center h-7 w-8 rounded-lg cursor-pointer transition-colors duration-150"
                style={{ color: colors.muted }}
                onMouseEnter={e => (e.currentTarget.style.background = colors.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <Download className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            onClick={onClose}
            title={t("topbar.close")}
            className="flex items-center justify-center h-7 w-8 rounded-lg cursor-pointer transition-colors duration-150 ml-0.5 hover:text-red-500"
            style={{ color: colors.muted }}
            onMouseEnter={e => (e.currentTarget.style.background = colors.hover)}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden relative" style={{ background: colors.bg }}>

        {/* Loading */}
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
            <Loader2 className="h-7 w-7 animate-spin text-blue-500" />
            <div className="flex flex-col items-center gap-1.5">
              <span
                className="text-[10px] font-bold font-mono uppercase tracking-widest"
                style={{ color: colors.muted }}
              >
                {t("loading")}
              </span>
              <div
                className="w-36 h-1 rounded-full overflow-hidden"
                style={{ background: colors.progressTrack }}
              >
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span
                className="text-[10px] font-mono"
                style={{ color: colors.muted }}
              >
                {progress}%
              </span>
            </div>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div
              className="rounded-2xl px-6 py-4 text-[13px] font-semibold max-w-sm text-center"
              style={{
                background: colors.errorBg,
                border: `1px solid ${colors.errorBdr}`,
                color: colors.errorText,
              }}
            >
              {error}
            </div>
            <button
              onClick={handleDownload}
              className="px-5 py-2 rounded-xl text-[12px] font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors duration-150 cursor-pointer"
            >
              {t("downloadInstead")}
            </button>
          </div>
        )}

        {/* Content */}
        {!loading && !error && (
          <div className="absolute inset-0">

            {/* IMAGE / SVG VECTOR */}
            {(isImage || isSvgImageView) && contentUrl && (
              <div className="w-full h-full flex relative overflow-hidden">
                {/* Main Viewport */}
                <div
                  className="flex-1 h-full flex items-center justify-center p-6 relative overflow-hidden select-none cursor-grab active:cursor-grabbing"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onWheel={handleWheel}
                  style={{
                    backgroundImage: showGrid
                      ? `radial-gradient(circle at center, ${colors.dotGrid} 1px, transparent 1px)`
                      : "none",
                    backgroundSize: "20px 20px",
                    backgroundColor: showGrid ? (isDark ? "#080c10" : "#fafafa") : colors.bg,
                  }}
                >
                  <div
                    style={{
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                      transition: isDragging ? "none" : "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  >
                    <img
                      src={contentUrl}
                      alt={file.name}
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                      }}
                      className="max-w-[85vw] max-h-[80vh] object-contain pointer-events-none"
                      style={{
                        boxShadow: "0 25px 60px rgba(0,0,0,0.35)",
                        borderRadius: "4px",
                      }}
                    />
                  </div>

                  {/* Floating bottom controls bar (glassmorphic pill) */}
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2.5 px-4 py-2 rounded-full border shadow-xl backdrop-blur-md bg-white/75 dark:bg-slate-900/70 border-slate-200/50 dark:border-slate-800/40 text-slate-700 dark:text-slate-250 z-20">
                    <button
                      onClick={zoomOut}
                      title={t("image.zoomOut")}
                      className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <ZoomOut className="h-4 w-4" />
                    </button>
                    <span className="text-[11px] font-mono font-bold min-w-[40px] text-center">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      onClick={zoomIn}
                      title={t("image.zoomIn")}
                      className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                    <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />
                    <button
                      onClick={resetZoom}
                      title={t("image.resetZoom")}
                      className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />
                    <button
                      onClick={rotateCounterClockwise}
                      title={t("image.rotateCounterClockwise")}
                      className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <RotateCw className="h-4 w-4 -scale-x-100" />
                    </button>
                    <button
                      onClick={rotateClockwise}
                      title={t("image.rotateClockwise")}
                      className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <RotateCw className="h-4 w-4" />
                    </button>
                    <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />
                    <button
                      onClick={() => setShowGrid(!showGrid)}
                      title={t("image.toggleGrid")}
                      className={`p-1 rounded-lg transition-colors cursor-pointer ${showGrid ? "text-blue-500" : ""}`}
                    >
                      <Grid3X3 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Collapsible Info Panel */}
                {showDetails && (
                  <div
                    className="w-64 border-l flex flex-col shrink-0 animate-in slide-in-from-right duration-250"
                    style={{
                      background: isDark ? "#0f131a" : "#fafafa",
                      borderColor: colors.border,
                    }}
                  >
                    <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: colors.border }}>
                      <span className="text-[12px] font-bold uppercase tracking-wider text-slate-400">{t("details.title")}</span>
                      <button
                        onClick={() => setShowDetails(false)}
                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-250 cursor-pointer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="p-4 flex flex-col gap-4 overflow-y-auto text-[12px]">
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">{t("details.name")}</div>
                        <div className="font-semibold break-all text-slate-700 dark:text-slate-300">{file.name}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">{t("details.dimensions")}</div>
                        <div className="font-semibold text-slate-700 dark:text-slate-300">
                          {dimensions ? `${dimensions.width} × ${dimensions.height} px` : t("details.loadingDimensions")}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">{t("details.fileSize")}</div>
                        <div className="font-semibold text-slate-700 dark:text-slate-300">{formatSize(file.size)}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">{t("details.mimeType")}</div>
                        <div className="font-mono text-slate-750 dark:text-slate-400">{file.mime}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">{t("details.path")}</div>
                        <div className="font-semibold text-slate-700 dark:text-slate-300 font-mono text-[11px] bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded border border-slate-200/50 dark:border-slate-800/50 inline-block">{file.folderPath}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">{t("details.uploadedAt")}</div>
                        <div className="font-semibold text-slate-700 dark:text-slate-300">
                          {new Date(file.uploadedAt).toLocaleString(i18n.language)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* VIDEO */}
            {isVideo && contentUrl && (
              <div
                ref={videoContainerRef}
                className="w-full h-full flex items-center justify-center p-4 relative bg-black select-none group"
              >
                {/* Native Video Element */}
                <video
                  ref={videoRef}
                  src={contentUrl}
                  autoPlay
                  onClick={togglePlayVideo}
                  onPlay={() => setIsVideoPlaying(true)}
                  onPause={() => setIsVideoPlaying(false)}
                  onTimeUpdate={handleVideoTimeUpdate}
                  onLoadedMetadata={handleVideoLoadedMetadata}
                  className="max-w-full max-h-full cursor-pointer shadow-2xl rounded-lg"
                  style={{ maxHeight: "calc(100vh - 120px)" }}
                />

                {/* Big Centered Play/Pause Overlay Button */}
                <div
                  onClick={togglePlayVideo}
                  className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-all duration-300 ${
                    !isVideoPlaying || showVideoControls ? "opacity-100" : "opacity-0"
                  }`}
                >
                  <button className="h-16 w-16 flex items-center justify-center rounded-full bg-black/50 border border-white/20 text-white backdrop-blur-md cursor-pointer hover:scale-110 active:scale-95 transition-all pointer-events-auto duration-200 shadow-lg">
                    {isVideoPlaying ? (
                      <Pause className="h-6 w-6 fill-white" />
                    ) : (
                      <Play className="h-6 w-6 fill-white ml-1" />
                    )}
                  </button>
                </div>

                {/* Glassmorphic Control Bar */}
                <div
                  className={`absolute bottom-6 left-6 right-6 p-4 rounded-2xl flex flex-col gap-2.5 transition-all duration-300 shadow-2xl border border-white/10 backdrop-blur-md bg-black/60 text-white z-20 ${
                    showVideoControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
                  }`}
                >
                  {/* Progress Timeline Slider */}
                  <div className="flex items-center gap-3 w-full">
                    <span className="text-[10px] font-mono text-white/70 min-w-[35px] text-right">
                      {formatTime(videoCurrentTime)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={videoDuration || 100}
                      step={0.1}
                      value={videoCurrentTime}
                      onChange={handleVideoSeek}
                      className="flex-1 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none"
                    />
                    <span className="text-[10px] font-mono text-white/70 min-w-[35px]">
                      {formatTime(videoDuration)}
                    </span>
                  </div>

                  {/* Buttons & Sliders */}
                  <div className="flex items-center justify-between">
                    {/* Left: Play/Pause, Skip Back, Skip Forward, Volume */}
                    <div className="flex items-center gap-3.5">
                      <button
                        onClick={togglePlayVideo}
                        className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer text-white/90 hover:text-white"
                      >
                        {isVideoPlaying ? <Pause className="h-4.5 w-4.5" /> : <Play className="h-4.5 w-4.5" />}
                      </button>

                      <button
                        onClick={() => skipVideo(-10)}
                        title={t("media.skipBack")}
                        className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer text-white/85 hover:text-white"
                      >
                        <SkipBack className="h-4 w-4" />
                      </button>

                      <button
                        onClick={() => skipVideo(10)}
                        title={t("media.skipForward")}
                        className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer text-white/85 hover:text-white"
                      >
                        <SkipForward className="h-4 w-4" />
                      </button>

                      <div className="h-4 w-px bg-white/10" />

                      {/* Volume controls */}
                      <div className="flex items-center gap-1.5 group/volume">
                        <button
                          onClick={toggleVideoMute}
                          className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer text-white/85 hover:text-white"
                        >
                          {isVideoMuted || videoVolume === 0 ? (
                            <VolumeX className="h-4.5 w-4.5" />
                          ) : (
                            <Volume2 className="h-4.5 w-4.5" />
                          )}
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={isVideoMuted ? 0 : videoVolume}
                          onChange={handleVideoVolumeChange}
                          className="w-16 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white hover:accent-blue-500 focus:outline-none transition-all duration-200"
                        />
                      </div>
                    </div>

                    {/* Right: Speed, Fullscreen */}
                    <div className="flex items-center gap-3 relative">
                      {/* Playback Speed selector */}
                      <div className="relative">
                        <button
                          onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                          className="text-[11px] font-mono font-bold px-2 py-1 bg-white/10 hover:bg-white/20 border border-white/5 rounded-lg cursor-pointer transition-colors"
                        >
                          {videoSpeed === 1 ? "1.0x" : `${videoSpeed}x`}
                        </button>

                        {showSpeedMenu && (
                          <div className="absolute bottom-full right-0 mb-2 py-1.5 w-20 rounded-xl border border-white/10 bg-slate-900/90 backdrop-blur-lg shadow-xl text-white/95 flex flex-col z-35 animate-in fade-in slide-in-from-bottom-2 duration-150">
                            {[0.5, 1, 1.25, 1.5, 2].map((sp) => (
                              <button
                                key={sp}
                                onClick={() => handleVideoSpeedChange(sp)}
                                className={`px-3 py-1 text-left text-[11px] font-mono hover:bg-white/10 transition-colors w-full cursor-pointer ${
                                  videoSpeed === sp ? "text-blue-400 font-bold" : ""
                                }`}
                              >
                                {sp === 1 ? "1.0x" : `${sp}x`}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <button
                        onClick={handleVideoFullscreen}
                        className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer text-white/85 hover:text-white"
                      >
                        {isVideoFullscreen ? <Minimize className="h-4.5 w-4.5" /> : <Maximize className="h-4.5 w-4.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* AUDIO */}
            {isAudio && contentUrl && (
              <div className="w-full h-full flex items-center justify-center p-6 bg-slate-950/5 animate-in fade-in duration-200">
                {/* Audio Element */}
                <audio
                  ref={audioRef}
                  src={contentUrl}
                  autoPlay
                  onPlay={() => setIsAudioPlaying(true)}
                  onPause={() => setIsAudioPlaying(false)}
                  onTimeUpdate={handleAudioTimeUpdate}
                  onLoadedMetadata={handleAudioLoadedMetadata}
                />

                {/* Inline Styles for visualizer and rotation animation */}
                <style>{`
                  @keyframes audio-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                  }
                  @keyframes bounce-bar-1 { 0% { height: 15%; } 100% { height: 75%; } }
                  @keyframes bounce-bar-2 { 0% { height: 30%; } 100% { height: 95%; } }
                  @keyframes bounce-bar-3 { 0% { height: 20%; } 100% { height: 60%; } }
                  @keyframes bounce-bar-4 { 0% { height: 40%; } 100% { height: 85%; } }
                  @keyframes bounce-bar-5 { 0% { height: 10%; } 100% { height: 100%; } }
                `}</style>

                {/* Glassmorphic Music Card */}
                <div
                  className={`flex flex-col items-center gap-6 p-8 rounded-3xl max-w-sm w-full border backdrop-blur-lg shadow-2xl transition-all duration-350 ${
                    isDark
                      ? "bg-slate-900/60 border-slate-800/40 shadow-[0_0_50px_rgba(20,184,166,0.15)]"
                      : "bg-white/60 border-slate-200/50 shadow-[0_0_40px_rgba(20,184,166,0.1)]"
                  }`}
                >
                  {/* Vinyl/CD Disc Layout */}
                  <div className="relative group select-none">
                    {/* Outer glowing border */}
                    <div
                      className={`h-40 w-40 rounded-full flex items-center justify-center bg-slate-950/95 dark:bg-black/90 relative shadow-2xl transition-transform duration-300 ${
                        isAudioPlaying ? "scale-105" : "scale-100"
                      }`}
                      style={{
                        backgroundImage: "radial-gradient(circle, #27272a 1px, transparent 1px), radial-gradient(circle, #09090b 70%, transparent 70%)",
                        backgroundSize: "6px 6px, 100% 100%",
                        animation: "audio-spin 12s linear infinite",
                        animationPlayState: isAudioPlaying ? "running" : "paused",
                        border: "5px solid rgba(255,255,255,0.03)",
                      }}
                    >
                      {/* Vinyl grooves lines (repeated concentric circles) */}
                      <div className="absolute inset-4 rounded-full border border-white/5" />
                      <div className="absolute inset-8 rounded-full border border-white/5" />
                      <div className="absolute inset-12 rounded-full border border-white/5" />

                      {/* Disc Center Label */}
                      <div
                        className="h-16 w-16 rounded-full flex items-center justify-center text-teal-400 relative"
                        style={{
                          background: "linear-gradient(135deg, #134e4a 0%, #115e59 100%)",
                          boxShadow: "inset 0 2px 4px rgba(255,255,255,0.2)",
                        }}
                      >
                        <Music className="h-6 w-6 animate-pulse" style={{ animationPlayState: isAudioPlaying ? "running" : "paused" }} />
                        {/* Spindle hole */}
                        <div className="absolute h-3 w-3 rounded-full bg-slate-950 dark:bg-black border border-white/10" />
                      </div>
                    </div>
                  </div>

                  {/* Equalizer Waveform Bouncing Bars */}
                  <div className="flex items-end justify-center gap-1.5 h-10 px-4 w-full">
                    {[1, 2, 3, 4, 5, 4, 3, 2, 1].map((_, i) => {
                      const animName = `bounce-bar-${(i % 5) + 1}`;
                      return (
                        <div
                          key={i}
                          className="w-1 bg-teal-500 dark:bg-teal-400 rounded-t-full transition-all duration-300"
                          style={{
                            height: isAudioPlaying ? "100%" : "20%",
                            animation: isAudioPlaying ? `${animName} 0.8s ease-in-out infinite alternate` : "none",
                            animationDelay: `${i * 0.1}s`,
                          }}
                        />
                      );
                    })}
                  </div>

                  {/* Track Info */}
                  <div className="text-center min-w-0 w-full">
                    <p
                      className="text-[15px] font-bold truncate leading-snug"
                      style={{ color: colors.text }}
                    >
                      {file.name}
                    </p>
                    <p className="text-[11px] font-semibold mt-1 flex items-center justify-center gap-1.5" style={{ color: colors.muted }}>
                      <span className="h-1.5 w-1.5 rounded-full bg-teal-500 animate-ping" style={{ animationPlayState: isAudioPlaying ? "running" : "paused" }} />
                      {t("media.audioTrack")}
                    </p>
                  </div>

                  {/* Seek Bar & Duration */}
                  <div className="flex flex-col gap-1.5 w-full">
                    <input
                      type="range"
                      min={0}
                      max={audioDuration || 100}
                      step={0.1}
                      value={audioCurrentTime}
                      onChange={handleAudioSeek}
                      className="w-full h-1 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-500 dark:accent-teal-400 focus:outline-none"
                    />
                    <div className="flex items-center justify-between text-[10px] font-mono" style={{ color: colors.muted }}>
                      <span>{formatTime(audioCurrentTime)}</span>
                      <span>{formatTime(audioDuration)}</span>
                    </div>
                  </div>

                  {/* Primary Playback controls */}
                  <div className="flex items-center justify-center gap-5 w-full">
                    <button
                      onClick={() => skipAudio(-10)}
                      title={t("media.skipBack")}
                      className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800/60 rounded-xl transition-colors cursor-pointer"
                      style={{ color: colors.muted }}
                    >
                      <SkipBack className="h-5 w-5" />
                    </button>

                    <button
                      onClick={togglePlayAudio}
                      className="h-14 w-14 flex items-center justify-center rounded-full bg-teal-500 hover:bg-teal-400 hover:scale-105 active:scale-95 text-white cursor-pointer shadow-lg transition-all duration-200"
                    >
                      {isAudioPlaying ? (
                        <Pause className="h-5.5 w-5.5 fill-white" />
                      ) : (
                        <Play className="h-5.5 w-5.5 fill-white ml-1" />
                      )}
                    </button>

                    <button
                      onClick={() => skipAudio(10)}
                      title={t("media.skipForward")}
                      className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800/60 rounded-xl transition-colors cursor-pointer"
                      style={{ color: colors.muted }}
                    >
                      <SkipForward className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Secondary controls (Volume + Speed) */}
                  <div className="flex items-center justify-between w-full mt-2 border-t pt-4" style={{ borderColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }}>
                    {/* Volume */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={toggleAudioMute}
                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                        style={{ color: colors.muted }}
                      >
                        {isAudioMuted || audioVolume === 0 ? (
                          <VolumeX className="h-4 w-4" />
                        ) : (
                          <Volume2 className="h-4 w-4" />
                        )}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={isAudioMuted ? 0 : audioVolume}
                        onChange={handleAudioVolumeChange}
                        className="w-16 h-1 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-500 dark:accent-teal-400 focus:outline-none"
                      />
                    </div>

                    {/* Speed dropdown */}
                    <div className="relative">
                      <button
                        onClick={() => setShowAudioSpeedMenu(!showAudioSpeedMenu)}
                        className="text-[10px] font-mono font-bold px-2.5 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700/30 rounded-lg cursor-pointer transition-colors"
                        style={{ color: colors.text }}
                      >
                        {audioSpeed === 1 ? "1.0x" : `${audioSpeed}x`}
                      </button>

                      {showAudioSpeedMenu && (
                        <div
                          className={`absolute bottom-full right-0 mb-2 py-1 w-20 rounded-xl border shadow-xl flex flex-col z-35 animate-in fade-in slide-in-from-bottom-2 duration-150 ${
                            isDark
                              ? "bg-slate-900 border-slate-800 text-white"
                              : "bg-white border-slate-200 text-slate-800"
                          }`}
                        >
                          {[0.5, 1, 1.25, 1.5, 2].map((sp) => (
                            <button
                              key={sp}
                              onClick={() => handleAudioSpeedChange(sp)}
                              className={`px-3 py-1 text-left text-[11px] font-mono hover:bg-slate-100 dark:hover:bg-white/10 transition-colors w-full cursor-pointer ${
                                audioSpeed === sp
                                  ? "text-teal-500 font-bold"
                                  : isDark
                                  ? "text-slate-400"
                                  : "text-slate-600"
                              }`}
                            >
                              {sp === 1 ? "1.0x" : `${sp}x`}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* PDF */}
            {isPdf && (
              <div className="absolute inset-0 w-full h-full flex flex-col">
                <PdfErrorBoundary onRetry={() => setPdfData(pdfBufferRef.current ? new Uint8Array(pdfBufferRef.current) : null)}>
                  <PdfViewer
                    data={pdfData || pdfBufferRef.current}
                    fileName={file.name}
                    onOpenSystemApp={handleOpenInSystemApp}
                  />
                </PdfErrorBoundary>
              </div>
            )}

            {/* MARKDOWN — Elevated Document Sheet */}
            {isMarkdownPreview && (
              <div
                className="absolute inset-0 overflow-y-auto px-4 py-8 md:py-12 pointer-events-auto select-text flex justify-center"
                style={{
                  scrollbarWidth: "thin",
                  scrollbarColor: isDark ? "#333537 transparent" : "#e0e2e7 transparent",
                  background: isDark ? "#131314" : "#f0f4f9",
                }}
              >
                <div
                  className="w-full max-w-4xl bg-white dark:bg-[#1e1f20] border border-[#e0e2e7] dark:border-[#333537] rounded-2xl shadow-sm p-8 md:p-14 my-auto min-h-full teledrive-markdown-body"
                  onClick={(e) => {
                    const target = (e.target as HTMLElement).closest("a");
                    if (target && target.href) {
                      e.preventDefault();
                      try {
                        const parsed = new URL(target.href);
                        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
                          openUrl(target.href).catch(() => window.open(target.href, "_blank", "noopener,noreferrer"));
                        }
                      } catch {
                        // ignore malformed URL
                      }
                    }
                  }}
                  dangerouslySetInnerHTML={{ __html: markdownHtml ?? "" }}
                />
              </div>
            )}

            {/* CSV / TSV — Interactive Spreadsheet Grid */}
            {isTableView && textContent !== null && (
              <div className="absolute inset-0">
                <CsvTableViewer
                  content={textContent}
                  isTsv={isTsvFile}
                  isDark={isDark}
                />
              </div>
            )}

            {/* CODE — Edit Mode */}
            {isCode && isEditMode && (
              <CodeEditor
                value={editContent}
                onChange={setEditContent}
                fileName={file.name}
                onCursorChange={setCursorPos}
                className="absolute inset-0"
              />
            )}

            {/* CODE / SOURCE — Read Mode */}
            {isCode && !isEditMode && (
              <SyntaxHighlighter
                code={textContent!}
                fileName={file.name}
                wrapLines={wrapLines}
                fontSize={codeFontSize}
                className="absolute inset-0"
              />
            )}

            {/* ARCHIVE PREVIEW CARD */}
            {isArchive && !textContent && !contentUrl && (
              <div className="w-full h-full flex items-center justify-center p-6">
                <div
                  className="flex flex-col items-center max-w-md w-full p-8 rounded-3xl text-center shadow-sm"
                  style={{
                    background: isDark ? "#1e1f20" : "#ffffff",
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <div className="h-16 w-16 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center mb-4">
                    <FolderArchive className="h-8 w-8" />
                  </div>
                  <h3 className="text-base font-bold mb-1 truncate max-w-full" style={{ color: colors.text }}>
                    {file.name}
                  </h3>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-md font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      {t("archive.badge", { ext: ext.toUpperCase() })}
                    </span>
                    <span className="text-[11px] font-mono" style={{ color: colors.muted }}>
                      {formatSize(file.size)}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed mb-6" style={{ color: colors.muted }}>
                    {t("archive.description")}
                  </p>
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-full text-xs font-semibold bg-[#0b57d0] hover:bg-[#0842a0] text-white shadow-xs transition-colors cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    {t("archive.download")}
                  </button>
                </div>
              </div>
            )}

            {/* UNSUPPORTED BINARY FILE */}
            {!isImage && !isSvgImageView && !isVideo && !isAudio && !isPdf && !isMarkdownPreview && !isTableView && !isCode && !isArchive && (
              <div className="w-full h-full flex items-center justify-center p-6">
                <div
                  className="flex flex-col items-center max-w-md w-full p-8 rounded-3xl text-center shadow-sm"
                  style={{
                    background: isDark ? "#1e1f20" : "#ffffff",
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <div className="h-16 w-16 rounded-2xl bg-slate-100 dark:bg-[#282a2c] text-slate-500 dark:text-slate-400 flex items-center justify-center mb-4">
                    <FallbackIcon className="h-8 w-8" strokeWidth={1.5} />
                  </div>
                  <h3 className="text-base font-bold mb-1 truncate max-w-full" style={{ color: colors.text }}>
                    {file.name}
                  </h3>
                  <div className="flex items-center gap-2 mb-4">
                    <code className="text-[11px] font-mono px-2 py-0.5 rounded-md font-semibold" style={{ background: colors.badgeBg, color: colors.badgeText }}>
                      {file.mime || "application/octet-stream"}
                    </code>
                    <span className="text-[11px] font-mono" style={{ color: colors.muted }}>
                      {formatSize(file.size)}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed mb-6" style={{ color: colors.muted }}>
                    {t("unsupported.description")}
                  </p>
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-full text-xs font-semibold bg-[#0b57d0] hover:bg-[#0842a0] text-white shadow-xs transition-colors cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    {t("unsupported.download")}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Status bar ───────────────────────────────────────────────────── */}
      {(isCode || isMarkdownFile || isTableData || isEditMode) && !loading && !error && textContent !== null && (
        <div
          className="flex items-center justify-between px-4 shrink-0 select-none"
          style={{
            height: "26px",
            background: colors.statusbar,
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          <div className="flex items-center gap-3">
            {statusParts.map((part, i) => (
              <span key={i} className="text-[11px] font-mono" style={{ color: colors.muted }}>
                {part}
              </span>
            ))}
          </div>
          {isEditMode && (
            <span className="text-[11px] font-mono" style={{ color: isDark ? "#374151" : "#94a3b8" }}>
              {t("status.editorInfo")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
