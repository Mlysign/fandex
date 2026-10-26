// Draw the score's baseline: ordinary titles, at random, per medium, from
// everything a provider knows above a vote floor (docs/fandex-score.md §3.7,
// 2026-10-26). The pull axis compares what a person picks against them.
//
//   node scripts/baseline-draw.mjs --draw 1 --out baseline.sql [--seed text]
//   npx wrangler d1 execute fandex --remote --file baseline.sql     (from worker/)
//   then, to start the walk: INSERT INTO kv (key, value) VALUES ('baseline_go', '1')
//
// It lists EVERY title above the floor first and samples from that list, so
// the draw is uniform: a niche tag turns up in the baseline about as often as
// it does among titles people have heard of. Not the most voted N: the owner's
// library reaches well past those, and against them a niche tag looks rarer
// than it is.
//
// The floors were picked so the population covers what the owner actually
// picks (measured 2026-10-26 on his library): TMDB films with 200+ votes cover
// 98% of his films, shows with 100+ cover 96%, IGDB games with a rating count
// of 10+ cover 82% of his games (the rest are obscure), Open Library works with
// 100+ reading-log entries cover 13 of his 14 books.
//
// Keys come from the repo's .env and are never printed. The output is SQL for
// `baseline_items` (migration 0008), one INSERT OR IGNORE per title, so a
// second run of the same draw adds nothing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const DRAW = Number(arg('draw', '1'));
const OUT = arg('out', 'baseline.sql');
const SEED = arg('seed', `fandex-baseline-${DRAW}`);

/** How many titles per medium, and the floor each is drawn above. */
export const BASELINE = {
  movie: { n: 2500, floor: 200 },
  show: { n: 1500, floor: 100 },
  game: { n: 2500, floor: 10 },
  book: { n: 1000, floor: 100 },
};

for (const line of fs.readFileSync(path.join(repo, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const started = Date.now();
const log = (m) => console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(3)}s] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function retry(fn, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= tries) throw e; await sleep(800 * 2 ** i); }
  }
}

// ── TMDB ────────────────────────────────────────────────────────────────────
const tmdbKey = process.env.TMDB_API_KEY;
if (!tmdbKey) throw new Error('TMDB_API_KEY is not in .env');
async function tmdb(p, q = {}) {
  return retry(async () => {
    const u = new URL(`https://api.themoviedb.org/3${p}`);
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    const bearer = tmdbKey.length > 40;
    if (!bearer) u.searchParams.set('api_key', tmdbKey);
    const r = await fetch(u, { headers: bearer ? { Authorization: `Bearer ${tmdbKey}` } : {} });
    if (r.status === 429) { await sleep(2000); throw new Error('TMDB 429'); }
    if (!r.ok) throw new Error(`TMDB ${r.status} ${p}`);
    return r.json();
  });
}

/** Every TMDB id of `kind` above the floor, year by year (a discover query stops at 500 pages). */
async function tmdbAll(kind, floor) {
  const yearKey = kind === 'movie' ? 'primary_release_year' : 'first_air_date_year';
  const ids = new Set();
  const thisYear = new Date().getUTCFullYear();
  for (let year = 1890; year <= thisYear + 1; year++) {
    const q = { 'vote_count.gte': String(floor), [yearKey]: String(year), sort_by: 'vote_count.desc', include_adult: 'false' };
    const first = await tmdb(`/discover/${kind}`, q);
    for (const r of first.results ?? []) ids.add(r.id);
    const pages = Math.min(500, first.total_pages ?? 1);
    let next = 2;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (next <= pages) {
        const page = next++;
        const j = await tmdb(`/discover/${kind}`, { ...q, page: String(page) });
        for (const r of j.results ?? []) ids.add(r.id);
      }
    }));
  }
  return [...ids];
}

// ── IGDB ────────────────────────────────────────────────────────────────────
async function igdbAll(floor) {
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) throw new Error('TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET are not in .env');
  const tok = await retry(() => fetch(`https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`, { method: 'POST' }).then((r) => r.json()));
  const ids = [];
  // Main games, remakes, remasters, expanded and standalone games: each a work
  // of its own. Ports and editions (version_parent) open their main game.
  for (let after = 0; ;) {
    const rows = await retry(async () => {
      const r = await fetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: { 'Client-ID': id, Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'text/plain' },
        body: `fields id; where total_rating_count >= ${floor} & version_parent = null & game_type = (0,4,8,9,10) & id > ${after}; sort id asc; limit 500;`,
      });
      if (!r.ok) throw new Error(`IGDB ${r.status}`);
      return r.json();
    });
    if (!rows.length) break;
    for (const g of rows) ids.push(g.id);
    after = rows.at(-1).id;
    await sleep(300);
  }
  return ids;
}

// ── Open Library ────────────────────────────────────────────────────────────
const OL_UA = 'Fandex/1.0 (https://fandex.org; hello@fandex.org)';
async function openLibraryAll(floor) {
  const keys = new Set();
  const q = encodeURIComponent(`readinglog_count:[${floor} TO *] language:eng`);
  for (let page = 1; page <= 40; page++) {
    const j = await retry(async () => {
      const r = await fetch(`https://openlibrary.org/search.json?q=${q}&fields=key&sort=readinglog&limit=1000&page=${page}`, { headers: { Accept: 'application/json', 'User-Agent': OL_UA } });
      if (!r.ok) throw new Error(`Open Library ${r.status}`);
      return r.json();
    });
    const docs = j.docs ?? [];
    for (const d of docs) { const k = /^\/works\/(OL\d+W)$/.exec(d.key ?? '')?.[1]; if (k) keys.add(k); }
    if (docs.length < 1000) break;
    await sleep(1000);
  }
  return [...keys];
}

// ── The draw ────────────────────────────────────────────────────────────────
/** A seeded generator (mulberry32 over a string hash), so a draw can be made again. */
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function sample(list, n, random) {
  const a = [...list].sort((x, y) => String(x).localeCompare(String(y)));
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, Math.min(n, a.length));
}

const random = rng(SEED);
const lists = {};
log('films: listing every TMDB film with 200+ votes');
lists.movie = { source: 'tmdb', ids: await tmdbAll('movie', BASELINE.movie.floor) };
log(`films: ${lists.movie.ids.length}`);
lists.show = { source: 'tmdb', ids: await tmdbAll('tv', BASELINE.show.floor) };
log(`shows: ${lists.show.ids.length}`);
lists.game = { source: 'igdb', ids: await igdbAll(BASELINE.game.floor) };
log(`games: ${lists.game.ids.length}`);
lists.book = { source: 'openlibrary', ids: await openLibraryAll(BASELINE.book.floor) };
log(`books: ${lists.book.ids.length}`);

const lines = [`-- The baseline, draw ${DRAW}, seed "${SEED}", ${new Date().toISOString()} (scripts/baseline-draw.mjs).`];
const summary = {};
for (const [type, { source, ids }] of Object.entries(lists)) {
  const drawn = sample(ids, BASELINE[type].n, random);
  summary[type] = { population: ids.length, drawn: drawn.length, floor: BASELINE[type].floor };
  for (const id of drawn) lines.push(`INSERT OR IGNORE INTO baseline_items (source, source_id, media_type, draw) VALUES ('${source}', '${String(id).replace(/'/g, "''")}', '${type}', ${DRAW});`);
}
lines.push(`INSERT INTO kv (key, value) VALUES ('baseline_population_${DRAW}', '${JSON.stringify(summary)}') ON CONFLICT(key) DO UPDATE SET value = excluded.value;`);
fs.writeFileSync(OUT, lines.join('\n') + '\n');
log(`wrote ${lines.length - 2} titles to ${OUT}: ${JSON.stringify(summary)}`);
