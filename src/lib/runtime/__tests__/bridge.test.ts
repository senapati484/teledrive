import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<any>>(async () => undefined));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "9.9.9"),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => undefined),
}));

import {
  isTauriRuntime,
  isWebRuntime,
  logVaultState,
  runtimeGetVersion,
  runtimeOpenUrl,
} from "../bridge";

const origWindow = (globalThis as any).window;
const origDocument = (globalThis as any).document;

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  if (origWindow === undefined) delete (globalThis as any).window;
  else (globalThis as any).window = origWindow;
  if (origDocument === undefined) delete (globalThis as any).document;
  else (globalThis as any).document = origDocument;
});

describe("runtime bridge", () => {
  it("delegates logging and app version to Tauri in native/test environments", async () => {
    expect(isWebRuntime()).toBe(false);
    await logVaultState("HELLO");
    expect(invokeMock).toHaveBeenCalledWith("log_vault_state", { state: "HELLO" });
    expect(await runtimeGetVersion("0.1.4")).toBe("9.9.9");
  });

  it("no-ops host IPC and uses window.open safely when running outside Tauri", async () => {
    const openSpy = vi.fn();
    (globalThis as any).window = { open: openSpy };
    (globalThis as any).document = {};

    expect(isTauriRuntime()).toBe(false);
    expect(isWebRuntime()).toBe(true);

    await logVaultState("IGNORED_OUTSIDE_TAURI");
    await runtimeOpenUrl("https://example.com");

    expect(invokeMock).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer"
    );
    expect(await runtimeGetVersion("0.1.4")).toBe("0.1.4");
  });
});
