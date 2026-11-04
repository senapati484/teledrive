import { Api, utils } from "telegram";
import { getClient } from "./client";
import { getSecret, saveSecret, VAULT_KEY_CHANNEL_ID, channelIdKey } from "../secure/vault";
import { canonicalChannelId } from "./peerId";

/**
 * Ensures the TeleDrive Storage channel exists for the given phone number.
 *
 * Multi-account design:
 *   Each Telegram account stores its channel ID under a phone-specific vault key:
 *   e.g. "telegram_channel_id_+918653420095"
 *
 *   This means logging in with Account A and Account B never interferes — each
 *   account finds its own channel and its own uploaded files.
 *
 * Lookup order:
 *   1. Phone-specific vault key  (fast path, normal case)
 *   2. Legacy generic key        (migration: single-account installs before this change)
 *   3. Dialog search             (recovery: vault cleared / first run on new device)
 *   4. Create new channel        (first-ever login for this account)
 */
const STORAGE_CHANNEL_TITLE = "TeleDrive Storage";

interface DialogSearchResult {
  /** Marked channel id (`-100…`) when found. */
  id: string | null;
  /** True only when every folder scan finished; a failed scan must not
   *  be mistaken for "this account has no storage channel yet". */
  complete: boolean;
}

/**
 * Look for the storage channel in both the main chat list and the archive.
 * `getDialogs({})` only scans the main folder, so an archived channel would
 * otherwise be invisible and we'd create a duplicate on the other device.
 */
async function searchStorageChannelInDialogs(): Promise<DialogSearchResult> {
  const client = getClient();
  let complete = true;

  // 0 = main folder, 1 = archive. Scan both before concluding it's absent.
  for (const folder of [0, 1]) {
    try {
      const dialogs = await client.getDialogs({ folder });
      for (const dialog of dialogs) {
        if (
          dialog.title === STORAGE_CHANNEL_TITLE &&
          (dialog.isChannel || dialog.entity?.className === "Channel") &&
          dialog.id
        ) {
          return { id: canonicalChannelId(String(dialog.id)), complete: true };
        }
      }
    } catch (err) {
      complete = false;
      console.warn(`[channelManager] Dialog search (folder ${folder}) failed:`, err);
    }
  }

  return { id: null, complete };
}

export async function ensureStorageChannel(phone: string): Promise<string> {
  const client = getClient();
  const phoneKey = channelIdKey(phone);

  // ── 1. Phone-specific vault key (fast path) ──────────────────────────────
  let channelId = await getSecret(phoneKey);

  if (channelId) {
    const canonical = canonicalChannelId(channelId);
    try {
      const peer = await client.getEntity(canonical);
      if (peer) {
        if (canonical !== channelId) {
          await saveSecret(phoneKey, canonical);
          console.info(
            `[channelManager] Migrated channel id ${channelId} → ${canonical}`
          );
        }
        return canonical;
      }
    } catch (err) {
      console.warn(`[channelManager] Phone-keyed channel ${channelId} not accessible, continuing…`, err);
      channelId = null;
    }
  }

  // ── 2. Legacy generic key (migration path for existing installs) ─────────
  if (!channelId) {
    const legacyId = await getSecret(VAULT_KEY_CHANNEL_ID);
    if (legacyId) {
      const canonical = canonicalChannelId(legacyId);
      try {
        const peer = await client.getEntity(canonical);
        if (peer) {
          // Migrate: write under the phone-specific key so future lookups are fast
          await saveSecret(phoneKey, canonical);
          if (canonical !== legacyId) {
            await saveSecret(VAULT_KEY_CHANNEL_ID, canonical);
          }
          console.info(`[channelManager] Migrated legacy channel ID ${legacyId} → ${phoneKey}`);
          return canonical;
        }
      } catch (err) {
        console.warn(`[channelManager] Legacy channel ${legacyId} not accessible, searching dialogs…`, err);
      }
    }
  }

  // ── 3. Search dialogs for "TeleDrive Storage" ────────────────────────────
  const dialogSearch = await searchStorageChannelInDialogs();
  if (dialogSearch.id) {
    // dialog.id from GramJS is already the marked peer id (-100…).
    await saveSecret(phoneKey, dialogSearch.id);
    console.info(`[channelManager] Found channel via dialog search: ${dialogSearch.id}`);
    return dialogSearch.id;
  }

  // Never create a second storage channel just because Telegram was
  // unreachable for a moment — that silently splits the user's files across
  // two channels and looks like "my devices don't sync" to them.
  if (!dialogSearch.complete) {
    throw new Error(
      "Unable to search Telegram chats for the TeleDrive storage channel. Check the connection and retry."
    );
  }

  // ── 4. Create a new private channel (first-ever login for this account) ──
  try {
    const result = await client.invoke(
      new Api.channels.CreateChannel({
        title: STORAGE_CHANNEL_TITLE,
        about: "Private storage channel managed by TeleDrive. Do not delete or modify pinned messages.",
        broadcast: true,
      })
    );

    const chats = (result as any).chats || [];
    const channel = chats[0];
    if (!channel) {
      throw new Error("Failed to create storage channel: channel info missing in updates");
    }

    // `channel.id` is the raw positive id. GramJS resolves a bare positive id
    // as a *user*, so storing it makes every later getEntity/getMessages call
    // fail (or hit the wrong peer). Use the marked channel id (-100…) that
    // Telegram and `dialog.id` use.
    const idStr = canonicalChannelId(utils.getPeerId(channel));
    await saveSecret(phoneKey, idStr);
    console.info(`[channelManager] Created new channel: ${idStr} for ${phoneKey}`);
    return idStr;
  } catch (err) {
    console.error("[channelManager] Failed to create storage channel:", err);
    throw err;
  }
}

/**
 * Look up the storage channel id WITHOUT contacting Telegram.
 *
 * Used by the multi-device sync orchestrator and the backup scheduler,
 * both of which need to know the channel id WITHOUT triggering a full
 * `ensureStorageChannel` (which would do dialog searches and potentially
 * create a new channel — too heavy for a background tick).
 *
 * Returns the phone-keyed id if present, else the legacy generic key.
 * Returns null if neither is set yet (i.e. user hasn't completed first
 * login). The caller should treat null as "wait for bootstrap" and
 * retry shortly.
 *
 * @param phone  The authenticated phone number, e.g. "+918653420095".
 *               Falls back to the legacy generic key if empty.
 */
export async function getStorageChannelId(phone?: string | null): Promise<string | undefined> {
  const phoneStr = phone ?? "";
  try {
    if (phoneStr) {
      const phoneKey = channelIdKey(phoneStr);
      const id = await getSecret(phoneKey);
      if (id) return canonicalChannelId(id);
    }
    const legacy = await getSecret(VAULT_KEY_CHANNEL_ID);
    return legacy ? canonicalChannelId(legacy) : undefined;
  } catch {
    return undefined;
  }
}

