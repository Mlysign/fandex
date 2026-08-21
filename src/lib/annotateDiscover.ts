// The persist → annotate pair every live-provider route runs its items through
// before serializing them. Extracted 2026-07-28 when the calendar's popular-
// releases route became the THIRD copy (it was already duplicated verbatim in
// api/discover/route.ts and api/home/route.ts).

import { persistDiscoverItems, lookupExistingUuids } from "@/lib/discoverPersist";
import { getUserStateMap, resolveMediaIdsBySource } from "@/lib/userState";
import { slugsForItemIds } from "@/lib/itemSlug";

/**
 * Give every item a media_items row (and so a uuid) and hand that uuid back as
 * the item's `id`, then STRIP `raw`.
 *
 * Two invariants ride on this function; both have already cost a production
 * incident once:
 *
 * 1. `raw` is the provider list payload used to write the row. It exists for
 *    persistence only and must never be serialized to a client (H2a).
 * 2. The WRITE is session-gated (PR15). Unconditional persistence on a public,
 *    crawlable route is what grew media_items to ~676k rows. An anonymous caller
 *    never writes.
 *
 * The anonymous branch still RESOLVES, though — it runs the read-only
 * `lookupExistingUuids` so a title that already has a row links to it. Until
 * 2026-08-12 it returned an empty map instead, which meant every card on the
 * entire logged-out surface (Home, Discover, facet pages) rendered inert: 0
 * clickable items against 2,012 real catalog rows, and crawlers dead-ended
 * (SM38). Only genuine first-sightings stay `linkable: false` now.
 *
 * This does NOT weaken the gate: the lookup is a plain SELECT, so an anonymous
 * request still writes exactly nothing.
 */
export function persistDiscoverBatch<T extends { id: string; raw?: unknown }>(
  items: T[],
  userId: string | null
): Omit<T, "raw">[] {
  const idMap = !items.length
    ? new Map<string, string>()
    : userId
      ? persistDiscoverItems(items as any)
      : lookupExistingUuids(items as any);
  // The slug too, so a card links straight to the canonical url instead of
  // through the legacy uuid one (which 308s). Same shape as the uuid: a title
  // we do not hold has neither, and is already non-linkable.
  const slugs = slugsForItemIds([...idMap.values()]);
  return items.map(({ raw: _raw, ...it }) => {
    const uuid = idMap.get(it.id);
    return (uuid
      ? { ...it, id: uuid, slug: slugs.get(uuid) ?? null }
      : { ...it, linkable: false }) as Omit<T, "raw">;
  });
}

/**
 * Attach canonical user state (wishlist providers + watched/played + rating) to
 * a batch of live provider items, resolved against the local DB by their
 * cross-source ids. DB-only — no extra external calls — so it stays fast under
 * infinite scroll.
 */
export function annotateUserState<T extends { ids?: Record<string, unknown> }>(items: T[], userId: string | null) {
  if (!userId) {
    return items.map((it) => ({ ...it, platformSources: [] as string[], onWatchlist: false, libraryStatus: null as string | null, rating: null as number | null }));
  }

  const pairs: { source: string; sourceId: string }[] = [];
  for (const it of items) {
    for (const [source, sid] of Object.entries(it.ids ?? {})) {
      if (sid != null) pairs.push({ source, sourceId: String(sid) });
    }
  }
  const idMap = resolveMediaIdsBySource(pairs);
  const stateMap = getUserStateMap(userId, [...new Set(idMap.values())]);

  return items.map((it) => {
    let mediaItemId: string | undefined;
    for (const [source, sid] of Object.entries(it.ids ?? {})) {
      if (sid == null) continue;
      const mid = idMap.get(`${source}:${sid}`);
      if (mid) { mediaItemId = mid; break; }
    }
    const st = mediaItemId ? stateMap.get(mediaItemId) : undefined;
    return {
      ...it,
      platformSources: st?.platformSources ?? [],
      onWatchlist: st?.onWatchlist ?? false,
      libraryStatus: st?.libraryStatus ?? null,
      rating: st?.rating ?? null,
    };
  });
}
