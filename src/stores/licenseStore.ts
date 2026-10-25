/**
 * licenseStore — stub replacement.
 *
 * TeleDrive is now a fully free application. All plan/Pro gating, backend
 * JWT authentication, and device-management features have been removed.
 *
 * This stub keeps the same export surface so any remaining imports compile
 * without changes. All backend actions are no-ops. `backupFolders` is now
 * persisted in localStorage directly by this store.
 */
import { create } from 'zustand';

export type Plan = 'FREE' | 'PRO';

export interface BackupFoldersPayload {
  paths: string[];
  excludes: string[];
}

/** Kept for source compatibility with files that import Device type */
export interface Device {
  id: string;
  deviceName: string;
  os: string;
  lastSeenAt: string | null;
  createdAt: string;
}

/** Kept for source compatibility */
export interface License {
  id: string;
  plan: Plan;
  purchasedAt: string | null;
  expiresAt: string | null;
  scheduledBackupIntervalMinutes: number | null;
}

/** Kept for source compatibility */
export type LicenseResponse = License;

interface LicenseState {
  plan: Plan;
  backupFolders: BackupFoldersPayload;
  backendReachable: boolean;
  /** Kept for source compatibility — always null. */
  jwt: null;
  license: License | null;
  activeDevices: Device[];
  deviceLimit: number;
  canActivateDevice: boolean;
  inFlightVerify: null;

  // No-op actions kept for import compatibility
  loginToBackend: (_params: unknown) => Promise<void>;
  reconnectToBackend: (_params: unknown) => Promise<void>;
  verifyBackendSession: () => Promise<void>;
  refreshBackendState: () => Promise<void>;
  logoutFromBackend: () => Promise<void>;
  revokeDeviceById: (_deviceId: string) => Promise<void>;
  setProSchedule: (intervalMinutes: number | null) => Promise<void>;
  setProBackupFolders: (folders: BackupFoldersPayload) => Promise<void>;
}

const BACKUP_FOLDERS_KEY = 'teledrive_backup_folders';
const BACKUP_SCHEDULE_KEY = 'teledrive_backup_schedule';
const BACKUP_SCHEDULE_ENABLED_AT_KEY = 'teledrive_backup_schedule_enabled_at';

function loadBackupFolders(): BackupFoldersPayload {
  try {
    const raw = localStorage.getItem(BACKUP_FOLDERS_KEY);
    if (raw) return JSON.parse(raw) as BackupFoldersPayload;
  } catch { /* ignore */ }
  return { paths: [], excludes: [] };
}

function saveBackupFolders(folders: BackupFoldersPayload): void {
  try {
    localStorage.setItem(BACKUP_FOLDERS_KEY, JSON.stringify(folders));
  } catch { /* ignore */ }
}

function loadBackupSchedule(): number | null {
  try {
    const raw = localStorage.getItem(BACKUP_SCHEDULE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function saveBackupSchedule(intervalMinutes: number | null): void {
  try {
    localStorage.setItem(BACKUP_SCHEDULE_KEY, JSON.stringify(intervalMinutes));
    if (intervalMinutes != null && intervalMinutes > 0) {
      localStorage.setItem(BACKUP_SCHEDULE_ENABLED_AT_KEY, String(Date.now()));
    } else {
      localStorage.removeItem(BACKUP_SCHEDULE_ENABLED_AT_KEY);
    }
  } catch { /* ignore */ }
}

export function getBackupScheduleEnabledAt(): number | null {
  try {
    const raw = localStorage.getItem(BACKUP_SCHEDULE_ENABLED_AT_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export const useLicenseStore = create<LicenseState>((set, _get) => ({
  plan: 'PRO',
  backupFolders: loadBackupFolders(),
  backendReachable: false,
  jwt: null,
  license: {
    id: 'local',
    plan: 'PRO',
    purchasedAt: null,
    expiresAt: null,
    scheduledBackupIntervalMinutes: loadBackupSchedule(),
  },
  activeDevices: [],
  deviceLimit: Infinity,
  canActivateDevice: true,
  inFlightVerify: null,

  loginToBackend: async () => { /* no-op: backend removed */ },
  reconnectToBackend: async () => { /* no-op: backend removed */ },
  verifyBackendSession: async () => { /* no-op: backend removed */ },
  refreshBackendState: async () => { /* no-op: backend removed */ },
  logoutFromBackend: async () => { /* no-op: backend removed */ },
  revokeDeviceById: async () => { /* no-op: backend removed */ },

  setProSchedule: async (intervalMinutes) => {
    saveBackupSchedule(intervalMinutes);
    // Update local license projection so the UI stays in sync
    set((prev) => ({
      license: prev.license
        ? { ...prev.license, scheduledBackupIntervalMinutes: intervalMinutes }
        : { id: 'local', plan: 'PRO', purchasedAt: null, expiresAt: null, scheduledBackupIntervalMinutes: intervalMinutes },
    }));
  },

  setProBackupFolders: async (folders) => {
    if (!Array.isArray(folders.paths) || !Array.isArray(folders.excludes)) return;
    const next: BackupFoldersPayload = {
      paths: folders.paths.filter((p) => typeof p === 'string' && p.length > 0).slice(0, 10),
      excludes: folders.excludes.filter((p) => typeof p === 'string' && p.length > 0).slice(0, 30),
    };
    saveBackupFolders(next);
    set({ backupFolders: next });
  },
}));

/** Test-only escape hatch */
export function __resetLicenseStoreForTests(): void {
  useLicenseStore.setState({
    plan: 'FREE',
    backupFolders: { paths: [], excludes: [] },
    backendReachable: false,
    jwt: null,
    license: null,
    activeDevices: [],
    deviceLimit: Infinity,
    canActivateDevice: true,
    inFlightVerify: null,
  });
  try {
    localStorage.removeItem('teledrive_backup_schedule_enabled_at');
  } catch { /* ignore */ }
}
