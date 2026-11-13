/**
 * langDetect.ts
 * Maps file extensions to:
 *  - highlight.js language alias (for read/preview mode)
 *  - CodeMirror 6 language support (statically imported, for edit mode)
 *  - Human-readable display name (for status bar badge)
 *
 * IMPORTANT: All CodeMirror language packs are STATICALLY imported here so
 * that Vite/Rollup bundles them into the codemirror-vendor chunk at build
 * time. Dynamic import() calls for language packs fail silently in production
 * Tauri builds because the asset:// protocol + CSP blocks late chunk loading.
 */

// ─── Static imports — bundled into codemirror-vendor at build time ──────────
import { python }     from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { html }       from "@codemirror/lang-html";
import { css }        from "@codemirror/lang-css";
import { json }       from "@codemirror/lang-json";
import { xml }        from "@codemirror/lang-xml";
import { rust }       from "@codemirror/lang-rust";
import { go }         from "@codemirror/lang-go";
import { cpp }        from "@codemirror/lang-cpp";
import { java }       from "@codemirror/lang-java";
import { sql }        from "@codemirror/lang-sql";
import { markdown }   from "@codemirror/lang-markdown";

export interface LangInfo {
  /** highlight.js language alias — pass to hljs.highlight() */
  hljsLang: string;
  /** Display name shown in the status bar / language badge */
  displayName: string;
  /**
   * Synchronous factory returning a CodeMirror LanguageSupport instance.
   * Returns null for languages without CodeMirror pack support.
   * NOTE: Kept as a function (not a bare value) so each editor gets a
   * fresh LanguageSupport instance — CodeMirror extensions are stateful.
   */
  cmLoader: (() => any) | null;
}

const LANG_MAP: Record<string, LangInfo> = {
  // Python
  py:   { hljsLang: "python",     displayName: "Python",      cmLoader: () => python() },
  pyw:  { hljsLang: "python",     displayName: "Python",      cmLoader: () => python() },

  // JavaScript / TypeScript
  js:   { hljsLang: "javascript", displayName: "JavaScript",  cmLoader: () => javascript() },
  mjs:  { hljsLang: "javascript", displayName: "JavaScript",  cmLoader: () => javascript() },
  cjs:  { hljsLang: "javascript", displayName: "JavaScript",  cmLoader: () => javascript() },
  jsx:  { hljsLang: "javascript", displayName: "JSX",         cmLoader: () => javascript({ jsx: true }) },
  ts:   { hljsLang: "typescript", displayName: "TypeScript",  cmLoader: () => javascript({ typescript: true }) },
  tsx:  { hljsLang: "typescript", displayName: "TSX",         cmLoader: () => javascript({ jsx: true, typescript: true }) },

  // Web
  html: { hljsLang: "html",       displayName: "HTML",        cmLoader: () => html() },
  htm:  { hljsLang: "html",       displayName: "HTML",        cmLoader: () => html() },
  css:  { hljsLang: "css",        displayName: "CSS",         cmLoader: () => css() },
  scss: { hljsLang: "scss",       displayName: "SCSS",        cmLoader: () => css() },
  less: { hljsLang: "less",       displayName: "Less",        cmLoader: () => css() },

  // Data formats
  json:  { hljsLang: "json",      displayName: "JSON",        cmLoader: () => json() },
  jsonc: { hljsLang: "json",      displayName: "JSONC",       cmLoader: () => json() },
  yaml:  { hljsLang: "yaml",      displayName: "YAML",        cmLoader: null },
  yml:   { hljsLang: "yaml",      displayName: "YAML",        cmLoader: null },
  toml:  { hljsLang: "toml",      displayName: "TOML",        cmLoader: null },
  xml:   { hljsLang: "xml",       displayName: "XML",         cmLoader: () => xml() },
  svg:   { hljsLang: "xml",       displayName: "SVG",         cmLoader: () => xml() },

  // Systems languages
  rs:   { hljsLang: "rust",       displayName: "Rust",        cmLoader: () => rust() },
  go:   { hljsLang: "go",         displayName: "Go",          cmLoader: () => go() },
  c:    { hljsLang: "c",          displayName: "C",           cmLoader: () => cpp() },
  h:    { hljsLang: "c",          displayName: "C Header",    cmLoader: () => cpp() },
  cpp:  { hljsLang: "cpp",        displayName: "C++",         cmLoader: () => cpp() },
  cc:   { hljsLang: "cpp",        displayName: "C++",         cmLoader: () => cpp() },
  cxx:  { hljsLang: "cpp",        displayName: "C++",         cmLoader: () => cpp() },
  hpp:  { hljsLang: "cpp",        displayName: "C++ Header",  cmLoader: () => cpp() },

  // JVM
  java: { hljsLang: "java",       displayName: "Java",        cmLoader: () => java() },
  kt:   { hljsLang: "kotlin",     displayName: "Kotlin",      cmLoader: null },
  kts:  { hljsLang: "kotlin",     displayName: "Kotlin",      cmLoader: null },
  scala:{ hljsLang: "scala",      displayName: "Scala",       cmLoader: null },

  // Other languages
  cs:   { hljsLang: "csharp",     displayName: "C#",          cmLoader: null },
  swift:{ hljsLang: "swift",      displayName: "Swift",       cmLoader: null },
  rb:   { hljsLang: "ruby",       displayName: "Ruby",        cmLoader: null },
  php:  { hljsLang: "php",        displayName: "PHP",         cmLoader: null },
  dart: { hljsLang: "dart",       displayName: "Dart",        cmLoader: null },
  lua:  { hljsLang: "lua",        displayName: "Lua",         cmLoader: null },
  r:    { hljsLang: "r",          displayName: "R",           cmLoader: null },
  ex:   { hljsLang: "elixir",     displayName: "Elixir",      cmLoader: null },
  exs:  { hljsLang: "elixir",     displayName: "Elixir",      cmLoader: null },

  // Shell
  sh:   { hljsLang: "bash",       displayName: "Shell",       cmLoader: null },
  bash: { hljsLang: "bash",       displayName: "Bash",        cmLoader: null },
  zsh:  { hljsLang: "bash",       displayName: "Zsh",         cmLoader: null },
  fish: { hljsLang: "bash",       displayName: "Fish",        cmLoader: null },
  bat:  { hljsLang: "batch",      displayName: "Batch",       cmLoader: null },
  cmd:  { hljsLang: "batch",      displayName: "Batch",       cmLoader: null },
  ps1:  { hljsLang: "powershell", displayName: "PowerShell",  cmLoader: null },

  // Database
  sql:  { hljsLang: "sql",        displayName: "SQL",         cmLoader: () => sql() },

  // Markup / Docs
  md:       { hljsLang: "markdown",   displayName: "Markdown",    cmLoader: () => markdown() },
  markdown: { hljsLang: "markdown",   displayName: "Markdown",    cmLoader: () => markdown() },
  rst:      { hljsLang: "plaintext",  displayName: "reStructured", cmLoader: null },

  // Config
  ini:       { hljsLang: "ini",       displayName: "INI",         cmLoader: null },
  conf:      { hljsLang: "ini",       displayName: "Config",      cmLoader: null },
  cfg:       { hljsLang: "ini",       displayName: "Config",      cmLoader: null },
  env:       { hljsLang: "bash",      displayName: "Env",         cmLoader: null },
  tf:        { hljsLang: "plaintext", displayName: "Terraform",   cmLoader: null },
  tfvars:    { hljsLang: "plaintext", displayName: "Terraform",   cmLoader: null },
  proto:     { hljsLang: "protobuf",  displayName: "Protobuf",    cmLoader: null },
  graphql:   { hljsLang: "graphql",   displayName: "GraphQL",     cmLoader: null },
  gql:       { hljsLang: "graphql",   displayName: "GraphQL",     cmLoader: null },
  dockerfile:{ hljsLang: "dockerfile",displayName: "Dockerfile",  cmLoader: null },
  makefile:  { hljsLang: "makefile",  displayName: "Makefile",    cmLoader: null },

  // Plain text & Data
  txt: { hljsLang: "plaintext", displayName: "Plain Text", cmLoader: null },
  log: { hljsLang: "plaintext", displayName: "Log",        cmLoader: null },
  csv: { hljsLang: "plaintext", displayName: "CSV",        cmLoader: null },
  tsv: { hljsLang: "plaintext", displayName: "TSV",        cmLoader: null },

  // Specialized languages & formats
  sol:     { hljsLang: "javascript", displayName: "Solidity",   cmLoader: null },
  prisma:  { hljsLang: "javascript", displayName: "Prisma",     cmLoader: null },
  zig:     { hljsLang: "c",          displayName: "Zig",        cmLoader: null },
  nim:     { hljsLang: "python",     displayName: "Nim",        cmLoader: null },
  tex:     { hljsLang: "latex",      displayName: "LaTeX",      cmLoader: null },
  latex:   { hljsLang: "latex",      displayName: "LaTeX",      cmLoader: null },
  bib:     { hljsLang: "latex",      displayName: "BibTeX",     cmLoader: null },
  v:       { hljsLang: "verilog",    displayName: "Verilog",    cmLoader: null },
  vhdl:    { hljsLang: "vhdl",       displayName: "VHDL",       cmLoader: null },
  asm:     { hljsLang: "x86asm",     displayName: "Assembly",   cmLoader: null },
  s:       { hljsLang: "x86asm",     displayName: "Assembly",   cmLoader: null },
  diff:    { hljsLang: "diff",       displayName: "Diff",       cmLoader: null },
  patch:   { hljsLang: "diff",       displayName: "Patch",      cmLoader: null },
  srt:     { hljsLang: "plaintext",  displayName: "Subtitles",  cmLoader: null },
  vtt:     { hljsLang: "plaintext",  displayName: "WebVTT",     cmLoader: null },
  gradle:  { hljsLang: "java",       displayName: "Gradle",     cmLoader: null },
  properties:{ hljsLang: "ini",      displayName: "Properties", cmLoader: null },
};

const FALLBACK: LangInfo = {
  hljsLang: "plaintext",
  displayName: "Plain Text",
  cmLoader: null,
};

/**
 * Detect language info from a file name.
 * Handles dotfiles like `.gitignore`, `.env`, `Dockerfile`, `Makefile`.
 */
export function detectLang(fileName: string): LangInfo {
  const lower = fileName.toLowerCase();
  const base = lower.split("/").pop() ?? lower;

  // Special dotfiles / no-extension files
  if (base === "dockerfile")          return LANG_MAP["dockerfile"];
  if (base === "makefile")            return LANG_MAP["makefile"];
  if (base === ".gitignore")          return { hljsLang: "bash", displayName: "Git Ignore", cmLoader: null };
  if (base === ".gitattributes")      return { hljsLang: "bash", displayName: "Git Attributes", cmLoader: null };
  if (base === ".npmrc")              return { hljsLang: "ini",  displayName: "npmrc", cmLoader: null };
  if (base === ".nvmrc")              return { hljsLang: "plaintext", displayName: "nvmrc", cmLoader: null };
  if (base === ".env" || base.startsWith(".env.")) return LANG_MAP["env"];
  if (base === ".editorconfig")       return { hljsLang: "ini", displayName: "EditorConfig", cmLoader: null };

  // Extension-based
  const parts = base.split(".");
  if (parts.length >= 2) {
    const ext = parts[parts.length - 1];
    return LANG_MAP[ext] ?? FALLBACK;
  }

  return FALLBACK;
}
