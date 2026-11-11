import { invoke } from "@tauri-apps/api/core";

/** Returns true when executing inside a Tauri desktop/mobile webview. */
export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  );
}

/**
 * Returns true in standard non-Tauri browser environments (e.g. `vite` preview).
 * Intentionally returns false in Node unit-test environments (`document` undefined).
 */
export function isWebRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    !isTauriRuntime()
  );
}

export async function logVaultState(state: string): Promise<void> {
  if (isWebRuntime()) return;
  await invoke("log_vault_state", { state }).catch(() => {});
}

export async function runtimeOpenUrl(url: string): Promise<void> {
  if (isWebRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

export async function runtimeGetVersion(fallback: string): Promise<string> {
  if (isWebRuntime()) return fallback;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return fallback;
  }
}

export function triggerBrowserBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 5_000);
}
