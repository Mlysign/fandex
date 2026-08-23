// What a franchise ACTUALLY contains, per provider, whether or not we hold the
// title. Read by the item page's "More from …" rail; written by the sweep in
// /api/dev/franchise-sweep.
//
// THE PROBLEM THIS SOLVES (measured 2026-08-23). `facets.ts` reads TMDB's
// `belongs_to_collection.name` and IGDB's `franchises[].name` as LABELS, and
// nothing anywhere asked what those franchises contain. So `franchiseForItem`
// could only list catalog rows, and the catalog is thin exactly where franchises
// are concerned: **167 of 249 distinct TMDB collections held exactly one title**,
// so two thirds of films carrying a franchise showed no rail at all. Star Wars
// showed 9 of TMDB's 12; Terminator 5 of 6.
//
// WHY A TABLE OF THIN ROWS RATHER THAN CATALOG ROWS — the numbers that decided
// it, since "just ingest them" is the obvious answer and it is wrong here:
//   · TMDB collections average **4.8** members. IGDB franchises average **78**,
//     largest **394**. Ingesting every member takes the catalog from 2,569 to
//     ~16,500 items.
//   · `discovery.ts` holds a DiscoveryVector per catalog item in memory, so that
//     is a 6.4x resident pool, and Railway bills RAM at ~$10/GB-month against a
//     $5 Hobby credit. Volume storage is $0.155/GB-month and was never the
//     constraint. The expensive axis is memory, not disk.
//   · It would also be a 6.4x crawl surface (~16,000 sitemap URLs), and cold
//     item pages cost provider calls, which is already the binding constraint.
//   · And it would not survive: a pre-ingested member is `browsed = 1`, and the
//     boot prune deletes browsed-only rows on every deploy.
// These rows are ~200 bytes. The whole membership set is a few MB.
//
// ⚠️ `ip_key` IS THE RAW `ipKey()`, NOT the canonical one. Aliases and bundles
// are runtime-editable (ipAlias.ts), so a canonical key persisted here goes
// stale the moment somebody edits a bundle — and silently, because the row is
// still perfectly valid, it just answers to a name nothing asks for any more.
// Aliases are resolved at READ time instead, which is what facets already do.

import { query, run, transaction } from "@/lib/db";
import { getIpAliases, canonicalIpKey } from "@/lib/ipAlias";
import { log } from "@/lib/logger";

export interface FranchiseMemberRow {
  ipKey: string;
  source: string;
  sourceId: string;
  type: string;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  popularity: number | null;
  fetchedAt: number;
}

export interface FranchiseMemberInput {
  source: string;
  sourceId: string;
  type: string;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  popularity: number | null;
}

/**
 * Replace one (rawIpKey, source) membership set.
 *
 * ⚠️ REPLACE, and scoped to ONE source. A franchise can be described by TMDB
 * (films) and IGDB (games) at once, and the rail is cross-media by design, so a
 * blanket `DELETE WHERE ip_key = ?` while re-sweeping TMDB would wipe the games
 * half and leave the rail quietly poorer until the next IGDB pass.
 *
 * ⚠️ AN EMPTY `members` IS TREATED AS "NOTHING TO SAY", NOT "AUTHORITATIVELY
 * EMPTY", and it deletes nothing. Same corollary as the prune invariant in
 * AGENTS.md: the fetchers throw rather than return [] on failure, but a caller
 * that catches and passes [] onward must not be able to erase a good membership
 * set. A franchise that genuinely lost every member is not a case worth
 * supporting at the cost of that.
 */
export function replaceFranchiseMembers(
  rawIpKey: string,
  source: string,
  members: FranchiseMemberInput[]
): number {
  if (!rawIpKey || !members.length) return 0;
  const now = Math.floor(Date.now() / 1000);
  return transaction(() => {
    run("DELETE FROM franchise_members WHERE ip_key = ? AND source = ?", [rawIpKey, source]);
    let n = 0;
    for (const m of members) {
      if (!m.sourceId || !m.title) continue;
      run(
        `INSERT OR REPLACE INTO franchise_members
           (ip_key, source, source_id, type, title, release_date, poster_url, popularity, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [rawIpKey, source, String(m.sourceId), m.type, m.title,
         m.releaseDate, m.posterUrl, m.popularity, now]
      );
      n++;
    }
    return n;
  });
}

/**
 * Every raw key that resolves to `canonical` — the canonical key itself, plus
 * any alias pointing at it.
 *
 * This is the read-time half of storing raw keys. `getIpAliases()` is
 * alias -> canonical and is cached + signature-invalidated, so this is an
 * in-memory pass over a handful of rows, not a query.
 */
function rawKeysFor(canonical: string): string[] {
  const keys = new Set<string>([canonical]);
  for (const [alias, target] of getIpAliases()) {
    if (canonicalIpKey(target) === canonical) keys.add(alias);
  }
  return [...keys];
}

/**
 * Stored membership for one canonical franchise key.
 *
 * Returns [] both when the franchise was never swept and when it holds nothing,
 * which is deliberate at THIS layer: the caller (the rail) merges these with
 * catalog rows and cannot act on the difference anyway. `franchiseSweepStats()`
 * below is what distinguishes the two for a human, and it exists because
 * AGENTS.md is explicit that a surface which renders nothing must be able to
 * say WHY it is empty.
 */
export function getFranchiseMembers(canonicalKey: string): FranchiseMemberRow[] {
  if (!canonicalKey) return [];
  const keys = rawKeysFor(canonicalKey);
  const placeholders = keys.map(() => "?").join(",");
  const rows = query<{
    ip_key: string; source: string; source_id: string; type: string; title: string;
    release_date: string | null; poster_url: string | null; popularity: number | null; fetched_at: number;
  }>(
    `SELECT ip_key, source, source_id, type, title, release_date, poster_url, popularity, fetched_at
       FROM franchise_members WHERE ip_key IN (${placeholders})`,
    keys
  );
  return rows.map((r) => ({
    ipKey: r.ip_key, source: r.source, sourceId: r.source_id, type: r.type,
    title: r.title, releaseDate: r.release_date, posterUrl: r.poster_url,
    popularity: r.popularity, fetchedAt: r.fetched_at,
  }));
}

/**
 * How much of the catalog's franchise vocabulary has actually been swept.
 *
 * Computed independently of the read path on purpose. AGENTS.md: a component
 * that renders nothing must know WHY before it ships, and "the rail is short"
 * has four unrelated causes — never swept, swept and genuinely small, the sweep
 * failed, or an alias edit orphaned the rows. This is the only thing that can
 * separate them, and the person hitting it is usually on a phone with no
 * console.
 */
export function franchiseSweepStats(): {
  franchises: number; members: number; oldestFetchedAt: number | null; newestFetchedAt: number | null;
} {
  const row = query<{ f: number; m: number; oldest: number | null; newest: number | null }>(
    `SELECT COUNT(DISTINCT ip_key) AS f, COUNT(*) AS m,
            MIN(fetched_at) AS oldest, MAX(fetched_at) AS newest
       FROM franchise_members`
  )[0];
  return {
    franchises: row?.f ?? 0,
    members: row?.m ?? 0,
    oldestFetchedAt: row?.oldest ?? null,
    newestFetchedAt: row?.newest ?? null,
  };
}

/** Drop rows older than `maxAgeSec`, in a bounded batch. See the note in
 *  facetCacheStore.ts about why a DELETE on a request-path table is bounded —
 *  this one is sweep-driven, so it is bounded for consistency rather than
 *  necessity. */
export function pruneStaleFranchiseMembers(maxAgeSec: number, limit = 2000): number {
  try {
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeSec;
    const res = run(
      `DELETE FROM franchise_members WHERE rowid IN (
         SELECT rowid FROM franchise_members WHERE fetched_at < ? LIMIT ?
       )`,
      [cutoff, limit]
    );
    return (res as { changes?: number } | undefined)?.changes ?? 0;
  } catch (e) {
    log.warn("franchise_members_prune_failed", { error: e instanceof Error ? e.message : String(e) });
    return 0;
  }
}
