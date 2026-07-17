// The ONE place that knows how an item is addressed. Every entry point (library ·
// wishlist · dashboard · discover · insights) routes through here.
import { CATALOG } from "@/lib/sources/catalog";
import { publicItemHref } from "@/lib/publicUrl";

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
  return publicItemHref(item);
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
