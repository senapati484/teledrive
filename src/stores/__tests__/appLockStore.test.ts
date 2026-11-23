import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { useAppLockStore } from "../appLockStore";

describe("useAppLockStore", () => {
  let mockVault: Record<string, string> = {};

  beforeEach(() => {
    mockVault = {};
    invoke.mockReset();
    invoke.mockImplementation(async (command: string, args: any) => {
      if (command === "save_vault_value") {
        mockVault[args.key] = args.value;
        return null;
      }
      if (command === "load_vault_value") {
        return mockVault[args.key] ?? null;
      }
      if (command === "delete_vault_value") {
        delete mockVault[args.key];
        return null;
      }
      if (command === "check_biometrics_available") {
        return { available: true, biometry_type: "touch_id" };
      }
      if (command === "authenticate_device_owner") {
        return true;
      }
      return null;
    });

    useAppLockStore.setState({
      isInitialized: false,
      isConfigured: false,
      enabled: false,
      isLocked: false,
      failedAttempts: 0,
      lockoutRemainingSec: 0,
      storedConfig: null,
    });
  });

  it("initializes as unconfigured when no vault entry exists", async () => {
    await useAppLockStore.getState().init();
    const state = useAppLockStore.getState();

    expect(state.isInitialized).toBe(true);
    expect(state.isConfigured).toBe(false);
    expect(state.enabled).toBe(false);
    expect(state.isLocked).toBe(false);
  });

  it("enables device biometrics mode and handles lock/unlock", async () => {
    const success = await useAppLockStore.getState().enableDeviceBiometrics({ autoLockMinutes: 5 });
    expect(success).toBe(true);

    const state = useAppLockStore.getState();
    expect(state.enabled).toBe(true);
    expect(state.mode).toBe("device_biometric");

    // Lock the app
    useAppLockStore.getState().lockNow();
    expect(useAppLockStore.getState().isLocked).toBe(true);

    // Unlock with biometrics
    const unlocked = await useAppLockStore.getState().unlockWithBiometrics();
    expect(unlocked).toBe(true);
    expect(useAppLockStore.getState().isLocked).toBe(false);
  });

  it("sets custom PIN and verifies unlockWithPasscode", async () => {
    const success = await useAppLockStore.getState().setCustomPasscode("1357", "pin");
    expect(success).toBe(true);

    useAppLockStore.getState().lockNow();
    expect(useAppLockStore.getState().isLocked).toBe(true);

    // Wrong PIN
    const wrongRes = await useAppLockStore.getState().unlockWithPasscode("9999");
    expect(wrongRes.success).toBe(false);
    expect(wrongRes.error).toBe("invalid_passcode");
    expect(useAppLockStore.getState().isLocked).toBe(true);
    expect(useAppLockStore.getState().failedAttempts).toBe(1);

    // Correct PIN
    const rightRes = await useAppLockStore.getState().unlockWithPasscode("1357");
    expect(rightRes.success).toBe(true);
    expect(useAppLockStore.getState().isLocked).toBe(false);
    expect(useAppLockStore.getState().failedAttempts).toBe(0);
  });

  it("handles 6-digit PIN with dynamic length", async () => {
    const success = await useAppLockStore.getState().setCustomPasscode("123456", "pin");
    expect(success).toBe(true);
    expect(useAppLockStore.getState().pinLength).toBe(6);

    useAppLockStore.getState().lockNow();
    expect(useAppLockStore.getState().isLocked).toBe(true);

    const rightRes = await useAppLockStore.getState().unlockWithPasscode("123456");
    expect(rightRes.success).toBe(true);
    expect(useAppLockStore.getState().isLocked).toBe(false);
  });

  it("disables app lock cleanly", async () => {
    await useAppLockStore.getState().enableDeviceBiometrics();
    expect(useAppLockStore.getState().enabled).toBe(true);

    await useAppLockStore.getState().disableAppLock();
    const state = useAppLockStore.getState();
    expect(state.enabled).toBe(false);
    expect(state.isConfigured).toBe(false);
    expect(state.isLocked).toBe(false);
  });
});
