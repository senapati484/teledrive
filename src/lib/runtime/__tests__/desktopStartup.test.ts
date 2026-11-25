import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<any>>());
const isMobileMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@/lib/platform", () => ({
  isMobilePlatform: isMobileMock,
}));

import {
  getDesktopStartupSettings,
  isDesktopStartupSupported,
  setLaunchAtLogin,
  setStartMinimizedToTray,
  UNSUPPORTED_DESKTOP_STARTUP_STATE,
} from "../desktopStartup";

const origWindow = (globalThis as any).window;
const origDocument = (globalThis as any).document;

beforeEach(() => {
  invokeMock.mockReset();
  isMobileMock.mockReturnValue(false);
});

afterEach(() => {
  if (origWindow === undefined) delete (globalThis as any).window;
  else (globalThis as any).window = origWindow;
  if (origDocument === undefined) delete (globalThis as any).document;
  else (globalThis as any).document = origDocument;
});

describe("desktopStartup runtime bridge", () => {
  it("queries and updates desktop startup commands when running on Tauri desktop", async () => {
    (globalThis as any).window = { __TAURI_INTERNALS__: {} };

    invokeMock.mockResolvedValueOnce({
      supported: true,
      launchAtLogin: false,
      startMinimizedToTray: false,
    });
    expect(isDesktopStartupSupported()).toBe(true);
    expect(await getDesktopStartupSettings()).toEqual({
      supported: true,
      launchAtLogin: false,
      startMinimizedToTray: false,
    });
    expect(invokeMock).toHaveBeenCalledWith("get_desktop_startup_settings");

    invokeMock.mockResolvedValueOnce({
      supported: true,
      launchAtLogin: true,
      startMinimizedToTray: false,
    });
    expect(await setLaunchAtLogin(true)).toEqual({
      supported: true,
      launchAtLogin: true,
      startMinimizedToTray: false,
    });
    expect(invokeMock).toHaveBeenCalledWith("set_launch_at_login", { enabled: true });

    invokeMock.mockResolvedValueOnce({
      supported: true,
      launchAtLogin: true,
      startMinimizedToTray: true,
    });
    expect(await setStartMinimizedToTray(true)).toEqual({
      supported: true,
      launchAtLogin: true,
      startMinimizedToTray: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("set_start_minimized_to_tray", { enabled: true });
  });

  it("returns unsupported defaults without invoking IPC on mobile or web", async () => {
    (globalThis as any).window = { __TAURI_INTERNALS__: {} };
    isMobileMock.mockReturnValue(true);

    expect(isDesktopStartupSupported()).toBe(false);
    expect(await getDesktopStartupSettings()).toEqual(UNSUPPORTED_DESKTOP_STARTUP_STATE);
    expect(await setLaunchAtLogin(true)).toEqual(UNSUPPORTED_DESKTOP_STARTUP_STATE);
    expect(await setStartMinimizedToTray(true)).toEqual(UNSUPPORTED_DESKTOP_STARTUP_STATE);
    expect(invokeMock).not.toHaveBeenCalled();

    isMobileMock.mockReturnValue(false);
    (globalThis as any).window = {};
    (globalThis as any).document = {};
    expect(isDesktopStartupSupported()).toBe(false);
    expect(await getDesktopStartupSettings()).toEqual(UNSUPPORTED_DESKTOP_STARTUP_STATE);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
