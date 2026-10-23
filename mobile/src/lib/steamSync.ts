// Steam, synced from the device (2026-10-23).
//
// The Worker reads the account's Steam library and wishlist with its own key
// (worker/src/steam.ts: a Steam Web API key may never ship in the app). The
// device does the rest, as it does for Trakt (lib/traktSync.ts): it finds the
// catalog title for each app id, compares that with the account's Steam rows,
// and sends the difference as explicit upserts and deletes.
//
// ⚠️ THE PRUNE INVARIANT, the same as Trakt's:
//
//   • the Worker answers whole or with an error, and a private profile is an
//     error, never an empty library;
//   • a Steam app that could not be matched THIS run (rate limited, a provider
//     down) blocks every delete for the run;
//   • a run that would delete more than a tenth of the account's Steam rows is
//     refused outright;
//   • a row edited on this device while the run was under way is left alone.
//
// Steam has no ratings and no write API: the rows say owned or played, and when
// the game was last played. A rating made in Fandex lives on a "local" row and
// is never touched here. Only rows whose source is "steam" are.

import type { SQLiteDatabase } from 'expo-sqlite';
import { api, ApiError, type ItemStateKey, type ItemStateUpsert, type ProviderRef, type SteamLibrary } from '~/lib/api';
import { getMeta, setMeta } from '~/lib/db';
import { StaleSync, syncState } from '~/lib/stateSync';
import { TraktSyncRefused, withoutRowsChangedDuringRun, type LocalItemRow } from '~/lib/traktSync';

const SYNCED_AT_KEY = 'steam_synced_at';
const WRITE_CHUNK = 1500;
const LOOKUP_CHUNK = 2000;
/** Steam apps fetched into the catalog per run. Each is an IGDB lookup on the Worker; the rest wait for the next run. */
const MAX_RESOLVES_PER_RUN = 25;

export interface SteamSyncResult {
  library: number;
  wishlist: number;
  itemsChanged: number;
  itemsRemoved: number;
  /** Titles fetched into the catalog for the first time. */
  newTitles: number;
  /** Apps waiting for the next run because the Worker would not resolve more now. */
  deferred: number;
  /** Apps IGDB has no game for: software, soundtracks, delisted store items. */
  unmatched: number;
}

export interface SteamPlan {
  itemUpserts: ItemStateUpsert[];
  itemDeletes: ItemStateKey[];
  unmatched: number;
}

const appKey = (appid: number) => String(appid);
const same = (a: number | null, b: number | null) => (a ?? null) === (b ?? null);

/**
 * What to send the Worker so the account's Steam rows match the pull. Pure.
 * `ids` maps an app id to its catalog item; `deferred` above zero means some
 * app could not be matched for a reason that may pass, and nothing is deleted.
 */
export function planSteamSync(input: {
  pull: SteamLibrary;
  ids: Map<string, string>;
  deferred: number;
  localItems: LocalItemRow[];
}): SteamPlan {
  const { pull, ids, deferred, localItems } = input;
  let unmatched = 0;
  const wanted = new Map<string, ItemStateUpsert>();
  for (const g of pull.library) {
    const mediaItemId = ids.get(appKey(g.appid));
    if (!mediaItemId) { unmatched++; continue; }
    const key = `${mediaItemId}|library`;
    const row: ItemStateUpsert = {
      mediaItemId, source: 'steam', relation: 'library',
      status: g.playtime > 0 ? 'played' : 'owned', rating: null, review: null, reviewedAt: g.lastPlayed,
    };
    // Two apps can be one catalog title (a game and its port). Keep the one played.
    const prev = wanted.get(key);
    if (prev && prev.status === 'played' && row.status !== 'played') continue;
    wanted.set(key, row);
  }
  for (const g of pull.wishlist) {
    const mediaItemId = ids.get(appKey(g.appid));
    if (!mediaItemId) { unmatched++; continue; }
    const key = `${mediaItemId}|wishlist`;
    if (!wanted.has(key)) {
      wanted.set(key, {
        mediaItemId, source: 'steam', relation: 'wishlist', status: null, rating: null, review: null, reviewedAt: null,
        addedAt: g.addedAt,
      });
    }
  }

  const local = new Map(localItems.map((r) => [`${r.mediaItemId}|${r.relation}`, r]));
  const itemUpserts: ItemStateUpsert[] = [];
  for (const [key, row] of wanted) {
    const have = local.get(key);
    if (have && have.status === row.status && same(have.reviewedAt, row.reviewedAt)) continue;
    // Whatever a row already carries that Steam does not (a rating, a review) stays.
    itemUpserts.push({ ...row, rating: have?.rating ?? null, review: have?.review ?? null });
  }
  const itemDeletes: ItemStateKey[] = [];
  for (const [key, row] of local) {
    if (wanted.has(key)) continue;
    if (row.relation !== 'library' && row.relation !== 'wishlist') continue;
    itemDeletes.push({ mediaItemId: row.mediaItemId, source: 'steam', relation: row.relation });
  }

  if (deferred > 0) return { itemUpserts, itemDeletes: [], unmatched };
  if (itemDeletes.length > Math.max(20, Math.floor(localItems.length / 10))) {
    throw new TraktSyncRefused(
      `Steam's answer is missing ${itemDeletes.length} of the ${localItems.length} titles this account holds from it. Nothing was changed.`,
    );
  }
  return { itemUpserts, itemDeletes, unmatched };
}

/** Which catalog title each app is: one lookup per 2,000, then a few resolves per run. */
async function matchApps(appids: number[]): Promise<{ ids: Map<string, string>; newTitles: number; deferred: number }> {
  const unique = [...new Set(appids)];
  const refs: ProviderRef[] = unique.map((a) => ({ source: 'steam', type: 'game', id: appKey(a) }));
  const ids = new Map<string, string>();
  for (let i = 0; i < refs.length; i += LOOKUP_CHUNK) {
    const res = await api.lookup(refs.slice(i, i + LOOKUP_CHUNK));
    for (const f of res.found) ids.set(f.id, f.mediaItemId);
  }
  const toFetch = unique.filter((a) => !ids.has(appKey(a)));
  let newTitles = 0;
  let deferred = 0;
  for (let i = 0; i < toFetch.length; i++) {
    if (i >= MAX_RESOLVES_PER_RUN) { deferred = toFetch.length - i; break; }
    try {
      const res = await api.resolve('steam', 'game', appKey(toFetch[i]));
      ids.set(appKey(toFetch[i]), res.id);
      if (res.created) newTitles++;
    } catch (e) {
      // IGDB has no game for this app: an answer, and it stays unmatched.
      if (e instanceof ApiError && e.code === 'not-found') continue;
      // Rate limited, out of budget, a provider down, offline: all may pass.
      deferred = toFetch.length - i;
      break;
    }
  }
  return { ids, newTitles, deferred };
}

async function localSteamRows(db: SQLiteDatabase): Promise<LocalItemRow[]> {
  const rows = await db.getAllAsync<{
    media_item_id: string; relation: string; status: string | null; rating: number | null; review: string | null; reviewed_at: number | null;
  }>("SELECT media_item_id, relation, status, rating, review, reviewed_at FROM item_state WHERE source = 'steam'");
  return rows.map((r) => ({
    mediaItemId: r.media_item_id, relation: r.relation, status: r.status, rating: r.rating, review: r.review, reviewedAt: r.reviewed_at,
  }));
}

/**
 * One Steam sync. Throws ApiError (a private profile is `steam-private`),
 * TraktSyncRefused when the run would delete too much, StaleSync when the
 * session changed under it. In every one of those cases nothing was deleted.
 */
export async function syncSteam(db: SQLiteDatabase, opts: { stillCurrent?: () => boolean } = {}): Promise<SteamSyncResult> {
  const current = () => { if (opts.stillCurrent && !opts.stillCurrent()) throw new StaleSync(); };
  // The comparison is against the Worker's rows, so the device's copy of them has to be current first.
  await syncState(db, false, opts.stillCurrent);
  const before = await localSteamRows(db);
  const pull = await api.steamLibrary();
  const { ids, newTitles, deferred } = await matchApps([...pull.library, ...pull.wishlist].map((g) => g.appid));
  const after = await localSteamRows(db);
  const plan = planSteamSync({ pull, ids, deferred, localItems: after });
  const { itemUpserts, itemDeletes } = withoutRowsChangedDuringRun(
    { itemUpserts: plan.itemUpserts, itemDeletes: plan.itemDeletes, episodeUpserts: [], episodeDeletes: [], unmatched: plan.unmatched },
    { items: before, episodes: [] }, { items: after, episodes: [] },
  );

  // Upserts before deletes: if the run dies half way, the account has gained
  // rows it should have, and lost none it should keep.
  for (let i = 0; i < itemUpserts.length; i += WRITE_CHUNK) { current(); await api.writeState({ items: { upsert: itemUpserts.slice(i, i + WRITE_CHUNK) } }); }
  for (let i = 0; i < itemDeletes.length; i += WRITE_CHUNK) { current(); await api.writeState({ items: { delete: itemDeletes.slice(i, i + WRITE_CHUNK) } }); }
  if (itemUpserts.length || itemDeletes.length) await syncState(db, false, opts.stillCurrent);
  current();
  await setMeta(db, SYNCED_AT_KEY, String(Date.now()));
  const result: SteamSyncResult = {
    library: pull.library.length, wishlist: pull.wishlist.length,
    itemsChanged: itemUpserts.length, itemsRemoved: itemDeletes.length, newTitles, deferred, unmatched: plan.unmatched,
  };
  // Counts only, as for Trakt: what a person plays does not belong in a device log.
  console.log('steam_sync', JSON.stringify(result));
  return result;
}

/** Unix ms of the last Steam sync that finished, or null. */
export async function steamSyncedAt(db: SQLiteDatabase): Promise<number | null> {
  const raw = await getMeta(db, SYNCED_AT_KEY);
  return raw ? Number(raw) : null;
}

/** Signing out, or disconnecting Steam: the next account must not inherit "synced a minute ago". */
export async function clearSteamSync(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM meta WHERE key = ?', [SYNCED_AT_KEY]);
}
