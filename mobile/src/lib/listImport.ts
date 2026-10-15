// The list import: a Letterboxd or IMDb export, read on the device.
//
// A port of the site's PL4 (src/lib/import, docs/letterboxd-import.md). The
// rules about the CSVs and about matching are the site's own modules, shared:
// parseText.ts reads the files, matchCore.ts runs the three matching passes.
// What differs is where it runs. The site uploaded the file to its server; here
// nothing leaves the device but the lookups and the rows that are kept.
//
//   analyzeImport   reads the file, matches every row against the device's
//                   catalog copy, and asks TMDB about the rest. Writes nothing,
//                   so it runs before anybody signs in, as the site's did.
//   applyImport     adds the titles the Worker does not hold, then writes the
//                   rows. With Trakt signed in on this device, the ratings and
//                   watchlist go to Trakt too (Nils, 2026-10-15: "always keep
//                   trakt and fandex accounts in sync").
//
// ⚠️ An import ADDS. A title the account already rated keeps its rating, and a
// title already in the library or on the wishlist is left as it is. A file is
// a snapshot from somewhere else; overwriting ratings from it would rewrite
// Trakt in bulk from a CSV.

import type { SQLiteDatabase } from 'expo-sqlite';
import { strFromU8, unzipSync } from 'fflate';
import { lookupQueue, matchAgainst, type MatchedRow } from '@/lib/import/matchCore';
import { ImportParseError, parseImportTexts, WANTED, type ParsedImport } from '@/lib/import/parseText';
import { api, ApiError, type ItemStateKey, type ItemStateUpsert, type MediaType, type ProviderRef } from '~/lib/api';
import { applyLocalWrite } from '~/lib/stateSync';
import { searchTmdbMovieId, tmdbFindImdb } from '~/lib/tmdb';
import { loadTraktTokens, traktAccessToken, traktPost } from '~/lib/trakt';

export { ImportParseError };

/** The site's per-import ceiling on provider lookups (matchCore.ts, PROVIDER_LOOKUP_BUDGET). */
const LOOKUP_CONCURRENCY = 4;
/** Bigger than any real export. A file past it is not one. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const WRITE_CHUNK = 1500;
const LOOKUP_CHUNK = 1000;
const TRAKT_CHUNK = 100;

// ── Reading ──────────────────────────────────────────────────────────────────

const isZip = (b: Uint8Array) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** The files a person chose: the ZIP as downloaded, or the CSVs out of it. Throws ImportParseError with a sentence to show. */
export function readImportFiles(files: { name: string; bytes: Uint8Array }[]): ParsedImport {
  const flat: { name: string; text: string }[] = [];
  for (const f of files) {
    if (f.bytes.length > MAX_FILE_BYTES) throw new ImportParseError(`${f.name} is too big to be an export.`);
    if (isZip(f.bytes)) {
      let entries: Record<string, Uint8Array>;
      try {
        // Only what is used. Reviews, diary, lists, likes and comments are in
        // there and are never decompressed, as on the site.
        entries = unzipSync(f.bytes, { filter: (file) => WANTED.some((w) => w.match.test(file.name)) });
      } catch {
        throw new ImportParseError('That ZIP could not be opened. Choose it exactly as it downloaded.');
      }
      for (const [name, data] of Object.entries(entries)) flat.push({ name, text: strFromU8(data) });
    } else {
      flat.push({ name: f.name, text: strFromU8(f.bytes) });
    }
  }
  return parseImportTexts(flat);
}

// ── Matching ─────────────────────────────────────────────────────────────────

export interface PlannedRow extends MatchedRow {
  /** Films or shows. Known for a catalog match, and for a TMDB match from what TMDB said. */
  type: MediaType | null;
}

export interface ImportAnalysis {
  source: ParsedImport['source'];
  filesRead: string[];
  rows: PlannedRow[];
  total: number;
  matchedLocally: number;
  matchedAtProvider: number;
  unmatched: number;
  /** Rows never looked up because the lookup budget ran out. */
  overBudget: number;
  ratings: number;
  wishlist: number;
}

/** Match every row: the device's catalog first, TMDB for the rest. Writes nothing. */
export async function analyzeImport(
  db: SQLiteDatabase,
  parsed: ParsedImport,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ImportAnalysis> {
  const catalog = await db.getAllAsync<{ id: string; type: MediaType; norm_title: string; year: number | null }>(
    "SELECT id, type, norm_title, year FROM catalog WHERE type IN ('movie', 'show')",
  );
  const byTitle = new Map<string, { id: string; year: number | null }[]>();
  const typeOf = new Map<string, MediaType>();
  for (const c of catalog) {
    typeOf.set(c.id, c.type);
    const list = byTitle.get(c.norm_title);
    if (list) list.push({ id: c.id, year: c.year }); else byTitle.set(c.norm_title, [{ id: c.id, year: c.year }]);
  }
  // The device holds no IMDb ids. An IMDb row the titles do not settle is asked
  // of TMDB by its id below, which is exact.
  const summary = matchAgainst(parsed.rows, new Map(), byTitle);
  const rows: PlannedRow[] = summary.rows.map((r) => ({ ...r, type: r.mediaItemId ? typeOf.get(r.mediaItemId) ?? null : null }));

  const queue = lookupQueue({ ...summary, rows });
  const found = new Map<MatchedRow, { type: MediaType; id: number }>();
  let next = 0;
  let done = 0;
  onProgress?.(0, queue.length);
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const row = queue[next++];
      if (!row || signal?.aborted) return;
      try {
        if (row.imdbId) {
          const hit = await tmdbFindImdb(row.imdbId, signal);
          if (hit) found.set(row, hit);
        } else {
          // Letterboxd is films only, as on the site.
          const id = await searchTmdbMovieId(row.title, row.year, signal);
          if (id != null) found.set(row, { type: 'movie', id });
        }
      } catch {
        // A failed lookup is a row reported as not found, never a failed import.
      }
      onProgress?.(++done, queue.length);
    }
  }));

  let matchedAtProvider = 0;
  const final = rows.map((r) => {
    const hit = found.get(r);
    if (!hit) return r;
    matchedAtProvider++;
    return { ...r, tmdbId: hit.id, type: hit.type, how: 'provider' as const };
  });
  const isMatched = (r: PlannedRow) => !!r.mediaItemId || r.tmdbId != null;
  return {
    source: parsed.source,
    filesRead: parsed.filesRead,
    rows: final,
    total: final.length,
    matchedLocally: summary.matchedLocally,
    matchedAtProvider,
    unmatched: final.filter((r) => !isMatched(r)).length,
    overBudget: Math.max(0, final.filter((r) => !r.mediaItemId).length - queue.length),
    ratings: final.filter((r) => isMatched(r) && r.relation === 'library').length,
    wishlist: final.filter((r) => isMatched(r) && r.relation === 'wishlist').length,
  };
}

// ── Writing ──────────────────────────────────────────────────────────────────

export interface HeldItemRow { mediaItemId: string; source: string; relation: string; rating: number | null }

export interface ImportRowToWrite {
  mediaItemId: string;
  type: MediaType;
  relation: 'library' | 'wishlist';
  rating: number | null;
  /** Unix seconds, or null. */
  ratedAt: number | null;
}

export interface ImportWritePlan {
  upsert: ItemStateUpsert[];
  del: ItemStateKey[];
  /** For Trakt, when this device is signed in to it. */
  trakt: {
    ratings: ImportRowToWrite[];
    /** Films rated here that Trakt does not hold as watched. A show is left out: Trakt marks every episode. */
    history: ImportRowToWrite[];
    watchlistAdd: ImportRowToWrite[];
    watchlistRemove: ImportRowToWrite[];
  };
  ratings: number;
  wishlist: number;
  /** Already rated on this account. Their rating was kept. */
  keptRated: number;
  /** Already in the library or on the wishlist. Left as they were. */
  alreadyListed: number;
}

/**
 * What an import writes, from the rows it matched and what the account holds.
 * Pure, so the rules have a test:
 *   • a title already rated keeps its rating;
 *   • a rating puts the title in the library as watched and takes it off the
 *     wishlist, as rating it in the app does (itemActions.ts);
 *   • a wishlist row is skipped for a title already in the library or on the
 *     wishlist, or rated in the same file;
 *   • with Trakt, a film's rows are Trakt's (the next sync finds them there);
 *     a show's rating is Fandex's own, because Trakt counts a show as watched
 *     only episode by episode, and the sync would take a "trakt" row away.
 */
export function planImportWrites(input: { rows: ImportRowToWrite[]; held: HeldItemRow[]; traktOn: boolean; now: number }): ImportWritePlan {
  const { rows, held, traktOn, now } = input;
  const rated = new Set(held.filter((h) => h.relation === 'library' && h.rating != null).map((h) => h.mediaItemId));
  const listed = new Set(held.filter((h) => h.relation === 'library' || h.relation === 'wishlist').map((h) => h.mediaItemId));
  const traktLibrary = new Set(held.filter((h) => h.relation === 'library' && h.source === 'trakt').map((h) => h.mediaItemId));
  const wishRows = (id: string) => held.filter((h) => h.mediaItemId === id && h.relation === 'wishlist' && h.source !== 'steam');

  const plan: ImportWritePlan = {
    upsert: [], del: [], trakt: { ratings: [], history: [], watchlistAdd: [], watchlistRemove: [] },
    ratings: 0, wishlist: 0, keptRated: 0, alreadyListed: 0,
  };
  const seen = new Set<string>();
  // Ratings first, so a title in both files counts as rated.
  const ordered = [...rows].sort((a, b) => (a.relation === b.relation ? 0 : a.relation === 'library' ? -1 : 1));
  for (const r of ordered) {
    if (seen.has(r.mediaItemId)) continue;
    seen.add(r.mediaItemId);
    const home = traktOn && (r.type === 'movie' || r.relation === 'wishlist') ? 'trakt' : 'local';

    if (r.relation === 'library') {
      if (rated.has(r.mediaItemId)) { plan.keptRated++; continue; }
      if (r.rating == null && listed.has(r.mediaItemId)) { plan.alreadyListed++; continue; }
      plan.upsert.push({
        mediaItemId: r.mediaItemId, source: home, relation: 'library',
        status: r.type === 'game' ? 'played' : 'watched', rating: r.rating, review: null, reviewedAt: r.ratedAt ?? now,
      });
      plan.ratings++;
      if (traktOn && r.type !== 'game') {
        if (r.rating != null) plan.trakt.ratings.push(r);
        if (r.type === 'movie' && !traktLibrary.has(r.mediaItemId)) plan.trakt.history.push(r);
      }
      if (r.rating != null) {
        for (const w of wishRows(r.mediaItemId)) {
          plan.del.push({ mediaItemId: r.mediaItemId, source: w.source, relation: 'wishlist' });
          if (w.source === 'trakt' && traktOn) plan.trakt.watchlistRemove.push(r);
        }
      }
    } else {
      if (listed.has(r.mediaItemId)) { plan.alreadyListed++; continue; }
      plan.upsert.push({ mediaItemId: r.mediaItemId, source: home, relation: 'wishlist', status: null, rating: null, review: null, reviewedAt: null });
      plan.wishlist++;
      if (home === 'trakt') plan.trakt.watchlistAdd.push(r);
    }
  }
  return plan;
}

export interface ImportResult {
  imported: number;
  ratings: number;
  wishlist: number;
  keptRated: number;
  alreadyListed: number;
  /** Titles new to the catalog, fetched by the Worker. */
  created: number;
  /** Matched at TMDB and still not added: the Worker would not fetch more today. */
  notAdded: number;
  sentToTrakt: boolean;
}

export type ImportPhase = 'finding' | 'adding' | 'trakt' | 'saving';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Write an analysed import into the signed-in account. */
export async function applyImport(
  db: SQLiteDatabase,
  analysis: ImportAnalysis,
  onProgress?: (phase: ImportPhase, done: number, total: number) => void,
): Promise<ImportResult> {
  const rows = analysis.rows.filter((r) => r.mediaItemId || r.tmdbId != null);

  // 1. Titles found at TMDB: the Worker may hold them already.
  const tmdbRows = rows.filter((r) => !r.mediaItemId && r.tmdbId != null && r.type);
  onProgress?.('finding', 0, tmdbRows.length);
  const refs: ProviderRef[] = [...new Map(tmdbRows.map((r) => [`${r.type}:${r.tmdbId}`, { source: 'tmdb', type: r.type!, id: String(r.tmdbId) }])).values()];
  const held = new Map<string, string>();
  for (let i = 0; i < refs.length; i += LOOKUP_CHUNK) {
    const res = await api.lookup(refs.slice(i, i + LOOKUP_CHUNK));
    for (const f of res.found) held.set(`${f.type}:${f.id}`, f.mediaItemId);
  }
  for (const r of tmdbRows) r.mediaItemId = held.get(`${r.type}:${r.tmdbId}`) ?? null;

  // 2. The rest the Worker fetches, one at a time: it allows 30 a minute.
  const toAdd = [...new Map(tmdbRows.filter((r) => !r.mediaItemId).map((r) => [`${r.type}:${r.tmdbId}`, r])).values()];
  let created = 0;
  let stopped = false;
  for (let i = 0; i < toAdd.length && !stopped; i++) {
    onProgress?.('adding', i, toAdd.length);
    const r = toAdd[i];
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await api.resolve('tmdb', r.type!, String(r.tmdbId));
        for (const same of tmdbRows) if (same.type === r.type && same.tmdbId === r.tmdbId) same.mediaItemId = res.id;
        if (res.created) created++;
        break;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'rate-limited' && attempt < 8) { await sleep(10_000); continue; }
        if (e instanceof ApiError && e.code === 'not-found') break;
        // Out of today's budget, or the provider is down: the rest wait for another day.
        if (e instanceof ApiError && (e.code === 'budget-exhausted' || e.status >= 500)) { stopped = true; break; }
        throw e;
      }
    }
  }
  onProgress?.('adding', toAdd.length, toAdd.length);

  // 3. What to write, against what the account holds.
  const heldRows = (await db.getAllAsync<{ media_item_id: string; source: string; relation: string; rating: number | null }>(
    'SELECT media_item_id, source, relation, rating FROM item_state',
  )).map((h) => ({ mediaItemId: h.media_item_id, source: h.source, relation: h.relation, rating: h.rating }));
  const toWrite: ImportRowToWrite[] = rows
    .filter((r) => r.mediaItemId && r.type)
    .map((r) => ({
      mediaItemId: r.mediaItemId!, type: r.type!, relation: r.relation, rating: r.rating,
      ratedAt: r.ratedAt ? Math.floor(Date.parse(r.ratedAt) / 1000) || null : null,
    }));
  const traktOn = !!(await loadTraktTokens());
  const plan = planImportWrites({ rows: toWrite, held: heldRows, traktOn, now: Math.floor(Date.now() / 1000) });

  // 4. Trakt first, as a single rating is: a row Fandex holds and Trakt does not would be undone by the next sync.
  if (traktOn) {
    const tmdbOf = await tmdbIds(db, [...plan.trakt.ratings, ...plan.trakt.history, ...plan.trakt.watchlistAdd, ...plan.trakt.watchlistRemove], rows);
    const token = await traktAccessToken();
    const send = async (endpoint: string, list: ImportRowToWrite[], extra: (r: ImportRowToWrite) => object) => {
      const usable = list.filter((r) => tmdbOf.has(r.mediaItemId));
      for (let i = 0; i < usable.length; i += TRAKT_CHUNK) {
        const body: Record<string, object[]> = {};
        for (const r of usable.slice(i, i + TRAKT_CHUNK)) {
          (body[r.type === 'movie' ? 'movies' : 'shows'] ??= []).push({ ids: { tmdb: tmdbOf.get(r.mediaItemId) }, ...extra(r) });
        }
        await traktPost(endpoint, token, body);
      }
    };
    const iso = (s: number | null) => (s ? new Date(s * 1000).toISOString() : undefined);
    const total = plan.trakt.ratings.length + plan.trakt.history.length + plan.trakt.watchlistAdd.length + plan.trakt.watchlistRemove.length;
    onProgress?.('trakt', 0, total);
    await send('/sync/ratings', plan.trakt.ratings, (r) => ({ rating: r.rating, rated_at: iso(r.ratedAt) }));
    await send('/sync/history', plan.trakt.history, (r) => ({ watched_at: iso(r.ratedAt) }));
    await send('/sync/watchlist', plan.trakt.watchlistAdd, () => ({}));
    await send('/sync/watchlist/remove', plan.trakt.watchlistRemove, () => ({}));
    onProgress?.('trakt', total, total);
  }

  // 5. The account, then the device's copy of it.
  const writes = plan.upsert.length + plan.del.length;
  onProgress?.('saving', 0, writes);
  for (let i = 0; i < plan.upsert.length; i += WRITE_CHUNK) {
    const write = { items: { upsert: plan.upsert.slice(i, i + WRITE_CHUNK) } };
    await api.writeState(write);
    await applyLocalWrite(db, write);
    onProgress?.('saving', Math.min(i + WRITE_CHUNK, plan.upsert.length), writes);
  }
  if (plan.del.length) {
    const write = { items: { delete: plan.del } };
    await api.writeState(write);
    await applyLocalWrite(db, write);
  }
  onProgress?.('saving', writes, writes);

  return {
    imported: plan.ratings + plan.wishlist,
    ratings: plan.ratings,
    wishlist: plan.wishlist,
    keptRated: plan.keptRated,
    alreadyListed: plan.alreadyListed,
    created,
    notAdded: tmdbRows.filter((r) => !r.mediaItemId).length,
    sentToTrakt: traktOn,
  };
}

/** Each title's TMDB id, from the import itself or from the catalog copy. */
async function tmdbIds(db: SQLiteDatabase, list: ImportRowToWrite[], rows: PlannedRow[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const r of rows) if (r.mediaItemId && r.tmdbId != null) out.set(r.mediaItemId, r.tmdbId);
  const missing = [...new Set(list.map((r) => r.mediaItemId).filter((id) => !out.has(id)))];
  for (let i = 0; i < missing.length; i += 200) {
    const chunk = missing.slice(i, i + 200);
    const got = await db.getAllAsync<{ id: string; vector: string }>(`SELECT id, vector FROM catalog WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
    for (const g of got) {
      try {
        const v = JSON.parse(g.vector) as { sources?: { source: string; sourceId: string }[] };
        const id = Number(v.sources?.find((s) => s.source === 'tmdb')?.sourceId);
        if (Number.isInteger(id) && id > 0) out.set(g.id, id);
      } catch { /* a title with an unreadable vector is left off Trakt */ }
    }
  }
  return out;
}
