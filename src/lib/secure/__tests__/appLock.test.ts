import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  calculateLockoutPenalty,
  createBiometricConfig,
  createPasscodeConfig,
  derivePasscodeKey,
  createCanary,
  verifyCanary,
  verifyPasscode,
  loadAppLockConfig,
  saveAppLockConfig,
  clearAppLockConfig,
} from "../appLock";

describe("appLock security & crypto", () => {
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
      return null;
    });
  });

  describe("canary verification", () => {
    it("canary encrypts and decrypts with the matching key", async () => {
      const salt = new Uint8Array(32);
      salt.fill(7);
      const key = await derivePasscodeKey("1234", salt, 1000);
      const canary = await createCanary(key);

      const isValid = await verifyCanary(key, canary.ivB64, canary.ciphertextB64);
      expect(isValid).toBe(true);
    });

    it("canary fails when decrypted with an incorrect key", async () => {
      const salt = new Uint8Array(32);
      salt.fill(7);
      const correctKey = await derivePasscodeKey("1234", salt, 1000);
      const wrongKey = await derivePasscodeKey("9999", salt, 1000);
      const canary = await createCanary(correctKey);

      const isValid = await verifyCanary(wrongKey, canary.ivB64, canary.ciphertextB64);
      expect(isValid).toBe(false);
    });
  });

  describe("createPasscodeConfig & verifyPasscode", () => {
    it("creates a valid configuration and verifies the correct passcode", async () => {
      const config = await createPasscodeConfig("4826", "pin", {
        autoLockMinutes: 15,
        lockOnMinimize: true,
      });

      expect(config.enabled).toBe(true);
      expect(config.mode).toBe("custom_passcode");
      expect(config.passcodeFormat).toBe("pin");
      expect(config.autoLockMinutes).toBe(15);
      expect(config.lockOnMinimize).toBe(true);
      expect(config.saltB64).toBeDefined();
      expect(config.canaryCiphertextB64).toBeDefined();

      const valid = await verifyPasscode("4826", config);
      expect(valid).toBe(true);

      const invalid = await verifyPasscode("0000", config);
      expect(invalid).toBe(false);
    });

    it("verifies alphanumeric passphrases", async () => {
      const config = await createPasscodeConfig("CorrectHorseBatteryStaple!42", "alphanumeric");
      expect(config.passcodeFormat).toBe("alphanumeric");

      expect(await verifyPasscode("CorrectHorseBatteryStaple!42", config)).toBe(true);
      expect(await verifyPasscode("WrongHorse", config)).toBe(false);
    });
  });

  describe("createBiometricConfig", () => {
    it("creates default biometric config", () => {
      const config = createBiometricConfig({ autoLockMinutes: 1 });
      expect(config.enabled).toBe(true);
      expect(config.mode).toBe("device_biometric");
      expect(config.autoLockMinutes).toBe(1);
      expect(config.saltB64).toBeUndefined();
    });
  });

  describe("lockout penalty calculation", () => {
    it("returns zero penalty for under 4 failed attempts", () => {
      expect(calculateLockoutPenalty(0)).toBe(0);
      expect(calculateLockoutPenalty(1)).toBe(0);
      expect(calculateLockoutPenalty(3)).toBe(0);
    });

    it("returns escalating penalties for consecutive failures", () => {
      expect(calculateLockoutPenalty(4)).toBe(15_000);   // 15s
      expect(calculateLockoutPenalty(5)).toBe(30_000);   // 30s
      expect(calculateLockoutPenalty(6)).toBe(60_000);   // 1 min
      expect(calculateLockoutPenalty(8)).toBe(120_000);  // 2 min
      expect(calculateLockoutPenalty(9)).toBe(900_000);  // 15 min
      expect(calculateLockoutPenalty(20)).toBe(900_000); // 15 min cap
    });
  });

  describe("vault persistence roundtrip", () => {
    it("saves, loads, and clears configuration", async () => {
      expect(await loadAppLockConfig()).toBeNull();

      const initial = createBiometricConfig({ autoLockMinutes: 10 });
      await saveAppLockConfig(initial);

      const loaded = await loadAppLockConfig();
      expect(loaded).not.toBeNull();
      expect(loaded?.mode).toBe("device_biometric");
      expect(loaded?.autoLockMinutes).toBe(10);

      await clearAppLockConfig();
      expect(await loadAppLockConfig()).toBeNull();
    });
  });
});
