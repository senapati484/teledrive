import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "@/lib/runtime/bridge";
import { logger } from "@/lib/logger";
import {
  type AppLockMode,
  type PasscodeFormat,
  type StoredAppLockConfig,
  DEFAULT_AUTO_LOCK_MINUTES,
  loadAppLockConfig,
  saveAppLockConfig,
  clearAppLockConfig,
  createBiometricConfig,
  createPasscodeConfig,
  verifyPasscode,
  calculateLockoutPenalty,
} from "@/lib/secure/appLock";

export interface BiometricInfo {
  available: boolean;
  biometry_type: "touch_id" | "face_id" | "windows_hello" | "system_password" | "generic_biometric" | "none";
}

export interface AppLockStoreState {
  isInitialized: boolean;
  isConfigured: boolean;
  enabled: boolean;
  isLocked: boolean;
  mode: AppLockMode;
  passcodeFormat: PasscodeFormat;
  autoLockMinutes: number;
  lockOnMinimize: boolean;
  privacyShield: boolean;
  failedAttempts: number;
  lockoutRemainingSec: number;
  biometricsAvailable: boolean;
  biometricsType: string;
  storedConfig: StoredAppLockConfig | null;

  // Actions
  init: () => Promise<void>;
  enableDeviceBiometrics: (options?: Partial<StoredAppLockConfig>) => Promise<boolean>;
  setCustomPasscode: (
    passcode: string,
    format: PasscodeFormat,
    options?: Partial<StoredAppLockConfig>
  ) => Promise<boolean>;
  disableAppLock: () => Promise<boolean>;
  updateSettings: (partial: Partial<StoredAppLockConfig>) => Promise<void>;
  unlockWithBiometrics: () => Promise<boolean>;
  unlockWithPasscode: (
    passcode: string
  ) => Promise<{ success: boolean; error?: "cooldown" | "invalid_passcode"; lockoutSec?: number }>;
  lockNow: () => void;
  resetAppLockOnLogout: () => Promise<void>;
}

let lockoutTimer: ReturnType<typeof setInterval> | null = null;

export const useAppLockStore = create<AppLockStoreState>((set, get) => ({
  isInitialized: false,
  isConfigured: false,
  enabled: false,
  isLocked: false,
  mode: "device_biometric",
  passcodeFormat: "pin",
  autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
  lockOnMinimize: false,
  privacyShield: true,
  failedAttempts: 0,
  lockoutRemainingSec: 0,
  biometricsAvailable: false,
  biometricsType: "none",
  storedConfig: null,

  init: async () => {
    let bioInfo: BiometricInfo = { available: false, biometry_type: "none" };

    if (isTauriRuntime()) {
      try {
        bioInfo = await invoke<BiometricInfo>("check_biometrics_available");
      } catch (err) {
        logger.warn("[AppLock] check_biometrics_available failed:", err);
      }
    }

    const config = await loadAppLockConfig();

    if (!config || !config.enabled) {
      set({
        isInitialized: true,
        isConfigured: Boolean(config),
        enabled: false,
        isLocked: false,
        biometricsAvailable: bioInfo.available,
        biometricsType: bioInfo.biometry_type,
        storedConfig: config,
      });
      return;
    }

    // App lock is enabled!
    const now = Date.now();
    let lockoutRemaining = 0;
    if (config.lockoutUntilMs > now) {
      lockoutRemaining = Math.ceil((config.lockoutUntilMs - now) / 1000);
      startLockoutCountdown(config.lockoutUntilMs);
    }

    set({
      isInitialized: true,
      isConfigured: true,
      enabled: true,
      isLocked: true, // Lock immediately on fresh launch
      mode: config.mode,
      passcodeFormat: config.passcodeFormat ?? "pin",
      autoLockMinutes: config.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES,
      lockOnMinimize: config.lockOnMinimize ?? false,
      privacyShield: config.privacyShield ?? true,
      failedAttempts: config.failedAttempts ?? 0,
      lockoutRemainingSec: lockoutRemaining,
      biometricsAvailable: bioInfo.available,
      biometricsType: bioInfo.biometry_type,
      storedConfig: config,
    });
  },

  enableDeviceBiometrics: async (options) => {
    // If running in Tauri, attempt a test prompt to ensure device credentials work
    if (isTauriRuntime()) {
      try {
        const ok = await invoke<boolean>("authenticate_device_owner", {
          reason: "Enable TeleDrive App Lock",
        });
        if (!ok) return false;
      } catch (err) {
        logger.error("[AppLock] Device biometric verification failed on enable:", err);
        return false;
      }
    }

    const current = get().storedConfig;
    const config = createBiometricConfig({
      autoLockMinutes: options?.autoLockMinutes ?? current?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES,
      lockOnMinimize: options?.lockOnMinimize ?? current?.lockOnMinimize ?? false,
      privacyShield: options?.privacyShield ?? current?.privacyShield ?? true,
    });

    await saveAppLockConfig(config);

    set({
      isConfigured: true,
      enabled: true,
      mode: "device_biometric",
      autoLockMinutes: config.autoLockMinutes,
      lockOnMinimize: config.lockOnMinimize,
      privacyShield: config.privacyShield,
      failedAttempts: 0,
      lockoutRemainingSec: 0,
      storedConfig: config,
    });

    return true;
  },

  setCustomPasscode: async (passcode, format, options) => {
    const current = get().storedConfig;
    const config = await createPasscodeConfig(passcode, format, {
      autoLockMinutes: options?.autoLockMinutes ?? current?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES,
      lockOnMinimize: options?.lockOnMinimize ?? current?.lockOnMinimize ?? false,
      privacyShield: options?.privacyShield ?? current?.privacyShield ?? true,
    });

    await saveAppLockConfig(config);

    set({
      isConfigured: true,
      enabled: true,
      mode: "custom_passcode",
      passcodeFormat: format,
      autoLockMinutes: config.autoLockMinutes,
      lockOnMinimize: config.lockOnMinimize,
      privacyShield: config.privacyShield,
      failedAttempts: 0,
      lockoutRemainingSec: 0,
      storedConfig: config,
    });

    return true;
  },

  disableAppLock: async () => {
    await clearAppLockConfig();
    if (lockoutTimer) {
      clearInterval(lockoutTimer);
      lockoutTimer = null;
    }
    set({
      isConfigured: false,
      enabled: false,
      isLocked: false,
      failedAttempts: 0,
      lockoutRemainingSec: 0,
      storedConfig: null,
    });
    return true;
  },

  updateSettings: async (partial) => {
    const current = get().storedConfig;
    if (!current) return;
    const updated: StoredAppLockConfig = {
      ...current,
      ...partial,
      updatedAt: Date.now(),
    };
    await saveAppLockConfig(updated);
    set({
      autoLockMinutes: updated.autoLockMinutes,
      lockOnMinimize: updated.lockOnMinimize,
      privacyShield: updated.privacyShield,
      storedConfig: updated,
    });
  },

  unlockWithBiometrics: async () => {
    const state = get();
    if (!state.enabled || !state.isLocked) return true;

    if (state.lockoutRemainingSec > 0) return false;

    if (isTauriRuntime()) {
      try {
        const ok = await invoke<boolean>("authenticate_device_owner", {
          reason: "Unlock TeleDrive",
        });
        if (ok) {
          if (state.storedConfig && state.storedConfig.failedAttempts > 0) {
            const updated = { ...state.storedConfig, failedAttempts: 0, lockoutUntilMs: 0 };
            await saveAppLockConfig(updated);
            set({ storedConfig: updated, failedAttempts: 0, lockoutRemainingSec: 0 });
          }
          set({ isLocked: false });
          return true;
        }
      } catch (err) {
        logger.warn("[AppLock] Biometric unlock rejected or failed:", err);
      }
      return false;
    }

    // In web/dev mock mode, biometrics succeed
    set({ isLocked: false });
    return true;
  },

  unlockWithPasscode: async (passcode) => {
    const state = get();
    if (!state.enabled || !state.isLocked) return { success: true };

    const now = Date.now();
    if (state.storedConfig && state.storedConfig.lockoutUntilMs > now) {
      const remaining = Math.ceil((state.storedConfig.lockoutUntilMs - now) / 1000);
      return { success: false, error: "cooldown", lockoutSec: remaining };
    }

    if (!state.storedConfig) {
      set({ isLocked: false });
      return { success: true };
    }

    const isValid = await verifyPasscode(passcode, state.storedConfig);

    if (isValid) {
      const updated: StoredAppLockConfig = {
        ...state.storedConfig,
        failedAttempts: 0,
        lockoutUntilMs: 0,
      };
      await saveAppLockConfig(updated);
      set({
        isLocked: false,
        failedAttempts: 0,
        lockoutRemainingSec: 0,
        storedConfig: updated,
      });
      return { success: true };
    }

    // Passcode incorrect!
    const newFailures = (state.storedConfig.failedAttempts || 0) + 1;
    const penaltyMs = calculateLockoutPenalty(newFailures);
    const lockoutUntilMs = penaltyMs > 0 ? now + penaltyMs : 0;
    const lockoutSec = Math.ceil(penaltyMs / 1000);

    const updated: StoredAppLockConfig = {
      ...state.storedConfig,
      failedAttempts: newFailures,
      lockoutUntilMs,
    };
    await saveAppLockConfig(updated);

    if (lockoutUntilMs > 0) {
      startLockoutCountdown(lockoutUntilMs);
    }

    set({
      failedAttempts: newFailures,
      lockoutRemainingSec: lockoutSec,
      storedConfig: updated,
    });

    return {
      success: false,
      error: lockoutSec > 0 ? "cooldown" : "invalid_passcode",
      lockoutSec,
    };
  },

  lockNow: () => {
    if (get().enabled) {
      set({ isLocked: true });
    }
  },

  resetAppLockOnLogout: async () => {
    await clearAppLockConfig();
    if (lockoutTimer) {
      clearInterval(lockoutTimer);
      lockoutTimer = null;
    }
    set({
      isConfigured: false,
      enabled: false,
      isLocked: false,
      failedAttempts: 0,
      lockoutRemainingSec: 0,
      storedConfig: null,
    });
  },
}));

function startLockoutCountdown(lockoutUntilMs: number) {
  if (lockoutTimer) {
    clearInterval(lockoutTimer);
  }

  const update = () => {
    const diff = lockoutUntilMs - Date.now();
    if (diff <= 0) {
      if (lockoutTimer) clearInterval(lockoutTimer);
      lockoutTimer = null;
      useAppLockStore.setState({ lockoutRemainingSec: 0 });
    } else {
      useAppLockStore.setState({ lockoutRemainingSec: Math.ceil(diff / 1000) });
    }
  };

  update();
  lockoutTimer = setInterval(update, 1000);
}
