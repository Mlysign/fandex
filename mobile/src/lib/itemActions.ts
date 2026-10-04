// What a person can do to a title from the app: rate it, wishlist it, take it
// out of the library.
//
// The order is always the same. Trakt first, when Trakt is the title's home;
// then the Worker; then the device's own copy. A step that fails stops the ones
// after it, so the device never shows a change the account does not have, and
// the account never holds a rating Trakt would undo at the next sync.
//
// The rules are the site's (src/app/api/library/route.ts), kept on purpose:
//   • rating a title puts it in the library as watched or played;
//   • the rating shown is the AVERAGE of the per-provider rows, so a new rating
//     is written to every row that already carries one, not only to its home;
//   • rating a title takes it off the wishlist;
//   • clearing a rating keeps the title in the library.
//
// Films and shows live on Trakt when this device is signed in to it. Games have
// no provider that takes a rating, so theirs live in Fandex alone (source
// "local"), which is the reason accounts exist.

import type { SQLiteDatabase } from 'expo-sqlite';
import { api, type ItemStateKey, type ItemStateUpsert, type MediaType, type StateWrite } from '~/lib/api';
import { applyLocalWrite } from '~/lib/stateSync';
import { loadTraktTokens, traktAccessToken, traktPost } from '~/lib/trakt';

export interface ActionTarget {
  id: string;
  type: MediaType;
  /** The provider ids the catalog holds for the title. */
  sources: { source: string; sourceId: string }[];
}

export interface HeldRow {
  source: string;
  relation: string;
  status: string | null;
  rating: number | null;
  review: string | null;
}

/**
 * Rows this app may write or delete. Steam's are Steam's: an owned game stays
 * owned whatever is tapped here, and its wishlist is edited on Steam.
 */
const isOurs = (source: string) => source !== 'steam';

/** How Trakt should find the title: its own id when the catalog holds one, else TMDB's. */
export function traktIds(target: ActionTarget): { trakt: number } | { tmdb: number } | null {
  const of = (source: string) => {
    const id = Number(target.sources.find((s) => s.source === source)?.sourceId);
    return Number.isInteger(id) && id > 0 ? id : null;
  };
  const trakt = of('trakt');
  if (trakt != null) return { trakt };
  const tmdb = of('tmdb');
  return tmdb != null ? { tmdb } : null;
}

const traktKey = (type: MediaType) => (type === 'movie' ? 'movies' : 'shows');

/** The rows a rating change writes. Pure, so the averaging rule has a test. */
export function ratingWrite(input: {
  target: ActionTarget;
  rows: HeldRow[];
  rating: number | null;
  /** Where a new library row goes: "trakt" when Trakt took the rating, else "local". */
  home: string;
  now: number;
}): StateWrite {
  const { target, rows, rating, home, now } = input;
  const library = rows.filter((r) => r.relation === 'library');
  const fallbackStatus = target.type === 'game' ? 'played' : 'watched';
  const row = (source: string, have: HeldRow | undefined): ItemStateUpsert => ({
    mediaItemId: target.id,
    source,
    relation: 'library',
    // An "owned" game that gets a rating has been played.
    status: have?.status && have.status !== 'owned' ? have.status : rating != null || !have ? fallbackStatus : have.status,
    rating,
    review: have?.review ?? null,
    reviewedAt: now,
  });

  if (rating === null) {
    // Clear every row that carries a score, and nothing else: the title stays.
    const upsert = library.filter((r) => r.rating != null && isOurs(r.source)).map((r) => row(r.source, r));
    return upsert.length ? { items: { upsert } } : {};
  }

  const sources = new Set<string>([home]);
  for (const r of library) if (r.rating != null && isOurs(r.source)) sources.add(r.source);
  const upsert = [...sources].map((s) => row(s, library.find((r) => r.source === s)));
  const del: ItemStateKey[] = rows
    .filter((r) => r.relation === 'wishlist' && isOurs(r.source))
    .map((r) => ({ mediaItemId: target.id, source: r.source, relation: 'wishlist' as const }));
  return { items: { upsert, ...(del.length ? { delete: del } : {}) } };
}

async function heldRows(db: SQLiteDatabase, id: string): Promise<HeldRow[]> {
  return db.getAllAsync<HeldRow>('SELECT source, relation, status, rating, review FROM item_state WHERE media_item_id = ?', [id]);
}

/** Films and shows go to Trakt when this device can reach it. */
async function traktFor(target: ActionTarget): Promise<{ token: string; ids: { trakt: number } | { tmdb: number } } | null> {
  if (target.type === 'game') return null;
  const ids = traktIds(target);
  if (!ids || !(await loadTraktTokens())) return null;
  return { token: await traktAccessToken(), ids };
}

async function commit(db: SQLiteDatabase, write: StateWrite): Promise<void> {
  const items = write.items;
  if (!items?.upsert?.length && !items?.delete?.length) return;
  await api.writeState(write);
  await applyLocalWrite(db, write);
}

/** Set a rating (1-10), or clear it with null. */
export async function rateItem(db: SQLiteDatabase, target: ActionTarget, rating: number | null): Promise<void> {
  const rows = await heldRows(db, target.id);
  const trakt = await traktFor(target);
  const key = traktKey(target.type);

  if (trakt) {
    if (rating === null) {
      await traktPost('/sync/ratings/remove', trakt.token, { [key]: [{ ids: trakt.ids }] });
    } else {
      await traktPost('/sync/ratings', trakt.token, { [key]: [{ rating, ids: trakt.ids }] });
      // Trakt keeps "rated" and "watched" apart, and the library is what was
      // watched. Only when Trakt does not already have it: a second post would
      // log a second play.
      if (!rows.some((r) => r.source === 'trakt' && r.relation === 'library')) {
        await traktPost('/sync/history', trakt.token, { [key]: [{ ids: trakt.ids }] });
      }
      if (rows.some((r) => r.source === 'trakt' && r.relation === 'wishlist')) {
        await traktPost('/sync/watchlist/remove', trakt.token, { [key]: [{ ids: trakt.ids }] });
      }
    }
  }
  await commit(db, ratingWrite({ target, rows, rating, home: trakt ? 'trakt' : 'local', now: Math.floor(Date.now() / 1000) }));
}

/** Put a title on the wishlist, or take it off. */
export async function setWishlist(db: SQLiteDatabase, target: ActionTarget, on: boolean): Promise<void> {
  const rows = await heldRows(db, target.id);
  const trakt = await traktFor(target);
  const key = traktKey(target.type);

  if (on) {
    if (trakt) await traktPost('/sync/watchlist', trakt.token, { [key]: [{ ids: trakt.ids }] });
    await commit(db, {
      items: {
        upsert: [{
          mediaItemId: target.id, source: trakt ? 'trakt' : 'local', relation: 'wishlist',
          status: null, rating: null, review: null, reviewedAt: null,
        }],
      },
    });
    return;
  }
  if (trakt && rows.some((r) => r.source === 'trakt' && r.relation === 'wishlist')) {
    await traktPost('/sync/watchlist/remove', trakt.token, { [key]: [{ ids: trakt.ids }] });
  }
  await commit(db, {
    items: {
      delete: rows.filter((r) => r.relation === 'wishlist' && isOurs(r.source))
        .map((r) => ({ mediaItemId: target.id, source: r.source, relation: 'wishlist' as const })),
    },
  });
}

/**
 * Take a title out of the library: its rating and its watched state, on Trakt
 * too. A game Steam says is owned stays owned.
 */
export async function removeFromLibrary(db: SQLiteDatabase, target: ActionTarget): Promise<void> {
  const rows = await heldRows(db, target.id);
  const trakt = await traktFor(target);
  const key = traktKey(target.type);

  if (trakt && rows.some((r) => r.source === 'trakt' && r.relation === 'library')) {
    // Both, or the next Trakt sync brings back whichever was left.
    await traktPost('/sync/ratings/remove', trakt.token, { [key]: [{ ids: trakt.ids }] });
    await traktPost('/sync/history/remove', trakt.token, { [key]: [{ ids: trakt.ids }] });
  }
  await commit(db, {
    items: {
      delete: rows.filter((r) => r.relation === 'library' && isOurs(r.source))
        .map((r) => ({ mediaItemId: target.id, source: r.source, relation: 'library' as const })),
    },
  });
}
