import { useCallback } from "react";
import {
  cancelBackup,
  isBackupRunning,
  startBackup,
} from "@/lib/backup/controller";
import { useBackupProgressStore } from "@/stores/backupProgressStore";

export interface UseBackupRunner {
  isRunning: boolean;
  runNow: () => Promise<void>;
  cancel: () => void;
}

export function useBackupRunner(): UseBackupRunner {
  const isRunning = useBackupProgressStore((s) => s.active);

  const runNow = useCallback(async () => {
    if (isBackupRunning()) return;
    await startBackup({ triggeredBy: "manual", reason: "manual" });
  }, []);

  const cancel = useCallback(() => {
    cancelBackup();
  }, []);

  return { isRunning, runNow, cancel };
}
