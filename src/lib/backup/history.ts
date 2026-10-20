/**
 * Channel-side snapshot history reader.
 *
 * Reads `teledrive_snapshot_v1` text messages from the Telegram storage
 * channel. Mirrors `parseIndexMessages` + `loadIndex` (in
 * `src/lib/storage/metadataStore.ts`) — same pattern: pinned + recent
 * 5s-timeout fetch, in-memory filter+parse, never throws on partial data.
 *
 * Used by `useActivityLog` to surface snapshot metadata in the Settings
 * → Plan & Devices → Activity panel alongside the audit-log rows from
 * `/api/backup/history`.
 *
 * Snapshots are metadata-only per the user's design choice for v1 — they
 * record `{fileCount, totalBytes, ts, triggeredBy, schema:"v1"}` and do
 * NOT include the actual file list. The "Restore to this point" button
 * is therefore an orphan-recovery re-scan filtered to the snapshot's
 * message id, not a literal rollback. Full file-list restore is future
 * work (would require snapshots to embed the file array, bloating each
 * Telegram text message).
 */
import { Api } from "telegram";
import { getClient } from "../telegram/client";
import { resolveChannelInputPeer, withTimeout } from "../storage/metadataStore";
import { withTelegramRetry } from "../telegram/rateLimit";

/** Single parsed snapshot row, ready for the UI. */
export interface SnapshotHistoryEntry {
  /** Telegram message id of the snapshot text message. */
  msgId: number;
  /** Wall-clock time the snapshot was taken (ISO 8601 string). */
  ts: string;
  /** Number of files at snapshot time. */
  fileCount: number;
  /** Total bytes of all files at snapshot time. */
  totalBytes: number;
  /** How the snapshot was triggered. */
  triggeredBy: "manual" | "auto";
}

const SNAPSHOT_PREFIX = "teledrive_snapshot_v1";

/**
 * Parse a batch of Telegram messages into SnapshotHistoryEntry records.
 *
 * Filters on the snapshot prefix (ignores index messages, file uploads,
 * and unrelated text). Silently skips malformed JSON or schema
 * mismatches — partial data is fine for a timeline view.
 */
export function parseSnapshotMessages(messages: any[]): SnapshotHistoryEntry[] {
  const snapMsgs = messages
    .filter(
      (m: any) => typeof m?.text === "string" && m.text.startsWith(SNAPSHOT_PREFIX),
    )
    .sort((a: any, b: any) => Number(a.id) - Number(b.id));
  const parsed: SnapshotHistoryEntry[] = [];
  for (const msg of snapMsgs) {
    try {
      // Body is `<prefix>\n<json>`. Strip the prefix line before parsing.
      const newlineIdx = msg.text.indexOf("\n");
      const jsonText = newlineIdx >= 0 ? msg.text.slice(newlineIdx + 1) : msg.text;
      const data = JSON.parse(jsonText);
      if (
        data &&
        typeof data.fileCount === "number" &&
        typeof data.totalBytes === "number" &&
        typeof data.ts === "string" &&
        (data.triggeredBy === "manual" || data.triggeredBy === "auto")
      ) {
        parsed.push({
          msgId: Number(msg.id),
          ts: data.ts,
          fileCount: data.fileCount,
          totalBytes: data.totalBytes,
          triggeredBy: data.triggeredBy,
        });
      }
    } catch {
      // Malformed snapshot — skip. Old or partial writes are normal.
    }
  }
  // Sort newest-first for the UI.
  return parsed.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}

/**
 * Fetch all snapshot history visible in the storage channel.
 *
 * Same fetch strategy as `loadIndex`: pinned + recent-200, each wrapped
 * in a 5s timeout. We don't use `loadIndexIncremental` because there's
 * no high-water-mark cursor for snapshots — we want the full visible
 * history, not just post-cursor messages.
 *
 * Returns an empty array on hard failures (channel missing, auth lost)
 * so the Activity UI can still render the audit-log rows from
 * `/api/backup/history`. Errors are logged with `console.warn`; callers
 * don't need try/catch.
 */
export async function loadSnapshotHistory(
  channelId: string,
): Promise<SnapshotHistoryEntry[]> {
  return withTelegramRetry(
    async () => {
      const client = getClient();
      const peer = await resolveChannelInputPeer(channelId);

      let allMsgs: any[] = [];
      try {
        const pinned = await withTimeout(
          client.getMessages(peer, {
            filter: new Api.InputMessagesFilterPinned(),
            limit: 100,
          }),
          5000,
          "loadSnapshotHistory.getMessages(pinned)",
        );
        allMsgs = allMsgs.concat(pinned);
      } catch (err) {
        console.warn(
          "[history] Failed to load pinned messages, falling back to scan:",
          err,
        );
      }

      try {
        const recent = await withTimeout(
          client.getMessages(peer, { limit: 200 }),
          5000,
          "loadSnapshotHistory.getMessages(recent)",
        );
        allMsgs = allMsgs.concat(recent);
      } catch (err) {
        console.warn(
          "[history] Failed to scan recent channel messages:",
          err,
        );
      }

      return parseSnapshotMessages(allMsgs);
    },
    "loadSnapshotHistory",
    3,
  ).catch((err) => {
    // Hard failure (auth lost, channel missing). Return empty so the
    // Activity UI can still render the audit-log rows.
    console.warn("[history] loadSnapshotHistory failed:", err);
    return [] as SnapshotHistoryEntry[];
  });
}