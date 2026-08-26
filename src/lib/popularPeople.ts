import { get, query } from "@/lib/db";
import { POOL_WHERE, ROLE_WEIGHT, itemsWithFacet, getCatalogFacets } from "@/lib/discovery";
import { personKey } from "@/lib/facets";
import { keyToSlug } from "@/lib/facetUrl";
import { sharedCache } from "@/lib/boundedCache";
import type { PopularPerson } from "@/lib/personRail";

// Re-exported so a SERVER caller can take the shape from the module it already
// imports. A CLIENT component must import it from lib/personRail directly, or
// it pulls this file's db.ts import into the browser bundle. See that file.
export type { PopularPerson } from "@/lib/personRail";
export { roleLabel } from "@/lib/personRail";

// Home's "Popular people" rail, as a pure read of the LOCAL catalog.
//
// WHY THIS MAKES NO PROVIDER CALL, including for the portraits. TMDB's item
// payload embeds `credits.cast[].profile_path` and `credits.crew[].profile_path`,
// and `projectRawData` keeps them, so a person's portrait is already sitting in
// a `media_links.raw_data` blob we hold. Measured 2026-08-26 on the live db: 297
// of 300 sampled tmdb rows carry at least one cast portrait. The obvious
// implementation, resolving each name against `/search/person` and then
// `/person/{id}` for the image, would have cost two TMDB calls per face on the
// most-hit page in the app, which `docs/scalability.md` §4.2 names as the single
// most expensive thing we could do. Do not "improve" this into a fetch.
//
// WHAT "POPULAR" MEANS HERE, stated plainly because the label overpromises
// otherwise: it is weighted PRESENCE IN THE CATALOG, not a live popularity
// feed. A person scores the sum, over every pool title they appear in, of their
// role weight (director 1.3, cast 0.6; a lead outranks a cameo via
// `prominence`) times a mild recency factor. So it moves as the catalog syncs
// and it favours people attached to current titles, but it is a statement about
// this catalog rather than about the world. `rotateRailFresh` at the call site
// is what stops the same faces sitting on `/` forever.
//
// ⚠️ EVERY PERSON LINKED FROM HERE MUST CLEAR THE INDEX THRESHOLD. `/person/{slug}`
// is `noindex, follow` below MIN_INDEXABLE_TITLES (3), and the whole point of
// this rail is to feed link equity into person pages from the highest-authority
// url on the domain. Linking a 1-title person spends that on a page we have
// told Google to drop. MIN_TITLES below is that gate, and it is why the rail is
// drawn from the ~1,200 people who qualify rather than from all 8,356.

/**
 * The index threshold, mirrored from `MIN_INDEXABLE_TITLES` in
 * publicFacetDetail.ts. Not imported: that module pulls the whole provider
 * fan-out (tmdb, igdb, the facet page cache) into anything that touches it, and
 * this one must stay a plain local read. A test asserts the two agree.
 */
export const MIN_TITLES = 3;

/** Rank this deep; the caller rotates a shorter rail out of it. */
export const POPULAR_PEOPLE_POOL = 60;

/**
 * Recency factor for one title, by release year. Deliberately gentle: a steep
 * curve would turn the rail into "whatever synced last week" and drop every
 * director whose body of work is older, which is most of them.
 */
function recencyFactor(releaseDate: string | null, thisYear: number): number {
  const year = releaseDate ? Number(releaseDate.slice(0, 4)) : NaN;
  if (!Number.isFinite(year)) return 1;
  const age = thisYear - year;
  if (age <= 1) return 1.6;   // out now or imminent
  if (age <= 3) return 1.35;
  if (age <= 8) return 1.15;
  if (age <= 20) return 1;
  return 0.85;
}

// Portraits change only when a title re-syncs, and this feeds the page every
// visitor loads first. One entry, holding the whole ranked pool.
const _cache = sharedCache<string, PopularPerson[]>("popularPeople", {
  max: 1,
  ttlMs: 30 * 60 * 1000,
});

/**
 * The ranked people pool, best first. Zero provider calls, one pass over the
 * catalog pool's already-derived facets.
 */
export function popularPeople(now: Date = new Date()): PopularPerson[] {
  const hit = _cache.get("pool");
  if (hit) return hit;

  const thisYear = now.getUTCFullYear();
  const rows = query<{ id: string; release_date: string | null }>(
    `SELECT mi.id, mi.release_date FROM media_items mi WHERE ${POOL_WHERE}`,
    [],
  );

  interface Acc {
    name: string;
    score: number;
    items: Set<string>;
    roleScore: Map<string, number>;
  }
  const acc = new Map<string, Acc>();

  for (const row of rows) {
    const facets = getCatalogFacets(row.id);
    if (!facets) continue;
    const boost = recencyFactor(row.release_date, thisYear);

    for (const f of facets) {
      if (f.kind !== "person" || !f.role) continue;
      const key = f.key;
      if (!key) continue;

      // `prominence` is billing order for cast (1 = lead, tapering for
      // background) and absent for everyone else, so a lead counts fully and a
      // twelfth-billed extra barely registers, which is the difference between
      // a rail of faces people know and a rail of working actors.
      const weight = (ROLE_WEIGHT[f.role] ?? 1) * (f.prominence ?? 1);

      const cur = acc.get(key) ?? {
        name: f.label || key,
        score: 0,
        items: new Set<string>(),
        roleScore: new Map<string, number>(),
      };
      cur.score += weight * boost;
      cur.items.add(row.id);
      cur.roleScore.set(f.role, (cur.roleScore.get(f.role) ?? 0) + weight);
      // Prefer the longest label seen: providers disagree on accents and
      // middle names, and the fuller spelling is nearly always the right one.
      if (f.label && f.label.length > cur.name.length) cur.name = f.label;
      acc.set(key, cur);
    }
  }

  const ranked: PopularPerson[] = [];
  for (const [key, a] of acc) {
    if (a.items.size < MIN_TITLES) continue;
    let topRole = "cast";
    let best = -1;
    for (const [role, s] of a.roleScore) if (s > best) { best = s; topRole = role; }
    ranked.push({
      key,
      name: a.name,
      href: `/person/${keyToSlug(key)}`,
      portraitUrl: null,
      titleCount: a.items.size,
      topRole,
      score: a.score,
    });
  }

  ranked.sort((x, y) => y.score - x.score || y.titleCount - x.titleCount);
  const pool = ranked.slice(0, POPULAR_PEOPLE_POOL);

  // Portraits last, and only for the pool that survived the cut. Reading
  // raw_data is the expensive half (a JSON.parse per title inspected) and doing
  // it for 8,356 people to show 60 would be most of the cost of the function.
  for (const p of pool) p.portraitUrl = portraitFor(p.key, p.topRole);

  _cache.set("pool", pool);
  return pool;
}

/**
 * Pull a person's TMDB portrait out of a carrying title's stored payload.
 *
 * Same trick as `resolvePersonTmdbId` in discovery.ts: walk the titles that
 * carry the facet, read one tmdb blob, match by `personKey`. The one difference
 * is that it wants `profile_path` rather than `id`.
 *
 * Stops at the first hit, and bounded so a person
 * whose every carrying title happens to lack portraits can't walk their whole
 * filmography on the homepage's render.
 */
const PORTRAIT_LOOKUP_LIMIT = 6;

function portraitFor(key: string, topRole: string): string | null {
  // Try the person's strongest role first, then the others: a director is in
  // `crew`, an actor in `cast`, and looking in the wrong array finds nothing.
  const roles = [topRole, ...["director", "writer", "creator", "cast"].filter((r) => r !== topRole)];

  for (const role of roles) {
    let looked = 0;
    for (const v of itemsWithFacet({ kind: "person", role: role as never, key })) {
      if (looked++ >= PORTRAIT_LOOKUP_LIMIT) break;
      const row = get<{ raw_data: string }>(
        `SELECT raw_data FROM media_links WHERE media_item_id = ? AND source = 'tmdb' LIMIT 1`,
        [v.id],
      );
      if (!row?.raw_data) continue;
      let data: { credits?: { cast?: unknown[]; crew?: unknown[] }; created_by?: unknown[] };
      try { data = JSON.parse(row.raw_data); } catch { continue; }

      const pool: unknown[] =
        role === "cast" ? (data.credits?.cast ?? [])
          : role === "creator" ? (data.created_by ?? [])
            : (data.credits?.crew ?? []);

      for (const entry of pool) {
        const p = entry as { name?: string; profile_path?: string | null };
        if (!p?.profile_path) continue;
        if (personKey(p.name ?? "") !== key) continue;
        return `https://image.tmdb.org/t/p/w185${p.profile_path}`;
      }
    }
  }
  return null;
}

/** Test seam. The shared cache would otherwise carry between cases. */
export function _resetPopularPeopleForTests(): void {
  _cache.clear();
}
