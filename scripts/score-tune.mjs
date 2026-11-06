// Should the Fandex Score's weights move? A search over the category, role and
// tag-tier weights, on half of one library's ratings, checked on the other half.
//
//   node scripts/score-tune.mjs --state nils.json --catalog <folder or catalog.json> --taxonomy taxonomy.json [--out proposal.json] [--passes 2]
//
// The measure is the score's own claim since 2026-10-27 (docs/fandex-score.md
// §3.11): the score ÷ 10 is the rating you would give. Every rated title is
// scored with its own rating left out (exact in the app's maths, as in
// score-backtest.mjs), and the two gains are refitted for every candidate
// (least squares on the tuning half), because a weight change needs a refit.
// The error is the mean distance from the rating given.
//
// Titles split into a tuning half and a checking half by a hash of the id.
// Coordinate descent on the tuning half: each weight in turn tries every value
// in GRID and keeps the best by more than MIN_GAIN. The verdict reads the
// CHECKING half only: a proposal ships when it is better there by at least
// SHIP_GAIN overall and no medium with 50 or more rated titles there is worse by
// more than WORSE_LIMIT. Otherwise the weights stay. It loads the app's module,
// so the numbers are the app's numbers. Nothing is written but --out.
//
// ⚠️ The state export is one person's library. Keep it out of the repo (data/ is gitignored).

import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const repo = path.dirname(here);
const { resolve } = await import(pathToFileURL(path.join(repo, 'scripts/alias-hooks.mjs')));
registerHooks({ resolve });
const { prepareTaxonomy, buildProfile, computeFandexScore } = await import(pathToFileURL(path.join(repo, 'mobile/src/lib/fandexScore.ts')));

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : [])).filter((p) => p.length));
for (const need of ['state', 'catalog', 'taxonomy']) if (!args[need]) { console.error(`--${need} is required`); process.exit(2); }

const GRID = [0, 0.25, 0.5, 1, 1.5, 2, 3];
const MIN_GAIN = 0.002;   // a step on the tuning half must beat this, in rating points
const SHIP_GAIN = 0.01;   // the checking half must improve this much overall
const WORSE_LIMIT = 0.02; // and no sizeable medium there may get worse than this
const PASSES = Number(args.passes ?? 2);

// ── Load (as score-backtest.mjs) ───────────────────────────────────────────
const catalog = new Map();
const files = statSync(args.catalog).isDirectory() ? readdirSync(args.catalog).filter((f) => f.endsWith('.json')).map((f) => path.join(args.catalog, f)) : [args.catalog];
for (const file of files) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const items = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : null;
  if (!items) continue;
  for (const it of items) catalog.set(it.vector.id, { id: it.vector.id, type: it.vector.type, facets: it.facets });
}
const taxJson = JSON.parse(readFileSync(args.taxonomy, 'utf8'));
const stateJson = JSON.parse(readFileSync(args.state, 'utf8'));
const state = Array.isArray(stateJson) && stateJson[0]?.results ? stateJson[0].results : stateJson;
const ratingRows = new Map();
for (const r of state) {
  if (r.relation === 'ignored' || !catalog.has(r.id) || !(r.rating > 0)) continue;
  const a = ratingRows.get(r.id) ?? []; a.push(r.rating); ratingRows.set(r.id, a);
}
const rated = [...ratingRows].map(([id, rs]) => ({ id, type: catalog.get(id).type, rating: Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 10) / 10, facets: catalog.get(id).facets }));
// A stable split by a hash of the id: the same titles tune and check every week.
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const isTune = (r) => hash(r.id) % 2 === 0;

// ── The knobs ──────────────────────────────────────────────────────────────
const stored = taxJson.scoring?.config ?? {};
const base = {
  category: Object.fromEntries((taxJson.tagCategories ?? []).filter((c) => !c.ignored).map((c) => [c.id, c.weight])),
  role: { ...(stored.roleWeights ?? {}) },
  tier: { ...(stored.tagTierWeights ?? {}) },
};
const knobs = [...Object.keys(base.category).map((k) => ['category', k]), ...Object.keys(base.role).map((k) => ['role', k]), ...Object.keys(base.tier).map((k) => ['tier', k])];

function taxonomyFor(w) {
  return prepareTaxonomy({
    ...taxJson,
    tagCategories: taxJson.tagCategories.map((c) => (c.id in w.category ? { ...c, weight: w.category[c.id] } : c)),
    scoring: { ...(taxJson.scoring ?? { version: 0 }), config: { ...stored, roleWeights: w.role, tagTierWeights: w.tier, mappingConstantUp: 1, mappingConstantDown: 1 } },
  });
}

/** Every rated title's taste points at unit gains and its centre, with its own rating left out. */
function pointsFor(w) {
  const tax = taxonomyFor(w);
  const profile = buildProfile(rated, tax, {});
  return rated.map((r) => {
    const fx = computeFandexScore(r.facets, r.id, profile, tax, r.type);
    return { r, x: fx?.taste.points ?? 0, centre: fx ? fx.center / 10 : null };
  }).filter((p) => p.centre != null);
}

/** The gains fitted on the tuning half, and the error on each half and per medium on the checking half. */
function measure(points) {
  let su = 0, suu = 0, sd = 0, sdd = 0;
  for (const p of points) {
    if (!isTune(p.r)) continue;
    const y = p.r.rating - p.centre;
    if (p.x > 0) { su += p.x * y; suu += p.x * p.x; } else if (p.x < 0) { sd += p.x * y; sdd += p.x * p.x; }
  }
  const up = suu ? su / suu : 0, down = sdd ? sd / sdd : 0;
  const err = { tune: [], check: [], byType: {} };
  for (const p of points) {
    const guess = Math.min(10, Math.max(1, p.centre + (p.x > 0 ? up * p.x : down * p.x)));
    const e = Math.abs(guess - p.r.rating);
    if (isTune(p.r)) err.tune.push(e);
    else { err.check.push(e); (err.byType[p.r.type] ??= []).push(e); }
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return { up, down, tune: mean(err.tune), check: mean(err.check), byType: Object.fromEntries(Object.entries(err.byType).map(([t, a]) => [t, { n: a.length, err: mean(a) }])) };
}

const clone = (w) => ({ category: { ...w.category }, role: { ...w.role }, tier: { ...w.tier } });
const started = Date.now();
const start = measure(pointsFor(base));
console.log(`${rated.length} rated titles (${rated.filter(isTune).length} tune, ${rated.length - rated.filter(isTune).length} check), ${knobs.length} weights, grid ${GRID.join(' ')}`);
console.log(`now: off by ${start.tune.toFixed(3)} tuning, ${start.check.toFixed(3)} checking · gains ${(10 * start.up).toFixed(2)} up, ${(10 * start.down).toFixed(2)} down`);

let best = clone(base), bestM = start;
for (let pass = 1; pass <= PASSES; pass++) {
  let moved = 0;
  for (const [group, k] of knobs) {
    const was = best[group][k];
    for (const v of GRID) {
      if (v === was) continue;
      const w = clone(best); w[group][k] = v;
      const m = measure(pointsFor(w));
      if (m.tune < bestM.tune - MIN_GAIN) { best = w; bestM = m; }
    }
    if (best[group][k] !== was) { moved++; console.log(`  pass ${pass}: ${group} ${k} ${was} → ${best[group][k]} (tuning ${bestM.tune.toFixed(3)}, checking ${bestM.check.toFixed(3)})`); }
  }
  if (!moved) break;
}

// ── The verdict, on the checking half ──────────────────────────────────────
const changes = knobs.filter(([g, k]) => best[g][k] !== base[g][k]).map(([g, k]) => ({ group: g, key: k, from: base[g][k], to: best[g][k] }));
const worse = Object.entries(bestM.byType).filter(([t, v]) => v.n >= 50 && v.err - (start.byType[t]?.err ?? v.err) > WORSE_LIMIT).map(([t]) => t);
const gain = start.check - bestM.check;
const ship = changes.length > 0 && gain >= SHIP_GAIN && worse.length === 0;
console.log(`\nchecking half, now → proposed: ${start.check.toFixed(3)} → ${bestM.check.toFixed(3)} (${gain >= 0 ? 'better' : 'worse'} by ${Math.abs(gain).toFixed(3)})`);
for (const [t, v] of Object.entries(bestM.byType)) console.log(`  ${t}: ${start.byType[t].err.toFixed(3)} → ${v.err.toFixed(3)} (${v.n} titles)`);
console.log(changes.length ? `changes: ${changes.map((c) => `${c.group} ${c.key} ${c.from} → ${c.to}`).join(', ')}` : 'changes: none');
console.log(ship
  ? `VERDICT: ship. Better on titles the search never saw by ${gain.toFixed(3)} points, no medium worse by more than ${WORSE_LIMIT}. Refit the gains on every title after applying (score-backtest.mjs --fit-gains).`
  : `VERDICT: keep the weights. ${!changes.length ? 'The search found nothing better.' : gain < SHIP_GAIN ? `The checking half moved by ${gain.toFixed(3)}, under the ${SHIP_GAIN} that counts.` : `Worse on ${worse.join(', ')}.`}`);
console.log(`(${((Date.now() - started) / 1000).toFixed(0)} s)`);
if (args.out && args.out !== true) writeFileSync(args.out, JSON.stringify({ ship, gain, start, proposed: bestM, changes, weights: best }, null, 1));
