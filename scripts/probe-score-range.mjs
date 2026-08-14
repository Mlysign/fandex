// SM39 — how far outside 0-100 does the Fandex Score actually land, and which
// knob fixes it? Read-only companion to scripts/calibrate-fandex.mjs.
//
// Usage: node scripts/probe-score-range.mjs <source-db-path> [userId] [--config <json>]
//
// `--config` takes a file holding a GET /api/dev/scoring response verbatim
// (`{config, categories, …}`) and scores THAT against this database instead of
// the local stored row. This is how you answer "what is production actually
// doing?" without a shell on the Railway volume — the config is small, the
// library is what's expensive to move, so bring the config to the data. It was
// added for SM39, where prod turned out to be running a hand-tuned config
// (director 4, C 2, K 30/20) that no local measurement could have predicted.
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

const argv = process.argv.slice(2);
const configFlag = argv.indexOf("--config");
const configPath = configFlag >= 0 ? argv.splice(configFlag, 2)[1] : null;

const sourcePath = argv[0];
if (!sourcePath || !fs.existsSync(sourcePath)) {
  console.error("usage: node scripts/probe-score-range.mjs <source-db-path> [userId] [--config <json>]");
  process.exit(1);
}
if (configPath && !fs.existsSync(configPath)) {
  console.error(`--config file not found: ${configPath}`);
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

const userId = argv[1] ?? get("SELECT id FROM users ORDER BY created_at LIMIT 1")?.id;
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

// --config wins over the local row, and brings its own category weights: those
// live in `tag_category`, NOT in the config blob, so reading only `config` from
// a /api/dev/scoring response reproduces the wrong thing. buildProfile's
// `categoryWeights` override (H5.4's live-preview path) is what applies them.
const imported = configPath ? JSON.parse(fs.readFileSync(configPath, "utf8")) : null;
const baseConfig = imported?.config ?? getScoringConfig();
const categoryWeights = imported?.categories
  ? new Map(imported.categories.map((c) => [c.id, { weight: c.weight, ignored: !!c.ignored }]))
  : undefined;

console.log(`Library: ${itemMap.size} items for user ${userId}`);
console.log(
  `${imported ? `Imported config (${configPath})` : "Live stored config"}: ` +
  `K_up ${baseConfig.mappingConstantUp} · K_down ${baseConfig.mappingConstantDown} · ` +
  `C ${baseConfig.priorStrength} · topN ${baseConfig.topTagsPositive}/${baseConfig.topTagsNegative}/${baseConfig.topPeople}/${baseConfig.topCompanies} · ` +
  `director ${baseConfig.roleWeights.director}\n`
);

const profileFor = (cfg) => buildProfile(userId, { config: cfg, categoryWeights });

function scores(cfg) {
  const profile = profileFor(cfg);
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
const round1 = (x) => Math.round(x * 10) / 10;

// Returns `cfg` with the two gains replaced by the pair that puts the 0.5th and
// 99.5th percentile exactly on 0 and 100. Everything else — role weights,
// category weights, top-N — is left alone, which is the point: those encode
// taste, the gains are only the ruler they're printed on.
function fitGains(cfg) {
  const s = scores({ ...cfg, mappingConstantUp: 1, mappingConstantDown: 1 });
  const c = profileFor(cfg).baseline * 10;
  const rHi = pct(s, 0.995) - c;
  const rLo = pct(s, 0.005) - c;
  return {
    ...cfg,
    mappingConstantUp: round1(rHi > 0 ? (100 - c) / rHi : cfg.mappingConstantUp),
    mappingConstantDown: round1(rLo < 0 ? c / -rLo : cfg.mappingConstantDown),
    _center: c,
    _spread: pct(s, 0.9) - pct(s, 0.1),
  };
}

console.log("── Step 1 · rawSum shape and the range-fitting gains, per priorStrength ──\n");
for (const C of [2, 5, 8, 12, 20, 30]) {
  const f = fitGains({ ...baseConfig, priorStrength: C });
  console.log(
    `C=${String(C).padStart(2)}  center ${f._center.toFixed(1)}  ` +
    `rawSum p10-p90 spread ${f._spread.toFixed(2).padStart(6)}  →  ` +
    `fits 0-100 at K_up ${f.mappingConstantUp} / K_down ${f.mappingConstantDown}`
  );
}

// ── Step 2: candidate configs, scored end to end ──────────────────────
console.log(`\n── Step 2 · candidate configs (real scores, ${itemMap.size} items) ──\n`);
console.log(HEAD);

const TIGHT_TOPN = { topTagsPositive: 3, topTagsNegative: 2, topPeople: 2, topCompanies: 1 };
const CANDIDATES = [
  ["A · as loaded", baseConfig],
  ["B · gains fitted, nothing else", fitGains(baseConfig)],
  ["C · C=5 + fitted gains", fitGains({ ...baseConfig, priorStrength: 5 })],
  ["D · C=12 + fitted gains", fitGains({ ...baseConfig, priorStrength: 12 })],
  ["E · tighter topN, gains as loaded", { ...baseConfig, ...TIGHT_TOPN }],
  ["F · tighter topN + fitted gains", fitGains({ ...baseConfig, ...TIGHT_TOPN })],
];

for (const [name, cfg] of CANDIDATES) {
  const label = name.startsWith("A") || name.startsWith("E")
    ? name
    : `${name} (${cfg.mappingConstantUp}/${cfg.mappingConstantDown})`;
  console.log(line(label, scores(cfg)));
}

console.log(`\nCopy left at ${copyPath} for inspection.`);
