// SM39 — how far outside 0-100 does the Fandex Score actually land, and which
// knob fixes it? Read-only companion to scripts/calibrate-fandex.mjs.
//
// Usage: node scripts/probe-score-range.mjs <source-db-path> [userId]
//
// Why a SECOND script rather than a flag on the calibrator: the two target
// different things and would fight each other. calibrate-fandex.mjs solves for
// the K that gives a 40-point p10-p90 SPREAD (legibility — "do these numbers
// look different from each other"). This one solves for the K that keeps the
// TAILS inside the badge's implied 0-100 (honesty — "does the badge lie"). A
// distribution can pass one and fail the other, and SM39 is exactly that case:
// the calibrated spread is fine while 8.9% of items still print over 100.
//
// It also sweeps priorStrength C and the four top-N counts, because those are
// the knobs TASKS.md time-gated as "tuned against the old weighted mean, never
// re-validated against the raw sum".
//
// Never writes: everything runs on a temp copy, and nothing is persisted to
// scoring_config. Applying a result is a PUT /api/dev/scoring, by hand.
//
// Same hook/import ordering constraints as scripts/calibrate-fandex.mjs — read
// that header before rearranging the imports.
import { registerHooks } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import "better-sqlite3";
import { resolve } from "./alias-hooks.mjs";

registerHooks({ resolve });

const sourcePath = process.argv[2];
if (!sourcePath || !fs.existsSync(sourcePath)) {
  console.error("usage: node scripts/probe-score-range.mjs <source-db-path> [userId]");
  process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-score-range-"));
const copyPath = path.join(workDir, "probe.db");
for (const [suffix, dest] of [["", copyPath], ["-wal", `${copyPath}-wal`], ["-shm", `${copyPath}-shm`]]) {
  const src = `${sourcePath}${suffix}`;
  if (fs.existsSync(src)) fs.copyFileSync(src, dest);
}
console.log(`Probing a copy at ${copyPath}\n(source ${sourcePath} is never written to)\n`);

process.env.DB_PATH = copyPath;

const { query, get } = await import("../src/lib/db.ts");
const { buildProfile, computeFandexScore } = await import("../src/lib/discovery.ts");
const { getScoringConfig } = await import("../src/lib/scoringConfig.ts");
const { mergeLinks } = await import("../src/lib/merge.ts");
const { extractFacets } = await import("../src/lib/facets.ts");
const { getUserCountry } = await import("../src/lib/userCountry.ts");

const userId = process.argv[3] ?? get("SELECT id FROM users ORDER BY created_at LIMIT 1")?.id;
if (!userId) {
  console.error("No users in this database.");
  process.exit(1);
}

// Same query shape as GET /api/library — what's scored here is what the owner sees.
const rows = query(
  `SELECT mi.id, mi.type, ml.source, ml.source_id, ml.raw_data, ml.release_date as link_release_date
     FROM user_library ul
     JOIN media_items mi ON mi.id = ul.media_item_id
     LEFT JOIN media_links ml ON ml.media_item_id = mi.id
    WHERE ul.user_id = ?`,
  [userId]
);

const itemMap = new Map();
for (const row of rows) {
  if (!itemMap.has(row.id)) itemMap.set(row.id, { type: row.type, links: [] });
  if (row.source) {
    itemMap.get(row.id).links.push({
      id: "", mediaItemId: row.id, source: row.source, sourceId: row.source_id,
      title: null, releaseDate: row.link_release_date,
      rawData: JSON.parse(row.raw_data ?? "{}"), lastSynced: 0,
    });
  }
}

const country = getUserCountry(userId);
const liveConfig = getScoringConfig();
console.log(`Library: ${itemMap.size} items for user ${userId}`);
console.log(`Live stored config: K_up ${liveConfig.mappingConstantUp} · K_down ${liveConfig.mappingConstantDown} · C ${liveConfig.priorStrength} · topN ${liveConfig.topTagsPositive}/${liveConfig.topTagsNegative}/${liveConfig.topPeople}/${liveConfig.topCompanies}\n`);

function scores(cfg) {
  const profile = buildProfile(userId, { config: cfg });
  const out = [];
  for (const { type, links } of itemMap.values()) {
    const merged = mergeLinks(links, type, country);
    const fx = computeFandexScore(extractFacets(links, type, merged), profile, cfg);
    if (fx) out.push(fx.score);
  }
  return out.sort((a, b) => a - b);
}

const pct = (s, p) => s[Math.floor((s.length - 1) * p)];
const outside = (s) => ({
  below: s.filter((v) => v < 0).length,
  above: s.filter((v) => v > 100).length,
});

function line(label, s) {
  const o = outside(s);
  const bad = (((o.below + o.above) / s.length) * 100).toFixed(1);
  return (
    label.padEnd(34) +
    `${pct(s, 0).toFixed(0).padStart(6)}` +
    `${pct(s, 0.1).toFixed(0).padStart(6)}` +
    `${pct(s, 0.5).toFixed(0).padStart(7)}` +
    `${pct(s, 0.9).toFixed(0).padStart(6)}` +
    `${s[s.length - 1].toFixed(0).padStart(6)}` +
    `${String(o.below).padStart(7)}` +
    `${String(o.above).padStart(7)}` +
    `${(bad + "%").padStart(8)}`
  );
}

const HEAD = "config".padEnd(34) + "   min   p10 median   p90   max  <0     >100  outside";

// ── Step 1: the rawSum shape per C, and the K that WOULD fit 0-100 ─────
// With K=1 the score is `center + rawSum`, so subtracting the center gives
// rawSum directly. The center is a profile constant (baseline*10), so the
// range-fitting K is closed-form off the rawSum tails, no search needed:
//   K_up   <= (100 - center) / rawSum_p99.5
//   K_down <=        center  / |rawSum_p0.5|
// Note this lands ASYMMETRIC by construction whenever the center isn't 50 —
// which is Q19's design intent (center = your own mean rating), and is why a
// single shared K cannot fit both tails at once.
console.log("── Step 1 · rawSum shape and the range-fitting K, per priorStrength ──\n");
const C_VALUES = [5, 8, 12, 20, 30, 50];
const fits = new Map();
for (const C of C_VALUES) {
  const cfg = { ...liveConfig, priorStrength: C, mappingConstantUp: 1, mappingConstantDown: 1 };
  const s = scores(cfg);
  const profile = buildProfile(userId, { config: cfg });
  const c = profile.baseline * 10;
  const rHi = pct(s, 0.995) - c;
  const rLo = pct(s, 0.005) - c;
  const kUp = (100 - c) / rHi;
  const kDown = rLo < 0 ? c / -rLo : Infinity;
  fits.set(C, { kUp, kDown, c, spread: pct(s, 0.9) - pct(s, 0.1) });
  console.log(
    `C=${String(C).padStart(2)}  center ${c.toFixed(1)}  ` +
    `rawSum p0.5 ${rLo.toFixed(2).padStart(7)}  p99.5 ${rHi.toFixed(2).padStart(6)}  ` +
    `p10-p90 spread ${(pct(s, 0.9) - pct(s, 0.1)).toFixed(2).padStart(5)}  →  ` +
    `fits 0-100 at K_up ${kUp.toFixed(1)} / K_down ${kDown.toFixed(1)}`
  );
}

// ── Step 2: candidate configs, scored end to end ──────────────────────
console.log(`\n── Step 2 · candidate configs (real scores, ${itemMap.size} items) ──\n`);
console.log(HEAD);

const CANDIDATES = [
  ["A · live stored (today)", { ...liveConfig }],
  ["B · asymmetric K, C unchanged", { ...liveConfig, mappingConstantUp: round1(fits.get(5).kUp), mappingConstantDown: round1(fits.get(5).kDown) }],
  ["C · C=12 + asymmetric K", { ...liveConfig, priorStrength: 12, mappingConstantUp: round1(fits.get(12).kUp), mappingConstantDown: round1(fits.get(12).kDown) }],
  ["D · C=20 + asymmetric K", { ...liveConfig, priorStrength: 20, mappingConstantUp: round1(fits.get(20).kUp), mappingConstantDown: round1(fits.get(20).kDown) }],
  ["E · tighter topN (3/2/2/1)", { ...liveConfig, topTagsPositive: 3, topTagsNegative: 2, topPeople: 2, topCompanies: 1 }],
  ["F · E + asymmetric K", null], // filled below — needs its own rawSum fit
  ["G · prod's suspected stale K=25", { ...liveConfig, mappingConstantUp: 25, mappingConstantDown: 25 }],
  ["H · prod's suspected stale K=50", { ...liveConfig, mappingConstantUp: 50, mappingConstantDown: 50 }],
];

function round1(x) { return Math.round(x * 10) / 10; }

for (const entry of CANDIDATES) {
  let [label, cfg] = entry;
  if (label.startsWith("F")) {
    const base = { ...liveConfig, topTagsPositive: 3, topTagsNegative: 2, topPeople: 2, topCompanies: 1 };
    const probe = scores({ ...base, mappingConstantUp: 1, mappingConstantDown: 1 });
    const c = buildProfile(userId, { config: base }).baseline * 10;
    cfg = {
      ...base,
      mappingConstantUp: round1((100 - c) / (pct(probe, 0.995) - c)),
      mappingConstantDown: round1(c / -(pct(probe, 0.005) - c)),
    };
    label = `F · tighter topN + asym K (${cfg.mappingConstantUp}/${cfg.mappingConstantDown})`;
  }
  if (label.startsWith("B") || label.startsWith("C") || label.startsWith("D")) {
    label += ` (${cfg.mappingConstantUp}/${cfg.mappingConstantDown})`;
  }
  console.log(line(label, scores(cfg)));
}

console.log(`\nCopy left at ${copyPath} for inspection.`);
