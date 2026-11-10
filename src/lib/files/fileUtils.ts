/**
 * Utility functions for analyzing file names, extensions, and MIME types.
 */

export type FileCategory = "Documents" | "Images" | "Videos" | "Audio" | "Archives" | "Other";

export type FileIconType =
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "spreadsheet"
  | "document"
  | "presentation"
  | "code"
  | "archive"
  | "file";

/**
 * Extracts the lowercase file extension (without the dot) from a filename.
 */
export function getFileExtension(fileName: string): string {
  const parts = fileName.split(".");
  if (parts.length <= 1) return "";
  return parts.pop()!.toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// Extension sets — maintained in one place so getFileCategory and
// getFileIconType stay in sync automatically.
// ---------------------------------------------------------------------------

export const IMAGE_EXTS = new Set([
  "jpg","jpeg","png","gif","bmp","webp","svg","tiff","tif",
  "heic","heif","ico","psd","ai","raw","cr2","nef","orf","arw",
  "dng","avif","jxl","xbm","ppm","pgm","pbm","tga",
]);

export const VIDEO_EXTS = new Set([
  "mp4","mkv","avi","mov","wmv","flv","webm","m4v","3gp","mpeg","mpg",
  "ogv","ts","mts","m2ts","vob","divx","xvid","rmvb","rm","asf","amv",
]);

export const AUDIO_EXTS = new Set([
  "mp3","wav","ogg","m4a","flac","aac","wma","opus","amr","mpga",
  "aiff","aif","mid","midi","ra","au","voc","oga","spx","caf","mka",
]);

export const ARCHIVE_EXTS = new Set([
  "zip","rar","7z","tar","gz","bz2","xz","zipx","iso","dmg",
  "cab","pkg","deb","rpm","apk","ipa","jar","war","ear","tgz",
]);

export const DOC_EXTS = new Set([
  "pdf","txt","md","doc","docx","xls","xlsx","ppt","pptx","csv",
  "rtf","odt","ods","odp","epub","pages","numbers","key","abw",
  "wpd","wps","tex","latex","bib","ris","enl","djvu","xps","oxps",
]);

// Code / scripting / config extensions
export const CODE_EXTS = new Set([
  // Web
  "js","ts","jsx","tsx","html","htm","css","scss","sass","less","vue","svelte",
  // Data / Config
  "json","xml","yaml","yml","toml","ini","conf","cfg","env","properties","plist","lock",
  // Backend / Systems
  "py","go","rs","c","cpp","cc","cxx","c++","h","hpp","hh",
  "cs","java","kt","kts","scala","groovy","clj","cljs","erl","ex","exs",
  "hs","lhs","ml","mli","fs","fsx","fsi","v","sv","vhd","vhdl",
  // Mobile
  "swift","m","mm","dart","gradle",
  // Scripting
  "sh","bash","zsh","fish","ps1","psm1","psd1","bat","cmd","vbs",
  "rb","pl","pm","lua","r","rmd","jl","matlab","awk","sed",
  // DB / Query
  "sql","ddl","dml","graphql","gql",
  // Infra / Devops
  "tf","tfvars","hcl","dockerfile","makefile","cmake","mak","mk",
  "proto","thrift","avsc","wsdl","xsd",
  // Other
  "asm","s","lisp","scm","clojure","coffee","elm","nim","zig","odin",
  "php","phtml","asp","aspx","jsp","erb","haml","jade","pug","mustache","hbs",
]);

/**
 * Categorizes a file based on its MIME type and/or file extension.
 * Extension takes priority over generic MIME (application/octet-stream) so
 * that files uploaded via Tauri (which may have no MIME) still categorize correctly.
 */
export function getFileCategory(fileName: string, mime: string): FileCategory {
  const m = (mime || "").toLowerCase().trim();
  const ext = getFileExtension(fileName);

  // 1. Folders
  if (m === "inode/directory" || m === "application/x-directory") return "Other";

  // 2. Images — MIME first, then extension
  if (m.startsWith("image/") || IMAGE_EXTS.has(ext)) return "Images";

  // 3. Videos
  if (m.startsWith("video/") || VIDEO_EXTS.has(ext)) return "Videos";

  // 4. Audio
  if (m.startsWith("audio/") || AUDIO_EXTS.has(ext)) return "Audio";

  // 5. Archives
  if (
    m.includes("zip") || m.includes("tar") || m.includes("rar") ||
    m.includes("gzip") || m.includes("archive") || m.includes("compressed") ||
    ARCHIVE_EXTS.has(ext)
  ) return "Archives";

  // 6. Documents — broad MIME match then extension
  if (
    m.startsWith("text/") ||
    m.includes("document") || m.includes("msword") || m.includes("pdf") ||
    m.includes("spreadsheet") || m.includes("excel") ||
    m.includes("presentation") || m.includes("powerpoint") ||
    m.includes("json") || m.includes("javascript") || m.includes("xml") ||
    DOC_EXTS.has(ext) || CODE_EXTS.has(ext)
  ) return "Documents";

  return "Other";
}

/**
 * Maps a file to a specific visual icon type.
 */
export function getFileIconType(fileName: string, mime: string): FileIconType {
  const m = (mime || "").toLowerCase().trim();
  const ext = getFileExtension(fileName);

  if (m === "inode/directory" || m === "application/x-directory") return "folder";

  if (m.startsWith("image/") || IMAGE_EXTS.has(ext)) return "image";
  if (m.startsWith("video/") || VIDEO_EXTS.has(ext)) return "video";
  if (m.startsWith("audio/") || AUDIO_EXTS.has(ext)) return "audio";

  if (m === "application/pdf" || ext === "pdf") return "pdf";

  if (
    m.includes("spreadsheet") || m.includes("excel") ||
    m === "text/csv" ||
    ["xls","xlsx","csv","ods","numbers"].includes(ext)
  ) return "spreadsheet";

  if (
    m.includes("presentation") || m.includes("powerpoint") ||
    ["ppt","pptx","odp","key"].includes(ext)
  ) return "presentation";

  if (
    m.includes("zip") || m.includes("tar") || m.includes("rar") ||
    m.includes("gzip") || m.includes("archive") ||
    ARCHIVE_EXTS.has(ext)
  ) return "archive";

  // Code files — large set handled by CODE_EXTS
  if (
    m.includes("javascript") || m.includes("typescript") || m.includes("json") ||
    m.includes("html") || m.includes("css") || m.includes("xml") ||
    m === "application/x-javascript" || m === "application/x-typescript" ||
    CODE_EXTS.has(ext)
  ) return "code";

  // Generic documents / text
  if (
    m.startsWith("text/") || m.includes("document") || m.includes("msword") ||
    DOC_EXTS.has(ext)
  ) return "document";

  return "file";
}

const VIDEO_MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mkv: "video/x-matroska",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
  ogv: "video/ogg",
  "3gp": "video/3gpp",
  ts: "video/mp2t",
  mts: "video/mp2t",
  m2ts: "video/mp2t",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
};

const AUDIO_MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  mpga: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  spx: "audio/ogg",
  opus: "audio/opus",
  flac: "audio/flac",
  wav: "audio/wav",
  aac: "audio/aac",
  wma: "audio/x-ms-wma",
  mka: "audio/x-matroska",
  aif: "audio/aiff",
  aiff: "audio/aiff",
};

export const UNRENDERABLE_IMAGE_EXTS = new Set([
  "psd", "ai", "raw", "cr2", "nef", "orf", "arw", "dng", "tga",
]);

export const NON_PREVIEWABLE_BINARY_EXTS = new Set([
  "exe", "msi", "msix", "appx", "dll", "so", "dylib", "bin", "img",
  "vhd", "vhdx", "vmdk", "appimage",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "odt", "ods", "odp", "epub", "mobi", "pages", "numbers", "key",
  "djvu", "xps", "oxps", "wpd", "wps",
  "sqlite", "sqlite3", "db", "mdb", "accdb",
  "wasm", "class", "pyc", "pyo", "o", "a", "lib",
  "ttf", "otf", "woff", "woff2", "eot",
]);

export function containsNullByte(bytes: Uint8Array, inspectBytes = 4096): boolean {
  const len = Math.min(bytes.length, inspectBytes);
  for (let i = 0; i < len; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

/**
 * Resolves a browser/WebView-compatible MIME type for video or audio files,
 * prioritizing explicit media extensions (e.g. `.mkv` -> `video/x-matroska`)
 * when Telegram metadata reports empty or generic `application/octet-stream`.
 */
export function getMediaMimeType(
  fileName: string,
  mime: string | undefined,
  kind: "video" | "audio"
): string {
  const m = (mime || "").toLowerCase().trim();
  const ext = getFileExtension(fileName);
  const table = kind === "video" ? VIDEO_MIME_BY_EXT : AUDIO_MIME_BY_EXT;
  if (ext && table[ext]) {
    return table[ext];
  }
  if (m.startsWith(`${kind}/`)) {
    return m;
  }
  return kind === "video" ? `video/${ext || "mp4"}` : `audio/${ext || "mpeg"}`;
}
