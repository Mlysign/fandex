// The reference population: what "the catalog" looks like when it is not one
// person's library (2026-10-25, the score's data fix d, docs/fandex-score.md §3.7).
//
// The pull axis asks "of the titles carrying this facet, what share have you
// been through, against your usual share?", and until this the denominator was
// the pool, which is 68% the owner's films and 97% his shows: anime lifted him
// almost nothing because he had put most of the pool's anime there himself.
// This takes the most popular titles per medium from the providers, extracts
// their facets with the same code the Worker uses, and ships the counts as a
// static file next to the catalog files (/catalog/reference.json). The device
// scales them to its own catalog's size per medium and uses them as the
// denominator where the file knows a facet, its own counts otherwise
// (mobile/src/lib/fandexScore.ts, catalogCountsFrom).
//
//   node mobile/web/referencePopulation.mjs [--out file] [--cache dir]
//
// Run by the website build once a week (build.mjs keeps the last answer in
// dist/cache and asks again after seven days), and by hand for a measurement.
// Keys come from the repo's .env (TMDB_API_KEY, TWITCH_CLIENT_ID and
// TWITCH_CLIENT_SECRET), read into the environment here and never printed.
//
// Per medium, about 2,000 titles:
//   films, shows   TMDB discover sorted by vote count, 100 pages, then each
//                  title's detail (credits, keywords) through the same call the
//                  Worker stores from; the projected payload is cached per id,
//                  so a weekly run fetches only the titles new to the list
//   games          IGDB by total_rating_count, four pages of 500, the fields the
//                  Worker stores (no Steam tags: the voted tier is not in the
//                  denominator for games, which keeps it honest, not inflated)
//   books          Open Library's search sorted by reading-log activity, two
//                  pages of 1,000 works, the rows the Worker stores
//   board games    none (BoardGameGeek is behind a token that does not exist yet)
//
// A medium whose providers fail is LEFT OUT of the file, never written short:
// the device falls back to its own counts for that medium, which is today's
// behaviour. Fewer than MIN_TITLES titles for a medium counts as a failure too.
//
// What is shipped: per medium, the total, and every facet carried by at least
// MIN_COUNT of its titles as [kind, role, key, count]. A facet on one title in
// two thousand says nothing as a denominator and is most of the cast list.

import fs from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');

export const REFERENCE_VERSION = 1;
export const TITLES_PER_MEDIUM = 2000;
export const MIN_TITLES = 1200;
export const MIN_COUNT = 2;
/** How long the build keeps a reference before asking the providers again. */
export const REFERENCE_MAX_AGE_MS = 7 * 86_400_000;

/** The repo's .env into process.env, for the keys the provider modules read at load. Values are never logged. */
export function loadEnv() {
  let text = '';
  try { text = fs.readFileSync(path.join(repo, '.env'), 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

/** The lib, loaded after the env so TMDB_API_KEY and the Twitch pair are there when the modules read them. */
async function lib() {
  const { resolve } = await import(pathToFileURL(path.join(repo, 'scripts', 'alias-hooks.mjs')).href);
  registerHooks({ resolve });
  const [merge, facets, tmdb, igdb, project] = await Promise.all([
    import(pathToFileURL(path.join(repo, 'src', 'lib', 'merge.ts')).href),
    import(pathToFileURL(path.join(repo, 'src', 'lib', 'facets.ts')).href),
    import(pathToFileURL(path.join(repo, 'src', 'lib', 'sources', 'tmdb.ts')).href),
    import(pathToFileURL(path.join(repo, 'src', 'lib', 'sources', 'igdb.ts')).href),
    import(pathToFileURL(path.join(repo, 'src', 'lib', 'sources', 'project.ts')).href),
  ]);
  return { ...merge, ...facets, ...tmdb, ...igdb, ...project };
}

const OL_FIELDS = 'key,title,subtitle,author_name,first_publish_year,subject,publisher,series_name,language,want_to_read_count,already_read_count';
const OL_UA = 'Fandex/1.0 (https://fandex.org; hello@fandex.org)';

/**
 * Build the reference: `{ version, builtAt, media: { movie: { total, facets }, … } }`.
 * `cacheDir` keeps the projected TMDB payloads between runs. `log` gets a line per step.
 */
export async function buildReferencePopulation({ cacheDir, log = () => {} } = {}) {
  loadEnv();
  const L = await lib();
  fs.mkdirSync(cacheDir ?? path.join(here, 'dist', 'cache', 'reference'), { recursive: true });
  const cache = cacheDir ?? path.join(here, 'dist', 'cache', 'reference');
  const media = {};

  /** Facet counts over a list of `{ source, sourceId, type, data }` single-link titles. */
  const count = (type, titles) => {
    const byFacet = new Map();
    const labels = new Map();
    let total = 0;
    for (const t of titles) {
      const link = { id: '', mediaItemId: '', source: t.source, sourceId: String(t.sourceId), title: null, releaseDate: null, rawData: t.data, lastSynced: 0 };
      let facets;
      try { facets = L.extractFacets([link], type, L.mergeLinks([link], type)); } catch { continue; }
      total++;
      const seen = new Set();
      for (const f of facets) {
        const id = L.facetId(f);
        if (seen.has(id)) continue;
        seen.add(id);
        byFacet.set(id, (byFacet.get(id) ?? 0) + 1);
        if (!labels.has(id)) labels.set(id, f);
      }
    }
    const facets = [...byFacet].filter(([, n]) => n >= MIN_COUNT).sort((a, b) => b[1] - a[1])
      .map(([id, n]) => { const f = labels.get(id); return [f.kind, f.role ?? '', f.key, n]; });
    return { total, facets };
  };

  // ── Films and shows: TMDB ───────────────────────────────────────────────
  for (const [type, kind, fetchOne] of [['movie', 'movie', L.getTmdbMovie], ['show', 'tv', L.getTmdbShow]]) {
    try {
      const ids = [];
      for (let page = 1; ids.length < TITLES_PER_MEDIUM && page <= 500; page++) {
        const rows = await L.discoverTmdbMostVoted(kind, page);
        if (!rows.length) break;
        for (const r of rows) if (!ids.includes(r.id)) ids.push(r.id);
      }
      const file = path.join(cache, `tmdb-${kind}.json`);
      let kept = {};
      try { kept = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
      const want = ids.slice(0, TITLES_PER_MEDIUM);
      const missing = want.filter((id) => !kept[id]);
      let next = 0;
      let failed = 0;
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (next < missing.length) {
          const id = missing[next++];
          try {
            const d = await fetchOne(id);
            if (d?.id) kept[id] = L.projectRawData('tmdb', d); else failed++;
          } catch { failed++; }
        }
      }));
      // Only the titles on today's list are kept, so the cache cannot grow without bound.
      kept = Object.fromEntries(want.filter((id) => kept[id]).map((id) => [id, kept[id]]));
      fs.writeFileSync(file, JSON.stringify(kept));
      const titles = want.filter((id) => kept[id]).map((id) => ({ source: 'tmdb', sourceId: id, data: kept[id] }));
      if (titles.length < MIN_TITLES) throw new Error(`only ${titles.length} ${type}s`);
      media[type] = count(type, titles);
      log(`${type}: ${media[type].total} titles (${missing.length - failed} fetched, ${failed} failed), ${media[type].facets.length} facets on ${MIN_COUNT}+`);
    } catch (e) {
      log(`${type}: left out, ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── Games: IGDB ─────────────────────────────────────────────────────────
  try {
    if (!L.igdbConfigured()) throw new Error('IGDB is not configured');
    const now = Math.floor(Date.now() / 1000);
    const games = [];
    for (let offset = 0; offset < TITLES_PER_MEDIUM; offset += 500) {
      const rows = await L.discoverIgdbUpcoming(0, now, 500, offset, 'total_rating_count', 'full');
      if (!rows.length) break;
      games.push(...rows);
    }
    const titles = games.filter((g) => g?.id).map((g) => ({ source: 'igdb', sourceId: g.id, data: g }));
    if (titles.length < MIN_TITLES) throw new Error(`only ${titles.length} games`);
    media.game = count('game', titles);
    log(`game: ${media.game.total} titles, ${media.game.facets.length} facets on ${MIN_COUNT}+`);
  } catch (e) {
    log(`game: left out, ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── Books: Open Library ─────────────────────────────────────────────────
  try {
    const docs = [];
    for (let page = 1; docs.length < TITLES_PER_MEDIUM && page <= 2; page++) {
      const res = await fetch(`https://openlibrary.org/search.json?q=language%3Aeng&sort=readinglog&fields=${OL_FIELDS}&limit=1000&page=${page}`, { headers: { Accept: 'application/json', 'User-Agent': OL_UA } });
      if (!res.ok) throw new Error(`Open Library answered ${res.status}`);
      const j = await res.json();
      for (const d of j?.docs ?? []) if (d?.key && d?.title) docs.push(d);
    }
    const titles = docs.slice(0, TITLES_PER_MEDIUM).map((d) => ({ source: 'openlibrary', sourceId: d.key, data: d }));
    if (titles.length < MIN_TITLES) throw new Error(`only ${titles.length} books`);
    media.book = count('book', titles);
    log(`book: ${media.book.total} titles, ${media.book.facets.length} facets on ${MIN_COUNT}+`);
  } catch (e) {
    log(`book: left out, ${e instanceof Error ? e.message : String(e)}`);
  }

  return { version: REFERENCE_VERSION, builtAt: new Date().toISOString(), media };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const out = arg('out') ?? path.join(here, 'dist', 'cache', 'reference.json');
  const started = Date.now();
  const ref = await buildReferencePopulation({ cacheDir: arg('cache'), log: (m) => console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(3)}s] ${m}`) });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(ref));
  console.log(`${out}: ${Object.keys(ref.media).join(', ')} · ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}
