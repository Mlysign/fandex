// The Fandex Score's backtest: how close the score as the app computes it
// comes to a real library's ratings, measured the way docs/fandex-score.md §11
// says every change must be measured. Nothing ships to the score without
// this moving the right way, per medium.
//
// Since 2026-10-27 the score is a predicted rating times ten, so the first
// measure is the rating one: for every rated title, scored with its own
// rating left out (exact in the app's maths), how far the score ÷ 10 sits
// from what the owner gave, against the floor of guessing their average for
// the medium. Then the ladder (what each band of the score meant), the bands
// (what a green badge earned), and pull's own bar: whether what they
// wishlisted ranks above what they never touched, by the pull axis.
//
// It loads the app's own module (mobile/src/lib/fandexScore.ts) under plain
// Node through scripts/alias-hooks.mjs, so the numbers are the app's numbers.
//
// Inputs, all files, nothing fetched:
//   --state     a user's user_item_state rows as `wrangler d1 execute --json`
//               writes them: SELECT media_item_id AS id, relation, status,
//               rating, source FROM user_item_state WHERE user_id = '…'
//   --catalog   a folder of the website's /catalog/p*.json pages (the pool
//               with facets), or a single JSON file of the same shape
//   --taxonomy  /v1/taxonomy as the Worker answers it (curl it to a file)
//   --baseline  the pull axis's baseline (§3.7): GET /v1/catalog/baseline saved
//               to a file (its ids are looked up in --catalog), or a JSON array of
//               {id, type, facets}. Without it there is no pull axis, as on a
//               device without the list. With it, "untouched" in the wishlist bar
//               is the baseline titles you have not touched: ordinary titles,
//               where without it they were the pool's, mostly pulled in by your
//               own library.
//   --strip     facets the baseline cannot carry, taken off both sides: tags of
//               these tiers and people on these media, e.g. "voted,game:person"
//               for a baseline fetched without Steam's tags and Wikidata's people
//   --set k=v,… override scoring config values (numbers), e.g. priorStrength=2
//   --fit-gains also print the two gains (`mappingConstantUp`, `Down`) the
//               current weights imply: the least-squares fit of rating − medium
//               average on the raw sum, up and down, times ten. Set them in
//               /dev/scoring after a weight change.
//
// node scripts/score-backtest.mjs --state nils.json --catalog ./catalog --taxonomy taxonomy.json
//
// ⚠️ The state export is one person's library. Keep it out of the repo.

import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const repo = path.dirname(here);
const { resolve } = await import(pathToFileURL(path.join(repo, 'scripts/alias-hooks.mjs')));
registerHooks({ resolve });
const score = await import(pathToFileURL(path.join(repo, 'mobile/src/lib/fandexScore.ts')));
const { prepareTaxonomy, buildProfile, buildPullModel, computeFandexScore, WISHLIST_WEIGHT } = score;

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : [])).filter((p) => p.length));
for (const need of ['state', 'catalog', 'taxonomy']) if (!args[need]) { console.error(`--${need} is required`); process.exit(2); }

// ── Load ───────────────────────────────────────────────────────────────────
const catalog = new Map();
const byProvider = new Map();
const catalogFiles = statSync(args.catalog).isDirectory() ? readdirSync(args.catalog).filter((f) => f.endsWith('.json')).map((f) => path.join(args.catalog, f)) : [args.catalog];
for (const file of catalogFiles) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  // A page of items, or a plain array; the folder's index.json is neither.
  const items = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : null;
  if (!items) continue;
  for (const it of items) {
    catalog.set(it.vector.id, { id: it.vector.id, type: it.vector.type, title: it.vector.title, year: it.vector.year, facets: it.facets });
    // "tmdb:603" and a medium → the pool's id (TMDB numbers films and shows apart), so a baseline given as provider ids finds a title the pool already holds.
    for (const s of it.vector.sources ?? []) byProvider.set(`${s.source}:${s.sourceId}:${it.vector.type}`, it.vector.id);
  }
}
const taxJson = JSON.parse(readFileSync(args.taxonomy, 'utf8'));
// --set priorStrength=2,mappingConstantUp=1.2: numbers over the stored config, for a measurement.
const overrides = Object.fromEntries(String(args.set === true ? '' : args.set ?? '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; }));
const withConfig = (extra = {}) => prepareTaxonomy({ ...taxJson, scoring: { ...(taxJson.scoring ?? { version: 0 }), config: { ...(taxJson.scoring?.config ?? {}), ...overrides, ...extra } } });
const tax = withConfig();
// --strip voted,game:person: facets the baseline cannot carry, off both sides.
const strips = String(args.strip === true ? '' : args.strip ?? '').split(',').filter(Boolean);
const stripped = (facets, type) => facets.filter((f) => !strips.some((s) => (s.includes(':') ? s === `${type}:${f.kind}` : f.kind === 'tag' && f.tier === s)));
for (const c of catalog.values()) c.facets = stripped(c.facets, c.type);
const stateJson = JSON.parse(readFileSync(args.state, 'utf8'));
const state = Array.isArray(stateJson) && stateJson[0]?.results ? stateJson[0].results : stateJson;

const ratingRows = new Map(); const held = new Set(); const wishlist = new Set();
for (const r of state) {
  if (r.relation === 'ignored' || !catalog.has(r.id)) continue;
  if (r.relation === 'wishlist') wishlist.add(r.id); else held.add(r.id);
  if (r.rating != null && r.rating > 0) { const a = ratingRows.get(r.id) ?? []; a.push(r.rating); ratingRows.set(r.id, a); }
}
for (const id of held) wishlist.delete(id);
const rated = [...ratingRows].map(([id, rs]) => ({ id, type: catalog.get(id).type, rating: Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 10) / 10, facets: catalog.get(id).facets }));
const ratedIds = new Set(rated.map((r) => r.id));
const consumed = [...held].map((id) => ({ id, type: catalog.get(id).type, facets: catalog.get(id).facets, weight: 1 }));
// The wishlist is HELD OUT of the profile here, so it can be the test; the app counts it at WISHLIST_WEIGHT.
let baselineTitles = [];
if (args.baseline) {
  const b = JSON.parse(readFileSync(args.baseline, 'utf8'));
  // A title the pool already holds is scored as the pool's (with its Steam tags and the like); the rest from their own facets.
  baselineTitles = Array.isArray(b)
    ? b.map((t) => { const held = catalog.get(byProvider.get(`${t.id}:${t.type}`) ?? t.id); return held ? { id: held.id, type: held.type, facets: held.facets } : { id: t.id, type: t.type, facets: stripped(t.facets, t.type), fresh: true }; })
    : (b.items ?? []).filter(([id]) => catalog.has(id)).map(([id, , added]) => { const c = catalog.get(id); return { id: c.id, type: c.type, facets: c.facets, ...(added === 1 ? { fresh: true } : {}) }; });
}
const fitStarted = Date.now();
const pull = baselineTitles.length ? buildPullModel(consumed, baselineTitles, tax) : null;
const fitMs = Date.now() - fitStarted;
const profile = buildProfile(rated, tax, { consumed, pull });
const baselineIds = new Set(baselineTitles.map((t) => t.id));
// A baseline title the catalog does not hold is scored from its own facets.
for (const t of baselineTitles) if (!catalog.has(t.id)) catalog.set(t.id, { id: t.id, type: t.type, title: t.id, facets: t.facets });
const cfg = tax.config;
console.log(`catalog ${catalog.size} · rated ${rated.length} · held ${held.size} · wishlist (held out) ${wishlist.size} · your averages ${[...profile.typeMeans].map(([t, v]) => `${t} ${v.toFixed(2)}`).join(', ')} (all ${profile.baseline.toFixed(2)})`);
console.log(`taste: prior ${cfg.priorStrength} · gains up ${cfg.mappingConstantUp}, down ${cfg.mappingConstantDown} · band margin ${cfg.tasteBandMargin} · top ${cfg.topTagsPositive}/${cfg.topTagsNegative} tags, ${cfg.topPeople} people, ${cfg.topCompanies} companies, ${cfg.topIps} franchises`);
console.log(pull
  ? `pull model: ${[...pull.media].map(([m, v]) => `${m} ${v.picks} picks / ${v.baseline} baseline`).join(', ')} · ${pull.beta.size} facets with weight · ${pull.sweeps} sweeps · fitted with folds in ${fitMs} ms · penalty ${cfg.pullL1}, ridge ${cfg.pullL2} · beside the number, not in it`
  : 'no baseline: no pull axis');
if (strips.length) console.log(`stripped from both sides: ${strips.join(', ')}`);
console.log(`wishlist weight in the app: ${WISHLIST_WEIGHT} (not applied here, the wishlist is the test)`);

// ── Score everything ───────────────────────────────────────────────────────
const rows = [];
for (const c of catalog.values()) {
  const fx = computeFandexScore(c.facets, c.id, profile, tax, c.type);
  if (!fx) continue;
  rows.push({ c, fx, own: ratedIds.has(c.id) ? rated.find((r) => r.id === c.id).rating : undefined, held: held.has(c.id), wish: wishlist.has(c.id) });
}

// ── Measures ───────────────────────────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (k, n) => (n ? `${Math.round((100 * k) / n)}%` : '-');
function spearman(pairs) {
  const rank = (arr) => { const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = new Array(arr.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; };
  const a = rank(pairs.map((p) => p[0])), b = rank(pairs.map((p) => p[1])); const ma = mean(a), mb = mean(b); let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
function auc(pos, neg) {
  const all = [...pos.map((v) => [v, 1]), ...neg.map((v) => [v, 0])].sort((a, b) => a[0] - b[0]); let rankSum = 0;
  for (let i = 0; i < all.length;) { let j = i; while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) if (all[k][1]) rankSum += avg; i = j + 1; }
  return (rankSum - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length);
}
const RUNGS = [[0, 50], [50, 60], [60, 65], [65, 70], [70, 75], [75, 80], [80, 101]];

for (const type of ['movie', 'show', 'game', 'book', 'boardgame', 'all']) {
  const of = rows.filter((r) => type === 'all' || r.c.type === type);
  const ratedRows = of.filter((r) => r.own !== undefined); if (ratedRows.length < 10) continue;
  const unseen = of.filter((r) => r.own === undefined);
  // With a baseline, untouched means the ordinary titles you have not touched; without one, the pool's.
  const wish = unseen.filter((r) => r.wish), owned = unseen.filter((r) => r.held);
  const untouched = unseen.filter((r) => !r.held && !r.wish && (!baselineIds.size || baselineIds.has(r.c.id)));
  const base8 = ratedRows.filter((r) => r.own >= 8).length / ratedRows.length;
  console.log(`\n==== ${type}: rated ${ratedRows.length} · unseen ${unseen.length} (wishlist ${wish.length}, held unrated ${owned.length}, untouched ${untouched.length}) · your 8+ share ${Math.round(100 * base8)}%`);

  // The rating measure: the score ÷ 10 against what you gave, and the floor of guessing your average for the medium (the score's own centre).
  const err = ratedRows.map((r) => r.fx.score / 10 - r.own);
  const floor = ratedRows.map((r) => r.fx.center / 10 - r.own);
  const within = (e, k) => e.filter((x) => Math.abs(x) <= k).length;
  let agree = 0, pairs = 0;
  for (let i = 0; i < ratedRows.length; i++) for (let j = i + 1; j < ratedRows.length; j++) { const a = ratedRows[i], b = ratedRows[j]; if (a.own === b.own) continue; pairs++; if (a.fx.score === b.fx.score) agree += 0.5; else if ((a.fx.score > b.fx.score) === (a.own > b.own)) agree++; }
  console.log(`  as a rating: off by ${mean(err.map(Math.abs)).toFixed(2)} (guessing your average: ${mean(floor.map(Math.abs)).toFixed(2)}) · within 1 point ${pct(within(err, 1), err.length)} (${pct(within(floor, 1), floor.length)}) · within 2 ${pct(within(err, 2), err.length)} (${pct(within(floor, 2), floor.length)}) · bias ${mean(err) >= 0 ? '+' : ''}${mean(err).toFixed(2)}`);
  console.log(`  order: right ${pairs ? Math.round(100 * agree / pairs) : '-'}% of pairs · rho ${spearman(ratedRows.map((r) => [r.fx.score, r.own])).toFixed(3)}`);
  const rungs = RUNGS.map(([lo, hi]) => { const b = ratedRows.filter((r) => r.fx.score >= lo && r.fx.score < hi); return `${lo === 0 ? `<${hi}` : hi > 100 ? `${lo}+` : `${lo}-${hi}`}: ${b.length}${b.length ? ` → ${mean(b.map((r) => r.own)).toFixed(1)}` : ''}`; });
  console.log(`  ladder (what it said → what you gave): ${rungs.join(' · ')}`);
  // What each band earned: a green badge should be an 8 more often than the grey.
  const perBand = {}; for (const r of ratedRows) (perBand[r.fx.band] ??= []).push(r.own);
  console.log(`  bands on rated titles: ${['high', 'usual', 'low'].filter((b) => perBand[b]).map((b) => `${b} ${perBand[b].length} → ${mean(perBand[b]).toFixed(2)} (8+ ${pct(perBand[b].filter((x) => x >= 8).length, perBand[b].length)})`).join(' · ')}`);
  const bandsUnseen = {}; for (const r of unseen) bandsUnseen[r.fx.band] = (bandsUnseen[r.fx.band] ?? 0) + 1;
  const q = (p) => { const v = unseen.map((r) => r.fx.score).sort((a, b) => a - b); return v.length ? v[Math.floor(p * (v.length - 1))].toFixed(0) : '-'; };
  console.log(`  unseen titles: p10 ${q(0.1)} · p50 ${q(0.5)} · p90 ${q(0.9)} · ${['high', 'usual', 'low'].map((b) => `${b} ${pct(bandsUnseen[b] ?? 0, unseen.length)}`).join(' · ')}`);
  // Pull's own bar, and the number's: what you wishlisted against what you never touched.
  if (wish.length >= 5 && untouched.length >= 20) {
    const pullOf = (r) => r.fx.pull?.points ?? 0;
    console.log(`  wishlist beats untouched: by the number ${Math.round(100 * auc(wish.map((r) => r.fx.score), untouched.map((r) => r.fx.score)))}%${pull ? ` · by pull alone ${Math.round(100 * auc(wish.map(pullOf), untouched.map(pullOf)))}%` : ''}`);
  }
  if (owned.length >= 10 && untouched.length >= 20) console.log(`  held-but-unrated beats untouched, by the number ${Math.round(100 * auc(owned.map((r) => r.fx.score), untouched.map((r) => r.fx.score)))}%`);
}

// ── The gains the weights imply ────────────────────────────────────────────
if (args['fit-gains']) {
  // With both gains at 1 the taste points ARE the raw sum (before the bend, which no rated title reaches). Fit rating − medium average on
  // them, up and down apart: two one-variable least squares, since the two never overlap.
  const unit = withConfig({ mappingConstantUp: 1, mappingConstantDown: 1 });
  const unitProfile = buildProfile(rated, unit, { consumed, pull });
  let su = 0, suu = 0, sd = 0, sdd = 0, n = 0;
  for (const r of rated) {
    const fx = computeFandexScore(r.facets, r.id, unitProfile, unit, r.type);
    if (!fx) continue;
    const x = fx.taste.points, y = r.rating - fx.center / 10;
    n++;
    if (x > 0) { su += x * y; suu += x * x; } else if (x < 0) { sd += x * y; sdd += x * x; }
  }
  const up = suu ? su / suu : 0, down = sdd ? sd / sdd : 0;
  console.log(`\ngains the current weights imply, fitted on ${n} rated titles: mappingConstantUp ${(10 * up).toFixed(2)} · mappingConstantDown ${(10 * down).toFixed(2)} (per rating point: ${up.toFixed(3)} up, ${down.toFixed(3)} down)`);
}
