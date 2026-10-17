/**
 * PdfViewer.tsx
 * Production-quality, crash-safe PDF viewer for TeleDrive (Tauri).
 *
 * Features:
 *  • Continuous multi-page scroll layout (like Adobe / Chrome PDF viewer)
 *  • High-DPI canvas rendering (devicePixelRatio aware)
 *  • Zoom in / out / fit-width / fit-page / custom % input
 *  • Scroll-wheel zoom (Ctrl+Wheel)
 *  • Keyboard navigation: ArrowUp/Down, PageUp/Down, Home/End, Ctrl+= / Ctrl+-
 *  • Clickable page number input (jump to any page)
 *  • Rotation (90° CW)
 *  • Print via hidden iframe blob
 *  • "Open in System Viewer" button
 *  • Full error recovery: PDF.js missing, corrupted file, rendering failures
 *  • Memory-safe: destroys old PDFDocumentProxy on unmount / data change
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  memo,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  ExternalLink,
  Maximize2,
  FileText,
  Loader2,
  AlertCircle,
  Printer,
  Minus,
  Plus,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  data: Uint8Array | null;
  fileName: string;
  onOpenSystemApp?: () => void;
}

interface PageEntry {
  pageNum: number;
  width: number;   // CSS pixels at scale=1, rotation=0
  height: number;  // CSS pixels at scale=1, rotation=0
}

// ─── Utility: clamp ───────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── SinglePageCanvas — renders one PDF page in an IntersectionObserver ──────

interface PageCanvasProps {
  pdfDoc: any;
  pageNum: number;
  scale: number;
  rotation: number;
}

const PageCanvas = memo(function PageCanvas({
  pdfDoc,
  pageNum,
  scale,
  rotation,
}: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<any>(null);
  const isVisibleRef = useRef(false);
  const pendingRender = useRef(false);

  // Trigger render
  const doRender = useCallback(async () => {
    if (!canvasRef.current || !pdfDoc) return;
    // Cancel any in-progress render
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel(); } catch (_) {}
      renderTaskRef.current = null;
    }

    try {
      const page = await pdfDoc.getPage(pageNum);
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale, rotation });

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return;

      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      ctx.save();
      ctx.scale(dpr, dpr);

      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;
      ctx.restore();
    } catch (err: any) {
      if (err?.name !== "RenderingCancelledException") {
        console.warn(`[PdfViewer] Page ${pageNum} render error:`, err?.message ?? err);
      }
    }
  }, [pdfDoc, pageNum, scale, rotation]);

  // Use IntersectionObserver so we only render visible pages
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          isVisibleRef.current = true;
          doRender();
        } else {
          isVisibleRef.current = false;
          pendingRender.current = false;
          // Cancel render of off-screen pages to save GPU
          if (renderTaskRef.current) {
            try { renderTaskRef.current.cancel(); } catch (_) {}
            renderTaskRef.current = null;
          }
        }
      },
      { threshold: 0.01, rootMargin: "300px" }
    );
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [doRender]);

  // Re-render when scale/rotation changes (if visible)
  useEffect(() => {
    if (isVisibleRef.current) {
      doRender();
    } else {
      pendingRender.current = true;
    }
  }, [doRender]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch (_) {}
      }
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="flex-shrink-0 flex items-center justify-center"
    >
      <canvas
        ref={canvasRef}
        className="shadow-[0_2px_12px_rgba(0,0,0,0.35)] rounded-[2px] bg-white block"
      />
    </div>
  );
});

// ─── Main PdfViewer Component ─────────────────────────────────────────────────

export function PdfViewer({ data, fileName, onOpenSystemApp }: Props) {
  const { t } = useTranslation("preview");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // ── PDF state ────────────────────────────────────────────────────────────
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // Holds a translation key (resolved at render time) rather than the message itself
  const [error, setError] = useState<string | null>(null);
  const pdfDocRef = useRef<any>(null); // for cleanup

  // ── View state ────────────────────────────────────────────────────────────
  const [scale, setScale] = useState(1.25);
  const [rotation, setRotation] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInputValue, setPageInputValue] = useState("1");
  const [isEditingPage, setIsEditingPage] = useState(false);

  // Track visible page via scroll
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  // ── Load PDF ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    // Destroy old doc
    if (pdfDocRef.current) {
      try { pdfDocRef.current.destroy(); } catch (_) {}
      pdfDocRef.current = null;
    }
    setPdfDoc(null);
    setTotalPages(0);
    setPages([]);
    setCurrentPage(1);
    setPageInputValue("1");
    setError(null);
    pageRefs.current = [];

    if (!data || data.length === 0) {
      setError("pdf.errors.noData");
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const pdfjs = (window as any).pdfjsLib;
        if (!pdfjs) {
          throw new Error(
            "PDF engine is not available. Please reload the application."
          );
        }

        // Configure worker
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.js";
        }

        // Copy buffer to avoid detached ArrayBuffer issues after component re-renders
        const buf = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength
        );

        const loadTask = pdfjs.getDocument({
          data: new Uint8Array(buf),
          // Disable range requests (we already have the full buffer)
          disableRange: true,
          disableStream: true,
          disableAutoFetch: true,
          // Suppress cmap warnings — most modern PDFs don't need them
          isEvalSupported: false,
        });

        const doc = await loadTask.promise;
        if (cancelled) {
          doc.destroy();
          return;
        }

        pdfDocRef.current = doc;

        // Pre-fetch page dimensions for layout (use scale=1)
        const pageEntries: PageEntry[] = [];
        const numPages = doc.numPages;

        for (let i = 1; i <= numPages; i++) {
          try {
            const page = await doc.getPage(i);
            const vp = page.getViewport({ scale: 1, rotation: 0 });
            pageEntries.push({ pageNum: i, width: vp.width, height: vp.height });
            page.cleanup();
          } catch (pageErr) {
            console.warn(`[PdfViewer] Could not get dimensions for page ${i}:`, pageErr);
            pageEntries.push({ pageNum: i, width: 595, height: 842 }); // A4 fallback
          }
        }

        if (cancelled) {
          doc.destroy();
          return;
        }

        pageRefs.current = new Array(numPages).fill(null);
        setPdfDoc(doc);
        setTotalPages(numPages);
        setPages(pageEntries);
        setCurrentPage(1);
        setPageInputValue("1");
      } catch (err: any) {
        if (cancelled) return;
        console.error("[PdfViewer] Failed to load PDF:", err);
        const msg =
          err?.message?.includes("Invalid PDF")
            ? "pdf.errors.invalid"
            : err?.message?.includes("Password")
            ? "pdf.errors.passwordProtected"
            : err?.message?.includes("engine")
            ? "pdf.errors.engineUnavailable"
            : "pdf.errors.loadFailed";
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [data]);

  // Destroy PDF on unmount
  useEffect(() => {
    return () => {
      if (pdfDocRef.current) {
        try { pdfDocRef.current.destroy(); } catch (_) {}
        pdfDocRef.current = null;
      }
    };
  }, []);


  // ── Scroll-based current page tracking ───────────────────────────────────
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || pages.length === 0) return;

    const onScroll = () => {
      const containerTop = container.scrollTop;
      const containerCenter = containerTop + container.clientHeight / 2;

      let bestPage = 1;
      let bestDist = Infinity;

      for (let i = 0; i < pageRefs.current.length; i++) {
        const el = pageRefs.current[i];
        if (!el) continue;
        const elTop = el.offsetTop;
        const elHeight = el.offsetHeight;
        const elCenter = elTop + elHeight / 2;
        const dist = Math.abs(elCenter - containerCenter);
        if (dist < bestDist) {
          bestDist = dist;
          bestPage = i + 1;
        }
      }

      setCurrentPage((prev) => {
        if (prev !== bestPage) setPageInputValue(String(bestPage));
        return bestPage;
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [pages]);

  // ── Zoom ─────────────────────────────────────────────────────────────────
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 5.0;
  const ZOOM_STEP = 0.25;

  const zoomIn = useCallback(() => {
    setScale((s) => clamp(Math.round((s + ZOOM_STEP) * 100) / 100, MIN_SCALE, MAX_SCALE));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((s) => clamp(Math.round((s - ZOOM_STEP) * 100) / 100, MIN_SCALE, MAX_SCALE));
  }, []);

  const fitWidth = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || pages.length === 0) return;
    const avail = container.clientWidth - 48; // 24px padding each side
    const pageW = pages[0]?.width ?? 595;
    const isRotated = rotation % 180 !== 0;
    const effectiveW = isRotated ? (pages[0]?.height ?? 842) : pageW;
    const ns = clamp(Math.round((avail / effectiveW) * 100) / 100, MIN_SCALE, MAX_SCALE);
    setScale(ns);
  }, [pages, rotation]);

  const fitPage = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || pages.length === 0) return;
    const availW = container.clientWidth - 48;
    const availH = container.clientHeight - 48;
    const pageW = pages[0]?.width ?? 595;
    const pageH = pages[0]?.height ?? 842;
    const isRotated = rotation % 180 !== 0;
    const effectiveW = isRotated ? pageH : pageW;
    const effectiveH = isRotated ? pageW : pageH;
    const scaleW = availW / effectiveW;
    const scaleH = availH / effectiveH;
    const ns = clamp(Math.round(Math.min(scaleW, scaleH) * 100) / 100, MIN_SCALE, MAX_SCALE);
    setScale(ns);
  }, [pages, rotation]);

  const rotate = useCallback(() => {
    setRotation((r) => (r + 90) % 360);
  }, []);

  // Ctrl+wheel zoom
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      setScale((s) => {
        const ns = clamp(Math.round(s * factor * 100) / 100, MIN_SCALE, MAX_SCALE);
        return ns;
      });
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  // ── Keyboard navigation ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack if user is typing in an input
      if (isEditingPage) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const container = scrollContainerRef.current;
      if (!container) return;

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        zoomIn();
      } else if (ctrl && e.key === "-") {
        e.preventDefault();
        zoomOut();
      } else if (ctrl && e.key === "0") {
        e.preventDefault();
        setScale(1.0);
      } else if (e.key === "PageDown" || (e.key === "ArrowDown" && !ctrl)) {
        e.preventDefault();
        container.scrollBy({ top: container.clientHeight * 0.85, behavior: "smooth" });
      } else if (e.key === "PageUp" || (e.key === "ArrowUp" && !ctrl)) {
        e.preventDefault();
        container.scrollBy({ top: -container.clientHeight * 0.85, behavior: "smooth" });
      } else if (e.key === "Home" || (e.key === "ArrowUp" && ctrl)) {
        e.preventDefault();
        container.scrollTo({ top: 0, behavior: "smooth" });
      } else if (e.key === "End" || (e.key === "ArrowDown" && ctrl)) {
        e.preventDefault();
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isEditingPage, zoomIn, zoomOut]);

  // ── Page navigation ───────────────────────────────────────────────────────
  const scrollToPage = useCallback((pageNum: number) => {
    const el = pageRefs.current[pageNum - 1];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const prevPage = useCallback(() => {
    const target = clamp(currentPage - 1, 1, totalPages);
    scrollToPage(target);
  }, [currentPage, totalPages, scrollToPage]);

  const nextPage = useCallback(() => {
    const target = clamp(currentPage + 1, 1, totalPages);
    scrollToPage(target);
  }, [currentPage, totalPages, scrollToPage]);

  const handlePageInputCommit = useCallback(() => {
    const num = parseInt(pageInputValue, 10);
    if (!isNaN(num) && num >= 1 && num <= totalPages) {
      scrollToPage(num);
    } else {
      setPageInputValue(String(currentPage));
    }
    setIsEditingPage(false);
  }, [pageInputValue, totalPages, currentPage, scrollToPage]);

  // ── Print ─────────────────────────────────────────────────────────────────
  const handlePrint = useCallback(() => {
    if (!data) return;
    try {
      const blob = new Blob([data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = url;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        try {
          iframe.contentWindow?.print();
        } catch (e) {
          // Fallback: open in new tab
          window.open(url, "_blank");
        }
        setTimeout(() => {
          document.body.removeChild(iframe);
          URL.revokeObjectURL(url);
        }, 2000);
      };
    } catch (e) {
      console.warn("[PdfViewer] Print failed:", e);
    }
  }, [data]);

  // ── Computed page dimensions at current scale ─────────────────────────────
  const pageRects = useMemo(() => {
    return pages.map((p) => {
      const isRotated = rotation % 180 !== 0;
      const w = (isRotated ? p.height : p.width) * scale;
      const h = (isRotated ? p.width : p.height) * scale;
      return { w, h };
    });
  }, [pages, scale, rotation]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#1a1b1e] text-slate-300 gap-4 select-none">
        <div className="relative">
          <div className="w-14 h-14 rounded-2xl bg-[#252629] border border-white/8 flex items-center justify-center">
            <FileText className="h-7 w-7 text-red-400" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
            <Loader2 className="h-3 w-3 animate-spin text-white" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-200">{t("pdf.loading")}</p>
          <p className="text-xs text-slate-500 mt-1 max-w-[240px]">
            {fileName || t("pdf.preparing")}
          </p>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#1a1b1e] text-white p-6 text-center select-none">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 mb-5">
          <AlertCircle className="h-8 w-8" />
        </div>
        <h3 className="text-base font-semibold mb-2 text-white">{t("pdf.errorTitle")}</h3>
        <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">{t(error)}</p>
        <div className="flex gap-3">
          {onOpenSystemApp && (
            <button
              onClick={onOpenSystemApp}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-sm transition-colors shadow-lg shadow-blue-600/20 cursor-pointer"
            >
              <ExternalLink className="h-4 w-4" />
              {t("pdf.openInSystemViewer")}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full flex flex-col bg-[#1a1b1e] select-none overflow-hidden">
      {/* ── Toolbar ── */}
      <div
        ref={toolbarRef}
        className="flex-none h-11 px-3 bg-[#25272b]/98 backdrop-blur border-b border-white/[0.06] flex items-center justify-between z-20 text-slate-200 text-xs gap-2"
      >
        {/* Left: navigation */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={prevPage}
            disabled={currentPage <= 1}
            title={t("pdf.toolbar.previousPage")}
            className="p-1.5 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>

          {/* Page input */}
          <div className="flex items-center gap-1 font-mono">
            {isEditingPage ? (
              <input
                type="number"
                min={1}
                max={totalPages}
                value={pageInputValue}
                onChange={(e) => setPageInputValue(e.target.value)}
                onBlur={handlePageInputCommit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handlePageInputCommit();
                  if (e.key === "Escape") {
                    setPageInputValue(String(currentPage));
                    setIsEditingPage(false);
                  }
                }}
                autoFocus
                className="w-12 text-center bg-black/40 border border-blue-500/60 rounded text-[12px] py-0.5 outline-none text-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            ) : (
              <button
                onClick={() => {
                  setPageInputValue(String(currentPage));
                  setIsEditingPage(true);
                }}
                title={t("pdf.toolbar.jumpToPage")}
                className="px-1.5 py-0.5 rounded text-[12px] bg-black/30 border border-white/10 hover:border-white/25 hover:bg-black/50 transition-colors cursor-pointer tabular-nums"
              >
                {currentPage}
              </button>
            )}
            <span className="text-slate-500 text-[11px]">/</span>
            <span className="text-slate-400 text-[12px] tabular-nums">{totalPages}</span>
          </div>

          <button
            onClick={nextPage}
            disabled={currentPage >= totalPages}
            title={t("pdf.toolbar.nextPage")}
            className="p-1.5 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>

          {/* Separator */}
          <div className="w-px h-4 bg-white/10 mx-1" />

          {/* Filename badge */}
          {fileName && (
            <div className="hidden lg:flex items-center gap-1.5 text-slate-500 truncate max-w-[180px]">
              <FileText className="h-3 w-3 text-red-400 flex-shrink-0" />
              <span className="truncate text-[11px]">{fileName}</span>
            </div>
          )}
        </div>

        {/* Center: zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={zoomOut}
            disabled={scale <= MIN_SCALE}
            title={t("pdf.toolbar.zoomOut")}
            className="p-1.5 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <Minus className="h-3 w-3" />
          </button>

          <button
            onClick={() => setScale(1.0)}
            title={t("pdf.toolbar.resetZoom")}
            className="px-2 py-0.5 font-mono text-[11px] rounded hover:bg-white/10 transition-colors cursor-pointer min-w-[46px] text-center tabular-nums"
          >
            {Math.round(scale * 100)}%
          </button>

          <button
            onClick={zoomIn}
            disabled={scale >= MAX_SCALE}
            title={t("pdf.toolbar.zoomIn")}
            className="p-1.5 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <Plus className="h-3 w-3" />
          </button>

          <div className="w-px h-4 bg-white/10 mx-0.5" />

          <button
            onClick={fitWidth}
            title={t("pdf.toolbar.fitWidth")}
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
          >
            <Maximize2 className="h-3 w-3" />
          </button>

          <button
            onClick={fitPage}
            title={t("pdf.toolbar.fitPage")}
            className="px-2 py-0.5 rounded text-[10px] font-semibold hover:bg-white/10 transition-colors cursor-pointer text-slate-400 hover:text-slate-200"
          >
            {t("pdf.toolbar.fit")}
          </button>

          <button
            onClick={rotate}
            title={t("pdf.toolbar.rotate")}
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
          >
            <RotateCw className="h-3 w-3" />
          </button>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handlePrint}
            title={t("pdf.toolbar.print")}
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer text-slate-400 hover:text-slate-200"
          >
            <Printer className="h-3.5 w-3.5" />
          </button>

          {onOpenSystemApp && (
            <button
              onClick={onOpenSystemApp}
              title={t("pdf.toolbar.openInSystemAppTitle")}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-600/80 hover:bg-blue-600 active:bg-blue-700 text-white font-semibold text-[11px] transition-colors cursor-pointer shadow-sm"
            >
              <ExternalLink className="h-3 w-3" />
              <span className="hidden sm:inline">{t("pdf.toolbar.systemViewer")}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Scroll Canvas Area ── */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto bg-[#141517]"
        style={{ scrollBehavior: "auto" }}
      >
        <div
          className="flex flex-col items-center py-6 gap-4 px-6"
          style={{ minHeight: "100%" }}
        >
          {pdfDoc && pages.map((page, idx) => {
            const rect = pageRects[idx];
            return (
              <div
                key={page.pageNum}
                ref={(el) => { pageRefs.current[idx] = el; }}
                className="flex-shrink-0"
                style={{
                  width: `${Math.round(rect?.w ?? 0)}px`,
                  height: `${Math.round(rect?.h ?? 0)}px`,
                }}
              >
                <PageCanvas
                  pdfDoc={pdfDoc}
                  pageNum={page.pageNum}
                  scale={scale}
                  rotation={rotation}
                />
              </div>
            );
          })}

          {/* Empty state (shouldn't happen if no error) */}
          {!pdfDoc && !loading && !error && (
            <div className="text-slate-500 text-sm py-20">{t("pdf.noDocument")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
