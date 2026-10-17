import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import i18n from "@/i18n"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a unix-ms timestamp as a short relative-time string
 * (e.g. "3 seconds", "5 minutes", "2 hours", "4 days", "2 months").
 *
 * Lightweight replacement for date-fns.formatDistanceToNow so we don't
 * have to add date-fns as a dependency for one helper. Returns the
 * closest reasonable unit; never throws on invalid input.
 */
export function formatDistanceToNow(timestampMs: number): string {
  const now = Date.now();
  const diffMs = now - timestampMs;
  if (!Number.isFinite(diffMs)) return i18n.t("messages:relativeTime.unknown");
  if (diffMs < 0) return i18n.t("messages:relativeTime.justNow"); // future / clock skew

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return i18n.t("messages:relativeTime.second", { count: Math.max(seconds, 1) });

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return i18n.t("messages:relativeTime.minute", { count: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t("messages:relativeTime.hour", { count: hours });

  const days = Math.floor(hours / 24);
  if (days < 30) return i18n.t("messages:relativeTime.day", { count: days });

  const months = Math.floor(days / 30);
  if (months < 12) return i18n.t("messages:relativeTime.month", { count: months });

  const years = Math.floor(months / 12);
  return i18n.t("messages:relativeTime.year", { count: years });
}

