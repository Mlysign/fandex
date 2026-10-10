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
// again only when that count moves (you watched something) or the answer is old
// enough that a new episode may have aired. A run asks about a few shows, the
// most recently watched first, so the top of the list is right after one run
// and a long history fills in over several.
//
// The ORDER is the site's rule (src/lib/upNext.ts): a watch and a release are
// both dated events, and an entry sits at its latest one. Ticking an episode
// moves its show to the front; so does a new episode airing.

import type { SQLiteDatabase } from 'expo-sqlite';
import { api } from '~/lib/api';
import { applyLocalWrite } from '~/lib/stateSync';
import { traktAccessToken, traktGet, traktPost } from '~/lib/trakt';
import { publishWidget } from '~/lib/widget';

/** Shows asked about per run. Each is one request to Trakt. */
const RUN_BUDGET = 12;
const CONCURRENCY = 3;
const DAY = 86_400;
/** A show watched in the last four months may get a new episode any day. */
const ACTIVE_WINDOW = 120 * DAY;
const TTL_ACTIVE = DAY;
const TTL_DORMANT = 7 * DAY;

export interface UpNextEntry {
  mediaItemId: string;
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
}

/** Trakt's answer for one show, reduced to what the list needs. */
export interface Progress {
  season: number | null;
  episode: number | null;
  title: string | null;
  airedAt: number | null;
  lastWatchedAt: number | null;
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
 */
export function readProgress(answer: unknown, now: number): Progress {
  const a = obj(answer);
  const next = obj(a.next_episode);
  const season = int(next.season);
  const episode = int(next.number);
  const airedAt = unix(next.first_aired);
  const lastWatchedAt = unix(a.last_watched_at);
  if (season == null || episode == null || season === 0 || (airedAt != null && airedAt > now)) {
    return { season: null, episode: null, title: null, airedAt: null, lastWatchedAt };
  }
  return { season, episode, title: typeof next.title === 'string' ? next.title : null, airedAt, lastWatchedAt };
}

/** Which shows to ask Trakt about now, most recently watched first. Pure, so the staleness rule has a test. */
export function showsToCheck(shows: ShowWatch[], stored: StoredRow[], now: number, budget = RUN_BUDGET): ShowWatch[] {
  const have = new Map(stored.map((r) => [r.media_item_id, r]));
  const due = shows.filter((s) => {
    const row = have.get(s.mediaItemId);
    if (!row) return true;
    if (row.watched_count !== s.watchedCount) return true;
    const active = s.lastWatchedAt != null && now - s.lastWatchedAt < ACTIVE_WINDOW;
    return now - row.checked_at > (active ? TTL_ACTIVE : TTL_DORMANT);
  });
  due.sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0));
  return due.slice(0, budget);
}

async function watchedShows(db: SQLiteDatabase): Promise<ShowWatch[]> {
  const rows = await db.getAllAsync<{ media_item_id: string; n: number; last: number | null }>(
    `SELECT e.media_item_id, COUNT(*) n, MAX(e.watched_at) last
       FROM episode_state e
      WHERE e.media_item_id NOT IN (SELECT media_item_id FROM hidden_item)
      GROUP BY e.media_item_id`,
  );
  return rows.map((r) => ({ mediaItemId: r.media_item_id, watchedCount: r.n, lastWatchedAt: r.last }));
}

/** The show's Trakt id, out of the catalog copy. Null when the catalog holds no Trakt link for it. */
async function traktIdOf(db: SQLiteDatabase, mediaItemId: string): Promise<number | null> {
  const row = await db.getFirstAsync<{ vector: string }>('SELECT vector FROM catalog WHERE id = ?', [mediaItemId]);
  if (!row) return null;
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
    `INSERT OR REPLACE INTO up_next (media_item_id, season, episode, title, aired_at, last_watched_at, watched_count, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    // The later of what Trakt says and what this device recorded. Trakt's
    // `last_watched_at` lagged behind a tick made seconds earlier, and a show
    // ticked again and again stayed below one ticked before it.
    [show.mediaItemId, p.season, p.episode, p.title, p.airedAt,
     Math.max(p.lastWatchedAt ?? 0, show.lastWatchedAt ?? 0) || null, show.watchedCount, now],
  );
}

async function checkShow(db: SQLiteDatabase, token: string, show: ShowWatch, now: number): Promise<void> {
  const traktId = await traktIdOf(db, show.mediaItemId);
  // No Trakt link: there is nobody to ask. Stored as caught up so it is not
  // asked about on every run.
  if (traktId == null) {
    await store(db, show, { season: null, episode: null, title: null, airedAt: null, lastWatchedAt: show.lastWatchedAt }, now);
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
  const stored = await db.getAllAsync<StoredRow>('SELECT media_item_id, watched_count, checked_at FROM up_next');
  const due = showsToCheck(shows, stored, now, Number.MAX_SAFE_INTEGER);
  const batch = due.slice(0, RUN_BUDGET);
  if (!batch.length) return { checked: 0, waiting: 0 };

  const token = await traktAccessToken();
  let checked = 0;
  let firstError: unknown = null;
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    await Promise.all(batch.slice(i, i + CONCURRENCY).map(async (show) => {
      try { await checkShow(db, token, show, now); checked++; } catch (e) { firstError ??= e; }
    }));
  }
  if (checked === 0 && firstError) throw firstError;
  if (checked) await publishWidget(db);
  return { checked, waiting: due.length - checked };
}

export async function upNextList(db: SQLiteDatabase, limit = 30): Promise<UpNextEntry[]> {
  const rows = await db.getAllAsync<{
    media_item_id: string; title: string; poster_url: string | null;
    season: number; episode: number; episode_title: string | null; event_at: number | null;
    release_date: string | null; community_votes: number; community_score: number | null;
  }>(
    `SELECT u.media_item_id, c.title, c.poster_url, c.release_date, c.community_votes, c.community_score,
            u.season, u.episode, u.title AS episode_title,
            MAX(COALESCE(u.last_watched_at, 0), COALESCE(u.aired_at, 0), COALESCE((SELECT MAX(e.watched_at) FROM episode_state e WHERE e.media_item_id = u.media_item_id), 0)) AS event_at
       FROM up_next u JOIN catalog c ON c.id = u.media_item_id
      WHERE u.season IS NOT NULL
        AND u.media_item_id NOT IN (SELECT media_item_id FROM hidden_item)
      ORDER BY event_at DESC, c.title
      LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    mediaItemId: r.media_item_id, title: r.title, posterUrl: r.poster_url,
    season: r.season, episode: r.episode, episodeTitle: r.episode_title, eventAt: r.event_at || null,
    releaseDate: r.release_date, votes: r.community_votes ?? 0, communityScore: r.community_score,
  }));
}

/** How many shows have never been asked about: the list is still filling while this is above zero. */
export async function upNextPending(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) n FROM (SELECT DISTINCT media_item_id FROM episode_state)
      WHERE media_item_id NOT IN (SELECT media_item_id FROM up_next)`,
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
