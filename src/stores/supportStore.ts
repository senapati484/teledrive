import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { computeSnoozeUntil } from "@/lib/support/starPromptLogic";

// ────────────────────────────────────────────────────────────────────────────
// First-session detection
// ────────────────────────────────────────────────────────────────────────────

/**
 * True only during the very first ever launch (i.e. `firstLaunchAt` was null
 * when the store was first initialised).  Set once at module-load time, then
 * never changes for the lifetime of the app process.
 */
let _isFirstSession = false;

export function getIsFirstSession(): boolean {
  return _isFirstSession;
}

// ────────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────────

interface SupportState {
  /** ms timestamp of the very first TeleDrive launch. Null until first boot. */
  firstLaunchAt: number | null;
  /** Number of successful uploads completed since first launch. */
  successfulUploads: number;
  /** ms timestamp until which the star prompt is snoozed. Null = not snoozed. */
  snoozedUntil: number | null;
  /** User clicked "Don't ask again" — never show the prompt again. */
  dontAskAgain: boolean;
  /** ms timestamp when the user clicked "⭐ Star on GitHub". Null = not starred. */
  starredAt: number | null;
  /**
   * The app version string the user last saw in the "What's New" dialog.
   * Null = never shown.
   */
  lastSeenVersion: string | null;

  // ── Actions ────────────────────────────────────────────────────────────────
  /** Call once on app boot to record the first-ever launch timestamp. */
  initFirstLaunch: () => void;
  /** Call after each successful upload to increment the counter. */
  incrementUploadCount: () => void;
  /** Snooze the star prompt for 30 days. */
  snooze: () => void;
  /** Permanently hide the star prompt. */
  dismissForever: () => void;
  /**
   * Record that the user clicked "⭐ Star on GitHub".
   * This permanently hides both the prompt and the What's New star button.
   */
  markStarred: () => void;
  /** Update the last-seen version after dismissing the What's New dialog. */
  markWhatsNewSeen: (version: string) => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Store
// ────────────────────────────────────────────────────────────────────────────

export const useSupportStore = create<SupportState>()(
  persist(
    (set, get) => ({
      firstLaunchAt: null,
      successfulUploads: 0,
      snoozedUntil: null,
      dontAskAgain: false,
      starredAt: null,
      lastSeenVersion: null,

      initFirstLaunch() {
        if (get().firstLaunchAt === null) {
          // This is genuinely the first ever session.
          _isFirstSession = true;
          set({ firstLaunchAt: Date.now() });
        }
      },

      incrementUploadCount() {
        set((s) => ({ successfulUploads: s.successfulUploads + 1 }));
      },

      snooze() {
        set({ snoozedUntil: computeSnoozeUntil(Date.now()) });
      },

      dismissForever() {
        set({ dontAskAgain: true });
      },

      markStarred() {
        set({ starredAt: Date.now(), dontAskAgain: true });
      },

      markWhatsNewSeen(version: string) {
        set({ lastSeenVersion: version });
      },
    }),
    {
      name: "teledrive-support",
      storage: createJSONStorage(() => localStorage),
      // Only persist the data fields, not the action functions.
      partialize: (s) => ({
        firstLaunchAt: s.firstLaunchAt,
        successfulUploads: s.successfulUploads,
        snoozedUntil: s.snoozedUntil,
        dontAskAgain: s.dontAskAgain,
        starredAt: s.starredAt,
        lastSeenVersion: s.lastSeenVersion,
      }),
    },
  ),
);
