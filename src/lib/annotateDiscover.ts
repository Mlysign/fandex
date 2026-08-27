// The persist → annotate pair every live-provider route runs its items through
// before serializing them. Extracted 2026-07-28 when the calendar's popular-
// releases route became the THIRD copy (it was already duplicated verbatim in
// api/discover/route.ts and api/home/route.ts).

import { persistDiscoverItems, lookupExistingUuids } from "@/lib/discoverPersist";
import { getUserStateMap, resolveMediaIdsBySource, sourceRefKey } from "@/lib/userState";
import { slugsForItemIds } from "@/lib/itemSlug";
import { availabilityForItems } from "@/lib/availability";

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
// A `media_items` id, which is the one kind of item id that needs no resolving.
// Provider ids are composites (`tmdb-movie-693134`, `rawg-45`), so this can
// never collide with one.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function persistDiscoverBatch<T extends { id: string; raw?: unknown }>(
  items: T[],
  userId: string | null
): Omit<T, "raw">[] {
  const idMap = !items.length
    ? new Map<string, string>()
    : userId
      ? persistDiscoverItems(items as any)
      : lookupExistingUuids(items as any);
  // ⚠️ An item that came from OUR catalog (the outage fallback in
  // lib/catalogFeed.ts) already carries its uuid and has no `raw` to resolve
  // by — and both helpers above skip anything without `raw`. Measured
  // 2026-08-27: without this branch every fallback card shipped
  // `linkable: false` with no slug, i.e. a whole page of titles nobody could
  // click, which is the same defect [[anon-surface-has-no-item-links]] records.
  const alreadyRows = items.filter((it) => UUID_RE.test(it.id)).map((it) => it.id);
  // The slug too, so a card links straight to the canonical url instead of
  // through the legacy uuid one (which 308s). Same shape as the uuid: a title
  // we do not hold has neither, and is already non-linkable.
  const slugs = slugsForItemIds([...idMap.values(), ...alreadyRows]);
  return items.map(({ raw: _raw, ...it }) => {
    const uuid = idMap.get(it.id) ?? (UUID_RE.test(it.id) ? it.id : undefined);
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
// SM50 — `type` joined the constraint: a provider id names one work only within
// a media type. Optional on T because a few callers pass rows that genuinely
// carry no type; those fall back to matching on source + id alone.
export function annotateUserState<T extends { ids?: Record<string, unknown>; type?: unknown }>(items: T[], userId: string | null) {
  if (!userId) {
    return items.map((it) => ({ ...it, platformSources: [] as string[], onWatchlist: false, libraryStatus: null as string | null, rating: null as number | null }));
  }

  const typeOf = (it: T) => (typeof it.type === "string" ? it.type : undefined);
  const pairs: { source: string; sourceId: string; type?: string }[] = [];
  for (const it of items) {
    for (const [source, sid] of Object.entries(it.ids ?? {})) {
      if (sid != null) pairs.push({ source, sourceId: String(sid), type: typeOf(it) });
    }
  }
  const idMap = resolveMediaIdsBySource(pairs);
  const stateMap = getUserStateMap(userId, [...new Set(idMap.values())]);

  return items.map((it) => {
    let mediaItemId: string | undefined;
    for (const [source, sid] of Object.entries(it.ids ?? {})) {
      if (sid == null) continue;
      const mid = idMap.get(sourceRefKey(source, String(sid), typeOf(it)));
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

/**
 * Attach the streaming availability we ALREADY hold for these items, in the
 * viewer's region. DB-only, one query per batch, no provider call.
 *
 * Runs AFTER persistDiscoverBatch, which is what turns a provider id into the
 * `media_items` uuid this reads by. An item we do not hold keeps no
 * `streamingProviders` key at all rather than an empty array: absent means "we
 * cannot say", and `[]` would claim "it is on nothing", which the filter reads
 * as a reason to hide it.
 *
 * ⚠️ Movies and shows only, by construction — `watch/providers` is TMDB's, and
 * games carry their `platforms` from the feed payload already.
 *
 * → docs/catalog-growth.md phase 1, and lib/availability.ts for the two stored
 * shapes and the region rule this must keep in step with.
 */
export function annotateAvailability<T extends { id: string; linkable?: boolean; streamingProviders?: unknown }>(
  items: T[],
  region: string
): T[] {
  if (!items.length) return items;
  const ids = items.filter((it) => it.linkable !== false).map((it) => it.id);
  const byId = availabilityForItems(ids, region);
  if (byId.size === 0) return items;
  return items.map((it) => {
    const hit = it.linkable === false ? undefined : byId.get(it.id);
    return hit ? { ...it, streamingProviders: hit } : it;
  });
}
