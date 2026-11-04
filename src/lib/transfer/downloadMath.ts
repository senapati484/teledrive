/** Percentage of a file received so far (0 when the size is unknown). */
export function downloadPercent(received: number, size: number): number {
  if (!(size > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((received / size) * 100)));
}

/** Bytes/second over the given window; 0 when the window is unusable. */
export function downloadSpeed(
  received: number,
  previousReceived: number,
  elapsedMs: number
): number {
  if (!(elapsedMs > 0)) return 0;
  return Math.max(0, ((received - previousReceived) * 1000) / elapsedMs);
}

/** Remaining seconds, or undefined when the speed/size is unknown. */
export function downloadEta(
  size: number,
  received: number,
  speed: number
): number | undefined {
  if (!(size > 0) || !(speed > 0) || received >= size) return undefined;
  return Math.round((size - received) / speed);
}

/**
 * Join buffered chunks. Throws when the assembled length does not match the
 * byte count we accounted for.
 */
export function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== total) {
    throw new Error(
      `Incomplete download: expected ${total} bytes, assembled ${offset}`
    );
  }
  return out;
}
