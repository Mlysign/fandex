// The franchise membership sweep: ask each provider what its franchises
// actually contain, and store the answer as thin rows.
//
// ⚠️ THIS IS A SWEEP, NOT A REQUEST-PATH FETCH, and that is the whole design.
// `docs/scalability.md` §4.2 is explicit that lowering provider calls on
// crawlable pages is worth more than every other lever combined, and the item
// page is the most-crawled surface we have. So the rail reads a table and makes
// zero provider calls; the calls happen here, admin-triggered, once.
//
// THE COST, measured 2026-08-23 before any of this was written:
//   · 249 distinct TMDB collections in the catalog, 172 IGDB franchises.
//   · ~421 provider calls to sweep all of them, ONCE.
//   · Against 158,257 TMDB calls in a month, that is **0.16% of one month's
//     budget** to make every franchise complete.
//   · Neither provider is RAWG, so the exhausted RAWG quota is not a constraint.
//
// Resumable and bounded per request, like the crosslink sweep beside it: a
// Railway request has a wall clock, and each item here is a real provider call.
//
// ⚠️ A SWEEP DRIVEN OFF "WHAT IS STILL MISSING" NEVER TERMINATES — that lesson
// is in memory from the crosslink work. A franchise whose provider genuinely
// returns nothing would stay "missing" forever and be re-asked every pass. So
// progress is tracked by `fetched_at` (we asked, and here is when), never by
// whether rows appeared.

import { query } from "@/lib/db";
import { ipKey } from "@/lib/facets";
import { getTmdbCollection, tmdbPosterUrl } from "@/lib/sources/tmdb";
import { getIgdbFranchiseGames, igdbConfigured, igdbImageUrl, igdbReleaseDate } from "@/lib/sources/igdb";
import { replaceFranchiseMembers, type FranchiseMemberInput } from "@/lib/franchiseMembers";
import { log, errorFields } from "@/lib/logger";

export type FranchiseSource = "tmdb" | "igdb";

export interface FranchiseTarget {
  source: FranchiseSource;
  /** The provider's own id for the collection / franchise. */
  providerId: string;
  /** The provider's name for it, as stored. */
  name: string;
  /** ipKey(name) — the RAW key, which is what franchise_members stores. */
  rawIpKey: string;
  /** When this (rawIpKey, source) pair was last swept; 0 = never. */
  fetchedAt: number;
  /** How many members we currently hold for it. */
  stored: number;
}

/**
 * Every franchise the catalog knows a provider id for, with how recently it was
 * swept.
 *
 * Pure reads. No network, no writes — safe to call any time, which is what
 * makes it usable as the survey half of the dev route.
 */
export function surveyFranchises(source?: FranchiseSource): FranchiseTarget[] {
  const out: FranchiseTarget[] = [];

  if (!source || source === "tmdb") {
    const rows = query<{ cid: string; name: string }>(
      `SELECT DISTINCT
              json_extract(raw_data, '$.belongs_to_collection.id')   AS cid,
              json_extract(raw_data, '$.belongs_to_collection.name') AS name
         FROM media_links
        WHERE source = 'tmdb'
          AND json_extract(raw_data, '$.belongs_to_collection.id') IS NOT NULL`
    );
    for (const r of rows) {
      if (!r.cid || !r.name) continue;
      out.push(makeTarget("tmdb", String(r.cid), r.name));
    }
  }

  if (!source || source === "igdb") {
    // IGDB's `franchises` is an ARRAY, so this needs json_each rather than a
    // path extract. One game can sit in several franchises, which is also why
    // franchiseForItem picks the largest rather than unioning them.
    const rows = query<{ fid: string; name: string }>(
      `SELECT DISTINCT
              json_extract(je.value, '$.id')   AS fid,
              json_extract(je.value, '$.name') AS name
         FROM media_links ml, json_each(json_extract(ml.raw_data, '$.franchises')) je
        WHERE ml.source = 'igdb'
          AND json_extract(ml.raw_data, '$.franchises') IS NOT NULL`
    );
    for (const r of rows) {
      if (!r.fid || !r.name) continue;
      out.push(makeTarget("igdb", String(r.fid), r.name));
    }
  }

  return out;
}

function makeTarget(source: FranchiseSource, providerId: string, name: string): FranchiseTarget {
  const rawIpKey = ipKey(name);
  const stat = query<{ n: number; fetched: number | null }>(
    `SELECT COUNT(*) AS n, MAX(fetched_at) AS fetched
       FROM franchise_members WHERE ip_key = ? AND source = ?`,
    [rawIpKey, source]
  )[0];
  return {
    source, providerId, name, rawIpKey,
    fetchedAt: stat?.fetched ?? 0,
    stored: stat?.n ?? 0,
  };
}

/** TMDB collection parts are films by definition; IGDB franchise members are games. */
function tmdbPartToMember(p: any): FranchiseMemberInput | null {
  if (!p?.id || !p?.title) return null;
  return {
    source: "tmdb", sourceId: String(p.id), type: "movie", title: String(p.title),
    releaseDate: p.release_date || null,
    posterUrl: tmdbPosterUrl(p.poster_path ?? null, "w342"),
    popularity: typeof p.popularity === "number" ? p.popularity : null,
  };
}

function igdbGameToMember(g: any): FranchiseMemberInput | null {
  if (!g?.id || !g?.name) return null;
  return {
    source: "igdb", sourceId: String(g.id), type: "game", title: String(g.name),
    releaseDate: igdbReleaseDate(g),
    posterUrl: igdbImageUrl(g.cover?.image_id, "t_cover_big"),
    // `total_rating_count` is IGDB's crowd-attention number, and it is what the
    // rail's cap selects on. Storing it here is what lets a 394-member franchise
    // be cut down to 40 by something meaningful rather than by date position.
    popularity: typeof g.total_rating_count === "number" ? g.total_rating_count : null,
  };
}

export interface SweepResult {
  processed: number;
  written: number;
  failed: number;
  remaining: number;
  /** Per-target detail, so a run that writes nothing can still say why. */
  detail: { source: string; name: string; members: number; error?: string }[];
}

/**
 * Sweep one bounded batch of franchises that have not been swept recently.
 *
 * `maxAgeSec` decides what counts as due. Franchise membership changes on the
 * order of months (a new film joins a collection), so a monthly refresh is
 * generous; the default is 30 days.
 */
export async function runFranchiseSweep(opts: {
  source?: FranchiseSource;
  maxItems?: number;
  maxAgeSec?: number;
  budgetMs?: number;
}): Promise<SweepResult> {
  const maxItems = opts.maxItems ?? 25;
  const maxAgeSec = opts.maxAgeSec ?? 30 * 24 * 60 * 60;
  const budgetMs = opts.budgetMs ?? 60_000;
  const startedAt = Date.now();
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSec;

  const all = surveyFranchises(opts.source);
  // Due = never swept, or swept longer ago than the refresh window. Ordered
  // oldest-first so repeated calls drain the backlog deterministically.
  const due = all.filter((t) => t.fetchedAt < cutoff).sort((a, b) => a.fetchedAt - b.fetchedAt);

  const detail: SweepResult["detail"] = [];
  let processed = 0, written = 0, failed = 0;

  for (const t of due) {
    if (processed >= maxItems) break;
    // Wall-clock guard: a Railway request has a limit, and each iteration is a
    // real provider call. The caller repeats until `remaining` is 0.
    if (Date.now() - startedAt > budgetMs) break;
    processed++;
    try {
      let members: FranchiseMemberInput[] = [];
      if (t.source === "tmdb") {
        const coll = await getTmdbCollection(Number(t.providerId));
        members = (coll?.parts ?? []).map(tmdbPartToMember).filter((m): m is FranchiseMemberInput => !!m);
      } else {
        if (!igdbConfigured()) throw new Error("IGDB not configured");
        const games = await getIgdbFranchiseGames(Number(t.providerId));
        members = games.map(igdbGameToMember).filter((m): m is FranchiseMemberInput => !!m);
      }
      const n = replaceFranchiseMembers(t.rawIpKey, t.source, members);
      written += n;
      detail.push({ source: t.source, name: t.name, members: n });
    } catch (e) {
      // One dead franchise must not end the batch. It stays due and is retried
      // on the next pass, and the reason is reported rather than swallowed —
      // a sweep that writes nothing and says nothing is indistinguishable from
      // a sweep that had nothing to do.
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      detail.push({ source: t.source, name: t.name, members: 0, error: msg });
      log.warn("franchise_sweep_target_failed", { source: t.source, name: t.name, ...errorFields(e) });
    }
  }

  return { processed, written, failed, remaining: Math.max(0, due.length - processed), detail };
}
