// Federated candidate ingestion: turn the user's strongest tags into live
// queries against TMDB (movies/shows) and RAWG (games), then persist the matches
// into the local DB so the recommender has a real pool to rank — not just the
// watchlist. Persisted items carry full metadata (keywords/tags), so subsequent
// recommendation passes score them precisely and instantly (the hybrid approach).

import { query } from "@/lib/db";
import { categorizeTag } from "@/lib/tags";
import { persistItemFromIds } from "@/lib/persistItem";
import {
  CandidateRef,
  tmdbGenreId,
  rawgGenreSlug,
  rawgTagSlug,
  resolveTmdbKeywordId,
  discoverTmdbByGenres,
  discoverTmdbByKeyword,
  discoverRawgByGenres,
  discoverRawgByTag,
} from "@/lib/sources/tagDiscover";

const MAX_KEYWORD_TAGS = 5;   // strongest non-genre tags to target individually
const MAX_INGEST = 50;        // cap new items persisted per run (bounds latency)
const PERSIST_CONCURRENCY = 5;

export interface IngestResult {
  fetched: number;  // fresh (not-yet-in-DB) candidates found
  ingested: number; // actually persisted
}

// Given the user's strongest preference tags (already ranked, from the Taste
// Match profile), pull matching titles from TMDB/RAWG into the local catalog.
export async function ingestCandidatesForTags(tagKeys: string[]): Promise<IngestResult> {
  if (!tagKeys.length) return { fetched: 0, ingested: 0 };

  // Split the strongest tags into genres (provider genre filters) and everything
  // else (provider keyword/tag filters), preserving the given priority order.
  const genreKeys = tagKeys.filter((k) => categorizeTag(k) === "genre");
  const otherKeys = tagKeys.filter((k) => categorizeTag(k) !== "genre").slice(0, MAX_KEYWORD_TAGS);

  // ── Gather candidate refs from the providers in parallel ──
  const jobs: Promise<CandidateRef[]>[] = [];

  const movieGenreIds = [...new Set(genreKeys.map((k) => tmdbGenreId(k, "movie")).filter((x): x is number => x != null))];
  const tvGenreIds = [...new Set(genreKeys.map((k) => tmdbGenreId(k, "show")).filter((x): x is number => x != null))];
  if (movieGenreIds.length) jobs.push(discoverTmdbByGenres(movieGenreIds, "movie"));
  if (tvGenreIds.length) jobs.push(discoverTmdbByGenres(tvGenreIds, "show"));

  const rawgSlugs = [...new Set(genreKeys.map(rawgGenreSlug).filter((x): x is string => !!x))];
  if (rawgSlugs.length) jobs.push(discoverRawgByGenres(rawgSlugs));

  for (const key of otherKeys) {
    jobs.push(
      (async () => {
        const id = await resolveTmdbKeywordId(key);
        if (!id) return [];
        const [mv, tv] = await Promise.all([discoverTmdbByKeyword(id, "movie"), discoverTmdbByKeyword(id, "show")]);
        return [...mv, ...tv];
      })()
    );
    jobs.push(discoverRawgByTag(rawgTagSlug(key)));
  }

  const refs = (await Promise.all(jobs)).flat();

  // Dedupe by source:id.
  const seen = new Set<string>();
  const unique: CandidateRef[] = [];
  for (const r of refs) {
    const k = `${r.source}:${r.sourceId}`;
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(r);
    }
  }

  // Drop anything already in the DB (this also excludes library/watchlist items,
  // since those already have media_links).
  const existing = existingLinkSet(unique);
  const fresh = unique.filter((r) => !existing.has(`${r.source}:${r.sourceId}`));
  const toIngest = fresh.slice(0, MAX_INGEST);

  let ingested = 0;
  for (let i = 0; i < toIngest.length; i += PERSIST_CONCURRENCY) {
    const batch = toIngest.slice(i, i + PERSIST_CONCURRENCY);
    const results = await Promise.all(
      batch.map((r) => persistItemFromIds({ type: r.type, ids: { [r.source]: r.sourceId } }).catch(() => null))
    );
    ingested += results.filter(Boolean).length;
  }

  return { fetched: fresh.length, ingested };
}

// Which of these candidate refs already have a media_links row? Matched on the
// exact source+source_id pair (tmdb 123 ≠ rawg 123).
function existingLinkSet(refs: CandidateRef[]): Set<string> {
  const set = new Set<string>();
  const ids = [...new Set(refs.map((r) => r.sourceId))];
  const CH = 400;
  for (let i = 0; i < ids.length; i += CH) {
    const chunk = ids.slice(i, i + CH);
    const ph = chunk.map(() => "?").join(",");
    const rows = query<{ source: string; source_id: string }>(
      `SELECT source, source_id FROM media_links WHERE source_id IN (${ph})`,
      chunk
    );
    for (const row of rows) set.add(`${row.source}:${row.source_id}`);
  }
  return set;
}
