// The Fandex Score's backtest: how well the score as the app computes it
// orders a real library, measured the way docs/fandex-score.md §9 says every
// change must be measured. Nothing ships to the score without this moving the
// right way, per medium, with the wishlist held out.
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
//   --reference /catalog/reference.json, the reference population (optional; without
//               it the catalog's own counts are the pull axis's denominator, as on a
//               device without the file)
//   --ladder    also print the odds ladder as JSON, for scoringDefaults
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
const { prepareTaxonomy, buildProfile, catalogCountsFrom, computeFandexScore, WISHLIST_WEIGHT } = score;

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : [])).filter((p) => p.length));
for (const need of ['state', 'catalog', 'taxonomy']) if (!args[need]) { console.error(`--${need} is required`); process.exit(2); }

// ── Load ───────────────────────────────────────────────────────────────────
const catalog = new Map();
const catalogFiles = statSync(args.catalog).isDirectory() ? readdirSync(args.catalog).filter((f) => f.endsWith('.json')).map((f) => path.join(args.catalog, f)) : [args.catalog];
for (const file of catalogFiles) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  for (const it of j.items ?? j) catalog.set(it.vector.id, { id: it.vector.id, type: it.vector.type, title: it.vector.title, year: it.vector.year, facets: it.facets });
}
const tax = prepareTaxonomy(JSON.parse(readFileSync(args.taxonomy, 'utf8')));
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
const consumed = [...held].map((id) => ({ id, facets: catalog.get(id).facets, weight: 1 }));
// The wishlist is HELD OUT of the profile here, so it can be the test; the app counts it at WISHLIST_WEIGHT.
const reference = args.reference ? JSON.parse(readFileSync(args.reference, 'utf8')) : null;
const counts = catalogCountsFrom([...catalog.values()], tax, reference);
const profile = buildProfile(rated, tax, { consumed, catalog: counts });
console.log(`catalog ${catalog.size} · rated ${rated.length} · held ${held.size} · wishlist (held out) ${wishlist.size} · your average ${profile.baseline.toFixed(2)} · pull gain ${tax.config.pullGain} · pull weights ${JSON.stringify(tax.config.pullWeight)}`);
console.log(reference ? `reference population of ${reference.builtAt.slice(0, 10)}: ${counts.referenceMedia?.join(', ') || 'no medium in common'} (${Object.entries(reference.media).map(([m, r]) => `${m} ${r.total}`).join(', ')}) · expected counts for ${counts.expected?.size ?? 0} facets` : 'no reference population: the catalog is its own denominator');
console.log(`wishlist weight in the app: ${WISHLIST_WEIGHT} (not applied here, the wishlist is the test)`);

// ── Score everything ───────────────────────────────────────────────────────
const rows = [];
for (const c of catalog.values()) {
  const fx = computeFandexScore(c.facets, c.id, profile, tax, c.type);
  if (!fx) continue;
  rows.push({ c, fx, own: ratedIds.has(c.id) ? rated.find((r) => r.id === c.id).rating : undefined, held: held.has(c.id), wish: wishlist.has(c.id) });
}

// ── Measures ───────────────────────────────────────────────────────────────
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
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
const BANDS = [[0, 60], [60, 70], [70, 78], [78, 86], [86, 101]];
const bandOf = (s) => BANDS.findIndex(([lo, hi]) => s >= lo && s < hi);
const ladder = {};

for (const type of ['movie', 'show', 'game', 'book', 'boardgame', 'all']) {
  const of = rows.filter((r) => type === 'all' || r.c.type === type);
  const ratedRows = of.filter((r) => r.own !== undefined); if (ratedRows.length < 10) continue;
  const unseen = of.filter((r) => r.own === undefined);
  const wish = unseen.filter((r) => r.wish), untouched = unseen.filter((r) => !r.held && !r.wish), owned = unseen.filter((r) => r.held);
  const base8 = ratedRows.filter((r) => r.own >= 8).length / ratedRows.length;
  let agree = 0, pairs = 0;
  for (let i = 0; i < ratedRows.length; i++) for (let j = i + 1; j < ratedRows.length; j++) { const a = ratedRows[i], b = ratedRows[j]; if (a.own === b.own) continue; pairs++; if (a.fx.score === b.fx.score) agree += 0.5; else if ((a.fx.score > b.fx.score) === (a.own > b.own)) agree++; }
  console.log(`\n==== ${type}: rated ${ratedRows.length} · unseen ${unseen.length} (wishlist ${wish.length}, held unrated ${owned.length}, untouched ${untouched.length}) · your 8+ share ${Math.round(100 * base8)}%`);
  console.log(`  ratings: order right ${pairs ? Math.round(100 * agree / pairs) : '-'}% of pairs · rho ${spearman(ratedRows.map((r) => [r.fx.score, r.own])).toFixed(3)} · taste axis alone rho ${spearman(ratedRows.map((r) => [r.fx.taste.points, r.own])).toFixed(3)}`);
  if (wish.length >= 5 && untouched.length >= 20) console.log(`  wishlist beats untouched ${Math.round(100 * auc(wish.map((r) => r.fx.score), untouched.map((r) => r.fx.score)))}% · by pull alone ${Math.round(100 * auc(wish.map((r) => r.fx.pull?.points ?? 0), untouched.map((r) => r.fx.pull?.points ?? 0)))}% · by taste alone ${Math.round(100 * auc(wish.map((r) => r.fx.taste.points), untouched.map((r) => r.fx.taste.points)))}%`);
  if (owned.length >= 10 && untouched.length >= 20) console.log(`  held-but-unrated beats untouched ${Math.round(100 * auc(owned.map((r) => r.fx.score), untouched.map((r) => r.fx.score)))}%`);
  const labels = {}; for (const r of unseen) labels[r.fx.label] = (labels[r.fx.label] ?? 0) + 1;
  console.log(`  labels on unseen titles: ${Object.entries(labels).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${Math.round(100 * n / unseen.length)}%`).join(' · ')}`);
  // The odds line's source: for each label, how much more often than usual you gave an 8 or more. A rated title's
  // pull is high almost by construction (it is in your library), so the LABEL is the honest unit here, not the band.
  const perLabel = {}; for (const r of ratedRows) { (perLabel[r.fx.label] ??= []).push(r.own); }
  console.log(`  what you gave each label: ${Object.entries(perLabel).filter(([, v]) => v.length >= 5).map(([l, v]) => `${l} ${mean(v).toFixed(1)} over ${v.length} (8+ ${Math.round(100 * v.filter((x) => x >= 8).length / v.length)}%, ×${((v.filter((x) => x >= 8).length / v.length) / base8).toFixed(2)} your usual)`).join(' · ')}`);
  ladder[type] = Object.fromEntries(Object.entries(perLabel).filter(([, v]) => v.length >= 10).map(([l, v]) => [l, Math.round(((v.filter((x) => x >= 8).length / v.length) / base8) * 100) / 100]));
  const rungs = BANDS.map(([lo, hi]) => { const b = ratedRows.filter((r) => r.fx.score >= lo && r.fx.score < hi); return { lo, hi: hi - 1, n: b.length, mean: b.length ? mean(b.map((r) => r.own)) : null }; });
  console.log(`  score bands against your ratings (the goalpost chart's rungs): ${rungs.map((r) => `${r.lo}-${r.hi}: ${r.n}${r.mean != null ? ` → ${r.mean.toFixed(1)}` : ''}`).join(' · ')}`);
}
if (args.ladder) console.log(`\nodds per label (8+ share over your usual, per medium; 10+ rated titles each):\n${JSON.stringify(ladder)}`);
