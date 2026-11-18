import { TeleFile } from "../types";

export type DateRangeFilter = "all" | "7d" | "30d" | "1y";
export type SizeRangeFilter = "all" | "small" | "medium" | "large";

export interface SearchFilters {
  dateRange?: DateRangeFilter;
  sizeRange?: SizeRangeFilter;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ONE_MB = 1024 * 1024;
const HUNDRED_MB = 100 * ONE_MB;

function isDir(file: TeleFile): boolean {
  return file.mime === "inode/directory" || file.mime === "application/x-directory";
}

/**
 * Generates padded character trigrams for typo-tolerant fuzzy matching.
 */
function buildTrigrams(text: string): Set<string> {
  const padded = `  ${text} `;
  const set = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) {
    set.add(padded.slice(i, i + 3));
  }
  return set;
}

/**
 * Computes trigram similarity (0..1) between a query and candidate string.
 * Uses Dice coefficient so partial word matches and single-character typos
 * score cleanly without flooding results with noise.
 */
function trigramSimilarity(query: string, candidate: string): number {
  if (query.length < 3 || candidate.length < 3) return 0;
  const qSet = buildTrigrams(query);
  const cSet = buildTrigrams(candidate);
  if (qSet.size === 0 || cSet.size === 0) return 0;

  let overlap = 0;
  for (const tri of qSet) {
    if (cSet.has(tri)) overlap++;
  }
  if (overlap < 2) return 0;

  // Check both full-candidate Dice and best token Dice so a short typo
  // inside a long filename (e.g. "documnt" vs "final_document_v2.pdf")
  // still scores well.
  const fullDice = (2 * overlap) / (qSet.size + cSet.size);
  return fullDice;
}

function bestTokenTrigramScore(query: string, name: string): number {
  if (query.length < 3) return 0;
  // Split filename on common delimiters (spaces, dots, dashes, underscores)
  const tokens = name.split(/[\s._\-/]+/).filter((t) => t.length >= 3);
  let best = trigramSimilarity(query, name);
  for (const token of tokens) {
    const sim = trigramSimilarity(query, token);
    if (sim > best) best = sim;
  }
  // Threshold prevents noisy false positives while catching real typos
  if (best < 0.42) return 0;
  // Map 0.42..1.0 → 15..45 (strictly below substring match of 50)
  return Math.round(15 + ((best - 0.42) / 0.58) * 30);
}

/**
 * Filters a file list by date range and file size criteria.
 * Directories are excluded when a size filter is active (since folders have size 0).
 */
export function applySearchFilters(
  files: TeleFile[],
  filters?: SearchFilters,
  now = Date.now(),
): TeleFile[] {
  if (!filters) return files;
  const dateRange = filters.dateRange ?? "all";
  const sizeRange = filters.sizeRange ?? "all";
  if (dateRange === "all" && sizeRange === "all") return files;

  let minTimestamp = 0;
  if (dateRange === "7d") minTimestamp = now - 7 * DAY_MS;
  else if (dateRange === "30d") minTimestamp = now - 30 * DAY_MS;
  else if (dateRange === "1y") minTimestamp = now - 365 * DAY_MS;

  return files.filter((file) => {
    if (minTimestamp > 0) {
      const ts = file.lastOpenedAt && file.lastOpenedAt > file.uploadedAt
        ? file.lastOpenedAt
        : file.uploadedAt;
      if (!ts || ts < minTimestamp) return false;
    }

    if (sizeRange !== "all") {
      if (isDir(file)) return false;
      const size = Number(file.size) || 0;
      if (sizeRange === "small" && size >= ONE_MB) return false;
      if (sizeRange === "medium" && (size < ONE_MB || size > HUNDRED_MB)) return false;
      if (sizeRange === "large" && size <= HUNDRED_MB) return false;
    }

    return true;
  });
}

function scoreSingleToken(file: TeleFile, q: string): number {
  let score = 0;
  const name = file.name.toLowerCase();

  if (name === q) {
    score += 100; // Exact match
  } else if (name.startsWith(q)) {
    score += 80; // Prefix match
  } else if (name.includes(q)) {
    score += 50; // Partial substring match
  } else {
    // Typo-tolerant trigram fallback (scores 15..45)
    score += bestTokenTrigramScore(q, name);
  }

  const path = file.folderPath.toLowerCase();
  if (path.includes(q)) {
    score += 20; // Folder path match
  }

  const mime = file.mime.toLowerCase();
  if (mime.includes(q)) {
    score += 10; // File type match
  }

  return score;
}

/**
 * Performs client-side fuzzy search on the virtual files catalog.
 * Ranks results based on exact matches, prefixes, substrings, trigram typo
 * similarity, folder paths, and MIME types. Supports multi-word queries and
 * optional date/size filters. Returns up to 50 sorted results.
 */
export function fuzzySearch(
  files: TeleFile[],
  query: string,
  filters?: SearchFilters,
  now?: number,
): TeleFile[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const candidates = applySearchFilters(files, filters, now);
  const q = trimmed.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: { file: TeleFile; score: number }[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const file = candidates[i];
    let score = scoreSingleToken(file, q);

    // Multi-word queries (e.g. "finance pdf"): require every token to match
    // something, and boost combined score when all tokens match.
    if (tokens.length > 1) {
      let allMatch = true;
      let tokenSum = 0;
      for (const tok of tokens) {
        const s = scoreSingleToken(file, tok);
        if (s === 0) {
          allMatch = false;
          break;
        }
        tokenSum += s;
      }
      if (allMatch) {
        score = Math.max(score, Math.round(tokenSum / tokens.length) + 10);
      }
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
