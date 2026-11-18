/**
 * BackupsPage — the dedicated entry point for browsing device backups.
 *
 * Renders <FileBrowser> rooted at /TeleDrive Backups so the user can
 * drill down into the per-device folder tree that the backup runner
 * writes to. The FileBrowser component reads `mode="backups"` and:
 *
 *   - filters out non-backup items (so this view never shows anything
 *     outside the backup namespace),
 *   - shows the read-only banner,
 *   - hides New Folder / Upload actions (backups are immutable),
 *   - renders a "Backups" breadcrumb segment so the user can return
 *     here from nested folders.
 *
 * FREE users see this view empty with the Pro-feature banner pattern
 * from BackupSection — the sidebar entry stays visible so they can
 * discover the feature exists.
 */
import { useEffect } from "react";
import { logger } from "@/lib/logger";
import { FileBrowser } from "@/components/files/FileBrowser";
import { BACKUP_ROOT } from "@/lib/backup/visibility";
import { useFileStore } from "@/stores/fileStore";
import { isBackupItem } from "@/lib/backup/visibility";

export default function BackupsPage() {
  // Dev-time diagnostic: log the backup slice of the file store on
  // mount so an empty Backups view is debuggable from devtools. The
  // log is gated by import.meta.env.DEV so production bundles don't
  // carry the string and it stays cheap in dev.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const files = useFileStore.getState().files;
    const backupFiles = files.filter(isBackupItem);
    const sample = backupFiles.slice(0, 5).map((f) => ({
      name: f.name,
      folderPath: f.folderPath,
      mime: f.mime,
    }));
    logger.log(
      `[BackupsPage] total files: ${files.length}, backup items: ${backupFiles.length}. Sample:`,
      sample,
    );
  }, []);
  return <FileBrowser folderPath={BACKUP_ROOT} mode="backups" />;
}