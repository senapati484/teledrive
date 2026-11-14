/**
 * useDarkMode.ts
 * Reads the app's theme from documentElement classList.
 * Subscribes to mutations so components re-render on theme change.
 * Compatible with the app's custom useTheme / uiStore system.
 */
import { useState, useEffect } from "react";

function isDarkNow(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

export function useDarkMode(): boolean {
  const [dark, setDark] = useState<boolean>(isDarkNow);

  useEffect(() => {
    // Sync immediately on mount (handles SSR/hydration edge-cases)
    setDark(isDarkNow());

    const observer = new MutationObserver(() => {
      setDark(isDarkNow());
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return dark;
}
