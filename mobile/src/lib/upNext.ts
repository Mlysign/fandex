// Up next: the one episode you would watch next, per show.
//
// The site worked this out from its own episode catalog. The device has no
// such catalog (the Worker's copy stopped being filled when the site did), so
// it asks Trakt, which knows both what has aired and what you have seen:
// `/shows/{id}/progress/watched` answers with `next_episode`, one small call
// per show.
//
// One call per show is why the answers are kept. A row says what Trakt answered
// and how many of the show's episodes were ticked at the time, and it is asked
// again when that count moves (you watched something), when the episode Trakt
// said was coming next has aired, or when the answer is old enough that a new
// episode may have aired unannounced. A run asks about a few shows, the most
// recently watched first, so the top of the list is right after one run and a
// long history fills in over several.
//
// The ORDER is the site's rule (src/lib/upNext.ts): a watch and a release are
// both dated events, and an entry sits at its latest one. Ticking an episode
// moves its show to the front; so does a new episode airing.

import type { SQLiteDatabase } from 'expo-sqlite';
import { api } from '~/lib/api';
import { applyLocalWrite } from '~/lib/stateSync';
import { TraktBusyError, traktAccessToken, traktGet, traktPost } from '~/lib/trakt';
import { publishWidget } from '~/lib/widget';

/** Shows asked about per run. Each is one request to Trakt. */
const RUN_BUDGET = 12;
const CONCURRENCY = 3;
const DAY = 86_400;
/** A show watched in the last four months may get a new episode any day. */
const ACTIVE_WINDOW = 120 * DAY;
/**
 * For a new episode Trakt had not dated when it was last asked. One it HAD dated
 * is asked about as soon as it airs (`next_air_at`), whatever these say: a
 * weekly show sat a day behind its new episode on the phone (2026-10-17).
 */
const TTL_ACTIVE = 6 * 3600;
const TTL_DORMANT = 7 * DAY;

export interface UpNextEntry {
  mediaItemId: string;
  /** The show's public address is /show/{slug}. Null for an old row. */
  slug: string | null;
  title: string;
  posterUrl: string | null;
  season: number;
  episode: number;
  episodeTitle: string | null;
  /** Unix seconds: the later of "you watched the one before" and "this one aired". */
  eventAt: number | null;
  // The show's own figures, for the Progress tab's other sorts.
  releaseDate: string | null;
  votes: number;
  communityScore: number | null;
  /** You hid this show. Only listed when asked for (a search by name: Hide promises it stays findable). */
  hidden?: boolean;
}

interface ShowWatch {
  mediaItemId: string;
  watchedCount: number;
  lastWatchedAt: number | null;
}

interface StoredRow {
  media_item_id: string;
  watched_count: number;
  checked_at: number;
  /** When the episode Trakt named as next airs, if that is still to come. */
  next_air_at?: number | null;
}

/** Trakt's answer for one show, reduced to what the list needs. */
export interface Progress {
  season: number | null;
  episode: number | null;
  title: string | null;
  airedAt: number | null;
  lastWatchedAt: number | null;
  /** The next episode has a date and it is still to come: ask again once it passes. */
  upcomingAt: number | null;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
function unix(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * Read `/shows/{id}/progress/watched`. A show with nothing left answers
 * `next_episode: null`, which is "caught up" and is stored as such. An episode
 * that has not aired yet is not "next": you cannot watch it.
 *
 * ⚠️ No air date is "not aired", never "aired". Trakt lists the first episode
 * of an announced season before anybody has scheduled it, with a placeholder
 * title and `first_aired: null` (seen 2026-10-10: Dune: Prophecy S02E01
 * "Episode #2.1", Sabikui Bisco S02E01 "Episode 1"). Reading null as "out"
 * put shows in Up next that nobody can watch. An episode that really aired
 * with no date on Trakt is rare, and missing it costs a row, not a wrong one.
 */
export function readProgress(answer: unknown, now: number): Progress {
  const a = obj(answer);
  const next = obj(a.next_episode);
  const season = int(next.season);
  const episode = int(next.number);
  const airedAt = unix(next.first_aired);
  const lastWatchedAt = unix(a.last_watched_at);
  if (season == null || episode == null || season === 0 || airedAt == null || airedAt > now) {
    const upcomingAt = season != null && season !== 0 && episode != null && airedAt != null && airedAt > now ? airedAt : null;
    return { season: null, episode: null, title: null, airedAt: null, lastWatchedAt, upcomingAt };
  }
  return { season, episode, title: typeof next.title === 'string' ? next.title : null, airedAt, lastWatchedAt, upcomingAt: null };
}

/** Which shows to ask Trakt about now, most recently watched first. Pure, so the staleness rule has a test. */
export function showsToCheck(shows: ShowWatch[], stored: StoredRow[], now: number, budget = RUN_BUDGET): ShowWatch[] {
  const have = new Map(stored.map((r) => [r.media_item_id, r]));
  const due = shows.filter((s) => {
    const row = have.get(s.mediaItemId);
    if (!row) return true;
    if (row.watched_count !== s.watchedCount) return true;
    if (row.next_air_at != null && row.next_air_at <= now) return true;
    const active = s.lastWatchedAt != null && now - s.lastWatchedAt < ACTIVE_WINDOW;
    return now - row.checked_at > (active ? TTL_ACTIVE : TTL_DORMANT);
  });
  due.sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0));
  return due.slice(0, budget);
}

/**
 * The shows you have ticked episodes of, among those the catalog copy holds.
 *
 * ⚠️ Only those. A show the copy does not hold YET cannot be looked up, and it
 * used to be stored as caught up without Trakt being asked. A catalog start-over
 * empties the copy and refills it page by page, and every page re-ran this:
 * after the 2026-10-16 fold every device recorded most of its shows as caught
 * up, and the answer held for a day to a week (TTL_ACTIVE, TTL_DORMANT). A show
 * left out here is asked about once the page holding it lands.
 */
async function watchedShows(db: SQLiteDatabase): Promise<ShowWatch[]> {
  const rows = await db.getAllAsync<{ media_item_id: string; n: number; last: number | null }>(
    `SELECT e.media_item_id, COUNT(*) n, MAX(e.watched_at) last
       FROM episode_state e
      WHERE e.media_item_id NOT IN (SELECT media_item_id FROM hidden_item)
        AND e.media_item_id IN (SELECT id FROM catalog)
      GROUP BY e.media_item_id`,
  );
  return rows.map((r) => ({ mediaItemId: r.media_item_id, watchedCount: r.n, lastWatchedAt: r.last }));
}

/**
 * The show's Trakt id, out of the catalog copy. Null when the copy holds the
 * show with no Trakt link; undefined when it does not hold the show at all,
 * which says nothing about Trakt.
 */
async function traktIdOf(db: SQLiteDatabase, mediaItemId: string): Promise<number | null | undefined> {
  const row = await db.getFirstAsync<{ vector: string }>('SELECT vector FROM catalog WHERE id = ?', [mediaItemId]);
  if (!row) return undefined;
  try {
    const sources = (JSON.parse(row.vector) as { sources?: { source: string; sourceId: string }[] }).sources ?? [];
    const id = Number(sources.find((s) => s.source === 'trakt')?.sourceId);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

async function store(db: SQLiteDatabase, show: ShowWatch, p: Progress, now: number): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO up_next (media_item_id, season, episode, title, aired_at, last_watched_at, watched_count, checked_at, next_air_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    // The later of what Trakt says and what this device recorded. Trakt's
    // `last_watched_at` lagged behind a tick made seconds earlier, and a show
    // ticked again and again stayed below one ticked before it.
    [show.mediaItemId, p.season, p.episode, p.title, p.airedAt,
     Math.max(p.lastWatchedAt ?? 0, show.lastWatchedAt ?? 0) || null, show.watchedCount, now, p.upcomingAt],
  );
}

async function checkShow(db: SQLiteDatabase, token: string, show: ShowWatch, now: number): Promise<void> {
  const traktId = await traktIdOf(db, show.mediaItemId);
  // Not in the catalog copy (yet): nothing is known, so nothing is stored.
  if (traktId === undefined) return;
  // No Trakt link: there is nobody to ask. Stored as caught up so it is not
  // asked about on every run.
  if (traktId === null) {
    await store(db, show, { season: null, episode: null, title: null, airedAt: null, lastWatchedAt: show.lastWatchedAt, upcomingAt: null }, now);
    return;
  }
  const answer = await traktGet(`/shows/${traktId}/progress/watched?hidden=false&specials=false&count_specials=false&extended=full`, token);
  await store(db, show, readProgress(answer, now), now);
}

/**
 * Ask Trakt about the shows that are due. Returns how many are still waiting,
 * so a screen can run it again. A show whose request fails is left as it was
 * and asked again next time; the failure is thrown only if every request of the
 * run failed, which is what "Trakt is down" or "sign in again" looks like.
 */
export async function refreshUpNext(db: SQLiteDatabase): Promise<{ checked: number; waiting: number }> {
  const now = Math.floor(Date.now() / 1000);
  const shows = await watchedShows(db);
  const stored = await db.getAllAsync<StoredRow>('SELECT media_item_id, watched_count, checked_at, next_air_at FROM up_next');
  const due = showsToCheck(shows, stored, now, Number.MAX_SAFE_INTEGER);
  const batch = due.slice(0, RUN_BUDGET);
  if (!batch.length) return { checked: 0, waiting: 0 };

  const token = await traktAccessToken();
  let checked = 0;
  let firstError: unknown = null;
  let busy: TraktBusyError | null = null;
  for (let i = 0; i < batch.length && !busy; i += CONCURRENCY) {
    await Promise.all(batch.slice(i, i + CONCURRENCY).map(async (show) => {
      try { await checkShow(db, token, show, now); checked++; } catch (e) {
        firstError ??= e;
        if (e instanceof TraktBusyError) busy = e;
      }
    }));
  }
  // Trakt said "not now". Asking about the rest of the shows would only extend
  // the wait, so the run ends here and says why, even if some shows did answer:
  // what is on screen is then partly old.
  if (busy) {
    if (checked) await publishWidget(db);
    throw busy;
  }
  if (checked === 0 && firstError) throw firstError;
  if (checked) await publishWidget(db);
  return { checked, waiting: due.length - checked };
}

/**
 * The list, best first. A show you hid is left out, unless `includeHidden`:
 * the Progress tab asks for it while a name is typed, so a hidden show is
 * findable as Hide promises (the site's Progress tab did the same).
 */
export async function upNextList(db: SQLiteDatabase, limit = 30, includeHidden = false): Promise<UpNextEntry[]> {
  const rows = await db.getAllAsync<{
    media_item_id: string; slug: string | null; title: string; poster_url: string | null;
    season: number; episode: number; episode_title: string | null; event_at: number | null;
    release_date: string | null; community_votes: number; community_score: number | null; hidden: number;
  }>(
    `SELECT u.media_item_id, c.slug, c.title, c.poster_url, c.release_date, c.community_votes, c.community_score,
            u.season, u.episode, u.title AS episode_title,
            (u.media_item_id IN (SELECT media_item_id FROM hidden_item)) AS hidden,
            MAX(COALESCE(u.last_watched_at, 0), COALESCE(u.aired_at, 0), COALESCE((SELECT MAX(e.watched_at) FROM episode_state e WHERE e.media_item_id = u.media_item_id), 0)) AS event_at
       FROM up_next u JOIN catalog c ON c.id = u.media_item_id
      WHERE u.season IS NOT NULL AND u.aired_at IS NOT NULL
        AND (? OR u.media_item_id NOT IN (SELECT media_item_id FROM hidden_item))
      ORDER BY event_at DESC, c.title
      LIMIT ?`,
    [includeHidden ? 1 : 0, limit],
  );
  return rows.map((r) => ({
    mediaItemId: r.media_item_id, slug: r.slug, title: r.title, posterUrl: r.poster_url,
    season: r.season, episode: r.episode, episodeTitle: r.episode_title, eventAt: r.event_at || null,
    releaseDate: r.release_date, votes: r.community_votes ?? 0, communityScore: r.community_score,
    hidden: !!r.hidden,
  }));
}

/** How many shows have never been asked about: the list is still filling while this is above zero. */
export async function upNextPending(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) n FROM (SELECT DISTINCT media_item_id FROM episode_state)
      WHERE media_item_id NOT IN (SELECT media_item_id FROM up_next)
        AND media_item_id IN (SELECT id FROM catalog)`,
  );
  return row?.n ?? 0;
}

/**
 * Mark episodes of one show watched or unwatched: Trakt, then the Worker, then
 * this device, then ask Trakt what is next for that show. The same order as
 * every other write, for the same reason (itemActions.ts).
 *
 * Every episode is named. Trakt can mark "a whole season" in one word, and then
 * what it marked is its own list, not ours: the rows saved here would be a guess
 * at what the provider did.
 */
export async function setEpisodesWatched(
  db: SQLiteDatabase,
  mediaItemId: string,
  episodes: { season: number; episode: number }[],
  watched: boolean,
): Promise<void> {
  if (!episodes.length) return;
  const traktId = await traktIdOf(db, mediaItemId);
  if (traktId == null) throw new Error('This show is not linked to Trakt, so the episode could not be marked.');
  const token = await traktAccessToken();
  const now = Math.floor(Date.now() / 1000);

  const bySeason = new Map<number, number[]>();
  for (const e of episodes) bySeason.set(e.season, [...(bySeason.get(e.season) ?? []), e.episode]);
  const seasons = [...bySeason].map(([number, list]) => ({ number, episodes: list.map((n) => ({ number: n })) }));
  await traktPost(watched ? '/sync/history' : '/sync/history/remove', token, { shows: [{ ids: { trakt: traktId }, seasons }] });

  const write = watched
    ? { episodes: { upsert: episodes.map((e) => ({ mediaItemId, season: e.season, episode: e.episode, watchedAt: now, sources: ['trakt'] })) } }
    : { episodes: { delete: episodes.map((e) => ({ mediaItemId, season: e.season, episode: e.episode })) } };
  await api.writeState(write);
  await applyLocalWrite(db, write);

  const left = await db.getFirstAsync<{ n: number; last: number | null }>(
    'SELECT COUNT(*) n, MAX(watched_at) last FROM episode_state WHERE media_item_id = ?', [mediaItemId],
  );
  try {
    // Nothing watched any more: the show is no longer in progress.
    if (!left?.n) await db.runAsync('DELETE FROM up_next WHERE media_item_id = ?', [mediaItemId]);
    else await checkShow(db, token, { mediaItemId, watchedCount: left.n, lastWatchedAt: watched ? now : left.last }, now);
  } catch {
    // The tick is saved. Drop the stale answer so the list does not offer the
    // episode that was just watched; the next run asks again.
    await db.runAsync('DELETE FROM up_next WHERE media_item_id = ?', [mediaItemId]);
  }
  await publishWidget(db);
}

/** The Up next row's tick, and the widget's. */
export function markEpisodeWatched(db: SQLiteDatabase, entry: Pick<UpNextEntry, 'mediaItemId' | 'season' | 'episode'>): Promise<void> {
  return setEpisodesWatched(db, entry.mediaItemId, [{ season: entry.season, episode: entry.episode }], true);
}

/** Signing out: the next account must not see this one's shows. */
export async function clearUpNext(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM up_next');
  await publishWidget(db);
}
