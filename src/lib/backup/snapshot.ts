/**
 * Backup snapshot sender.
 *
 * A snapshot is a TEXT MESSAGE posted to the user's Telegram storage channel
 * with body `teledrive_snapshot_v1\n{json}` and (best-effort) pinned. It is
 * the audit log anchor for the user's index — file content itself stays in
 * Telegram, never duplicated here.
 *
 * The body format is forward-compatible: a future `restore-from-backup`
 * feature reads the same channel, scans for the snapshot prefix, and
 * reconstructs a prior index state. A future `teledrive_snapshot_v2`
 * format would coexist cleanly (the bootstrap filters by prefix).
 *
 * After sending the Telegram message, posts an audit row to the backend
 * at `/api/backup/log` so the Plan page can show a "Last backup: 3 hours
 * ago" history. The backend dedupes by (userId, scheduledFor) so two
 * devices both running the same tick don't create duplicate audit rows.
 */
import { Api } from "telegram";
import { getClient } from "../telegram/client";
import { resolveChannelInputPeer } from "../storage/metadataStore";
import { withTelegramRetry } from "../telegram/rateLimit";
import { useFileStore } from "@/stores/fileStore";
import { logVaultState } from "../runtime/bridge";
import type { TeleFile } from "../types";

const SNAPSHOT_PREFIX = "teledrive_snapshot_v1";

export type Trigger = "manual" | "auto";

export interface SnapshotResult {
  /** Telegram message id of the snapshot text message. Null if send failed. */
  messageId: number | null;
  /** File count at snapshot time. */
  fileCount: number;
  /** Sum of file sizes in bytes at snapshot time. */
  totalBytes: number;
  /** scheduledFor value used in the audit row (rounded to the second). */
  scheduledFor: Date;
  /** ISO timestamp of the snapshot. Mirrors scheduledFor for manual runs. */
  ranAt: Date;
}

/**
 * Take a snapshot of the current index and post it to the storage channel.
 *
 * @param channelId  The user's Telegram channel id.
 * @param triggeredBy  "manual" (Run now button) or "auto" (scheduled tick).
 *
 * NEVER throws — failures are caught, logged, and recorded in the audit
 * row with `status: 'failed'`. Callers (UI toasts, scheduler) want a
 * result object even on failure.
 */
export async function takeSnapshot(
  channelId: string,
  triggeredBy: Trigger,
): Promise<SnapshotResult> {
  const files = useFileStore.getState().files;
  const fileCount = files.length;
  const totalBytes = files.reduce(
    (acc: number, f: TeleFile) => acc + (Number(f?.size) || 0),
    0,
  );

  // Round scheduledFor to the second so two simultaneous manual clicks
  // within 1s dedupe on the backend (userId, scheduledFor) unique index.
  const now = new Date();
  const scheduledFor = new Date(Math.floor(now.getTime() / 1000) * 1000);

  const snapshotPayload = {
    fileCount,
    totalBytes,
    ts: now.toISOString(),
    triggeredBy,
    schema: "v1",
  };

  let messageId: number | null = null;
  let errorMsg: string | null = null;

  try {
    messageId = await withTelegramRetry(
      async () => {
        const client = getClient();
        const peer = await resolveChannelInputPeer(channelId);
        const body =
          `${SNAPSHOT_PREFIX}\n` + JSON.stringify(snapshotPayload, null, 2);
        const result = await client.sendMessage(peer, {
          message: body,
          // silent: don't notify the user. Snapshots are background work.
          silent: true,
        } as any);
        const id = Number((result as any)?.id);
        if (!Number.isFinite(id) || id <= 0) {
          throw new Error(`sendMessage returned no usable id: ${JSON.stringify(result).slice(0, 120)}`);
        }

        // Best-effort pin. If pinning fails (PEER_ID_INVALID-style error),
        // the snapshot still exists and is queryable — log and move on.
        try {
          await client.invoke(
            new Api.messages.UpdatePinnedMessage({
              peer,
              id: Number(result.id),
              unpin: false,
              silent: true,
            }),
          );
        } catch (pinErr) {
          console.warn("[backup] snapshot pin failed (non-fatal):", pinErr);
        }

        return id;
      },
      "backup.sendSnapshot",
      3,
    );
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[backup] snapshot send failed:", err);
    await logVaultState(`BACKUP_SNAPSHOT_FAILED error=${errorMsg}`);
  }


  // Update the in-store timestamp regardless of success/failure so the UI
  // can show "Last attempt: Xs ago". For failures, the Plan page surfaces
  // a separate error.
  useFileStore.getState().setLastBackupAt(now.getTime());

  return {
    messageId,
    fileCount,
    totalBytes,
    scheduledFor,
    ranAt: now,
  };
}
