import { getClient } from "../telegram/client";
import { resolveChannelInputPeer } from "../storage/metadataStore";

/** Delete a set of messages from the storage channel (best-effort caller). */
export async function deleteMessages(
  channelId: string,
  ids: number[],
): Promise<void> {
  const unique = [...new Set(ids.map(Number).filter((id) => id > 0))];
  if (unique.length === 0) return;
  const client = getClient();
  const peer = await resolveChannelInputPeer(channelId);
  await client.deleteMessages(peer, unique, { revoke: true });
}
