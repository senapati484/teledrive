/**
 * Telegram rate-limit (FLOOD_WAIT_X) and transient-error helpers.
 *
 * Used by uploader, downloader, and the IndexQueue so that FLOOD_WAIT
 * handling is consistent across every Telegram call site.
 *
 * Telegram returns FLOOD_WAIT_X in two flavors:
 *   - As an RPC error: err.message === "A wait of X seconds is required (caused by ...)"
 *   - As an explicit error class name like FLOOD_WAIT_30
 *   - Sometimes embedded in `err.seconds` (GramJS error object)
 *
 * Per the user's chosen policy: block-and-wait with the indicated time,
 * capped at FLOOD_WAIT_CAP_SECONDS so we never freeze the UI on a 300s wait.
 */

/**
 * Cap on a single FLOOD_WAIT backoff. Telegram can demand 300s+; we
 * refuse to block the UI for that long. With the cap, a retry cycle
 * stays under FLOOD_WAIT_CAP_SECONDS × maxAttempts (worst case 30s × 5
 * stays within reasonable bounds, while respecting Telegram's cooldown
 * timers so retries do not fail prematurely before the limit expires.
 */
export const FLOOD_WAIT_CAP_SECONDS = 300;

/**
 * Returns the FLOOD_WAIT delay (in seconds) Telegram is asking for, or null
 * if this error is not a FLOOD_WAIT.
 */
export function parseFloodWaitSeconds(err: any): number | null {
  if (!err) return null;

  // 1. GramJS error.seconds (most reliable, set on FloodWaitError objects)
  if (typeof err.seconds === "number" && err.seconds > 0) {
    return err.seconds;
  }

  // 2. Explicit class name "FloodWaitError" or similar with seconds
  const className = err?.constructor?.name || err?.name || "";
  if (/FloodWait/i.test(className) && typeof err.seconds === "number") {
    return err.seconds;
  }

  // 3. Message pattern: "A wait of X seconds is required"
  const msg: string = typeof err === "string"
    ? err
    : (err.message || err.errorMessage || err.error?.errorMessage || "");

  const m1 = /A wait of (\d+) seconds? is required/i.exec(msg);
  if (m1) return Math.max(1, parseInt(m1[1], 10));

  // 4. Compact pattern: "FLOOD_WAIT_30" or "FLOOD_WAIT (30)"
  const m2 = /FLOOD_WAIT[_ ]+(\d+)/i.exec(msg);
  if (m2) return Math.max(1, parseInt(m2[1], 10));

  return null;
}

/**
 * Cap the wait at FLOOD_WAIT_CAP_SECONDS so we never block for hours.
 * Telegram flood waits for user actions or index saves are typically 10s - 180s.
 * Capping at 30s was causing premature retries that violated Telegram's wait timer
 * and burned through all retry attempts before the cooldown elapsed.
 */
export function clampFloodWait(seconds: number): number {
  return Math.min(seconds, FLOOD_WAIT_CAP_SECONDS);
}

const TRANSIENT_PATTERNS: RegExp[] = [
  /timeout/i,
  /timed out/i,
  /network/i,
  /fetch/i,
  /socket/i,
  /disconnect(ed)?/i,
  /reset/i,
  /econnreset/i,
  /etimedout/i,
  /enotfound/i,
  /econnrefused/i,
  /handshake/i,
  /abort/i,
  /temporar(y|ily)/i,
  /try again/i,
  /429/,
  /flood/i,
  /too many/i,
];

/**
 * Returns true if the error is transient (network / rate-limit / timeout)
 * and worth retrying. Returns false for hard errors that should bubble up
 * (auth lost, channel missing, deserialization, etc.).
 */
export function isTransientError(err: any): boolean {
  if (parseFloodWaitSeconds(err) != null) return true;
  const msg: string =
    typeof err === "string"
      ? err
      : (err?.message || err?.errorMessage || err?.error?.errorMessage || "");
  return TRANSIENT_PATTERNS.some((p) => p.test(msg));
}

const HARD_PATTERNS: RegExp[] = [
  /AUTH_KEY_UNREGISTERED/i,
  /SESSION_REVOKED/i,
  /USER_DEACTIVATED/i,
  /CHANNEL_PRIVATE/i,
  /CHAT_WRITE_FORBIDDEN/i,
  /PEER_ID_INVALID/i,
  /INPUT_PEER_INVALID/i,
  /MSG_ID_INVALID/i,
  /MESSAGE_DELETE_FORBIDDEN/i,
  /MESSAGE_EDIT_FORBIDDEN/i,
  /FILE_PARTS_INVALID/i,
  /FILE_ID_INVALID/i,
  /JSON/i, // JSON parse errors in our own code
];

export function isHardError(err: any): boolean {
  const msg: string =
    typeof err === "string"
      ? err
      : (err?.message || err?.errorMessage || err?.error?.errorMessage || "");
  return HARD_PATTERNS.some((p) => p.test(msg));
}

/**
 * Compute the backoff delay for a transient retry.
 *
 * FLOOD_WAIT errors use the time Telegram told us to wait (clamped).
 * Other transient errors use exponential backoff with jitter, capped at 8s.
 */
export function computeRetryDelay(attempt: number, err: any): number {
  const flood = parseFloodWaitSeconds(err);
  if (flood != null) {
    return clampFloodWait(flood) * 1000 + Math.floor(Math.random() * 250);
  }
  const base = Math.min(8000, 500 * Math.pow(2, attempt));
  return base + Math.floor(Math.random() * 250);
}

/**
 * Callback signature for retry events. Fired once per attempt that
 * will be retried (i.e. not on the final attempt or on success). Used
 * by the uploader to surface "Retrying 3/5 (FLOOD_WAIT 30s)" to the
 * progress store, so the BackupProgressOverlay can show the user the
 * upload is making progress instead of looking stuck.
 */
export type TelegramRetryEvent = {
  /** 1-indexed attempt number that just failed. */
  attempt: number;
  /** Total attempts allowed. */
  maxAttempts: number;
  /** Milliseconds we are about to wait before the next attempt. */
  waitMs: number;
  /** Telegram's FLOOD_WAIT, if this retry was triggered by one. */
  floodSeconds: number | null;
  /** The error that just failed. */
  error: any;
};

/**
 * Run `fn` with Telegram-aware retry semantics.
 *
 * - Transient errors (FLOOD_WAIT, timeout, network) → wait the right amount, retry.
 * - Hard errors → throw immediately.
 *
 * @param fn           The async operation to run.
 * @param label        Used in thrown error messages so we know which call failed.
 * @param maxAttempts  Cap on total attempts. Defaults to 5.
 * @param onRetry      Optional callback fired once per transient error
 *                     that will be retried. The BackupProgressOverlay
 *                     uses this to show "Retrying 3/5 (FLOOD_WAIT 30s)"
 *                     instead of a frozen progress bar.
 */
export async function withTelegramRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts: number = 5,
  onRetry?: (event: TelegramRetryEvent) => void
): Promise<T> {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (isHardError(err)) {
        // Bubble up hard errors immediately; no point retrying.
        throw err;
      }
      if (attempt >= maxAttempts) {
        throw new Error(
          `[${label}] Failed after ${maxAttempts} attempts: ${err?.message ?? err}`
        );
      }
      const delay = computeRetryDelay(attempt, err);
      // eslint-disable-next-line no-console
      console.warn(
        `[${label}] transient error (attempt ${attempt}/${maxAttempts}); waiting ${Math.round(delay / 100) / 10}s →`,
        err?.message ?? err
      );
      onRetry?.({
        attempt,
        maxAttempts,
        waitMs: delay,
        floodSeconds: parseFloodWaitSeconds(err),
        error: err,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  // Unreachable but keeps the TS compiler happy.
  throw lastErr;
}
