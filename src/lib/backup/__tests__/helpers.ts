import { vi } from "vitest";
import type { TeleFile } from "../../types";
import { useFileStore } from "@/stores/fileStore";
import { resetManifestStateForTests } from "../manifest";
import { resetBackupIndexSaveForTests } from "../indexSave";
import { resetBackupControllerForTests } from "../controller";

export interface MemoryManifestState {
  base: string | null;
  generation: number;
  journal: string[];
}

export interface MemoryBackend {
  invoke: (...args: any[]) => Promise<any>;
  vault: Map<string, string>;
  manifests: Map<string, MemoryManifestState>;
}

export function createMemoryBackend(): MemoryBackend {
  const vault = new Map<string, string>();
  const manifests = new Map<string, MemoryManifestState>();

  const stateFor = (channelId: string): MemoryManifestState => {
    let state = manifests.get(channelId);
    if (!state) {
      state = { base: null, generation: 0, journal: [] };
      manifests.set(channelId, state);
    }
    return state;
  };

  const invoke = vi.fn(async (command: string, args: any = {}) => {
    switch (command) {
      case "load_backup_manifest": {
        const state = stateFor(args.channelId);
        return {
          base: state.base,
          generation: state.generation,
          journal: [...state.journal],
        };
      }
      case "save_backup_manifest": {
        const state = stateFor(args.channelId);
        if (state.generation !== args.generation) {
          throw new Error(
            `generation changed (expected ${args.generation}, found ${state.generation})`,
          );
        }
        const parsed = JSON.parse(args.value);
        const next = state.generation + 1;
        parsed.generation = next;
        state.base = JSON.stringify(parsed);
        state.generation = next;
        state.journal = [];
        return next;
      }
      case "append_backup_manifest_journal": {
        const state = stateFor(args.channelId);
        if (state.generation !== args.generation) {
          throw new Error(
            `generation changed (expected ${args.generation}, found ${state.generation})`,
          );
        }
        state.journal.push(args.line);
        return null;
      }
      case "quarantine_backup_manifest": {
        const state = stateFor(args.channelId);
        const base = state.base;
        state.base = null;
        state.journal = [];
        return base;
      }
      case "load_vault_value":
        return vault.get(args.key) ?? null;
      case "save_vault_value":
        vault.set(args.key, args.value);
        return null;
      case "delete_vault_value":
        vault.delete(args.key);
        return null;
      case "quarantine_vault_value": {
        const value = vault.get(args.key);
        if (value !== undefined) {
          vault.set(args.backupKey, value);
          vault.delete(args.key);
        }
        return null;
      }
      case "get_app_data_dir":
        return "/tmp/teledrive-test";
      case "cancel_backup_walk":
        return null;
      default:
        return null;
    }
  });

  return { invoke, vault, manifests };
}

export function makeTeleFile(
  id: string,
  overrides: Partial<TeleFile> = {},
): TeleFile {
  return {
    id,
    name: `${id}.txt`,
    size: 100,
    mime: "text/plain",
    folderPath: "/TeleDrive Backups/Device",
    messageId: 100,
    channelId: "chan_test",
    uploadedAt: 1_000,
    starred: false,
    trashed: false,
    ...overrides,
  };
}

export function resetBackupTestState(): void {
  resetManifestStateForTests();
  resetBackupIndexSaveForTests();
  resetBackupControllerForTests();
  useFileStore.setState({
    files: [],
    indexLoadState: "ready",
    indexLoadError: null,
    indexQueueState: "idle",
    indexQueueError: null,
    indexQueueRetryInSec: 0,
    bootstrapComplete: true,
    lastBackupAt: null,
  });
}

export function installMemoryLocalStorage(): () => void {
  const prior = (globalThis as any).localStorage;
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, String(value)),
    removeItem: (key: string) => map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
  return () => {
    if (prior === undefined) delete (globalThis as any).localStorage;
    else (globalThis as any).localStorage = prior;
  };
}
