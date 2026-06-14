import { get, query } from "@/lib/db";
import { SOURCES, sourcesForType } from "@/lib/sources/registry";

// Which providers can hold a wishlist for a media type, their labels, and whether
// they're writable — now DERIVED from the MediaSource registry rather than a
// hand-maintained table. Adding a platform to the registry surfaces it here
// automatically.

export interface PlatformStatus {
  provider: string;
  label: string;
  displayName: string | null;
  canWrite: boolean;
  onList: boolean;
  notConnected: boolean;
  resolvedMediaItemId: string | null;
}

// Compute per-provider wishlist status for one item from local DB state.
// mediaItemId may be null (item not yet in the DB) → everything is off-list.
export function getPlatformStatus(
  userId: string,
  mediaItemId: string | null,
  type: string
): { platforms: PlatformStatus[]; onAnyList: boolean } {
  const identities = query<any>(
    "SELECT provider, display_name, provider_user_id FROM user_identities WHERE user_id = ?",
    [userId]
  );

  const currentSources: string[] = [];
  if (mediaItemId) {
    const watchlistEntry = get<{ platform_sources: string }>(
      "SELECT platform_sources FROM user_watchlist WHERE user_id = ? AND media_item_id = ?",
      [userId, mediaItemId]
    );
    if (watchlistEntry) {
      currentSources.push(...JSON.parse(watchlistEntry.platform_sources ?? "[]"));
    }
  }

  const connectedProviders = new Set(identities.map((i: any) => i.provider));

  const connectedPlatforms: PlatformStatus[] = identities
    .map((id: any) => ({ id, src: SOURCES[id.provider as keyof typeof SOURCES] }))
    .filter((x): x is { id: any; src: NonNullable<typeof x.src> } =>
      !!x.src && x.src.mediaTypes.includes(type as any))
    .map(({ id, src }) => ({
      provider: src.id,
      label: src.label,
      displayName: id.display_name ?? id.provider_user_id,
      canWrite: src.capabilities.wishlist.write,
      onList: currentSources.includes(src.id),
      notConnected: false,
      resolvedMediaItemId: mediaItemId,
    }));

  const unconnectedPlatforms: PlatformStatus[] = sourcesForType(type)
    .filter((src) => !connectedProviders.has(src.id))
    .map((src) => ({
      provider: src.id,
      label: src.label,
      displayName: null,
      canWrite: src.capabilities.wishlist.write,
      onList: false,
      notConnected: true,
      resolvedMediaItemId: mediaItemId,
    }));

  return {
    platforms: [...connectedPlatforms, ...unconnectedPlatforms],
    onAnyList: currentSources.length > 0,
  };
}
