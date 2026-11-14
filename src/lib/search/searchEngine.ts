import { TeleFile } from "../types";

/**
 * Performs client-side fuzzy search on the virtual files catalog.
 * Ranks results based on exact matches, prefixes, paths, and MIME types.
 * Returns up to 50 sorted results.
 */
export function fuzzySearch(files: TeleFile[], query: string): TeleFile[] {
  if (!query.trim()) return [];
  
  const q = query.toLowerCase().trim();
  const scored: { file: TeleFile; score: number }[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let score = 0;
    const name = file.name.toLowerCase();

    // Ranks
    if (name === q) {
      score += 100; // Exact match
    } else if (name.startsWith(q)) {
      score += 80; // Prefix match
    } else if (name.includes(q)) {
      score += 50; // Partial substring match
    }

    const path = file.folderPath.toLowerCase();
    if (path.includes(q)) {
      score += 20; // Folder path match
    }

    const mime = file.mime.toLowerCase();
    if (mime.includes(q)) {
      score += 10; // File type match
    }

    if (score > 0) {
      scored.push({ file, score });
    }
  }

  // Sort by descending score, fallback to name alphabetically
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.file.name.localeCompare(b.file.name);
  });

  return scored.slice(0, 50).map((item) => item.file);
}
