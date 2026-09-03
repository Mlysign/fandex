import { get, query } from "@/lib/db";
import { hiddenItemIds } from "@/lib/hiddenItems";
import { publicItemHref } from "@/lib/publicUrl";
import { CATALOG_TTL_SECONDS, ensureShowSeasons, ensureSeasonEpisodes } from "@/lib/episodes";

// ── "Up next" — the Home progress module (2026-08-16) ────────────────────────
//
// The one episode you'd actually watch next, per show. Built on MB14's
// `user_episode_state` + `show_episodes`.
//
// ── ONE filter, ONE sort ─────────────────────────────────────────────────────
//
// FILTER (the only one): the episode immediately before it — in season/episode
// order, across the season boundary — is marked watched. That's it. Nothing is
// excluded for being old.
//
// SORT: a watch and a release are both DATED EVENTS on one timeline, and an
// entry's position is its LATEST event:
//
//     eventAt = max(preceding episode's watched_at, this episode's release date)
//
// Newest event first, capped at MAX_ENTRIES. So (Nils's own example) —
//   Jan 1  you finish a Pluribus episode
//   Jan 2  a new Andor episode is released
//   Jan 3  you finish a One Piece episode
// reads One Piece → Andor → Pluribus; and ticking Pluribus on Jan 4 stamps a
// NEW event on it, so it jumps to the front: Pluribus → One Piece → Andor.
//
// This replaced a 30-day recency FILTER (2026-08-16, same day): the two arms are
// the same two dates, but as a filter they silently hid a show rather than
// ranking it, and there is no honest cutoff — the cap is what bounds the rail.
//
// Two behaviours that are deliberate, not oversights:
//   • A show you have never ticked an episode on never appears. The filter has
//     no preceding episode to satisfy for S1E1, so this is strictly "continue
//     watching", not "start watching".
//   • An UNAIRED episode never appears. A future release date would otherwise
//     sort straight to the front — and you cannot watch, or tick, something
//     that isn't out yet.

/** Providers that can supply per-episode state (capabilities.episodes.read). */
const EPISODE_PROVIDERS = ["trakt"];

/** Cap on the rail. Nils: "~10". */
const MAX_ENTRIES = 10;

/**
 * Shows whose episode catalog may be filled from TMDB in ONE request.
 *
 * The catalog is filled lazily (a detail view, a season expand), but the Trakt
 * pull writes watch state for shows nobody has opened here — so this path can be
 * the first thing that needs a given show's episode list. Healing every such
 * show at once would put an unbounded provider fan-out on the heaviest page in
 * the app, which is the exact shape of the 2026-08-02 latency incident.
 *
 * So: a small number per request, prioritised below, and each heal lasts a week.
 * A user with a large Trakt history converges over a few Home loads instead of
 * paying for all of it on one.
 */
const MAX_HEAL_SHOWS = 3;
const HEAL_BUDGET_MS = 4_000;

// The bulk catalog backfill (backfillUpNextCatalog), which runs on the SYNC
// path rather than on a page render — so it can be far more generous than the
// per-request heal above without making Home slow. Sized to drain a
// ~300-show library in a couple of syncs while leaving the sync itself well
// inside a request's lifetime.
const BACKFILL_MAX_SHOWS = 400;
const BACKFILL_BUDGET_MS = 20_000;
const BACKFILL_CONCURRENCY = 6;

/**
 * Why the rail is empty — because "no data yet", "still fetching episode lists",
 * "you're caught up" and "the Trakt pull is failing" all render as the same
 * nothing, and the person looking at it may be on a phone with no console.
 *
 * Every field is derived from state this user already owns. It exists to be
 * shown to them, so it carries no provider ids, tokens or other users' data.
 */
export interface UpNextStatus {
  /** Is a provider that can supply episodes connected at all? */
  episodeProviderConnected: boolean;
  /** Rows in user_episode_state — 0 means nothing has ever written any. */
  episodeRows: number;
  /** Distinct shows with episode state. */
  showsTracked: number;
  /** Of those, how many still need their episode list fetched (heals 3/request). */
  showsAwaitingCatalog: number;
  /** The last episode-reconcile this user's sync performed, if any. */
  lastEpisodeSync: { at: number | null; count: number | null; status: string | null; error: string | null } | null;
  /** The last Trakt LIBRARY pull — where a failing pull shows up. */
  lastLibrarySync: { at: number | null; count: number | null; status: string | null; error: string | null } | null;
}

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
  /** The sort key: the later of the two events above. Null when neither is dated. */
  eventAt: number | null;
  /** Which event won — useful when reading the rail's order back. */
  eventKind: "watched" | "released" | "unknown";
  /** The show's item page. */
  href: string;
  /**
   * This viewer hid the show (2026-09-03). Only ever true on the Progress TAB,
   * whose fetch asks for hidden shows so its search box can still find them;
   * every other caller filters them out at the query and never sees the flag.
   */
  hidden?: boolean;
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
  /** Public url address segment; see publicUrl.ts. */
  slug: string | null;
  posterUrl: string | null;
  /** episode key → watched_at (null when the provider gave no date) */
  watched: Map<string, number | null>;
  /** The most recent watched_at across the show — drives heal priority. */
  lastWatchedAt: number | null;
  /** Highest season the user has watched anything in. */
  maxWatchedSeason: number;
}

/** Every show this user has any episode state for, with that state attached. */
// 2026-09-03 (Nils): "shows should not show up on the progress feed" once
// hidden. Filtered HERE rather than over the finished entries, because this is
// also what feeds the heal queue: a hidden show that never appears must not
// spend any of buildUpNext's 3-shows-per-request provider budget either. It
// stays in user_episode_state and in the library untouched, and unhiding puts it
// straight back with its watch history intact.
//
// ⚠️ `includeHidden` exists for ONE caller, and the reason is Nils's other rule.
// Second pass the same day: "i cannot find it on progress when typing it into
// the searchbox (wrong)." Hidden means "stop volunteering it", not "pretend it
// does not exist", and the Progress TAB has a search box — so that surface has
// to be handed the hidden shows, flagged, and drop them client-side unless the
// person is searching. Every other caller (Home's rail, the heal queue) keeps
// the default and never sees them.
function loadShowStates(userId: string, includeHidden = false): ShowState[] {
  const hiddenClause = includeHidden
    ? ""
    : "AND s.media_item_id NOT IN (SELECT media_item_id FROM user_hidden_items WHERE user_id = ?)";
  const params = includeHidden ? [userId] : [userId, userId];

  const rows = query<{
    media_item_id: string;
    title: string;
    slug: string | null;
    poster_url: string | null;
    season_number: number;
    episode_number: number;
    watched_at: number | null;
  }>(
    `SELECT s.media_item_id, m.title, m.slug, m.poster_url, s.season_number, s.episode_number, s.watched_at
       FROM user_episode_state s
       JOIN media_items m ON m.id = s.media_item_id
      WHERE s.user_id = ? AND m.type = 'show' ${hiddenClause}`,
    params,
  );

  const byShow = new Map<string, ShowState>();
  for (const r of rows) {
    let st = byShow.get(r.media_item_id);
    if (!st) {
      st = {
        mediaItemId: r.media_item_id,
        title: r.title,
        slug: r.slug ?? null,
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

interface SeasonInfo {
  seasons: number[];
  /** Oldest `updated_at` across the show's season rows — its freshness. */
  updatedAt: number;
}

/**
 * The season LIST per show, in one query rather than one per show.
 *
 * Batched deliberately: the freshness check below needs this for every candidate
 * on every request, and the old per-show `loadSeasons()` call inside the coverage
 * test was one indexed query per show on Home's critical path.
 */
function loadSeasonIndex(mediaItemIds: string[]): Map<string, SeasonInfo> {
  const out = new Map<string, SeasonInfo>();
  if (!mediaItemIds.length) return out;
  const placeholders = mediaItemIds.map(() => "?").join(",");
  const rows = query<{ media_item_id: string; season_number: number; updated_at: number }>(
    `SELECT media_item_id, season_number, updated_at FROM show_seasons
      WHERE media_item_id IN (${placeholders})`,
    mediaItemIds,
  );
  for (const r of rows) {
    const info = out.get(r.media_item_id) ?? { seasons: [], updatedAt: Infinity };
    info.seasons.push(r.season_number);
    info.updatedAt = Math.min(info.updatedAt, r.updated_at);
    out.set(r.media_item_id, info);
  }
  return out;
}

type Coverage = "missing" | "stale" | "ok";

/**
 * Can this show's STORED catalog answer "what's next", and is it still current?
 *
 * `missing` — no rows, or nothing covering the season the user is in, or the
 *   next season exists in the season list but its episodes were never fetched.
 *   The next-season half is what makes the rollover work: without it, someone
 *   sitting on a season finale looks finished.
 *
 * `stale` — it can answer, but the season LIST is older than the catalog TTL, so
 *   a season released since then would be invisible. That matters much more now
 *   that a release is a sort input rather than a bonus filter: a show whose new
 *   season just dropped has to be able to reach the front of the rail, and it
 *   never would if we only ever trusted a year-old season list. Lower heal
 *   priority than `missing`, which can't produce an entry at all.
 */
function coverage(st: ShowState, eps: CatalogEpisode[] | undefined, info: SeasonInfo | undefined, nowSec: number): Coverage {
  if (!eps?.length || !info) return "missing";
  if (!eps.some((e) => e.season === st.maxWatchedSeason)) return "missing";
  const nextSeason = st.maxWatchedSeason + 1;
  if (info.seasons.includes(nextSeason) && !eps.some((e) => e.season === nextSeason)) return "missing";
  if (info.updatedAt < nowSec - CATALOG_TTL_SECONDS) return "stale";
  return "ok";
}

/** One show's catalog fill: the season list, then the two seasons that matter. */
async function healShow(st: ShowState): Promise<void> {
  const seasons = (await ensureShowSeasons(st.mediaItemId)).map((s) => s.seasonNumber);
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

    // The two events, on one timeline. Latest wins — that IS the sort key.
    const prevWatchedAt = st.watched.get(prevKey) ?? null;
    let eventAt: number | null = null;
    let eventKind: UpNextEntry["eventKind"] = "unknown";
    if (prevWatchedAt != null || air != null) {
      // A null `watched_at` (Trakt can omit last_watched_at) simply doesn't
      // compete — the other event, if any, wins by default.
      eventAt = Math.max(prevWatchedAt ?? -Infinity, air ?? -Infinity);
      eventKind = eventAt === prevWatchedAt ? "watched" : "released";
    }

    return {
      mediaItemId: st.mediaItemId,
      showTitle: st.title,
      posterUrl: st.posterUrl,
      season: ep.season,
      episode: ep.episode,
      episodeTitle: ep.title,
      airDate: ep.airDate,
      previousWatchedAt: prevWatchedAt,
      eventAt,
      eventKind,
      href: publicItemHref({ id: st.mediaItemId, type: "show", title: st.title, slug: st.slug }),
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
  opts: { now?: number; maxHealShows?: number; healBudgetMs?: number; limit?: number; includeHidden?: boolean } = {},
): Promise<UpNextEntry[]> {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  const states = loadShowStates(userId, opts.includeHidden);
  // Only asked for when hidden shows were included, so the common path costs no
  // query at all.
  const hidden = opts.includeHidden ? hiddenItemIds(userId) : null;
  if (!states.length) return [];

  const ids = states.map((s) => s.mediaItemId);
  let episodeIndex = loadEpisodeIndex(ids);
  const seasonIndex = loadSeasonIndex(ids);

  // `missing` before `stale` — a show with no usable catalog cannot appear at
  // all, while a stale one is merely possibly out of date. Within each group,
  // most recently watched first.
  const rank = { missing: 0, stale: 1, ok: 2 } as const;
  const needHeal = states
    .map((s) => ({ st: s, cov: coverage(s, episodeIndex.get(s.mediaItemId), seasonIndex.get(s.mediaItemId), nowSec) }))
    .filter((c) => c.cov !== "ok")
    .sort((a, b) => rank[a.cov] - rank[b.cov] || (b.st.lastWatchedAt ?? 0) - (a.st.lastWatchedAt ?? 0))
    .slice(0, opts.maxHealShows ?? MAX_HEAL_SHOWS);

  if (needHeal.length) {
    const deadline = Date.now() + (opts.healBudgetMs ?? HEAL_BUDGET_MS);
    const healed: string[] = [];
    for (const { st } of needHeal) {
      if (Date.now() > deadline) break;
      await healShow(st);
      healed.push(st.mediaItemId);
    }
    if (healed.length) {
      const fresh = loadEpisodeIndex(healed);
      episodeIndex = new Map([...episodeIndex, ...fresh]);
    }
  }

  const entries: UpNextEntry[] = [];
  for (const st of states) {
    const e = nextForShow(st, episodeIndex.get(st.mediaItemId), nowSec);
    if (e) entries.push(hidden?.has(st.mediaItemId) ? { ...e, hidden: true } : e);
  }

  // Newest event first. An entry with no dated event at all sorts last rather
  // than being dropped — the filter already said it belongs here.
  entries.sort((a, b) => (b.eventAt ?? -Infinity) - (a.eventAt ?? -Infinity));
  return entries.slice(0, opts.limit ?? MAX_ENTRIES);
}

// The library's Progress tab asks for this same list UNCAPPED, via
// `buildFilterableUpNext` (lib/upNextFacts.ts) — which calls the function above
// with `limit: Infinity` and attaches the show facts its toolbar filters on. It
// replaced a `buildUpNextPage` helper on 2026-08-28; see that module's header
// for why the tab pages its render rather than its fetch.

/**
 * Fill the episode catalog for shows that can't produce a rail entry yet.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * buildUpNext heals 3 shows per request, which is right for a Home render but
 * cannot bootstrap a library. The first real sync attached episodes for 280
 * shows, all with an empty catalog, so the rail could only ever show entries for
 * the handful healed so far — Nils saw **2** where the cap is 10. The cap was
 * never the binding constraint; catalog coverage was.
 *
 * Bounded and resumable by construction: it re-derives "what still lacks
 * coverage" on every call and stops at the first of `maxShows` or `budgetMs`, so
 * repeated calls converge and none of them runs long. Nothing is persisted about
 * where it got to — the same reason the Wikidata sweep needed a `checked` table
 * does NOT apply here, because a healed show stops qualifying.
 *
 * Runs a few shows CONCURRENTLY because each is network-bound and independent.
 * Kept deliberately small: TMDB tolerates far more, but a sync already fires
 * other provider calls and the point is to converge over a few passes, not to
 * burst.
 *
 * Never throws — `healShow`'s helpers already degrade to what's stored, so a
 * provider outage costs coverage, not the sync it's attached to.
 */
export async function backfillUpNextCatalog(
  userId: string,
  opts: { now?: number; maxShows?: number; budgetMs?: number; concurrency?: number } = {},
): Promise<{ healed: number; remaining: number }> {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  const maxShows = opts.maxShows ?? BACKFILL_MAX_SHOWS;
  const budgetMs = opts.budgetMs ?? BACKFILL_BUDGET_MS;
  const concurrency = Math.max(1, opts.concurrency ?? BACKFILL_CONCURRENCY);

  const states = loadShowStates(userId);
  if (!states.length) return { healed: 0, remaining: 0 };

  const ids = states.map((s) => s.mediaItemId);
  const episodeIndex = loadEpisodeIndex(ids);
  const seasonIndex = loadSeasonIndex(ids);

  // Same priority as the per-request heal: unusable before merely stale, most
  // recently watched first. So the shows most likely to belong at the front of
  // the rail are also the ones filled first, and an interrupted sweep still
  // leaves the rail better than it found it.
  const rank = { missing: 0, stale: 1, ok: 2 } as const;
  const pending = states
    .map((s) => ({ st: s, cov: coverage(s, episodeIndex.get(s.mediaItemId), seasonIndex.get(s.mediaItemId), nowSec) }))
    .filter((c) => c.cov !== "ok")
    .sort((a, b) => rank[a.cov] - rank[b.cov] || (b.st.lastWatchedAt ?? 0) - (a.st.lastWatchedAt ?? 0));

  const targets = pending.slice(0, maxShows);
  const deadline = Date.now() + budgetMs;
  let healed = 0;
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= targets.length || Date.now() > deadline) return;
      await healShow(targets[i].st);
      healed++;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return { healed, remaining: Math.max(0, pending.length - healed) };
}

/**
 * The "why is this empty" answer, computed independently of buildUpNext so a
 * thrown heal can never take it down — when the rail is blank, this is the only
 * thing that can say anything at all.
 */
export function upNextStatus(userId: string, opts: { now?: number } = {}): UpNextStatus {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);

  const episodeProviderConnected = !!get<{ n: number }>(
    `SELECT COUNT(*) n FROM user_identities WHERE user_id = ? AND provider IN (${EPISODE_PROVIDERS.map(() => "?").join(",")})`,
    [userId, ...EPISODE_PROVIDERS],
  )?.n;

  const rows = get<{ rows: number; shows: number }>(
    `SELECT COUNT(*) rows, COUNT(DISTINCT media_item_id) shows
       FROM user_episode_state WHERE user_id = ?`,
    [userId],
  );

  const states = loadShowStates(userId);
  const ids = states.map((s) => s.mediaItemId);
  const episodeIndex = loadEpisodeIndex(ids);
  const seasonIndex = loadSeasonIndex(ids);
  const showsAwaitingCatalog = states.filter(
    (s) => coverage(s, episodeIndex.get(s.mediaItemId), seasonIndex.get(s.mediaItemId), nowSec) === "missing",
  ).length;

  const lastLog = (provider: string) => {
    const r = get<{ synced_at: number; item_count: number; status: string; error: string | null }>(
      `SELECT synced_at, item_count, status, error FROM sync_log
        WHERE user_id = ? AND provider = ? ORDER BY synced_at DESC, rowid DESC LIMIT 1`,
      [userId, provider],
    );
    return r
      ? { at: r.synced_at, count: r.item_count, status: r.status, error: r.error }
      : null;
  };

  return {
    episodeProviderConnected,
    episodeRows: rows?.rows ?? 0,
    showsTracked: rows?.shows ?? 0,
    showsAwaitingCatalog,
    lastEpisodeSync: lastLog("trakt-episodes"),
    lastLibrarySync: lastLog("trakt-library"),
  };
}
