// Builds the URL for the item inspection page (`/item`). Works for every entry
// point: watchlist/library items carry a UUID + a `sources` array, while
// discover items carry a composite id + an `ids` object. Both serialize into
// the same query shape that `/api/detail` already knows how to resolve.
import { CATALOG } from "@/lib/sources/catalog";
import { anyItemHref } from "@/lib/publicUrl";

export interface InspectableItem {
  id: string;
  type: string;
  title?: string | null;
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

// P13 — every entry point (library · wishlist · dashboard · discover · insights)
// now links to the ONE shared item url, `/{type}/{id}/{slug}`. It used to build
// `/item?id=…&tmdbId=…`, a separate authed page; that page is now a redirect to
// this url. Rewriting it HERE means all ~12 call sites moved without touching
// them, and there's still exactly one place that knows how an item is addressed.
export function buildItemHref(item: InspectableItem): string {
  // A library/watchlist item carries `sources[]`; a discover item carries `ids{}`.
  // Both collapse to the same source→id map that anyItemHref picks from.
  const ids: Record<string, string | number> = {};
  for (const s of item.sources ?? []) if (s.sourceId) ids[s.source] = s.sourceId;
  for (const [source, val] of Object.entries(item.ids ?? {})) if (val != null) ids[source] = val;

  return anyItemHref({ id: item.id, type: item.type, title: item.title, ids });
}

// Link to the insights facet detail page for a tag / person / company.
export function buildFacetHref(f: { kind: string; role?: string; key: string; label: string }): string {
  const p = new URLSearchParams();
  p.set("kind", f.kind);
  if (f.role) p.set("role", f.role);
  p.set("key", f.key);
  p.set("label", f.label);
  return `/insights/facet?${p.toString()}`;
}
