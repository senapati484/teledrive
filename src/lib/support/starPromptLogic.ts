/**
 * Pure, framework-free logic for the "Support TeleDrive" star-prompt feature.
 *
 * No React, Tauri, or Zustand imports here — keep it that way so the logic
 * can be exercised in plain vitest without any environment setup.
 */

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const MIN_UPLOADS_TO_SHOW = 3;

export interface StarPromptState {
  firstLaunchAt: number | null;
  successfulUploads: number;
  snoozedUntil: number | null;
  dontAskAgain: boolean;
  starredAt: number | null;
}

export interface ShowOpts {
  /** Current timestamp in milliseconds (Date.now()). */
  now: number;
  /**
   * True when this is the very first app session (firstLaunchAt was null
   * before we initialised the store for the first time).
   */
  isFirstSession: boolean;
  /** True when any upload or download transfer is currently in progress. */
  isTransferActive: boolean;
}

/**
 * Determines whether the star-prompt dialog should be displayed.
 *
 * Rules (evaluated in order):
 * 1. Never if the user has permanently dismissed it (dontAskAgain or starred).
 * 2. Never during the first ever app session.
 * 3. Never while an upload / download is in progress.
 * 4. Never while the snooze window is still active.
 * 5. Show if at least 7 days have elapsed since firstLaunchAt.
 * 6. Show if the user has completed ≥ 3 successful uploads.
 * 7. Otherwise, do not show.
 */
export function shouldShowStarPrompt(
  state: StarPromptState,
  opts: ShowOpts,
): boolean {
  const { now, isFirstSession, isTransferActive } = opts;

  // ── Permanent dismissals ──────────────────────────────────────────────────
  if (state.dontAskAgain) return false;
  if (state.starredAt !== null) return false;

  // ── Session / activity guards ─────────────────────────────────────────────
  if (isFirstSession) return false;
  if (isTransferActive) return false;

  // ── Snooze guard ──────────────────────────────────────────────────────────
  if (state.snoozedUntil !== null && now < state.snoozedUntil) return false;

  // ── Trigger conditions (either / or) ─────────────────────────────────────
  if (
    state.firstLaunchAt !== null &&
    now - state.firstLaunchAt >= SEVEN_DAYS_MS
  ) {
    return true;
  }
  if (state.successfulUploads >= MIN_UPLOADS_TO_SHOW) return true;

  return false;
}

/** Returns the timestamp (ms) until which the dialog should be snoozed. */
export function computeSnoozeUntil(now: number): number {
  return now + THIRTY_DAYS_MS;
}
