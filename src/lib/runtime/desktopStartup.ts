import { invoke } from "@tauri-apps/api/core";
import { isMobilePlatform } from "@/lib/platform";
import { isTauriRuntime } from "@/lib/runtime/bridge";

export interface DesktopStartupState {
  supported: boolean;
  launchAtLogin: boolean;
  startMinimizedToTray: boolean;
}

export const UNSUPPORTED_DESKTOP_STARTUP_STATE: DesktopStartupState = {
  supported: false,
  launchAtLogin: false,
  startMinimizedToTray: false,
};

/**
 * Returns true when running inside a Tauri desktop shell (Windows, macOS, Linux).
 * Android, iOS, and browser sessions return false because OS startup/tray APIs do not apply.
 */
export function isDesktopStartupSupported(): boolean {
  return isTauriRuntime() && !isMobilePlatform();
}

export async function getDesktopStartupSettings(): Promise<DesktopStartupState> {
  if (!isDesktopStartupSupported()) {
    return { ...UNSUPPORTED_DESKTOP_STARTUP_STATE };
  }
  return invoke<DesktopStartupState>("get_desktop_startup_settings");
}

export async function setLaunchAtLogin(enabled: boolean): Promise<DesktopStartupState> {
  if (!isDesktopStartupSupported()) {
    return { ...UNSUPPORTED_DESKTOP_STARTUP_STATE };
  }
  return invoke<DesktopStartupState>("set_launch_at_login", { enabled });
}

export async function setStartMinimizedToTray(enabled: boolean): Promise<DesktopStartupState> {
  if (!isDesktopStartupSupported()) {
    return { ...UNSUPPORTED_DESKTOP_STARTUP_STATE };
  }
  return invoke<DesktopStartupState>("set_start_minimized_to_tray", { enabled });
}
