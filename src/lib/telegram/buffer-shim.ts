import { Buffer } from "buffer";
import { logger } from "@/lib/logger";

// Ensure Buffer is globally accessible across all environments & runtimes
if (typeof window !== "undefined") {
  (window as any).Buffer = Buffer;
  (window as any).global = window;
}
if (typeof globalThis !== "undefined") {
  (globalThis as any).Buffer = Buffer;
  (globalThis as any).global = globalThis;
}

// Mark prototype with _isBuffer
if (Buffer && Buffer.prototype) {
  (Buffer.prototype as any)._isBuffer = true;
}

/**
 * CRITICAL FIX FOR GRAMJS 2FA SERIALIZATION:
 *
 * GramJS's `serializeBytes()` in `telegram/tl/generationHelpers.js` uses:
 *   if (!(data instanceof Buffer)) { throw Error(`Bytes or str expected, not ${data.constructor.name}`) }
 *
 * In production/bundled environments, chunks or polyfill bridges can create
 * buffer instances from different prototype chains or TypedArray subclasses,
 * causing `data instanceof Buffer` to return false and throwing:
 *   "Bytes or str expected, not e" (where 'e' is minified Buffer constructor name).
 *
 * Defining `Symbol.hasInstance` on the Buffer constructor makes JavaScript's
 * native `instanceof Buffer` operator return `true` for ANY genuine Buffer,
 * TypedArray, or Buffer-like byte structure across all realms and polyfills.
 */
try {
  Object.defineProperty(Buffer, Symbol.hasInstance, {
    value: function (instance: any) {
      if (!instance) return false;
      return (
        instance._isBuffer === true ||
        instance instanceof Uint8Array ||
        ArrayBuffer.isView(instance) ||
        (instance.constructor &&
          (instance.constructor.name === "Buffer" ||
            instance.constructor.name === "e" ||
            instance.constructor.name === "Uint8Array"))
      );
    },
    configurable: true,
  });
} catch (e) {
  logger.warn("[TeleDrive] Failed to define Symbol.hasInstance on Buffer:", e);
}

export { Buffer };
