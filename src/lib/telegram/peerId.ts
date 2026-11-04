/**
 * Telegram channel id helpers.
 *
 * Older builds stored the raw positive `channel.id`; current builds store the
 * marked `-100…` id. Both refer to the same channel. Normalising at every
 * boundary keeps lookups working after an upgrade and lets local stores keyed
 * by channel id (tombstones, pending markers, backup manifests) migrate
 * without losing data.
 */

/** `"123"` -> `"-100123"`; marked ids, usernames and links are unchanged. */
export function canonicalChannelId(channelId: string): string {
  const id = channelId.trim();
  if (/^\d+$/.test(id)) return `-100${id}`;
  return id;
}

/** `"-100123"` -> `"123"`; null when the id is not a marked channel id. */
export function rawChannelId(channelId: string): string | null {
  const id = channelId.trim();
  if (/^-100\d+$/.test(id)) return id.slice(4);
  return null;
}

/** Every key that could hold local data for this channel. */
export function channelKeyVariants(channelId: string): string[] {
  const exact = channelId.trim();
  if (!exact) return [];
  const canonical = canonicalChannelId(exact);
  const variants = new Set<string>([exact, canonical]);
  const raw = rawChannelId(canonical);
  if (raw) variants.add(raw);
  return [...variants];
}
