/**
 * CodeEditor.tsx
 * Full CodeMirror 6 editor — lazy-loaded, fully theme-aware.
 *
 * Dark  → One Dark Pro (@codemirror/theme-one-dark)
 * Light → GitHub Light (inline custom theme, no extra package)
 *
 * Uses a Compartment to hot-swap the theme without destroying the editor.
 * Performance: single dynamic import on first mount, compartment reconfigure on theme change.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDarkMode } from "@/hooks/useDarkMode";
import { detectLang } from "@/lib/files/langDetect";

import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
} from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentUnit } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { oneDark } from "@codemirror/theme-one-dark";

interface CursorPosition { line: number; col: number; }

interface Props {
  value: string;
  onChange: (value: string) => void;
  fileName: string;
  onCursorChange?: (pos: CursorPosition) => void;
  className?: string;
}

// ─── GitHub Light inline theme ─────────────────────────────────────────────
function buildLightTheme(EditorView: any) {
  return EditorView.theme({
    "&": {
      height: "100%",
      fontSize: "13px",
      fontFamily: "'Geist Mono','Fira Code','JetBrains Mono','Cascadia Code',monospace",
      background: "#ffffff",
      color: "#24292f",
    },
    ".cm-content": { caretColor: "#0969da", padding: "1rem 0 1rem 0.75rem", lineHeight: "21px" },
    ".cm-cursor": { borderLeftColor: "#0969da", borderLeftWidth: "2px" },
    ".cm-gutters": {
      background: "#f6f8fa",
      borderRight: "1px solid #e2e8f0",
      color: "#8b949e",
      paddingTop: "1rem",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      boxSizing: "border-box",
      minWidth: "3.5rem",
      paddingRight: "1rem",
      paddingLeft: "0.75rem",
      fontSize: "12px",
    },
    ".cm-activeLineGutter": { background: "rgba(0,0,0,0.04)", color: "#24292f" },
    ".cm-activeLine": { background: "rgba(0,0,0,0.03)" },
    ".cm-selectionBackground, ::selection": { background: "#b6d7ff !important" },
    ".cm-focused .cm-selectionBackground": { background: "#b6d7ff" },
    ".cm-matchingBracket": { background: "#c8e1ff", outline: "1px solid #79b8ff" },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "inherit",
      scrollbarWidth: "thin",
      scrollbarColor: "#cbd5e1 transparent",
    },
    ".cm-tooltip": { background: "#f6f8fa", border: "1px solid #e2e8f0", borderRadius: "6px", color: "#24292f" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { background: "#dbeafe" },
    "&.cm-focused": { outline: "none" },
  }, { dark: false });
}

function buildDarkTheme(EditorView: any, oneDark: any) {
  // Start with One Dark base, then override font/size
  return [
    oneDark,
    EditorView.theme({
      "&": {
        height: "100%",
        fontSize: "13px",
        fontFamily: "'Geist Mono','Fira Code','JetBrains Mono','Cascadia Code',monospace",
        background: "#0d1117",
      },
      ".cm-content": { padding: "1rem 0 1rem 0.75rem", lineHeight: "21px" },
      ".cm-gutters": {
        background: "#0d1117",
        borderRight: "1px solid #1e293b",
        paddingTop: "1rem",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        boxSizing: "border-box",
        minWidth: "3.5rem",
        paddingRight: "1rem",
        paddingLeft: "0.75rem",
        fontSize: "12px",
      },
      ".cm-activeLineGutter": { background: "rgba(255,255,255,0.04)" },
      ".cm-activeLine": { background: "rgba(255,255,255,0.03)" },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily: "inherit",
        scrollbarWidth: "thin",
        scrollbarColor: "#334155 transparent",
      },
      "&.cm-focused": { outline: "none" },
    }, { dark: true }),
  ];
}

// ─── Component ─────────────────────────────────────────────────────────────

export function CodeEditor({ value, onChange, fileName, onCursorChange, className = "" }: Props) {
  const { t } = useTranslation("preview");
  const isDark = useDarkMode();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartmentRef = useRef<Compartment | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursorChange);
  const [isLoading, setIsLoading] = useState(false);
  const langInfo = detectLang(fileName);

  // Keep callback refs fresh
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onCursorRef.current = onCursorChange; }, [onCursorChange]);

  // ── Build + mount editor (once per fileName) ─────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let view: EditorView | null = null;

    try {
      // Language support (optional)
      let langExt: any[] = [];
      if (langInfo.cmLoader) {
        try { langExt = [langInfo.cmLoader()]; } catch { /* skip */ }
      }

      // Theme compartment — allows hot-swapping without recreating the editor
      const themeCompartment = new Compartment();
      themeCompartmentRef.current = themeCompartment;

      const isDarkNow = document.documentElement.classList.contains("dark");
      const themeExt = themeCompartment.of(
        isDarkNow ? buildDarkTheme(EditorView, oneDark) : buildLightTheme(EditorView)
      );

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        if (update.selectionSet && onCursorRef.current) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          onCursorRef.current({ line: line.number, col: pos - line.from + 1 });
        }
      });

      const state = EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          rectangularSelection(),
          crosshairCursor(),
          highlightSpecialChars(),
          highlightSelectionMatches(),
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          indentUnit.of("  "),
          autocompletion(),
          keymap.of([
            indentWithTab,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...completionKeymap,
          ]),
          EditorView.lineWrapping,
          ...langExt,
          themeExt,
          updateListener,
        ],
      });

      view = new EditorView({ state, parent: containerRef.current });
      viewRef.current = view;
      setIsLoading(false);
    } catch (err) {
      console.error("[CodeEditor] init error:", err);
      setIsLoading(false);
    }

    return () => {
      view?.destroy();
      viewRef.current = null;
      themeCompartmentRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName]);

  // ── Hot-swap theme via Compartment (no editor rebuild) ───────────────────
  useEffect(() => {
    const compartment = themeCompartmentRef.current;
    if (!compartment || !viewRef.current) return;
    viewRef.current.dispatch({
      effects: compartment.reconfigure(
        isDark ? buildDarkTheme(EditorView, oneDark) : buildLightTheme(EditorView)
      ),
    });
  }, [isDark]);

  // ── Sync external value without recreating the editor ───────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const curr = view.state.doc.toString();
    if (curr !== value) {
      view.dispatch({ changes: { from: 0, to: curr.length, insert: value } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const bg = isDark ? "#0d1117" : "#ffffff";

  return (
    <div
      className={`relative w-full h-full flex flex-col overflow-hidden ${className}`}
      style={{ background: bg }}
    >
      {isLoading && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3"
          style={{ background: bg }}
        >
          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          <span
            className="text-[10px] font-mono font-bold uppercase tracking-widest"
            style={{ color: isDark ? "#475569" : "#94a3b8" }}
          >
            {t("codeEditor.loading")}
          </span>
        </div>
      )}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{ display: isLoading ? "none" : "block", height: "100%" }}
      />
    </div>
  );
}
