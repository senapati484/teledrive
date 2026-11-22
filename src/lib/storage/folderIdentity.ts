import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

/**
 * Deterministic folder id from a full virtual path.
 *
 * Same path → same id, every cold start. Replaces the old `healed_<random>`
 * scheme that produced duplicate folder entries on every bootstrap (Bug 1 in
 * the plan). Folders created via `createFolder` keep their original random id
 * for backwards compatibility — the dedupe pass on recovery collapses them
 * to the canonical `folder_<hash>` only if duplicates exist.
 *
 * Slashes, dots, and unicode are preserved in the base64 — the id is an
 * opaque internal token, never shown to users. Length cap protects against
 * pathological paths.
 */
export function folderIdForPath(fullPath: string): string {
  const normalized = fullPath === "/" ? "/" : fullPath.replace(/\/+$/, "");
  // Hash the FULL path. The previous base64-truncation scheme kept only the
  // first 36 bytes, so any folder tree deeper than that (e.g. backup device
  // folders) collapsed to a single shared id and id-based actions modified
  // unrelated folders. A 128-bit slice of SHA-256 makes collisions infeasible.
  const digest = bytesToHex(sha256(new TextEncoder().encode(normalized)));
  return `folder_${digest.slice(0, 32)}`;
}
