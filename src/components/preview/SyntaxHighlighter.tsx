/**
 * SyntaxHighlighter.tsx
 * Read-only syntax-highlighted code view.
 *
 * Theme: One Dark Pro (dark) / GitHub Light (light) — both injected once.
 * Layout: sticky line-number gutter + scrollable code block (no table, fewer DOM nodes).
 * Performance: lazy highlight.js, React.memo, useMemo for line count.
 */
import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDarkMode } from "@/hooks/useDarkMode";
import { detectLang } from "@/lib/files/langDetect";

// ─── Theme CSS ─────────────────────────────────────────────────────────────

const CSS_DARK = `
.hljs{color:#abb2bf;background:transparent}
.hljs-comment,.hljs-quote{color:#5c6370;font-style:italic}
.hljs-doctag,.hljs-keyword,.hljs-formula{color:#c678dd}
.hljs-section,.hljs-name,.hljs-selector-tag,.hljs-deletion,.hljs-subst{color:#e06c75}
.hljs-literal{color:#56b6c2}
.hljs-string,.hljs-regexp,.hljs-addition,.hljs-attribute,.hljs-meta-string{color:#98c379}
.hljs-built_in,.hljs-class .hljs-title{color:#e6c07b}
.hljs-attr,.hljs-variable,.hljs-template-variable,.hljs-type,.hljs-selector-class,.hljs-selector-attr,.hljs-selector-pseudo,.hljs-number{color:#d19a66}
.hljs-symbol,.hljs-bullet,.hljs-link,.hljs-meta,.hljs-selector-id,.hljs-title{color:#61aeee}
.hljs-emphasis{font-style:italic}
.hljs-strong{font-weight:bold}
.hljs-link{text-decoration:underline}
`;

const CSS_LIGHT = `
.hljs{color:#24292f;background:transparent}
.hljs-comment,.hljs-quote{color:#57606a;font-style:italic}
.hljs-keyword,.hljs-doctag,.hljs-formula,.hljs-selector-tag{color:#cf222e}
.hljs-section,.hljs-name,.hljs-deletion,.hljs-subst{color:#82071e}
.hljs-literal{color:#0550ae}
.hljs-string,.hljs-regexp,.hljs-addition,.hljs-attribute,.hljs-meta-string{color:#0a3069}
.hljs-built_in,.hljs-class .hljs-title,.hljs-title{color:#8250df}
.hljs-attr,.hljs-variable,.hljs-template-variable,.hljs-type,.hljs-selector-class,.hljs-number{color:#0550ae}
.hljs-symbol,.hljs-bullet,.hljs-link,.hljs-meta,.hljs-selector-id{color:#0a3069}
.hljs-emphasis{font-style:italic}
.hljs-strong{font-weight:bold}
.hljs-link{text-decoration:underline}
`;

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
  const [highlighted, setHighlighted] = useState<string>("");
  const [hljsReady, setHljsReady] = useState(false);
  const langInfo = useMemo(() => detectLang(fileName), [fileName]);

  const lineCount = useMemo(() => code.split(/\r?\n/).length, [code]);
  const isTooLarge = lineCount > MAX_HIGHLIGHT_LINES;
  const lineHeightPx = Math.round(fontSize * 1.62);

  // ── Inject theme CSS dynamically based on active theme ───────────────────
  useEffect(() => {
    // Clean up older conflicting tags if they exist
    document.getElementById("hljs-dark")?.remove();
    document.getElementById("hljs-light")?.remove();

    const css = isDark ? CSS_DARK : CSS_LIGHT;
    let el = document.getElementById("hljs-theme");
    if (!el) {
      el = document.createElement("style");
      el.id = "hljs-theme";
      document.head.appendChild(el);
    }
    el.textContent = css;
  }, [isDark]);

  // ── Highlight.js — lazy load + highlight ─────────────────────────────────
  useEffect(() => {
    if (isTooLarge) {
      setHighlighted(
        code
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
      );
      setHljsReady(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const hljs = (await import("highlight.js")).default;
        if (cancelled) return;

        let html: string;
        if (langInfo.hljsLang !== "plaintext") {
          html = hljs.highlight(code, {
            language: langInfo.hljsLang,
            ignoreIllegals: true,
          }).value;
        } else {
          html = code
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        }

        if (!cancelled) {
          setHighlighted(html);
          setHljsReady(true);
        }
      } catch {
        if (!cancelled) {
          setHighlighted(
            code
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
          );
          setHljsReady(true);
        }
      }
    })();

    return () => { cancelled = true; };
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
        {hljsReady ? (
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code style={{ opacity: 0.5 }}>{code}</code>
        )}
      </pre>
    </div>
  );
});
