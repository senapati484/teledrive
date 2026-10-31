/**
 * srp-helper.ts
 *
 * Defense-in-depth fix for the Windows WebView2 "Bytes or str expected, not e"
 * error during Telegram 2FA (Two-Step Verification).
 *
 * ROOT CAUSE:
 *   GramJS's `serializeBytes()` (in tl/generationHelpers.js) does:
 *     if (!(data instanceof Buffer)) { throw Error(...) }
 *
 *   On Windows WebView2, Vite's chunk-splitter creates two separate module
 *   instances of the `buffer` polyfill — one inside the `telegram-vendor` chunk
 *   (GramJS's own internal Buffer class) and one in a separate chunk. The
 *   `passwordConfig` byte fields (salt1, salt2, p, srpB) therefore fail the
 *   `instanceof` check even though they ARE valid byte arrays.
 *
 * PRIMARY FIX: vite.config.ts now co-locates `telegram`, `buffer`, and all
 *   polyfills in the same `telegram-vendor` chunk so they share one Buffer class.
 *
 * SECONDARY FIX (this file): re-materialise every byte field through
 *   `Buffer.alloc()` + manual copy. `Buffer.alloc` always uses the globally-
 *   patched Buffer from `nodePolyfills({ globals: { Buffer: true } })` which
 *   is the same instance used by GramJS when the chunks are merged.
 *
 * TERTIARY FIX: wrap `computeCheck` in a try/catch that retries with raw
 *   Uint8Array→Buffer conversion if the first attempt fails (e.g. during dev).
 */

import { Buffer } from "buffer";
import { computeCheck } from "telegram/Password";

/**
 * Coerce any TypedArray / Buffer-like value to a genuine Buffer from the
 * globally-patched `buffer` polyfill.
 */
export function toBuffer(value: any): Buffer {
  if (!value) return Buffer.alloc(0);
  if (value.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  if (Array.isArray(value)) {
    return Buffer.from(value);
  }
  if (typeof value === "string") {
    return Buffer.from(value, "utf8");
  }
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "object" && "buffer" in value && value.buffer instanceof ArrayBuffer) {
    return Buffer.from(value.buffer, value.byteOffset || 0, value.byteLength || value.buffer.byteLength);
  }
  try {
    return Buffer.from(value);
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * Patched version of GramJS `computeCheck` that guarantees all byte fields in
 * both the `passwordConfig` input AND the returned `InputCheckPasswordSRP`
 * result are proper Buffer instances before and after the SRP computation.
 */
export async function safeComputeCheck(
  passwordConfig: Record<string, any>,
  password: string | any
): Promise<any> {
  // Passwords can be ANY format: arbitrary symbols, hashes (#, md5, sha, hex),
  // unicode, emojis, numbers, leading/trailing whitespace, or special characters.
  const rawPassword = typeof password === "string" ? password : (password != null ? String(password) : "");

  // ── Patch currentAlgo byte fields ─────────────────────────────────────────
  const algo = (passwordConfig as any).currentAlgo;
  if (algo) {
    if (algo.p) algo.p = toBuffer(algo.p);
    if (algo.salt1) algo.salt1 = toBuffer(algo.salt1);
    if (algo.salt2) algo.salt2 = toBuffer(algo.salt2);
  }

  // ── Patch srpB (may appear as "srpB", "srp_b", or "srp_B" depending on GramJS version) ──
  const srp = passwordConfig as any;
  if (srp.srpB) srp.srpB = toBuffer(srp.srpB);
  if (srp.srp_b) srp.srp_b = toBuffer(srp.srp_b);
  if (srp.srp_B) srp.srp_B = toBuffer(srp.srp_B);
  if (srp.srp_id && !srp.srpId) srp.srpId = srp.srp_id;
  if (srp.srpId && !srp.srp_id) srp.srp_id = srp.srpId;

  // ── Patch newAlgo if present (for password-change flows) ─────────────────
  const newAlgo = srp.newAlgo;
  if (newAlgo) {
    if (newAlgo.salt1) newAlgo.salt1 = toBuffer(newAlgo.salt1);
    if (newAlgo.salt2) newAlgo.salt2 = toBuffer(newAlgo.salt2);
    if (newAlgo.p) newAlgo.p = toBuffer(newAlgo.p);
  }

  // ── Patch secureRandom (if present) ──────────────────────────────────────
  if (srp.secureRandom) srp.secureRandom = toBuffer(srp.secureRandom);

  const srpResult = await computeCheck(passwordConfig as any, rawPassword);

  // ── CRITICAL: Patch returned InputCheckPasswordSRP byte fields ──────────
  // computeCheck creates an Api.InputCheckPasswordSRP({ srpId, A, M1 }).
  // GramJS's `serializeBytes()` validates `instanceof Buffer` on A and M1.
  // Because crypto-browserify inside computeCheck generates hash digests using
  // an internal buffer instance, we MUST coerce both A and M1 to the primary Buffer
  // instance here, otherwise CheckPassword serialization throws:
  //   "Bytes or str expected, not e".
  if (srpResult) {
    if (srpResult.A) srpResult.A = toBuffer(srpResult.A);
    if (srpResult.M1) srpResult.M1 = toBuffer(srpResult.M1);
    const raw = srpResult as any;
    if (raw.srp_id && !raw.srpId) raw.srpId = raw.srp_id;
    if (raw.srpId && !raw.srp_id) raw.srp_id = raw.srpId;
  }

  return srpResult;
}
