// The ONE place that knows how an item is addressed. Every entry point (library ·
// wishlist · dashboard · discover · insights) routes through here.
import { CATALOG } from "@/lib/sources/catalog";
import { publicItemHref } from "@/lib/publicUrl";
import { publicFacetHref, isLinkableFacetKind } from "@/lib/facetUrl";
import type { FacetKind, FacetRole } from "@/lib/facets";

export interface InspectableItem {
  id: string;
  type: string;
  title?: string | null;
  /** The public url address segment. When absent, buildItemHref emits the
   *  legacy uuid url, which permanently redirects to the slug one. */
  slug?: string | null;
  /** An explicit destination that overrides the id/slug derivation entirely.
   *  Set only by a card that is NOT a catalog row and so has no item url of its
   *  own — today that is a franchise member we do not hold, pointing at the /r
   *  resolver (2026-08-23). See buildItemHref. */
  href?: string;
  releaseDate?: string | null;
  posterUrl?: string | null;
  // Watchlist / library shape
  sources?: { source: string; sourceId: string }[];
  // Discover shape
  ids?: { rawg?: number | string; tmdb?: number | string; trakt?: number | string; steam?: number | string; letterboxd?: number | string };
}

// The `/item?…&tmdbId=…` param names, declared once on the catalog entries (A5).
// Still needed by the /item → /{type}/{id}/{slug} redirect, which reads the ids
// off the legacy url it's forwarding.
export const SOURCE_PARAMS: string[] = Object.values(CATALOG).map((m) => m.urlParam);

// source → its `/item` query-param name (`tmdb` → `tmdbId`), for that same
// legacy read side.
export const SOURCE_PARAM: Record<string, string> = Object.fromEntries(
  Object.values(CATALOG).map((m) => [m.id, m.urlParam]),
);

// P13 — every entry point links to the ONE shared item url, `/{type}/{id}/{slug}`.
// It used to build `/item?id=…&tmdbId=…`, a separate authed page; that page is now
// a redirect to this url. Rewriting it HERE means all ~12 call sites moved without
// touching them.
//
// H2b — `item.id` is now always a uuid, including for discover results, so the
// item's own id IS its address. This used to have to collapse `sources[]`/`ids{}`
// into a source→id map and pick a "best" source to address a discover item by,
// because those items had no row yet.
export function buildItemHref(item: InspectableItem): string {
  // An explicit href wins (2026-08-23). A franchise member we do not hold has
  // no uuid and no slug, so publicItemHref has nothing to build from — it would
  // emit a url that hard-404s. Such a card carries a /r resolver destination
  // instead, which ingests the title on demand and redirects to its real page.
  if (item.href) return item.href;
  return publicItemHref(item);
}

// P17 — link to the PUBLIC facet page (`/person|tag|studio/{slug}`), not the old
// authed `/insights/facet?…` query-param page (now a 308 redirect to this). role
// is dropped from the url on purpose: the public page shows the person's whole
// body of work, role-badged per title. See facetUrl.ts.
export function buildFacetHref(f: { kind: string; role?: string; key: string; label: string }): string {
  // This one takes an untyped `kind` (callers hand it loosely-typed rows), so
  // the LinkableFacetKind guarantee has to be checked rather than inferred. No
  // current caller can reach this: Insights renders three kind-scoped sections,
  // and every other producer is a literal. It throws rather than emitting
  // `/undefined/star-wars`, because a wrong href is the failure that survives
  // review — an unlinkable facet reaching a URL builder is a bug upstream.
  if (!isLinkableFacetKind(f.kind)) {
    throw new Error(`buildFacetHref: facet kind "${f.kind}" has no public page`);
  }
  return publicFacetHref({ kind: f.kind, role: f.role as FacetRole | undefined, key: f.key, label: f.label });
}
