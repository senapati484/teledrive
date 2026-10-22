import { describe, it, expect } from "vitest";
import {
  shouldShowStarPrompt,
  computeSnoozeUntil,
  StarPromptState,
  SEVEN_DAYS_MS,
  THIRTY_DAYS_MS,
  MIN_UPLOADS_TO_SHOW,
} from "../starPromptLogic";

const BASE_STATE: StarPromptState = {
  firstLaunchAt: Date.now() - SEVEN_DAYS_MS - 1000, // launched > 7 days ago
  successfulUploads: 0,
  snoozedUntil: null,
  dontAskAgain: false,
  starredAt: null,
};

const BASE_OPTS = {
  now: Date.now(),
  isFirstSession: false,
  isTransferActive: false,
};

// ────────────────────────────────────────────────────────────────────────────
// Permanent dismissal guards
// ────────────────────────────────────────────────────────────────────────────

describe("shouldShowStarPrompt", () => {
  it("returns false when dontAskAgain is true", () => {
    const state: StarPromptState = { ...BASE_STATE, dontAskAgain: true };
    expect(shouldShowStarPrompt(state, BASE_OPTS)).toBe(false);
  });

  it("returns false when the user has already starred", () => {
    const state: StarPromptState = { ...BASE_STATE, starredAt: Date.now() };
    expect(shouldShowStarPrompt(state, BASE_OPTS)).toBe(false);
  });

  // ── Session / activity guards ─────────────────────────────────────────────

  it("returns false during the first session", () => {
    expect(
      shouldShowStarPrompt(BASE_STATE, { ...BASE_OPTS, isFirstSession: true }),
    ).toBe(false);
  });

  it("returns false while a transfer is active", () => {
    expect(
      shouldShowStarPrompt(BASE_STATE, {
        ...BASE_OPTS,
        isTransferActive: true,
      }),
    ).toBe(false);
  });

  // ── Snooze guard ──────────────────────────────────────────────────────────

  it("returns false when still within the snooze window", () => {
    const now = Date.now();
    const state: StarPromptState = {
      ...BASE_STATE,
      snoozedUntil: now + 1000, // snoozed for another 1 second
    };
    expect(shouldShowStarPrompt(state, { ...BASE_OPTS, now })).toBe(false);
  });

  it("returns true when the snooze window has expired", () => {
    const now = Date.now();
    const state: StarPromptState = {
      ...BASE_STATE,
      snoozedUntil: now - 1000, // snooze expired 1 second ago
      successfulUploads: MIN_UPLOADS_TO_SHOW,
    };
    expect(shouldShowStarPrompt(state, { ...BASE_OPTS, now })).toBe(true);
  });

  // ── Trigger conditions ────────────────────────────────────────────────────

  it("returns true when successfulUploads >= MIN_UPLOADS_TO_SHOW (not first session)", () => {
    const state: StarPromptState = {
      ...BASE_STATE,
      // Set firstLaunchAt to very recently so the time trigger doesn't fire.
      firstLaunchAt: Date.now() - 60_000,
      successfulUploads: MIN_UPLOADS_TO_SHOW,
    };
    expect(shouldShowStarPrompt(state, BASE_OPTS)).toBe(true);
  });

  it("returns true when 7+ days have elapsed since firstLaunchAt (not first session)", () => {
    const now = Date.now();
    const state: StarPromptState = {
      ...BASE_STATE,
      firstLaunchAt: now - SEVEN_DAYS_MS - 1,
      successfulUploads: 0,
    };
    expect(shouldShowStarPrompt(state, { ...BASE_OPTS, now })).toBe(true);
  });

  it("returns false when uploads < MIN and < 7 days have passed", () => {
    const now = Date.now();
    const state: StarPromptState = {
      ...BASE_STATE,
      firstLaunchAt: now - 3 * 24 * 60 * 60 * 1000, // 3 days ago
      successfulUploads: MIN_UPLOADS_TO_SHOW - 1,
    };
    expect(shouldShowStarPrompt(state, { ...BASE_OPTS, now })).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// computeSnoozeUntil
// ────────────────────────────────────────────────────────────────────────────

describe("computeSnoozeUntil", () => {
  it("returns now + 30 days (in milliseconds)", () => {
    const now = 1_700_000_000_000;
    expect(computeSnoozeUntil(now)).toBe(now + THIRTY_DAYS_MS);
  });
});
