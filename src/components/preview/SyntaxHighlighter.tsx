/**
 * SyntaxHighlighter.tsx
 * Read-only syntax-highlighted code view.
 *
 * Theme: One Dark Pro (dark) / GitHub Light (light) — statically bundled in index.css.
 * Layout: sticky line-number gutter + scrollable code block (no table, fewer DOM nodes).
 * Performance: pre-bundled highlight.js, React.memo, useMemo for line count.
 */
import { memo, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import hljs from "highlight.js";
import { useDarkMode } from "@/hooks/useDarkMode";
import { detectLang } from "@/lib/files/langDetect";

/**
 * Robust hljs resolver handling ESM default export, CJS export, and Vite bundling.
 */
function getHljs(): typeof hljs {
  if (typeof (hljs as any)?.highlight === "function") {
    return hljs;
  }
  if (typeof (hljs as any)?.default?.highlight === "function") {
    return (hljs as any).default;
  }
  return hljs;
}

// Max lines to highlight; beyond this, show plain text with a notice
const MAX_HIGHLIGHT_LINES = 3000;

// ─── Component ─────────────────────────────────────────────────────────────

interface Props {
  code: string;
  fileName: string;
  className?: string;
  wrapLines?: boolean;
  fontSize?: number;
}

export const SyntaxHighlighter = memo(function SyntaxHighlighter({
  code,
  fileName,
  className = "",
  wrapLines = false,
  fontSize = 13,
}: Props) {
  const { t } = useTranslation("preview");
  const isDark = useDarkMode();
  const langInfo = useMemo(() => detectLang(fileName), [fileName]);

  const lineCount = useMemo(() => code.split(/\r?\n/).length, [code]);
  const isTooLarge = lineCount > MAX_HIGHLIGHT_LINES;
  const lineHeightPx = Math.round(fontSize * 1.62);

  // Clean up any legacy dynamic style elements if present in DOM
  useEffect(() => {
    document.getElementById("hljs-theme")?.remove();
    document.getElementById("hljs-dark")?.remove();
    document.getElementById("hljs-light")?.remove();
  }, []);

  // ── Highlight.js — synchronous, bundled, zero dynamic-import failure ─────
  const highlighted = useMemo(() => {
    const escapeHtml = (str: string) =>
      str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    if (isTooLarge) {
      return escapeHtml(code);
    }

    try {
      const h = getHljs();
      const lang = langInfo.hljsLang;
      if (lang && lang !== "plaintext" && typeof h?.getLanguage === "function" && h.getLanguage(lang)) {
        return h.highlight(code, {
          language: lang,
          ignoreIllegals: true,
        }).value;
      }
      return escapeHtml(code);
    } catch (err) {
      console.warn("[SyntaxHighlighter] highlight error:", err);
      return escapeHtml(code);
    }
  }, [code, langInfo.hljsLang, isTooLarge]);

  // ── Theme-derived values ─────────────────────────────────────────────────
  const bg         = isDark ? "#0d1117" : "#ffffff";
  const gutterBg   = isDark ? "#0d1117" : "#f6f8fa";
  const gutterText = isDark ? "#4b5563" : "#8b949e";
  const gutterBdr  = isDark ? "#1e293b" : "#e2e8f0";
  const codeColor  = isDark ? "#abb2bf" : "#24292f";

  return (
    <div
      className={`relative grid h-full w-full overflow-auto select-text pointer-events-auto ${className}`}
      style={{
        gridTemplateColumns: "min-content 1fr",
        background: bg,
        fontFamily: "'Geist Mono', 'Fira Code', 'JetBrains Mono', 'Cascadia Code', monospace",
        fontSize: `${fontSize}px`,
        lineHeight: `${lineHeightPx}px`,
        scrollbarWidth: "thin",
        scrollbarColor: isDark ? "#334155 transparent" : "#cbd5e1 transparent",
      }}
      role="region"
      aria-label={t("syntaxHighlighter.ariaLabel")}
    >
      {/* ── Sticky line-number gutter ─────────────────────────────────── */}
      <div
        aria-hidden="true"
        className="sticky left-0 z-10 shrink-0 select-none text-right"
        style={{
          boxSizing: "border-box",
          minWidth: "3.5rem",
          paddingTop: "1rem",
          paddingBottom: "1rem",
          paddingRight: "1rem",
          paddingLeft: "0.75rem",
          background: gutterBg,
          color: gutterText,
          borderRight: `1px solid ${gutterBdr}`,
          whiteSpace: "pre",
          lineHeight: `${lineHeightPx}px`,
          fontSize: `${Math.max(fontSize - 1, 11)}px`,
          fontFamily: "inherit",
          userSelect: "none",
          pointerEvents: "none",
          transition: "background 0.2s, color 0.2s",
        }}
      >
        {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
      </div>

      {/* ── Code block ───────────────────────────────────────────────── */}
      <pre
        className="m-0 overflow-visible"
        style={{
          padding: "1rem 1.5rem 1rem 0.75rem",
          background: "transparent",
          color: codeColor,
          whiteSpace: wrapLines ? "pre-wrap" : "pre",
          wordBreak: wrapLines ? "break-word" : "normal",
          lineHeight: `${lineHeightPx}px`,
          fontFamily: "inherit",
          fontSize: "inherit",
          transition: "color 0.2s",
        }}
      >
        {isTooLarge && (
          <div
            className="mb-3 text-[11px] font-bold rounded-md px-3 py-1.5 inline-block"
            style={{
              background: isDark ? "rgba(245,158,11,0.12)" : "#fef9c3",
              color: isDark ? "#fbbf24" : "#92400e",
              border: `1px solid ${isDark ? "rgba(245,158,11,0.25)" : "#fde68a"}`,
            }}
          >
            ⚠ {t("syntaxHighlighter.largeFile", { count: lineCount })}
          </div>
        )}
        <code className="hljs font-mono" dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
});
