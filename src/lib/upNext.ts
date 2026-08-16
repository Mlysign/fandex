import { query } from "@/lib/db";
import { publicItemHref } from "@/lib/publicUrl";
import { ensureShowSeasons, ensureSeasonEpisodes, loadSeasons } from "@/lib/episodes";

// ── "Up next" — the Home progress module (2026-08-16) ────────────────────────
//
// The one episode you'd actually watch next, per show, for the shows you are
// actually watching. Built on MB14's `user_episode_state` + `show_episodes`.
//
// RELEVANCE, exactly as specified. An episode qualifies when:
//   1. the episode IMMEDIATELY BEFORE it (in season/episode order, across the
//      season boundary) is marked watched, and
//   2. either that preceding episode was watched in the last 30 days, OR this
//      episode was released in the last 30 days.
//
// (2) is what separates "paused mid-season" from "abandoned", and its second
// arm is what brings a show back the week a new season drops even though you
// finished the previous one a year ago. There is no explicit "abandoned" flag —
// the recency window IS the abandonment test, which is why nothing here reads
// one.
//
// Two consequences worth stating because they are deliberate, not oversights:
//   • A show you have never ticked an episode on never appears. Rule (1) has no
//     preceding episode to satisfy for S1E1, so this module is strictly
//     "continue watching", not "start watching".
//   • An UNAIRED episode never appears. Rule (2)'s first arm would happily
//     surface next week's episode the day after you watch this week's, and you
//     cannot watch — or tick — something that isn't out.

const DAY = 86_400;
const RECENT_SECONDS = 30 * DAY;

/** Cap on what the rail renders. Well past what anyone scrolls. */
const MAX_ENTRIES = 20;

/**
 * Shows whose episode catalog may be filled from TMDB in ONE request.
 *
 * The catalog is filled lazily (a detail view, a season expand), but the Trakt
 * pull writes watch state for shows nobody has opened here — so this path can be
 * the first thing that needs a given show's episode list. Healing every such
 * show at once would put an unbounded provider fan-out on the heaviest page in
 * the app, which is the exact shape of the 2026-08-02 latency incident.
 *
 * So: a small number per request, most-recently-watched first, and each heal is
 * permanent (a week's TTL). A user with a large Trakt history converges over a
 * few Home loads instead of paying for all of it on one.
 */
const MAX_HEAL_SHOWS = 3;
const HEAL_BUDGET_MS = 4_000;

export interface UpNextEntry {
  mediaItemId: string;
  showTitle: string;
  posterUrl: string | null;
  season: number;
  episode: number;
  episodeTitle: string | null;
  airDate: string | null;
  /** When the PRECEDING episode was marked watched (unix seconds), if known. */
  previousWatchedAt: number | null;
  /** The show's item page. */
  href: string;
}

interface EpisodeKey {
  season: number;
  episode: number;
}

const key = (e: EpisodeKey) => `${e.season}:${e.episode}`;

/** ISO date → unix seconds, or null. Dates are `YYYY-MM-DD`, so UTC midnight. */
function airUnix(airDate: string | null): number | null {
  if (!airDate) return null;
  const t = Date.parse(`${airDate}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

export interface ShowState {
  mediaItemId: string;
  title: string;
  posterUrl: string | null;
  /** episode key → watched_at (null when the provider gave no date) */
  watched: Map<string, number | null>;
  /** The most recent watched_at across the show — drives heal priority + sort. */
  lastWatchedAt: number | null;
  /** Highest season the user has watched anything in. */
  maxWatchedSeason: number;
}

/** Every show this user has any episode state for, with that state attached. */
function loadShowStates(userId: string): ShowState[] {
  const rows = query<{
    media_item_id: string;
    title: string;
    poster_url: string | null;
    season_number: number;
    episode_number: number;
    watched_at: number | null;
  }>(
    `SELECT s.media_item_id, m.title, m.poster_url, s.season_number, s.episode_number, s.watched_at
       FROM user_episode_state s
       JOIN media_items m ON m.id = s.media_item_id
      WHERE s.user_id = ? AND m.type = 'show'`,
    [userId],
  );

  const byShow = new Map<string, ShowState>();
  for (const r of rows) {
    let st = byShow.get(r.media_item_id);
    if (!st) {
      st = {
        mediaItemId: r.media_item_id,
        title: r.title,
        posterUrl: r.poster_url,
        watched: new Map(),
        lastWatchedAt: null,
        maxWatchedSeason: 0,
      };
      byShow.set(r.media_item_id, st);
    }
    st.watched.set(key({ season: r.season_number, episode: r.episode_number }), r.watched_at);
    if (r.watched_at != null && (st.lastWatchedAt == null || r.watched_at > st.lastWatchedAt)) {
      st.lastWatchedAt = r.watched_at;
    }
    if (r.season_number > st.maxWatchedSeason) st.maxWatchedSeason = r.season_number;
  }
  return [...byShow.values()];
}

export interface CatalogEpisode extends EpisodeKey {
  title: string | null;
  airDate: string | null;
}

/** Every known episode of these shows, in season/episode order, grouped by show. */
function loadEpisodeIndex(mediaItemIds: string[]): Map<string, CatalogEpisode[]> {
  const out = new Map<string, CatalogEpisode[]>();
  if (!mediaItemIds.length) return out;
  const placeholders = mediaItemIds.map(() => "?").join(",");
  const rows = query<{
    media_item_id: string;
    season_number: number;
    episode_number: number;
    title: string | null;
    air_date: string | null;
  }>(
    `SELECT media_item_id, season_number, episode_number, title, air_date
       FROM show_episodes WHERE media_item_id IN (${placeholders})
      ORDER BY media_item_id, season_number, episode_number`,
    mediaItemIds,
  );
  for (const r of rows) {
    const list = out.get(r.media_item_id) ?? [];
    list.push({
      season: r.season_number,
      episode: r.episode_number,
      title: r.title,
      airDate: r.air_date,
    });
    out.set(r.media_item_id, list);
  }
  return out;
}

/**
 * Does this show's stored catalog cover what "next up" needs?
 *
 * It needs the season the user is in AND the one after it — otherwise a viewer
 * sitting on a season finale looks finished when the next season exists. Asking
 * for both up front is what makes the season rollover work without a second
 * pass. A show whose stored list simply ends (the real final season) answers
 * "covered" on the first clause and correctly yields no entry.
 */
function catalogCovers(st: ShowState, eps: CatalogEpisode[] | undefined): boolean {
  if (!eps?.length) return false;
  const hasCurrent = eps.some((e) => e.season === st.maxWatchedSeason);
  if (!hasCurrent) return false;
  const seasons = loadSeasons(st.mediaItemId).map((s) => s.seasonNumber);
  const nextSeason = st.maxWatchedSeason + 1;
  if (!seasons.includes(nextSeason)) return true; // no next season exists
  return eps.some((e) => e.season === nextSeason);
}

/** One show's catalog fill: the season list, then the two seasons that matter. */
async function healShow(st: ShowState): Promise<void> {
  await ensureShowSeasons(st.mediaItemId);
  const seasons = loadSeasons(st.mediaItemId).map((s) => s.seasonNumber);
  for (const n of [st.maxWatchedSeason, st.maxWatchedSeason + 1]) {
    if (seasons.includes(n)) await ensureSeasonEpisodes(st.mediaItemId, n);
  }
}

/** The next episode for one show, or null when nothing qualifies. */
export function nextForShow(
  st: ShowState,
  eps: CatalogEpisode[] | undefined,
  nowSec: number,
): UpNextEntry | null {
  if (!eps?.length) return null;
  const cutoff = nowSec - RECENT_SECONDS;

  // The earliest unwatched episode whose immediate predecessor IS watched. That
  // is "the next one to watch" including the case of a gap left mid-season, and
  // it crosses the season boundary for free because `eps` is one ordered list.
  for (let i = 1; i < eps.length; i++) {
    const ep = eps[i];
    if (st.watched.has(key(ep))) continue;
    const prevKey = key(eps[i - 1]);
    if (!st.watched.has(prevKey)) continue;

    // Not out yet → not watchable, so not "up next".
    const air = airUnix(ep.airDate);
    if (air != null && air > nowSec) return null;

    // A null watched_at means "watched, date unknown" — treated as NOT recent,
    // because the honest reading of an unknown date is "some time ago", and the
    // release arm below still rescues a genuinely new episode.
    const prevWatchedAt = st.watched.get(prevKey) ?? null;
    const prevRecent = prevWatchedAt != null && prevWatchedAt >= cutoff;
    const releaseRecent = air != null && air >= cutoff;
    if (!prevRecent && !releaseRecent) return null;

    return {
      mediaItemId: st.mediaItemId,
      showTitle: st.title,
      posterUrl: st.posterUrl,
      season: ep.season,
      episode: ep.episode,
      episodeTitle: ep.title,
      airDate: ep.airDate,
      previousWatchedAt: prevWatchedAt,
      href: publicItemHref({ id: st.mediaItemId, type: "show", title: st.title }),
    };
  }
  return null;
}

/**
 * Build the Home progress rail for one user.
 *
 * Bounded, and degrades rather than throwing: this feeds a Home module, so a
 * TMDB outage must cost the shows it couldn't heal, never the page. (Both
 * `ensure*` helpers already swallow provider errors and return what's stored.)
 */
export async function buildUpNext(
  userId: string,
  opts: { now?: number; maxHealShows?: number; healBudgetMs?: number } = {},
): Promise<UpNextEntry[]> {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  const states = loadShowStates(userId);
  if (!states.length) return [];

  let index = loadEpisodeIndex(states.map((s) => s.mediaItemId));

  // Heal the shows whose catalog can't answer yet — most recently watched
  // first, since those are the ones the user is actually in the middle of.
  const needHeal = states
    .filter((s) => !catalogCovers(s, index.get(s.mediaItemId)))
    .sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0))
    .slice(0, opts.maxHealShows ?? MAX_HEAL_SHOWS);

  if (needHeal.length) {
    const deadline = Date.now() + (opts.healBudgetMs ?? HEAL_BUDGET_MS);
    const healed: string[] = [];
    for (const st of needHeal) {
      if (Date.now() > deadline) break;
      await healShow(st);
      healed.push(st.mediaItemId);
    }
    if (healed.length) {
      const fresh = loadEpisodeIndex(healed);
      index = new Map([...index, ...fresh]);
    }
  }

  const entries: UpNextEntry[] = [];
  for (const st of states) {
    const e = nextForShow(st, index.get(st.mediaItemId), nowSec);
    if (e) entries.push(e);
  }

  // Most recent activity first: the show you watched last night is the one you
  // are most likely to continue. A brand-new episode of a show you last touched
  // months ago sorts below it, which is the right emphasis for a "continue"
  // module.
  entries.sort(
    (a, b) =>
      (b.previousWatchedAt ?? 0) - (a.previousWatchedAt ?? 0) ||
      (b.airDate ?? "").localeCompare(a.airDate ?? ""),
  );
  return entries.slice(0, MAX_ENTRIES);
}
