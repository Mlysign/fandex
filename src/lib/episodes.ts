import { get, query, run, transaction } from "@/lib/db";
import { getTmdbShowSeasons, getTmdbSeasonEpisodes, tmdbPosterUrl } from "@/lib/sources/tmdb";
import { getTraktShowSeasons } from "@/lib/sources/trakt";
import { log, errorFields } from "@/lib/logger";
import { sharedCache } from "@/lib/boundedCache";
import { isProviderCircuitOpen } from "@/lib/http";
import { TMDB_HOST } from "@/lib/sources/tmdb";

// ── MB14 — per-episode watched tracking ──────────────────────────────────────
//
// Three tables (migration 15), two of them catalog and one personal:
//
//   show_seasons / show_episodes   shared TMDB metadata, filled LAZILY on a
//                                  detail view / season expand. P18's precedent:
//                                  heal one item at a time, never a full-catalog
//                                  op.
//   user_episode_state             one row per WATCHED episode. Absence is "not
//                                  watched" — there is no watched=0 row, so the
//                                  table stays proportional to what someone
//                                  actually watched, not to the catalog.
//
// `sources` on the personal table mirrors user_library.platform_sources: the
// JSON array of providers holding this state. It is the whole reason the Trakt
// pull can prune only what Trakt is responsible for and leave a purely local
// mark alone. See reconcileProviderEpisodes below.

/** How long a stored season list / episode list is trusted before a refetch. */
export const CATALOG_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Season 0 is TMDB's "Specials". Excluded — Trakt tracks it separately and it
 *  breaks the "n of total" progress the UI is built around. */
const SPECIALS_SEASON = 0;

const nowSec = () => Math.floor(Date.now() / 1000);

// Why a show's catalog is empty, kept for exactly as long as it is useful.
//
// Both `ensure*` helpers below DEGRADE on a provider failure — correct, since
// nothing on this path drives a prune — but degrading silently is how "TMDB is
// refusing us" and "this show genuinely has no seasons" became the same blank
// section on every show page. The message is surfaced to the item's own viewer
// through /api/episodes; it is our own error text, never a provider payload.
const _catalogError = sharedCache<string, string>("episodes.catalogError", { max: 500, ttlMs: 60 * 60 * 1000 });

function recordCatalogError(mediaItemId: string, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  _catalogError.set(mediaItemId, msg.slice(0, 200));
}

/** A successful fill clears the last failure — otherwise a show that recovered
 *  keeps reporting a stale error for the whole TTL, which is worse than saying
 *  nothing. (Caught by a test that expected exactly that.) */
function clearCatalogError(mediaItemId: string): void {
  _catalogError.delete(mediaItemId);
}

export interface EpisodeCatalogDiagnostic {
  /** Preferred catalog source (stills, overviews, per-season). */
  tmdbLinked: boolean;
  /** Fallback catalog source, and the only one for a Trakt-only show. */
  traktLinked: boolean;
  seasonsStored: number;
  episodesStored: number;
  /** http.ts's per-host breaker. Open → every fetch throws before leaving. */
  tmdbCircuitOpen: boolean;
  /** The last failure this show's catalog fetch hit, if any. */
  lastError: string | null;
}

/** What to say when a show's season list comes back empty. */
export function episodeCatalogDiagnostic(mediaItemId: string): EpisodeCatalogDiagnostic {
  return {
    tmdbLinked: !!tmdbIdFor(mediaItemId),
    traktLinked: !!sourceIdFor(mediaItemId, "trakt"),
    seasonsStored:
      get<{ n: number }>("SELECT COUNT(*) n FROM show_seasons WHERE media_item_id = ?", [mediaItemId])?.n ?? 0,
    episodesStored:
      get<{ n: number }>("SELECT COUNT(*) n FROM show_episodes WHERE media_item_id = ?", [mediaItemId])?.n ?? 0,
    tmdbCircuitOpen: isProviderCircuitOpen(TMDB_HOST),
    lastError: _catalogError.get(mediaItemId) ?? null,
  };
}

export interface SeasonRow {
  seasonNumber: number;
  name: string | null;
  episodeCount: number;
  airDate: string | null;
  posterUrl: string | null;
  overview: string | null;
}

export interface EpisodeRow {
  seasonNumber: number;
  episodeNumber: number;
  title: string | null;
  airDate: string | null;
  runtimeMinutes: number | null;
  overview: string | null;
  stillUrl: string | null;
}

/** One episode's identity. The unit every read/write path here speaks in. */
export interface EpisodeRef {
  season: number;
  episode: number;
}

/** An episode a provider reports as watched. `watchedAt` is unix seconds. */
export interface PulledEpisode extends EpisodeRef {
  watchedAt?: number | null;
}

// ── Catalog reads ────────────────────────────────────────────────────────────

export function loadSeasons(mediaItemId: string): SeasonRow[] {
  return query<any>(
    `SELECT season_number, name, episode_count, air_date, poster_url, overview
       FROM show_seasons WHERE media_item_id = ? ORDER BY season_number`,
    [mediaItemId],
  ).map((r) => ({
    seasonNumber: r.season_number,
    name: r.name,
    episodeCount: r.episode_count,
    airDate: r.air_date,
    posterUrl: r.poster_url,
    overview: r.overview,
  }));
}

export function loadEpisodes(mediaItemId: string, seasonNumber: number): EpisodeRow[] {
  return query<any>(
    `SELECT season_number, episode_number, title, air_date, runtime_minutes, overview, still_url
       FROM show_episodes WHERE media_item_id = ? AND season_number = ?
      ORDER BY episode_number`,
    [mediaItemId, seasonNumber],
  ).map((r) => ({
    seasonNumber: r.season_number,
    episodeNumber: r.episode_number,
    title: r.title,
    airDate: r.air_date,
    runtimeMinutes: r.runtime_minutes,
    overview: r.overview,
    stillUrl: r.still_url,
  }));
}

/** This item's id at one source, or null when it isn't linked there. */
export function sourceIdFor(mediaItemId: string, source: string): string | null {
  return (
    get<{ source_id: string }>(
      "SELECT source_id FROM media_links WHERE media_item_id = ? AND source = ?",
      [mediaItemId, source],
    )?.source_id ?? null
  );
}

/** The TMDB id linked to this item, or null when it has no TMDB link. */
export function tmdbIdFor(mediaItemId: string): string | null {
  return sourceIdFor(mediaItemId, "tmdb");
}

// ── Which provider supplies the episode CATALOG ──────────────────────────────
//
// Not the same question as who supplies your watch state — that is Trakt and
// only Trakt (`capabilities.episodes.read`). This is "what episodes exist",
// which is shared metadata, and BOTH can answer:
//
//   TMDB   preferred when linked: stills, overviews, per-season granularity.
//   Trakt  the fallback, and for a Trakt-only show the ONLY source. One call
//          returns every season with its episodes.
//
// The fallback is why a show Trakt knows everything about no longer renders a
// blank section just because nothing ever cross-linked it to TMDB.

/** Write a Trakt `/shows/:id/seasons?extended=full,episodes` payload to both tables. */
function storeTraktSeasons(mediaItemId: string, seasons: any[]): void {
  const usable = seasons.filter(
    (s) => Number.isInteger(s?.number) && s.number !== SPECIALS_SEASON,
  );
  if (!usable.length) {
    recordCatalogError(mediaItemId, `Trakt returned ${seasons.length} seasons, none usable`);
    return;
  }
  clearCatalogError(mediaItemId);
  const stamp = nowSec();
  transaction(() => {
    for (const s of usable) {
      const episodes = (s.episodes ?? []).filter((e: any) => Number.isInteger(e?.number));
      run(
        `INSERT INTO show_seasons
           (media_item_id, season_number, name, episode_count, air_date, poster_url, overview, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(media_item_id, season_number) DO UPDATE SET
           name = excluded.name, episode_count = excluded.episode_count,
           air_date = excluded.air_date, overview = excluded.overview,
           updated_at = excluded.updated_at`,
        [
          mediaItemId,
          s.number,
          s.title ?? `Season ${s.number}`,
          // Trakt's own `episode_count` counts specials on some shows; the
          // episodes we actually got is the number the UI can honour.
          episodes.length || (Number.isFinite(s.episode_count) ? s.episode_count : 0),
          isoDate(s.first_aired),
          s.overview || null,
          stamp,
        ],
      );
      for (const e of episodes) {
        run(
          `INSERT INTO show_episodes
             (media_item_id, season_number, episode_number, title, air_date, runtime_minutes, overview, still_url, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
           ON CONFLICT(media_item_id, season_number, episode_number) DO UPDATE SET
             title = excluded.title, air_date = excluded.air_date,
             runtime_minutes = excluded.runtime_minutes, overview = excluded.overview,
             updated_at = excluded.updated_at`,
          [
            mediaItemId,
            s.number,
            e.number,
            e.title ?? null,
            isoDate(e.first_aired),
            Number.isFinite(e.runtime) ? e.runtime : null,
            e.overview || null,
            stamp,
          ],
        );
      }
    }
  });
}

/** Trakt dates are ISO datetimes; the catalog stores plain `YYYY-MM-DD`. */
function isoDate(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/** Fill a show's whole catalog from Trakt. Degrades like the TMDB path. */
async function fillFromTrakt(mediaItemId: string, traktId: string): Promise<boolean> {
  try {
    storeTraktSeasons(mediaItemId, await getTraktShowSeasons(traktId));
    return true;
  } catch (e) {
    log.warn("episode_seasons_trakt_failed", { mediaItemId, traktId, ...errorFields(e) });
    recordCatalogError(mediaItemId, e);
    return false;
  }
}

// ── Catalog fill (lazy, one show at a time) ──────────────────────────────────

function seasonsAreFresh(mediaItemId: string): boolean {
  const row = get<{ n: number; oldest: number | null }>(
    "SELECT COUNT(*) n, MIN(updated_at) oldest FROM show_seasons WHERE media_item_id = ?",
    [mediaItemId],
  );
  if (!row || row.n === 0) return false;
  return (row.oldest ?? 0) > nowSec() - CATALOG_TTL_SECONDS;
}

/**
 * Fill/refresh `show_seasons` for one show from TMDB.
 *
 * Degrades rather than throws: a TMDB outage (or an open circuit) leaves the
 * caller with whatever is already stored instead of failing the request. That is
 * safe HERE and only here — nothing on this path drives a prune. The Trakt pull
 * in sync/index.ts is the opposite case and must keep throwing.
 */
export async function ensureShowSeasons(mediaItemId: string): Promise<SeasonRow[]> {
  if (seasonsAreFresh(mediaItemId)) return loadSeasons(mediaItemId);
  const tmdbId = tmdbIdFor(mediaItemId);
  if (!tmdbId) {
    // No TMDB link — Trakt is then the only source, and for a Trakt-only user
    // it is the RIGHT one. One call fills seasons and episodes together.
    const traktId = sourceIdFor(mediaItemId, "trakt");
    if (traktId) await fillFromTrakt(mediaItemId, traktId);
    return loadSeasons(mediaItemId);
  }

  let seasons: any[];
  try {
    seasons = await getTmdbShowSeasons(tmdbId);
  } catch (e) {
    log.warn("episode_seasons_fetch_failed", { mediaItemId, tmdbId, ...errorFields(e) });
    recordCatalogError(mediaItemId, e);
    return loadSeasons(mediaItemId);
  }

  const usable = seasons.filter(
    (s) => Number.isInteger(s?.season_number) && s.season_number !== SPECIALS_SEASON,
  );
  if (usable.length) clearCatalogError(mediaItemId);
  else recordCatalogError(mediaItemId, `TMDB returned ${seasons.length} seasons, none usable`);
  const stamp = nowSec();
  transaction(() => {
    for (const s of usable) {
      run(
        `INSERT INTO show_seasons
           (media_item_id, season_number, name, episode_count, air_date, poster_url, overview, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(media_item_id, season_number) DO UPDATE SET
           name = excluded.name, episode_count = excluded.episode_count,
           air_date = excluded.air_date, poster_url = excluded.poster_url,
           overview = excluded.overview, updated_at = excluded.updated_at`,
        [
          mediaItemId,
          s.season_number,
          s.name ?? null,
          Number.isFinite(s.episode_count) ? s.episode_count : 0,
          s.air_date || null,
          tmdbPosterUrl(s.poster_path ?? null, "w342"),
          s.overview || null,
          stamp,
        ],
      );
    }
  });
  return loadSeasons(mediaItemId);
}

function episodesAreFresh(mediaItemId: string, seasonNumber: number): boolean {
  const row = get<{ n: number; oldest: number | null }>(
    "SELECT COUNT(*) n, MIN(updated_at) oldest FROM show_episodes WHERE media_item_id = ? AND season_number = ?",
    [mediaItemId, seasonNumber],
  );
  if (!row || row.n === 0) return false;
  return (row.oldest ?? 0) > nowSec() - CATALOG_TTL_SECONDS;
}

/** Fill/refresh one season's episode list. Same degrade-don't-throw contract as
 *  ensureShowSeasons — one TMDB call per season, then never again for a week. */
export async function ensureSeasonEpisodes(
  mediaItemId: string,
  seasonNumber: number,
): Promise<EpisodeRow[]> {
  if (episodesAreFresh(mediaItemId, seasonNumber)) return loadEpisodes(mediaItemId, seasonNumber);
  const tmdbId = tmdbIdFor(mediaItemId);
  if (!tmdbId) {
    // Trakt's seasons call returns EVERY season's episodes at once, so this
    // fills the requested one as a side effect — no per-season endpoint needed.
    const traktId = sourceIdFor(mediaItemId, "trakt");
    if (traktId) await fillFromTrakt(mediaItemId, traktId);
    return loadEpisodes(mediaItemId, seasonNumber);
  }

  let episodes: any[];
  try {
    episodes = await getTmdbSeasonEpisodes(tmdbId, seasonNumber);
  } catch (e) {
    log.warn("episode_list_fetch_failed", { mediaItemId, tmdbId, seasonNumber, ...errorFields(e) });
    recordCatalogError(mediaItemId, e);
    return loadEpisodes(mediaItemId, seasonNumber);
  }

  const usable = episodes.filter((e) => Number.isInteger(e?.episode_number));
  if (usable.length) clearCatalogError(mediaItemId);
  const stamp = nowSec();
  transaction(() => {
    for (const e of usable) {
      run(
        `INSERT INTO show_episodes
           (media_item_id, season_number, episode_number, title, air_date, runtime_minutes, overview, still_url, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(media_item_id, season_number, episode_number) DO UPDATE SET
           title = excluded.title, air_date = excluded.air_date,
           runtime_minutes = excluded.runtime_minutes, overview = excluded.overview,
           still_url = excluded.still_url, updated_at = excluded.updated_at`,
        [
          mediaItemId,
          seasonNumber,
          e.episode_number,
          e.name ?? null,
          e.air_date || null,
          Number.isFinite(e.runtime) ? e.runtime : null,
          e.overview || null,
          tmdbPosterUrl(e.still_path ?? null, "w300"),
          stamp,
        ],
      );
    }
    // The season's own episode_count is TMDB's announced total, which drifts
    // from the real list for a currently-airing show. The list we just fetched
    // is the better number, so let it correct the header count.
    if (usable.length) {
      run(
        "UPDATE show_seasons SET episode_count = ? WHERE media_item_id = ? AND season_number = ? AND episode_count < ?",
        [usable.length, mediaItemId, seasonNumber, usable.length],
      );
    }
  });
  return loadEpisodes(mediaItemId, seasonNumber);
}

// ── Per-user state ───────────────────────────────────────────────────────────

export interface WatchedEpisode extends EpisodeRef {
  watchedAt: number | null;
  sources: string[];
}

export function loadWatched(
  userId: string,
  mediaItemId: string,
  seasonNumber?: number,
): WatchedEpisode[] {
  const sql =
    `SELECT season_number, episode_number, watched_at, sources
       FROM user_episode_state WHERE user_id = ? AND media_item_id = ?` +
    (seasonNumber == null ? "" : " AND season_number = ?") +
    " ORDER BY season_number, episode_number";
  const params: any[] = seasonNumber == null ? [userId, mediaItemId] : [userId, mediaItemId, seasonNumber];
  return query<any>(sql, params).map((r) => ({
    season: r.season_number,
    episode: r.episode_number,
    watchedAt: r.watched_at,
    sources: parseSources(r.sources),
  }));
}

/** Watched-episode count per season, for the collapsed `n/total` header. */
export function watchedCounts(userId: string, mediaItemId: string): Record<number, number> {
  const out: Record<number, number> = {};
  for (const r of query<{ season_number: number; n: number }>(
    `SELECT season_number, COUNT(*) n FROM user_episode_state
      WHERE user_id = ? AND media_item_id = ? GROUP BY season_number`,
    [userId, mediaItemId],
  )) {
    out[r.season_number] = r.n;
  }
  return out;
}

function parseSources(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Mark episodes watched. `sources` are the providers the mark was actually
 * pushed to — empty means it lives only here, so it is stored as ["local"].
 * This mirrors recordLibraryRating's contract exactly, and it is what keeps a
 * later provider prune honest: a row Trakt never accepted is never attributed
 * to Trakt, so Trakt's pull can't later "remove" it.
 *
 * Idempotent: re-marking an already-watched episode unions the sources and
 * keeps the earliest known watched_at rather than resetting it.
 */
export function markEpisodes(
  userId: string,
  mediaItemId: string,
  episodes: EpisodeRef[],
  opts: { sources?: string[]; watchedAt?: number | null } = {},
): number {
  if (!episodes.length) return 0;
  const sources = opts.sources?.length ? opts.sources : ["local"];
  const watchedAt = opts.watchedAt ?? nowSec();
  const stamp = nowSec();

  return transaction(() => {
    let n = 0;
    for (const ep of episodes) {
      const existing = get<{ sources: string; watched_at: number | null }>(
        `SELECT sources, watched_at FROM user_episode_state
          WHERE user_id = ? AND media_item_id = ? AND season_number = ? AND episode_number = ?`,
        [userId, mediaItemId, ep.season, ep.episode],
      );
      const merged = Array.from(new Set([...parseSources(existing?.sources ?? null), ...sources]));
      run(
        `INSERT INTO user_episode_state
           (user_id, media_item_id, season_number, episode_number, watched_at, sources, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, media_item_id, season_number, episode_number) DO UPDATE SET
           watched_at = COALESCE(user_episode_state.watched_at, excluded.watched_at),
           sources = excluded.sources,
           updated_at = excluded.updated_at`,
        [userId, mediaItemId, ep.season, ep.episode, watchedAt, JSON.stringify(merged), stamp],
      );
      if (!existing) n++;
    }
    return n;
  });
}

/** Un-mark episodes entirely (every source). The UI's un-tick. */
export function unmarkEpisodes(userId: string, mediaItemId: string, episodes: EpisodeRef[]): number {
  if (!episodes.length) return 0;
  return transaction(() => {
    let n = 0;
    for (const ep of episodes) {
      n += run(
        `DELETE FROM user_episode_state
          WHERE user_id = ? AND media_item_id = ? AND season_number = ? AND episode_number = ?`,
        [userId, mediaItemId, ep.season, ep.episode],
      ).changes;
    }
    return n;
  });
}

// ── Provider reconcile (the prune half) ──────────────────────────────────────

const key = (e: EpisodeRef) => `${e.season}:${e.episode}`;

/**
 * Reconcile ONE provider's episode state for one user, across every show.
 *
 * ⚠️ THE PRUNE INVARIANT APPLIES. This detaches `source` from every stored
 * episode absent from `byItem` — including whole shows that vanished from the
 * pull — so it is only ever correct after a pull that is KNOWN COMPLETE. Its one
 * caller (syncProvider) runs it inside the try block, after the pull loop, so a
 * throwing pull returns before it and an outage becomes a no-op rather than a
 * wiped watch history. A pull that legitimately found nothing may pass an empty
 * map; a pull that FAILED must never reach here → [[trakt-sync-completeness]].
 *
 * Detach, not delete: a row whose `sources` still lists another provider (or
 * "local") survives with `source` removed, exactly as removeLibrarySource
 * treats the library cache. Only the last source removed deletes the row.
 */
export function reconcileProviderEpisodes(
  userId: string,
  source: string,
  byItem: Map<string, PulledEpisode[]>,
): { attached: number; detached: number } {
  return transaction(() => {
    let attached = 0;
    let detached = 0;

    for (const [mediaItemId, pulled] of byItem) {
      const wanted = new Map(pulled.map((e) => [key(e), e]));
      const existing = query<any>(
        `SELECT season_number, episode_number, watched_at, sources FROM user_episode_state
          WHERE user_id = ? AND media_item_id = ?`,
        [userId, mediaItemId],
      );
      const seen = new Set<string>();

      for (const row of existing) {
        const k = `${row.season_number}:${row.episode_number}`;
        seen.add(k);
        const sources = parseSources(row.sources);
        const want = wanted.get(k);
        if (want) {
          if (!sources.includes(source)) {
            run(
              `UPDATE user_episode_state SET sources = ?, watched_at = COALESCE(watched_at, ?), updated_at = ?
                WHERE user_id = ? AND media_item_id = ? AND season_number = ? AND episode_number = ?`,
              [
                JSON.stringify([...sources, source]),
                want.watchedAt ?? null,
                nowSec(),
                userId,
                mediaItemId,
                row.season_number,
                row.episode_number,
              ],
            );
            attached++;
          }
        } else {
          detached += detachOne(userId, mediaItemId, row.season_number, row.episode_number, sources, source);
        }
      }

      // Episodes the provider knows about that we've never seen.
      for (const [k, e] of wanted) {
        if (seen.has(k)) continue;
        run(
          `INSERT OR IGNORE INTO user_episode_state
             (user_id, media_item_id, season_number, episode_number, watched_at, sources, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [userId, mediaItemId, e.season, e.episode, e.watchedAt ?? null, JSON.stringify([source]), nowSec()],
        );
        attached++;
      }
    }

    // Shows that dropped out of the pull entirely: same "absent from a complete
    // pull means removed upstream" rule, applied at the item level. Without this
    // a show deleted on Trakt would keep its episode rows forever.
    const stale = query<any>(
      `SELECT media_item_id, season_number, episode_number, sources FROM user_episode_state
        WHERE user_id = ?`,
      [userId],
    );
    for (const row of stale) {
      if (byItem.has(row.media_item_id)) continue;
      const sources = parseSources(row.sources);
      if (!sources.includes(source)) continue;
      detached += detachOne(userId, row.media_item_id, row.season_number, row.episode_number, sources, source);
    }

    return { attached, detached };
  });
}

function detachOne(
  userId: string,
  mediaItemId: string,
  season: number,
  episode: number,
  sources: string[],
  source: string,
): number {
  if (!sources.includes(source)) return 0;
  const rest = sources.filter((s) => s !== source);
  if (rest.length === 0) {
    run(
      `DELETE FROM user_episode_state
        WHERE user_id = ? AND media_item_id = ? AND season_number = ? AND episode_number = ?`,
      [userId, mediaItemId, season, episode],
    );
  } else {
    run(
      `UPDATE user_episode_state SET sources = ?, updated_at = ?
        WHERE user_id = ? AND media_item_id = ? AND season_number = ? AND episode_number = ?`,
      [JSON.stringify(rest), nowSec(), userId, mediaItemId, season, episode],
    );
  }
  return 1;
}
