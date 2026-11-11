/**
 * Normalizes any user-defined virtual folder path:
 * - Empty, undefined, null, or "/" -> "/"
 * - Trims whitespace, eliminates duplicate slashes, strips trailing slashes
 * - Guarantees a single leading slash (e.g. "Dev" -> "/Dev", "/Dev/" -> "/Dev", "Projects/MyCode/" -> "/Projects/MyCode")
 */
export function normalizeFolderPath(path: string | null | undefined): string {
  if (!path || path === "/" || path.trim() === "") return "/";
  const trimmed = path.trim();
  const segments = trimmed.split("/").map((s) => s.trim()).filter(Boolean);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

