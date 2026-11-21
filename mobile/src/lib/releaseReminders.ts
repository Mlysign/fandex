// Reminders on the day something comes out (Nils, 2026-11-21).
//
// Three kinds, each switched on or off in Settings, all only on the day itself
// (no "in a week", no "in two days"):
//  • EPISODES (added the same day): the next episode of a show you are caught
//    up on (Up next holds nothing aired left to watch), on TMDB's air date.
//    Its season's first episode is the season's reminder, not a second one.
//  • RELEASES: a title on your wishlist, any media type, on its release day in
//    your country (`catalog.release_date`, lib/localDates.ts).
//  • SEASONS: a new season of a show you are caught up on, the calendar's own
//    rule (lib/seasonPremieres.ts): every episode before it watched. A hidden
//    show is never one of them.
//
// On the device, scheduled ahead by the phone itself (lib/reminderScheduler.ts):
// no server, no push service, and what you watch never leaves the phone. The
// schedule is rebuilt after every catalog or rows sync, so a moved date moves
// its reminder. This file is the plan, pure where it can be, so it has tests.

import type { SQLiteDatabase } from 'expo-sqlite';
import { itemHref } from '~/lib/cardHref';
import { getMeta, setMeta } from '~/lib/db';
import { premiereRows } from '~/lib/seasonPremieres';

export const NOTIFY_RELEASES_KEY = 'notify_releases';
export const NOTIFY_SEASONS_KEY = 'notify_seasons';
export const NOTIFY_EPISODES_KEY = 'notify_episodes';

/** The hour of the day a reminder arrives, local time. */
export const REMINDER_HOUR = 9;
/** How far ahead reminders are set: past it, the next syncs set them. */
export const REMINDER_DAYS_AHEAD = 120;
/** At most this many set at once, the soonest first. Android allows an app 500 alarms. */
export const REMINDER_CAP = 60;
/** Every identifier this feature sets starts with one of these, so it never touches another notification. */
export const RELEASE_PREFIX = 'fandex-release:';
export const SEASON_PREFIX = 'fandex-season:';
export const EPISODE_PREFIX = 'fandex-episode:';

export interface ReminderPrefs { releases: boolean; seasons: boolean; episodes: boolean }
export type ReminderKind = keyof ReminderPrefs;
const PREF_KEY: Record<ReminderKind, string> = { releases: NOTIFY_RELEASES_KEY, seasons: NOTIFY_SEASONS_KEY, episodes: NOTIFY_EPISODES_KEY };
export const KIND_PREFIX: Record<ReminderKind, string> = { releases: RELEASE_PREFIX, seasons: SEASON_PREFIX, episodes: EPISODE_PREFIX };

/** Each on unless switched off: a reminder is what a wishlist is for. */
export async function readReminderPrefs(db: SQLiteDatabase): Promise<ReminderPrefs> {
  const [r, s, e] = await Promise.all([getMeta(db, NOTIFY_RELEASES_KEY), getMeta(db, NOTIFY_SEASONS_KEY), getMeta(db, NOTIFY_EPISODES_KEY)]);
  return { releases: r !== '0', seasons: s !== '0', episodes: e !== '0' };
}

export async function writeReminderPref(db: SQLiteDatabase, kind: ReminderKind, on: boolean): Promise<void> {
  await setMeta(db, PREF_KEY[kind], on ? '1' : '0');
}

export interface Reminder {
  /** Stable per title and day: a moved date is a new reminder, the old one is cancelled. */
  identifier: string;
  at: Date;
  title: string;
  body: string;
  /** Where a tap leads. */
  url: string;
}

export interface WishlistRelease { id: string; type: string; title: string; slug: string | null; release_date: string }
export interface SeasonStart { id: string; title: string; slug: string | null; season: number; release_date: string }
export interface EpisodeStart { id: string; title: string; slug: string | null; season: number; episode: number; release_date: string }

const TYPE_WORD: Record<string, string> = { movie: 'movie', show: 'show', game: 'game', book: 'book', boardgame: 'board game' };

/** A local day ("2026-11-21") as today's string. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The moment a reminder for `day` arrives: that day at REMINDER_HOUR, local time. Null for anything but a whole date. */
export function reminderTime(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), REMINDER_HOUR, 0, 0, 0) : null;
}

/**
 * What to set, soonest first: one reminder per title per day, only for days
 * still to come (today counts while it is before REMINDER_HOUR). A list that is
 * `undefined` was not read (a failed request), which `syncReminders` must keep
 * apart from "nothing due".
 */
export function planReminders(input: {
  releases: WishlistRelease[];
  seasons: SeasonStart[];
  episodes?: EpisodeStart[];
  now: Date;
}): Reminder[] {
  const out: Reminder[] = [];
  const horizon = input.now.getTime() + REMINDER_DAYS_AHEAD * 86_400_000;
  const due = (day: string) => {
    const at = reminderTime(day);
    return at && at.getTime() > input.now.getTime() && at.getTime() <= horizon ? at : null;
  };
  for (const r of input.releases) {
    const at = due(r.release_date);
    if (!at) continue;
    out.push({
      identifier: `${RELEASE_PREFIX}${r.id}:${r.release_date}`,
      at,
      title: `${r.title} is out today`,
      body: `The ${TYPE_WORD[r.type] ?? 'title'} on your wishlist.`,
      url: itemHref({ id: r.id, type: r.type, slug: r.slug }),
    });
  }
  for (const s of input.seasons) {
    const at = due(s.release_date);
    if (!at) continue;
    out.push({
      identifier: `${SEASON_PREFIX}${s.id}:${s.season}:${s.release_date}`,
      at,
      title: `${s.title}: season ${s.season} starts today`,
      body: 'A new season of a show you watch.',
      url: itemHref({ id: s.id, type: 'show', slug: s.slug }),
    });
  }
  // A season's first episode is the season's reminder, not a second one the same day.
  const seasonDay = new Set(input.seasons.map((s) => `${s.id}|${s.release_date}`));
  for (const e of input.episodes ?? []) {
    const at = due(e.release_date);
    if (!at || seasonDay.has(`${e.id}|${e.release_date}`)) continue;
    out.push({
      identifier: `${EPISODE_PREFIX}${e.id}:${e.season}:${e.episode}:${e.release_date}`,
      at,
      title: `New episode of ${e.title} today`,
      body: `Season ${e.season}, episode ${e.episode}.`,
      url: itemHref({ id: e.id, type: 'show', slug: e.slug }),
    });
  }
  const seen = new Set<string>();
  return out
    .filter((r) => (seen.has(r.identifier) ? false : (seen.add(r.identifier), true)))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, REMINDER_CAP);
}

/**
 * Wishlisted titles with a whole release date from today on, in your country.
 * Not one you hid, and not one already in your library (seen, played or read).
 */
export async function wishlistReleases(db: SQLiteDatabase, today: string): Promise<WishlistRelease[]> {
  return db.getAllAsync<WishlistRelease>(
    `SELECT DISTINCT c.id, c.type, c.title, c.slug, c.release_date
       FROM item_state s JOIN catalog c ON c.id = s.media_item_id
      WHERE s.relation = 'wishlist'
        AND c.release_date >= ? AND length(c.release_date) = 10
        AND c.id NOT IN (SELECT media_item_id FROM hidden_item)
        AND NOT EXISTS (SELECT 1 FROM item_state l WHERE l.media_item_id = c.id AND l.relation = 'library')
      ORDER BY c.release_date`,
    [today],
  );
}

/** The months a reminder can fall in: this one and the ones REMINDER_DAYS_AHEAD reaches. */
export function monthsAhead(now: Date): string[] {
  const out: string[] = [];
  const end = new Date(now.getTime() + REMINDER_DAYS_AHEAD * 86_400_000);
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  while (d <= end) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

/**
 * The shows you are caught up on: Up next holds nothing aired left to watch
 * (`season` null). A show you never started has no row, and a hidden one is
 * left out. With its TMDB id, which is what names the next episode.
 */
export async function caughtUpShows(db: SQLiteDatabase): Promise<{ id: string; title: string; slug: string | null; tmdbId: string }[]> {
  const rows = await db.getAllAsync<{ id: string; title: string; slug: string | null; sources: string | null }>(
    `SELECT c.id, c.title, c.slug, json_extract(c.vector, '$.sources') AS sources
       FROM up_next u JOIN catalog c ON c.id = u.media_item_id
      WHERE u.season IS NULL AND c.type = 'show'
        AND u.media_item_id NOT IN (SELECT media_item_id FROM hidden_item)`,
  );
  return rows.flatMap((r) => {
    try {
      const tmdb = (JSON.parse(r.sources ?? '[]') as { source: string; sourceId: string }[]).find((s) => s.source === 'tmdb');
      return tmdb ? [{ id: r.id, title: r.title, slug: r.slug, tmdbId: tmdb.sourceId }] : [];
    } catch {
      return [];
    }
  });
}

type NextToAir = (tmdbId: string) => Promise<{ season: number; episode: number; airDate: string | null } | null>;

/** TMDB's answer per show, kept six hours: the schedule is rebuilt after every sync, the next episode moves weekly. */
const nextKnown = new Map<string, { at: number; next: ReturnType<NextToAir> }>();
const NEXT_TTL_MS = 6 * 60 * 60 * 1000;

/** For tests. */
export function forgetNextEpisodes(): void {
  nextKnown.clear();
}

/**
 * The next episode due of each show you are caught up on (TMDB's
 * `next_episode_to_air`), from today on. A show TMDB could not be asked about
 * is in `failed`, so its reminder is kept rather than cancelled; when every
 * show failed (no connection) the whole answer throws.
 */
export async function episodeStarts(db: SQLiteDatabase, now: Date, ask: NextToAir): Promise<{ starts: EpisodeStart[]; failed: Set<string> }> {
  const today = localDay(now);
  const shows = await caughtUpShows(db);
  const starts: EpisodeStart[] = [];
  const failed = new Set<string>();
  // Four at a time: a polite pace for an app key, and quick enough for a few hundred shows.
  for (let i = 0; i < shows.length; i += 4) {
    await Promise.all(shows.slice(i, i + 4).map(async (show) => {
      const held = nextKnown.get(show.tmdbId);
      const fresh = held && Date.now() - held.at < NEXT_TTL_MS ? held.next : null;
      const next = fresh ?? ask(show.tmdbId);
      if (!fresh) {
        nextKnown.set(show.tmdbId, { at: Date.now(), next });
        next.catch(() => nextKnown.delete(show.tmdbId));
      }
      try {
        const n = await next;
        if (n && n.season > 0 && n.airDate && n.airDate >= today) {
          starts.push({ id: show.id, title: show.title, slug: show.slug, season: n.season, episode: n.episode, release_date: n.airDate });
        }
      } catch {
        failed.add(show.id);
      }
    }));
  }
  if (shows.length && failed.size === shows.length) throw new Error('TMDB answered for none of the shows');
  return { starts, failed };
}

/**
 * New seasons of the shows you are caught up on, from today on: the calendar's
 * rows (`premiereRows`, which leaves hidden shows out). Throws when the Worker
 * cannot be asked, so a failure never reads as "no seasons".
 */
export async function seasonStarts(db: SQLiteDatabase, now: Date): Promise<SeasonStart[]> {
  const today = localDay(now);
  const months = await Promise.all(monthsAhead(now).map((m) => premiereRows(db, m)));
  return months.flat()
    .filter((r) => typeof r.release_date === 'string' && r.release_date >= today)
    .map((r) => ({ id: r.id, title: r.title, slug: r.slug ?? null, season: r.season, release_date: r.release_date as string }));
}
