// Trakt, synced from the device.
//
// The device pulls what Trakt holds for the person, works out which catalog
// title each entry is, compares that with the account's Trakt rows, and sends
// the Worker the difference as explicit upserts and explicit deletes.
//
// ⚠️ THE PRUNE INVARIANT LIVES HERE NOW. A row is deleted because Trakt's answer
// no longer contains it, so the answer has to be whole and it has to be right:
//
//   • every Trakt list is read to its last page, and one failed page throws out
//     of the pull before anything is compared (trakt.ts → traktList);
//   • the comparison is against the Worker's rows, fetched fresh first, and a
//     failure there throws too;
//   • a title that could not be matched to the catalog THIS run (the Worker was
//     rate limited, or a provider was down) blocks every delete for the run;
//   • a run that would delete more than a tenth of what the account holds is
//     refused outright. A pull that came back short for a reason nobody
//     anticipated looks exactly like that.
//
// Only rows whose source is "trakt" are ever touched. A title Steam or TMDB
// also holds keeps those rows whatever Trakt says.

import type { SQLiteDatabase } from 'expo-sqlite';
import {
  api, ApiError,
  type EpisodeStateKey, type EpisodeStateUpsert, type ItemStateKey, type ItemStateUpsert, type ProviderRef,
} from '~/lib/api';
import { getMeta, setMeta } from '~/lib/db';
import { syncState } from '~/lib/stateSync';
import { traktAccessToken, traktList } from '~/lib/trakt';

const SYNCED_AT_KEY = 'trakt_synced_at';
/** Rows per write. The Worker takes 2,000; this leaves room. */
const WRITE_CHUNK = 1500;
/** Refs per lookup. Two refs per title (its Trakt id and its TMDB id). */
const LOOKUP_CHUNK = 2000;
/** New titles fetched per run. The Worker allows 30 fetches a minute; the rest wait for the next run. */
const MAX_RESOLVES_PER_RUN = 25;

type Kind = 'movie' | 'show';

export interface PulledTitle {
  type: Kind;
  traktId: number;
  tmdbId: number | null;
}
export interface PulledLibraryTitle extends PulledTitle {
  /** 1-10, or null when watched and not rated. */
  rating: number | null;
  /** Unix seconds: when it was rated, else when it was last watched. */
  reviewedAt: number | null;
}
export interface PulledEpisode { season: number; episode: number; watchedAt: number | null }

export interface TraktPull {
  library: PulledLibraryTitle[];
  wishlist: PulledTitle[];
  /** Keyed by the show's Trakt id. */
  episodesByShow: Map<number, PulledEpisode[]>;
}

/** The seven Trakt lists a sync reads, as Trakt answers them. */
export interface RawTraktPull {
  watchedMovies: unknown[];
  watchedShows: unknown[];
  ratedMovies: unknown[];
  ratedShows: unknown[];
  watchlistMovies: unknown[];
  watchlistShows: unknown[];
  episodeHistory: unknown[];
}

// Trakt's payloads are read field by field. A shape that is not what is
// expected yields nothing for that entry, never a guess.
type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

function unix(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

function titleOf(entry: unknown, kind: Kind): PulledTitle | null {
  const ids = obj(obj(obj(entry)[kind]).ids);
  const traktId = int(ids.trakt);
  return traktId == null ? null : { type: kind, traktId, tmdbId: int(ids.tmdb) };
}

/**
 * Turn Trakt's seven answers into what the account should hold.
 *
 * The same reading the site's adapter made (src/lib/sources/adapters/trakt.ts):
 * the library is what was WATCHED, a rating decorates a watched title and does
 * not put an unwatched one in the library, and the episode history is an event
 * log folded to one row per episode with the latest play. Season 0 (specials)
 * is left out, as it always was, so "next episode" never lands on a special.
 */
export function foldTraktPull(raw: RawTraktPull): TraktPull {
  const ratings = (list: unknown[], kind: Kind) => {
    const map = new Map<number, { rating: number | null; ratedAt: number | null }>();
    for (const r of list) {
      const t = titleOf(r, kind);
      if (t) map.set(t.traktId, { rating: int(obj(r).rating), ratedAt: unix(obj(r).rated_at) });
    }
    return map;
  };

  const library: PulledLibraryTitle[] = [];
  const watched = (list: unknown[], kind: Kind, rated: ReturnType<typeof ratings>) => {
    for (const e of list) {
      const t = titleOf(e, kind);
      if (!t) continue;
      const r = rated.get(t.traktId);
      library.push({ ...t, rating: r?.rating ?? null, reviewedAt: r?.ratedAt ?? unix(obj(e).last_watched_at) });
    }
  };
  watched(raw.watchedMovies, 'movie', ratings(raw.ratedMovies, 'movie'));
  watched(raw.watchedShows, 'show', ratings(raw.ratedShows, 'show'));

  const wishlist: PulledTitle[] = [];
  for (const e of raw.watchlistMovies) { const t = titleOf(e, 'movie'); if (t) wishlist.push(t); }
  for (const e of raw.watchlistShows) { const t = titleOf(e, 'show'); if (t) wishlist.push(t); }

  const byShow = new Map<number, Map<string, PulledEpisode>>();
  for (const h of raw.episodeHistory) {
    const showId = int(obj(obj(obj(h).show).ids).trakt);
    const ep = obj(obj(h).episode);
    const season = int(ep.season);
    const episode = int(ep.number);
    if (showId == null || season == null || season === 0 || episode == null) continue;
    const watchedAt = unix(obj(h).watched_at);
    const forShow = byShow.get(showId) ?? new Map<string, PulledEpisode>();
    const key = `${season}:${episode}`;
    const prev = forShow.get(key);
    if (!prev || (watchedAt ?? 0) > (prev.watchedAt ?? 0)) forShow.set(key, { season, episode, watchedAt });
    byShow.set(showId, forShow);
  }
  const episodesByShow = new Map<number, PulledEpisode[]>();
  for (const [showId, eps] of byShow) episodesByShow.set(showId, [...eps.values()]);

  return { library, wishlist, episodesByShow };
}

// ── The comparison ───────────────────────────────────────────────────────────

export interface LocalItemRow {
  mediaItemId: string;
  relation: string;
  status: string | null;
  rating: number | null;
  review: string | null;
  reviewedAt: number | null;
}
export interface LocalEpisodeRow extends EpisodeStateKey { watchedAt: number | null; sources: string[] }

export interface TraktPlan {
  itemUpserts: ItemStateUpsert[];
  itemDeletes: ItemStateKey[];
  episodeUpserts: EpisodeStateUpsert[];
  episodeDeletes: EpisodeStateKey[];
  /** Trakt entries with no catalog title: no TMDB id to fetch by, or TMDB has no such title. */
  unmatched: number;
}

/** A run that would delete too much. Nothing was written. */
export class TraktSyncRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TraktSyncRefused';
  }
}

const titleKey = (t: { type: string; traktId: number }) => `${t.type}:${t.traktId}`;
const sameNumber = (a: number | null, b: number | null) => (a == null || b == null ? a == b : Math.abs(a - b) < 0.001);

/**
 * What to send the Worker so the account's Trakt rows match the pull.
 *
 * `ids` maps a title (`movie:123`, by Trakt id) to its catalog item. `deferred`
 * is how many titles could not be matched for a reason that may pass (see the
 * header): any at all and nothing is deleted this run.
 */
export function planTraktSync(input: {
  pull: TraktPull;
  ids: Map<string, string>;
  deferred: number;
  localItems: LocalItemRow[];
  localEpisodes: LocalEpisodeRow[];
}): TraktPlan {
  const { pull, ids, deferred, localItems, localEpisodes } = input;
  let unmatched = 0;

  const wanted = new Map<string, ItemStateUpsert>();
  const want = (t: PulledTitle, relation: 'library' | 'wishlist', fields: Pick<ItemStateUpsert, 'status' | 'rating' | 'reviewedAt'>) => {
    const mediaItemId = ids.get(titleKey(t));
    if (!mediaItemId) { unmatched++; return; }
    const key = `${mediaItemId}|${relation}`;
    const prev = wanted.get(key);
    // Two Trakt entries can be one catalog title. Keep the one that carries a rating.
    if (prev && (prev.rating != null || fields.rating == null)) return;
    wanted.set(key, { mediaItemId, source: 'trakt', relation, review: null, ...fields });
  };
  for (const t of pull.library) want(t, 'library', { status: 'watched', rating: t.rating, reviewedAt: t.reviewedAt });
  for (const t of pull.wishlist) want(t, 'wishlist', { status: null, rating: null, reviewedAt: null });

  const local = new Map(localItems.map((r) => [`${r.mediaItemId}|${r.relation}`, r]));
  const itemUpserts: ItemStateUpsert[] = [];
  for (const [key, row] of wanted) {
    const have = local.get(key);
    if (have && have.status === row.status && sameNumber(have.rating, row.rating) && sameNumber(have.reviewedAt, row.reviewedAt)) continue;
    // A review is not something Trakt's lists carry. Whatever the row holds stays.
    itemUpserts.push({ ...row, review: have?.review ?? null });
  }
  const itemDeletes: ItemStateKey[] = [];
  for (const [key, row] of local) {
    if (wanted.has(key)) continue;
    if (row.relation !== 'library' && row.relation !== 'wishlist') continue;
    itemDeletes.push({ mediaItemId: row.mediaItemId, source: 'trakt', relation: row.relation });
  }

  // Episodes belong to a show in the library. A show Trakt lists as watched
  // with no history is authoritative too: it has no episodes.
  const wantedEpisodes = new Map<string, EpisodeStateKey & { watchedAt: number | null }>();
  for (const t of pull.library) {
    if (t.type !== 'show') continue;
    const mediaItemId = ids.get(titleKey(t));
    if (!mediaItemId) continue;
    for (const e of pull.episodesByShow.get(t.traktId) ?? []) {
      const key = `${mediaItemId}|${e.season}|${e.episode}`;
      const prev = wantedEpisodes.get(key);
      if (!prev || (e.watchedAt ?? 0) > (prev.watchedAt ?? 0)) {
        wantedEpisodes.set(key, { mediaItemId, season: e.season, episode: e.episode, watchedAt: e.watchedAt });
      }
    }
  }
  const localEps = new Map(localEpisodes.map((r) => [`${r.mediaItemId}|${r.season}|${r.episode}`, r]));
  const episodeUpserts: EpisodeStateUpsert[] = [];
  for (const [key, row] of wantedEpisodes) {
    const have = localEps.get(key);
    if (have && have.sources.includes('trakt') && sameNumber(have.watchedAt, row.watchedAt)) continue;
    episodeUpserts.push({ ...row, sources: [...new Set([...(have?.sources ?? []), 'trakt'])] });
  }
  const episodeDeletes: EpisodeStateKey[] = [];
  for (const [key, row] of localEps) {
    if (wantedEpisodes.has(key)) continue;
    // Only a row Trakt alone vouches for. One the person ticked in Fandex stays.
    if (row.sources.length !== 1 || row.sources[0] !== 'trakt') continue;
    episodeDeletes.push({ mediaItemId: row.mediaItemId, season: row.season, episode: row.episode });
  }

  if (deferred > 0) return { itemUpserts, itemDeletes: [], episodeUpserts, episodeDeletes: [], unmatched };

  const tooMany = (deletes: number, held: number, floor: number) => deletes > Math.max(floor, Math.floor(held / 10));
  if (tooMany(itemDeletes.length, localItems.length, 20)) {
    throw new TraktSyncRefused(
      `Trakt's answer is missing ${itemDeletes.length} of the ${localItems.length} titles this account holds from it. Nothing was changed.`,
    );
  }
  const traktOnlyEpisodes = localEpisodes.filter((r) => r.sources.length === 1 && r.sources[0] === 'trakt').length;
  if (tooMany(episodeDeletes.length, traktOnlyEpisodes, 100)) {
    throw new TraktSyncRefused(
      `Trakt's answer is missing ${episodeDeletes.length} of the ${traktOnlyEpisodes} episodes this account holds from it. Nothing was changed.`,
    );
  }
  return { itemUpserts, itemDeletes, episodeUpserts, episodeDeletes, unmatched };
}

// ── Running it ───────────────────────────────────────────────────────────────

export interface TraktSyncResult {
  /** True when the run only worked out what it would do. */
  dryRun: boolean;
  library: number;
  wishlist: number;
  episodes: number;
  itemsChanged: number;
  itemsRemoved: number;
  episodesChanged: number;
  episodesRemoved: number;
  /** Titles fetched into the catalog for the first time. */
  newTitles: number;
  /** Titles waiting for the next run because the Worker would not fetch more this minute. */
  deferred: number;
  unmatched: number;
}

async function pullTrakt(accessToken: string): Promise<TraktPull> {
  // One Promise.all on purpose: any of the seven failing rejects the lot, before
  // a single row is compared.
  const [watchedMovies, watchedShows, ratedMovies, ratedShows, watchlistMovies, watchlistShows, episodeHistory] = await Promise.all([
    traktList('/sync/watched/movies', accessToken),
    traktList('/sync/watched/shows?extended=noseasons', accessToken),
    traktList('/sync/ratings/movies', accessToken),
    traktList('/sync/ratings/shows', accessToken),
    traktList('/sync/watchlist/movies', accessToken),
    traktList('/sync/watchlist/shows', accessToken),
    traktList('/sync/history/episodes', accessToken),
  ]);
  return foldTraktPull({ watchedMovies, watchedShows, ratedMovies, ratedShows, watchlistMovies, watchlistShows, episodeHistory });
}

/**
 * Which catalog item each pulled title is. Held titles are answered by one
 * lookup per 1,000; a title nobody holds is fetched by its TMDB id, a few per
 * run. Throws when the lookup itself fails: an unknown mapping must not be
 * mistaken for "not in the catalog".
 */
async function matchTitles(titles: PulledTitle[]): Promise<{ ids: Map<string, string>; newTitles: number; deferred: number }> {
  const unique = new Map<string, PulledTitle>();
  for (const t of titles) if (!unique.has(titleKey(t))) unique.set(titleKey(t), t);

  const refs: ProviderRef[] = [];
  for (const t of unique.values()) {
    refs.push({ source: 'trakt', type: t.type, id: String(t.traktId) });
    if (t.tmdbId != null) refs.push({ source: 'tmdb', type: t.type, id: String(t.tmdbId) });
  }
  const held = new Map<string, string>();
  for (let i = 0; i < refs.length; i += LOOKUP_CHUNK) {
    const res = await api.lookup(refs.slice(i, i + LOOKUP_CHUNK));
    for (const f of res.found) held.set(`${f.source}:${f.type}:${f.id}`, f.mediaItemId);
  }

  const ids = new Map<string, string>();
  const toFetch: PulledTitle[] = [];
  for (const t of unique.values()) {
    const id = held.get(`trakt:${t.type}:${t.traktId}`) ?? (t.tmdbId != null ? held.get(`tmdb:${t.type}:${t.tmdbId}`) : undefined);
    if (id) ids.set(titleKey(t), id);
    else if (t.tmdbId != null) toFetch.push(t);
  }

  let newTitles = 0;
  let deferred = 0;
  for (let i = 0; i < toFetch.length; i++) {
    const t = toFetch[i];
    if (i >= MAX_RESOLVES_PER_RUN) { deferred = toFetch.length - i; break; }
    try {
      const res = await api.resolve('tmdb', t.type, String(t.tmdbId));
      ids.set(titleKey(t), res.id);
      if (res.created) newTitles++;
    } catch (e) {
      // TMDB has no such title: that is an answer, and the entry stays unmatched.
      if (e instanceof ApiError && e.code === 'not-found') continue;
      // Rate limited, out of budget, provider down, offline: all may pass. Stop
      // asking, and let the plan hold back its deletes.
      deferred = toFetch.length - i;
      break;
    }
  }
  return { ids, newTitles, deferred };
}

async function localTraktRows(db: SQLiteDatabase): Promise<{ items: LocalItemRow[]; episodes: LocalEpisodeRow[] }> {
  const items = await db.getAllAsync<{
    media_item_id: string; relation: string; status: string | null; rating: number | null; review: string | null; reviewed_at: number | null;
  }>("SELECT media_item_id, relation, status, rating, review, reviewed_at FROM item_state WHERE source = 'trakt'");
  const episodes = await db.getAllAsync<{ media_item_id: string; season: number; episode: number; watched_at: number | null; sources: string }>(
    'SELECT media_item_id, season, episode, watched_at, sources FROM episode_state',
  );
  return {
    items: items.map((r) => ({
      mediaItemId: r.media_item_id, relation: r.relation, status: r.status, rating: r.rating, review: r.review, reviewedAt: r.reviewed_at,
    })),
    episodes: episodes.map((r) => {
      let sources: string[] = [];
      try { const s: unknown = JSON.parse(r.sources); if (Array.isArray(s)) sources = s.filter((x): x is string => typeof x === 'string'); } catch { /* no sources */ }
      return { mediaItemId: r.media_item_id, season: r.season, episode: r.episode, watchedAt: r.watched_at, sources };
    }),
  };
}

async function writePlan(plan: TraktPlan): Promise<void> {
  const chunks = <T,>(rows: T[]): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < rows.length; i += WRITE_CHUNK) out.push(rows.slice(i, i + WRITE_CHUNK));
    return out;
  };
  // Upserts before deletes: if the run dies half way, the account has gained
  // rows it should have, and lost none it should keep.
  for (const upsert of chunks(plan.itemUpserts)) await api.writeState({ items: { upsert } });
  for (const upsert of chunks(plan.episodeUpserts)) await api.writeState({ episodes: { upsert } });
  for (const del of chunks(plan.itemDeletes)) await api.writeState({ items: { delete: del } });
  for (const del of chunks(plan.episodeDeletes)) await api.writeState({ episodes: { delete: del } });
}

/**
 * One Trakt sync. Throws TraktAuthError when Trakt needs a new sign-in,
 * TraktSyncRefused when the run would delete too much, and whatever the network
 * threw otherwise. In every one of those cases nothing was deleted.
 */
export async function syncTrakt(db: SQLiteDatabase, opts: { dryRun?: boolean } = {}): Promise<TraktSyncResult> {
  const accessToken = await traktAccessToken();
  // The comparison is against the Worker's rows, so the device's copy of them
  // has to be current first.
  await syncState(db);

  const pull = await pullTrakt(accessToken);
  const { ids, newTitles, deferred } = await matchTitles([...pull.library, ...pull.wishlist]);
  const local = await localTraktRows(db);
  const plan = planTraktSync({ pull, ids, deferred, localItems: local.items, localEpisodes: local.episodes });

  const result: TraktSyncResult = {
    dryRun: !!opts.dryRun,
    library: pull.library.length,
    wishlist: pull.wishlist.length,
    episodes: [...pull.episodesByShow.values()].reduce((n, e) => n + e.length, 0),
    itemsChanged: plan.itemUpserts.length,
    itemsRemoved: plan.itemDeletes.length,
    episodesChanged: plan.episodeUpserts.length,
    episodesRemoved: plan.episodeDeletes.length,
    newTitles,
    deferred,
    unmatched: plan.unmatched,
  };
  // Counts only. What a person watched does not belong in a device log.
  console.log('trakt_sync', JSON.stringify({ ...result, localItems: local.items.length, localEpisodes: local.episodes.length }));
  if (opts.dryRun) return result;

  const changes = result.itemsChanged + result.itemsRemoved + result.episodesChanged + result.episodesRemoved;
  if (changes > 0) {
    await writePlan(plan);
    await syncState(db, true);
  }
  await setMeta(db, SYNCED_AT_KEY, String(Date.now()));
  return result;
}

/** Unix ms of the last Trakt sync that finished, or null. */
export async function traktSyncedAt(db: SQLiteDatabase): Promise<number | null> {
  const raw = await getMeta(db, SYNCED_AT_KEY);
  return raw ? Number(raw) : null;
}

/** Signing out: the next account must not inherit this one's "synced a minute ago". */
export async function clearTraktSync(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM meta WHERE key = ?', [SYNCED_AT_KEY]);
}
