// Library analysis — aggregates the user's rated library into per-facet stats
// (count / sum / avg) plus a flat per-item list, the user's rating baseline, and
// type/status breakdowns. Powers both the Insights page and the Taste Match
// preference model. Generalizes the old tag-only `analyzeLibraryTags`.

import { query, get } from "@/lib/db";
import { sharedCache } from "@/lib/boundedCache";
import { getDerivedForItem, peekDerivedBatch, derivedSignature, type Derived, type RawLink } from "@/lib/facetCache";
import { parseRatings, averageRating, representativeCommunity } from "@/lib/ratings";
import { facetId, type FacetKind, type FacetRole } from "@/lib/facets";
import { applyTagAliases, getTagAliases } from "@/lib/tagAlias";
import { applyIpFacets, getIpAliases, getItemIpOverrides } from "@/lib/ipAlias";
import { getScoringConfig, getTagCategoryOverrides, scoringConfigSignature } from "@/lib/scoringConfig";
import type { MediaLink, MediaType } from "@/types";

// One aggregated facet (tag / person / company) across the rated library.
export interface FacetStat {
  kind: FacetKind;
  role?: FacetRole;
  key: string;
  label: string;
  category?: string; // tags only
  count: number;     // # rated items carrying this facet — plain, for display ("N rated")
  sum: number;       // Σ of those items' personal ratings — plain, for `avg`
  avg: number;       // sum / count — the plain "well received" score (0-10)
  // Q22 (2026-07-19) — the SAME Bayesian shrinkage average computeFandexScore's
  // BA_f uses (shrunk toward your overall baseline by scoring_config's
  // priorStrength), so Insights' tag panels rank the same way the score does
  // instead of by a raw mean a single 10/10 can dominate.
  ba: number;
  // Q30 (2026-07-19) — prominence-weighted accumulators (cast billing order;
  // 1:1 with count/sum for every non-cast facet, since prominence defaults to
  // 1). `ba` is computed from THESE, not the plain count/sum, so a person's
  // Bayesian average reflects how prominently they actually featured across
  // your rated library — a lead role counts closer to a full data point, a
  // cameo closer to CAST_PROMINENCE_FLOOR. `count`/`sum`/`avg` stay plain and
  // unweighted so Insights' "N rated" / raw average keep reading as real counts.
  weightedCount: number;
  weightedSum: number;
  // T10 (2026-07-29) — NOT set by getLibraryFacetAnalysis itself (it has no
  // classWeight/config); insights.ts attaches it after the fact via
  // discovery.ts's facetImpact(), so the field lives here for FacetStat's one
  // shape to stay consistent end to end.
  impact?: number | null;
}

// A rated library item, flattened for the overview / histogram / divergence /
// by-era stats. `community` is the normalized 0-100 representative crowd score.
export interface RatedItem {
  id: string;
  type: MediaType;
  title: string;
  posterUrl: string | null;
  releaseDate: string | null;
  rating: number;
  community: number | null;
  sources: { source: string; sourceId: string }[]; // for buildItemHref on the few items sent to the client
}

// Your best-rated library item carrying a given facet. Home's "your
// highest-rated <tag> item" highlight (2026-07-30) needs per-facet-per-item data,
// which `facets` (aggregated) and `items` (facet-less) each half-answer.
// Accumulated inside the SAME per-item facet loop that builds `facets`, so it
// costs no extra query and no extra JSON.parse of raw_data.
export interface TopFacetItem {
  id: string;
  title: string;
  posterUrl: string | null;
  rating: number;
  type: MediaType;
}

export interface LibraryFacetAnalysis {
  facets: FacetStat[];         // sorted by avg desc, then count desc
  items: RatedItem[];          // rated items only
  baseline: number;            // mean personal rating across rated items
  ratedItemCount: number;
  libraryItemCount: number;    // all library rows (rated or not)
  libraryIds: string[];        // all library item ids — for membership filters
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  ratingValues: number[];      // every personal rating (for histogram/median)
  topItemByFacet: Map<string, TopFacetItem>; // facetId → your best-rated item with it
}

interface ItemRow {
  id: string;
  type: MediaType;
  title: string;
  release_date: string | null;
  poster_url: string | null;
  rating: number | null;
  metadata: string | null;
  status: string | null;
  source: string | null;
  source_id: string | null;
  link_release_date: string | null;
  last_synced: number | null;
  /** OCTET_LENGTH(raw_data), not the blob: half of facetCache's freshness token, and
   *  the half that catches a same-second rewrite. */
  raw_len: number | null;
}

// Personal 0-10 score: average across platforms, falling back to the canonical
// column. null when unrated.
function personalRating(rating: number | null, metadata: string | null): number | null {
  return averageRating(parseRatings(metadata)) ?? rating;
}

// SQLite caps host parameters per statement. Same chunk size discovery.ts's
// buildEntries uses, and for the same reason: stay well under any build's limit
// rather than assuming the modern 32k default.
const MISS_CHUNK = 400;

interface RawDataRow {
  media_item_id: string; source: string; source_id: string;
  release_date: string | null; raw_data: string | null; last_synced: number | null;
}

export function analyzeLibraryFacets(userId: string): LibraryFacetAnalysis {
  // TWO PASSES, not one — the same shape discovery.ts's buildEntries took in §A
  // (2026-08-02) and for the same measured reason. Pass 1 reads metadata plus a
  // freshness token (`last_synced`, `OCTET_LENGTH(raw_data)`); it does NOT read the
  // blobs. `raw_data` was never PARSED here (getDerivedForItem only JSON.parses
  // on a cache miss) but it was still being READ: a media_links row carries
  // ~7 KB, so a 1,942-item library was pulling tens of MB of pages off disk to
  // reach a cache that then ignored them. Measured 2026-08-28: **350 ms per
  // call**, on the first request after every rating, which is the single most
  // common write on the site.
  const rows = query<ItemRow>(
    `SELECT mi.id, mi.type, mi.title, mi.slug, mi.release_date, mi.poster_url,
            ul.rating, ul.metadata, ul.status,
            ml.source, ml.source_id, ml.release_date as link_release_date,
            ml.last_synced, OCTET_LENGTH(ml.raw_data) as raw_len
     FROM user_library ul
     JOIN media_items mi ON mi.id = ul.media_item_id
     LEFT JOIN media_links ml ON ml.media_item_id = mi.id
     WHERE ul.user_id = ?`,
    [userId]
  );

  // Collapse (item ⋈ links) into one entry per media item. `rawData` is null on
  // every link here — it is filled in below for cache misses only.
  const groups = new Map<string, { item: ItemRow; rawLinks: RawLink[]; maxSynced: number; rawLen: number }>();
  for (const r of rows) {
    let g = groups.get(r.id);
    if (!g) { g = { item: r, rawLinks: [], maxSynced: 0, rawLen: 0 }; groups.set(r.id, g); }
    if (r.source) {
      g.rawLinks.push({
        source: r.source as MediaLink["source"], sourceId: r.source_id!,
        releaseDate: r.link_release_date, rawData: null, lastSynced: r.last_synced ?? 0,
      });
      g.maxSynced = Math.max(g.maxSynced, r.last_synced ?? 0);
      g.rawLen += r.raw_len ?? 0;
    }
  }

  // Only RATED items are derived at all. An unrated row contributes its id to
  // `libraryIds` and nothing else (the loop below `continue`s on it), so
  // fetching or deriving its facets was always pure waste.
  //
  // The signature is constant across the whole pass but costs ~0.06 ms a call,
  // so it is hoisted for the same reason buildEntries hoists it.
  const sig = derivedSignature();
  const rated: { id: string; maxLastSynced: number; rawLen: number }[] = [];
  for (const [id, g] of groups) {
    if (personalRating(g.item.rating, g.item.metadata) == null) continue;
    rated.push({ id, maxLastSynced: g.maxSynced, rawLen: g.rawLen });
  }
  // One batched read across memory and the projection table, same as
  // buildEntries — see peekDerivedBatch.
  const derivedById = peekDerivedBatch(rated, undefined, sig);
  const missIds: string[] = [];
  for (const r of rated) if (!derivedById.has(r.id)) missIds.push(r.id);

  // Pass 2: raw_data for the misses alone. Same bulk-vs-chunked choice as
  // buildEntries — a chunked `IN (?,?,…)` wins for a handful of misses and
  // loses badly when nearly everything misses (a cold cache).
  if (missIds.length) {
    const rawByItem = new Map<string, RawDataRow[]>();
    const bulk = missIds.length > groups.size / 2;
    const rd = bulk
      ? query<RawDataRow>(
          `SELECT ml.media_item_id, ml.source, ml.source_id, ml.release_date, ml.raw_data, ml.last_synced
           FROM media_links ml
           JOIN user_library ul ON ul.media_item_id = ml.media_item_id
           WHERE ul.user_id = ?`,
          [userId]
        )
      : [];
    for (const r of rd) {
      const list = rawByItem.get(r.media_item_id);
      if (list) list.push(r); else rawByItem.set(r.media_item_id, [r]);
    }
    for (let i = 0; !bulk && i < missIds.length; i += MISS_CHUNK) {
      const chunk = missIds.slice(i, i + MISS_CHUNK);
      const part = query<RawDataRow>(
        `SELECT media_item_id, source, source_id, release_date, raw_data, last_synced
         FROM media_links WHERE media_item_id IN (${chunk.map(() => "?").join(",")})`,
        chunk
      );
      for (const r of part) {
        const list = rawByItem.get(r.media_item_id);
        if (list) list.push(r); else rawByItem.set(r.media_item_id, [r]);
      }
    }
    for (const id of missIds) {
      const g = groups.get(id)!;
      const rawLinks: RawLink[] = (rawByItem.get(id) ?? []).map((r) => ({
        source: r.source as MediaLink["source"], sourceId: r.source_id,
        releaseDate: r.release_date, rawData: r.raw_data, lastSynced: r.last_synced ?? 0,
      }));
      // getDerivedForItem populates the shared cache as a side effect.
      derivedById.set(id, getDerivedForItem(id, rawLinks, g.item.type, undefined, sig));
    }
  }

  const statMap = new Map<string, FacetStat>();
  const topItemByFacet = new Map<string, TopFacetItem>();
  const items: RatedItem[] = [];
  const libraryIds: string[] = [];
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const ratingValues: number[] = [];
  let ratingSum = 0;

  // H5.6: fetch the tag-bundle map once, then canonicalize each item's tag
  // facets — so all bundled spellings accumulate into one FacetStat (one merged
  // count/sum → one Bayesian average across the whole bundle).
  const aliases = getTagAliases();
  // 2026-08-14: the franchise layer resolves here for the same reason — this is
  // where a facet's Bayesian average is LEARNED, so an attached franchise
  // (item_ip_override) has to be present or the item never counts toward it,
  // and a bundled one has to be canonical or the two spellings keep two
  // separate averages. Fetched once for the loop, like `aliases`.
  const ipAliases = getIpAliases();
  const ipOverrides = getItemIpOverrides();
  // Q31 (2026-07-19): an admin-reassigned tag (tag_category_override) must win
  // over categorizeTag()'s code heuristic HERE too — buildProfile() already
  // resolves it this way for scoring, but Insights was still showing every
  // reassigned tag under its ORIGINAL category, and a brand-new category
  // (added via /dev/scoring's Taxonomy editor) never got any tags at all
  // since nothing routed them there.
  const tagOverrides = getTagCategoryOverrides();

  for (const { item, rawLinks } of groups.values()) {
    libraryIds.push(item.id);
    const rating = personalRating(item.rating, item.metadata);
    if (rating == null) continue; // unrated → no weight

    ratingSum += rating;
    ratingValues.push(rating);
    byType[item.type] = (byType[item.type] ?? 0) + 1;
    if (item.status) byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;

    // This has always used the DEFAULT region (no region arg was ever passed
    // to mergeLinks here) — Insights/taste stats aren't region-specific, so the
    // two passes above resolve it the same way, preserving that exactly.
    const { facets: rawFacets, merged } = derivedById.get(item.id)!;
    items.push({
      id: item.id,
      type: item.type,
      title: item.title ?? merged.title,
      posterUrl: item.poster_url ?? merged.posterUrl,
      releaseDate: item.release_date ?? merged.releaseDate,
      rating,
      community: representativeCommunity(merged.communityRatings),
      sources: rawLinks.map((l) => ({ source: l.source, sourceId: l.sourceId })),
    });

    for (const f of applyIpFacets(applyTagAliases(rawFacets, aliases), item.id, { aliases: ipAliases, overrides: ipOverrides })) {
      const id = `${f.kind}|${f.role ?? ""}|${f.key}`;
      const category = f.kind === "tag" ? (tagOverrides.get(f.key) ?? f.category) : f.category;
      const prom = f.prominence ?? 1; // Q30: 1 for everything except cast

      // Best-rated item per facet. Ties break on the FIRST seen so the result is
      // stable across rebuilds (the query has no ORDER BY, but the grouping map
      // preserves insertion order, so equal ratings keep a consistent winner).
      const best = topItemByFacet.get(id);
      if (!best || rating > best.rating) {
        topItemByFacet.set(id, {
          id: item.id,
          title: item.title ?? merged.title ?? "",
          posterUrl: item.poster_url ?? merged.posterUrl ?? null,
          rating,
          type: item.type,
        });
      }
      const st = statMap.get(id);
      if (st) {
        st.count++;
        st.sum += rating;
        st.weightedCount += prom;
        st.weightedSum += rating * prom;
      } else {
        statMap.set(id, {
          kind: f.kind, role: f.role, key: f.key, label: f.label,
          category, count: 1, sum: rating, avg: 0, ba: 0,
          weightedCount: prom, weightedSum: rating * prom,
        });
      }
    }
  }

  const ratedItemCount = ratingValues.length;
  const baseline = ratedItemCount ? ratingSum / ratedItemCount : 0;
  const C = getScoringConfig().priorStrength;

  const facets = [...statMap.values()].map((s) => ({
    ...s,
    avg: Math.round((s.sum / s.count) * 10) / 10,
    // Q30: from the prominence-weighted accumulators, not the plain ones —
    // identical to the old formula for every non-cast facet (weightedCount ==
    // count, weightedSum == sum there).
    ba: Math.round(((C * baseline + s.weightedSum) / (C + s.weightedCount)) * 10) / 10,
  }));
  facets.sort((a, b) => b.ba - a.ba || b.count - a.count);

  return {
    facets, items, baseline, ratedItemCount,
    libraryItemCount: libraryIds.length, libraryIds, byType, byStatus, ratingValues,
    topItemByFacet,
  };
}

// ── Cache (the analysis is identical until the library changes) ────

// Per-user; sig-invalidated on read. Size-capped so it can't grow unbounded
// across many users on the single long-lived process (P2).
const _cache = sharedCache<string, { sig: string; data: LibraryFacetAnalysis }>("libraryAnalysis.facets", { max: 500 });

export function librarySignature(userId: string): string {
  // D6: COUNT/MAX(reviewed_at)/SUM(rating) alone miss two offsetting edits
  // (7→8 and 8→7 leave all three unchanged). A rowid-weighted rating sum is
  // order-sensitive, so swapping two items' ratings changes the signature.
  //
  // Signed off user_item_state, not user_library. Two reasons, in order of
  // importance: user_library is a VIEW as of migration 16 and a view HAS no
  // rowid (this query threw `no such column: rowid` the moment it became one),
  // and user_item_state is the truth table anyway — one row per
  // (item, source), so this is strictly MORE sensitive than the per-item
  // aggregate it replaces. discovery.ts's poolSignature already signs the same
  // table the same way. The signature is only ever a cache key, so the one-off
  // change in its value just recomputes each profile once.
  const r = get<{ n: number; mx: number; sm: number; wsm: number }>(
    `SELECT COUNT(*) n, COALESCE(MAX(reviewed_at),0) mx, COALESCE(SUM(rating),0) sm,
            COALESCE(SUM(rating * rowid),0) wsm
     FROM user_item_state WHERE user_id = ? AND relation = 'library'`,
    [userId]
  );
  // D9: the facets come from the underlying media_links' raw_data, but an
  // enrich/backfill rewrites raw_data + bumps last_synced WITHOUT touching
  // user_library — so a user_library-only signature would serve stale (pre-enrich)
  // facets. Fold in the linked rows' count + MAX(last_synced) so any re-sync of a
  // library item's links invalidates the cache.
  //
  // ⚠️ 2026-08-27 — off `user_item_state`, NOT `user_library`, and measured:
  // `user_library` is a VIEW built from CTEs with json_group_array and two
  // GROUP BYs, so asking it for a COUNT and a MAX materialised the whole thing
  // **every call, 69 ms**. This signature is computed several times per
  // request (buildProfile, getLibraryFacetAnalysis and discovery's score cache
  // each key on it), which made it most of a warm Discover request.
  //
  // Against the base table plus the covering index `idx_links_item_synced`
  // (db.ts) the same question answers in **1 ms**. The count differs — the view
  // is one row per item, the table one per (item, source) — and that is fine
  // twice over: a signature only has to CHANGE when the data changes, and the
  // per-source count is strictly more sensitive, which is the same argument the
  // note above makes for `r`. The value shifting once just recomputes each
  // profile once.
  const l = get<{ lc: number; lmx: number }>(
    `SELECT COUNT(*) lc, COALESCE(MAX(ml.last_synced),0) lmx
       FROM user_item_state s JOIN media_links ml ON ml.media_item_id = s.media_item_id
      WHERE s.user_id = ? AND s.relation = 'library'`,
    [userId]
  );
  return `${r?.n ?? 0}:${r?.mx ?? 0}:${r?.sm ?? 0}:${r?.wsm ?? 0}:${l?.lc ?? 0}:${l?.lmx ?? 0}`;
}

// SM11 (2026-07-27) — Home/Profile's "top genre" stat. Pulled out as a pure
// function (rather than inlined in the route) so the "genre" narrowing is
// unit-testable: `kind === "tag"` alone spans the whole tag taxonomy
// (platform/theme/artstyle/meta…), so without the category check a
// platform tag like "steam" can win the slot.
export function pickBestGenre(facets: FacetStat[], minCount: number): { label: string; ba: number } | null {
  return pickBestTag(facets, "genre", minCount);
}

// The same narrowing for ANY tag category — Home's rotating highlights ask for
// "your top setting", "your top mood", and so on (2026-07-30). Generalising
// pickBestGenre rather than adding a parallel filter keeps the category check
// (the thing SM11 was about) in one place.
export function pickBestTag(
  facets: FacetStat[], category: string, minCount: number
): { label: string; ba: number; key: string; count: number } | null {
  const best = facets
    .filter((f) => f.kind === "tag" && f.category === category && f.count >= minCount)
    .sort((x, y) => y.ba - x.ba)[0];
  return best ? { label: best.label, ba: Math.round(best.ba * 10) / 10, key: best.key, count: best.count } : null;
}

/** Highest Bayesian-average facet of one kind+role (e.g. your best director). */
export function pickBestByRole(
  facets: FacetStat[], kind: FacetKind, role: string, minCount: number
): FacetStat | null {
  return facets
    .filter((f) => f.kind === kind && f.role === role && f.count >= minCount)
    .sort((x, y) => y.ba - x.ba)[0] ?? null;
}

/** Most-seen facet of one kind+role (volume, not quality). */
export function pickMostSeenByRole(
  facets: FacetStat[], kind: FacetKind, role: string, minCount: number
): FacetStat | null {
  return facets
    .filter((f) => f.kind === kind && f.role === role && f.count >= minCount)
    .sort((x, y) => y.count - x.count || y.ba - x.ba)[0] ?? null;
}

/** Most-seen tag within one category. */
export function pickMostSeenTag(
  facets: FacetStat[], category: string, minCount: number
): FacetStat | null {
  return facets
    .filter((f) => f.kind === "tag" && f.category === category && f.count >= minCount)
    .sort((x, y) => y.count - x.count || y.ba - x.ba)[0] ?? null;
}

export function getLibraryFacetAnalysis(userId: string): LibraryFacetAnalysis {
  // H5.6: fold the tag-alias signature into the cache key — a bundle edit
  // changes the aggregated facets but not the library itself, so librarySignature
  // alone would serve stale (pre-bundle) stats.
  // Q31: scoringConfigSignature() already folds tagAliasSignature() in (plus
  // the category/override signatures) — using it directly here means a
  // tag_category_override write (or a priorStrength change, which also feeds
  // `ba` above) busts this cache too, not just buildProfile's.
  const sig = `${librarySignature(userId)}|${scoringConfigSignature()}`;
  const cached = _cache.get(userId);
  if (cached && cached.sig === sig) return cached.data;
  const data = analyzeLibraryFacets(userId);
  _cache.set(userId, { sig, data });
  return data;
}

// ── Membership signal (for the personalized live discover feed) ────
// Unlike analyzeLibraryFacets (which only weighs RATED items), this counts every
// facet carried by the user's library + wishlist regardless of rating — so a
// stuffed wishlist with zero ratings still yields a taste signal (cold-start),
// and an unrated-but-owned genre still nudges recommendations. Also collects an
// original-language histogram (the most direct lever against an irrelevant
// foreign-language flood) without making language a hard filter.

export interface MembershipFacet {
  kind: FacetKind; role?: FacetRole; key: string; label: string; category?: string;
  libCount: number;  // # library items carrying this facet (rated or not)
  wishCount: number; // # wishlist items carrying this facet
}

export interface MembershipSignal {
  facets: Map<string, MembershipFacet>;  // keyed by facetId
  languages: Map<string, number>;        // original_language → weighted count (wishlist counts double)
  libCount: number;                      // total library items seen
  wishCount: number;                     // total wishlist items seen
}

interface MemberRow {
  id: string; type: MediaType;
  source: string | null; raw_data: string | null;
  link_release_date: string | null; source_id: string | null;
  last_synced: number | null;
}

// One (item ⋈ links) load for a membership table, grouped per media item.
// `raw_data` stays UNPARSED (2026-07-31 — same reasoning as analyzeLibraryFacets
// above): getDerivedForItem only parses it on a cache miss.
function loadMembershipGroups(userId: string, table: "user_library" | "user_watchlist") {
  const rows = query<MemberRow>(
    `SELECT mi.id, mi.type, ml.source, ml.source_id, ml.raw_data, ml.release_date as link_release_date,
            ml.last_synced
       FROM ${table} ut
       JOIN media_items mi ON mi.id = ut.media_item_id
       LEFT JOIN media_links ml ON ml.media_item_id = mi.id
      WHERE ut.user_id = ?`,
    [userId]
  );
  const groups = new Map<string, { type: MediaType; rawLinks: RawLink[] }>();
  for (const r of rows) {
    if (!groups.has(r.id)) groups.set(r.id, { type: r.type, rawLinks: [] });
    if (r.source) {
      groups.get(r.id)!.rawLinks.push({
        source: r.source as MediaLink["source"], sourceId: r.source_id!,
        releaseDate: r.link_release_date, rawData: r.raw_data, lastSynced: r.last_synced ?? 0,
      });
    }
  }
  return groups;
}

function membershipSignature(userId: string): string {
  const lib = get<{ n: number }>(`SELECT COUNT(*) n FROM user_library WHERE user_id = ?`, [userId]);
  const wl = get<{ n: number }>(`SELECT COUNT(*) n FROM user_watchlist WHERE user_id = ?`, [userId]);
  // Fold in the membership items' link freshness so an enrich/re-sync (which
  // rewrites raw_data without touching membership rows) invalidates the cache —
  // same rationale as librarySignature's D9 term.
  const l = get<{ lmx: number }>(
    `SELECT COALESCE(MAX(ml.last_synced),0) lmx FROM media_links ml
      WHERE ml.media_item_id IN (
        SELECT media_item_id FROM user_library  WHERE user_id = ?
        UNION
        SELECT media_item_id FROM user_watchlist WHERE user_id = ?
      )`,
    [userId, userId]
  );
  return `${lib?.n ?? 0}:${wl?.n ?? 0}:${l?.lmx ?? 0}`;
}

// Capped like its sibling `_cache` above (and discovery.ts's `_profileCache`)
// so many distinct users can't grow it without bound — this one was missed in
// the BoundedCache migration and leaked one entry per userId for the life of
// the process.
const _memberCache = sharedCache<string, { sig: string; data: MembershipSignal }>("libraryAnalysis.membership", { max: 500 });

export function getMembershipSignal(userId: string): MembershipSignal {
  const sig = membershipSignature(userId);
  const cached = _memberCache.get(userId);
  if (cached && cached.sig === sig) return cached.data;

  const facets = new Map<string, MembershipFacet>();
  const languages = new Map<string, number>();

  const tally = (
    groups: Map<string, { type: MediaType; rawLinks: RawLink[] }>,
    bucket: "libCount" | "wishCount",
    langWeight: number
  ): number => {
    let count = 0;
    for (const [id, { type, rawLinks }] of groups.entries()) {
      count++;
      // This never applied tag aliases or category overrides, and still
      // doesn't — extractFacets' RAW output, exactly as before this cache
      // existed (see facetCache.ts's header comment on why that's by design).
      const { facets: rawFacets, merged } = getDerivedForItem(id, rawLinks, type);
      for (const f of rawFacets) {
        const facetKey = facetId(f);
        const ex = facets.get(facetKey);
        if (ex) ex[bucket]++;
        else facets.set(facetKey, { kind: f.kind, role: f.role, key: f.key, label: f.label, category: f.category, libCount: 0, wishCount: 0, [bucket]: 1 } as MembershipFacet);
      }
      // Original language (movies/shows only). Was read straight off the TMDB
      // blob only; now reads `merged.originalLanguage` (mergeLinks' own
      // priority: tmdb, then trakt) since raw per-source blobs aren't exposed
      // by the cache. Strictly widens coverage — a trakt-only item (no tmdb
      // link) now contributes a language signal it never did before — never
      // narrows it, so nothing that worked before can break.
      const lang = merged.originalLanguage;
      if (typeof lang === "string" && lang) languages.set(lang, (languages.get(lang) ?? 0) + langWeight);
    }
    return count;
  };

  const libCount = tally(loadMembershipGroups(userId, "user_library"), "libCount", 1);
  // Wishlist = forward-looking intent → its language preference counts double.
  const wishCount = tally(loadMembershipGroups(userId, "user_watchlist"), "wishCount", 2);

  const data: MembershipSignal = { facets, languages, libCount, wishCount };
  _memberCache.set(userId, { sig, data });
  return data;
}
