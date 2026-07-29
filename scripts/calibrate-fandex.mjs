// T3 (2026-07-29-tag-admin-and-score-rework) — calibrate K and BAND_MARGIN for
// the new unbounded raw-sum Fandex Score against a COPY of a real database.
//
// Usage: node scripts/calibrate-fandex.mjs <source-db-path> [userId]
//
// Why this exists: every DB test in this repo starts from a fresh schema (see
// the fresh-db-tests-hide-upgrade-bugs note), so a hand-picked K in a unit test
// says nothing about what spread the owner's real ~2,000-item library actually
// produces. This copies a live DB aside and scores the WHOLE library with the
// real buildProfile()/computeFandexScore() functions (same code path
// /api/library uses), so the calibration reflects production behavior exactly.
//
// It NEVER touches the source file: everything happens on the copy. It also
// never writes K/BAND_MARGIN anywhere — it only PRINTS the computed values.
// The caller applies them to src/lib/scoringDefaults.ts and
// src/components/FandexScoreBadge.tsx by hand, and persists K into the LIVE
// database through PUT /api/dev/scoring (the admin route), never via SQL here.
//
// Same hook/import ordering constraints as scripts/rehearse-prune.mjs — read
// the header there before rearranging the imports.
import { registerHooks } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import "better-sqlite3";
import { resolve } from "./alias-hooks.mjs";

registerHooks({ resolve });

const sourcePath = process.argv[2];
if (!sourcePath || !fs.existsSync(sourcePath)) {
  console.error("usage: node scripts/calibrate-fandex.mjs <source-db-path> [userId]");
  process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "calibrate-fandex-"));
const copyPath = path.join(workDir, "rehearsal.db");
for (const [suffix, dest] of [["", copyPath], ["-wal", `${copyPath}-wal`], ["-shm", `${copyPath}-shm`]]) {
  const src = `${sourcePath}${suffix}`;
  if (fs.existsSync(src)) fs.copyFileSync(src, dest);
}
console.log(`Calibrating against a copy at ${copyPath}`);
console.log(`(source ${sourcePath} is never written to)\n`);

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

// Same query shape as GET /api/library, so what's scored here is exactly what
// the owner sees in their library.
const rows = query(
  `SELECT
     mi.id, mi.type,
     ml.source, ml.source_id, ml.raw_data, ml.release_date as link_release_date
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
console.log(`Library: ${itemMap.size} items for user ${userId}\n`);

const country = getUserCountry(userId);
const liveConfig = getScoringConfig();

function scoreDistribution(configOverride) {
  const profile = buildProfile(userId, { config: configOverride });
  const scores = [];
  for (const { type, links } of itemMap.values()) {
    const merged = mergeLinks(links, type, country);
    const facets = extractFacets(links, type, merged);
    const fx = computeFandexScore(facets, profile, configOverride);
    if (fx) scores.push(fx.score);
  }
  return scores.sort((a, b) => a - b);
}

function percentile(sorted, p) {
  return sorted[Math.floor((sorted.length - 1) * p)];
}

function report(label, sorted) {
  console.log(`${label}: n=${sorted.length}`);
  console.log(
    `  min ${sorted[0]?.toFixed(1)} · p10 ${percentile(sorted, 0.1)?.toFixed(1)} · ` +
    `p25 ${percentile(sorted, 0.25)?.toFixed(1)} · median ${percentile(sorted, 0.5)?.toFixed(1)} · ` +
    `p75 ${percentile(sorted, 0.75)?.toFixed(1)} · p90 ${percentile(sorted, 0.9)?.toFixed(1)} · ` +
    `max ${sorted[sorted.length - 1]?.toFixed(1)}`
  );
}

// Step 1 — score with K=1 so `score - center` IS rawSum directly (gain=1).
// center is a profile-level constant (baseline*10), so subtracting it doesn't
// need a per-item lookup.
const k1Config = { ...liveConfig, mappingConstantUp: 1, mappingConstantDown: 1 };
const rawSumScores = scoreDistribution(k1Config);
report("Raw sum distribution (K=1)", rawSumScores);

const p10 = percentile(rawSumScores, 0.1);
const p90 = percentile(rawSumScores, 0.9);
const spread = p90 - p10;
if (spread <= 0) {
  console.error("\np90 - p10 <= 0 — cannot calibrate K from a degenerate distribution.");
  process.exit(1);
}
const K = Math.round((40 / spread) * 10) / 10;
console.log(`\nTarget p10-p90 spread: 40 points. p90(rawSum) - p10(rawSum) = ${spread.toFixed(2)}`);
console.log(`K = round(40 / ${spread.toFixed(2)}, 1) = ${K}\n`);

// Step 2 — re-score with the calibrated K to re-anchor BAND_MARGIN.
const calibratedConfig = { ...liveConfig, mappingConstantUp: K, mappingConstantDown: K };
const calibratedScores = scoreDistribution(calibratedConfig);
report("Calibrated score distribution (K=" + K + ")", calibratedScores);

const p25 = percentile(calibratedScores, 0.25);
const p75 = percentile(calibratedScores, 0.75);
const BAND_MARGIN = Math.round((p75 - p25) / 2);
console.log(`\nBAND_MARGIN = round((p75 - p25) / 2) = round((${p75.toFixed(1)} - ${p25.toFixed(1)}) / 2) = ${BAND_MARGIN}\n`);

console.log("── Apply ──────────────────────────────────────────");
console.log(`1. src/lib/scoringDefaults.ts: mappingConstantUp/mappingConstantDown = ${K}`);
console.log(`2. src/components/FandexScoreBadge.tsx: BAND_MARGIN = ${BAND_MARGIN}`);
console.log(`3. PUT /api/dev/scoring (admin session) with the live config's roleWeights/`);
console.log(`   priorStrength/topTags*/topPeople/topCompanies unchanged and`);
console.log(`   mappingConstantUp/mappingConstantDown = ${K}, to persist into the LIVE DB.`);

// Matches rehearse-prune.mjs's convention: leave the copy for inspection
// rather than rmSync it — better-sqlite3 holds a Windows file handle open on
// the WAL file for the life of this process, so an immediate rmSync EPERMs
// there (POSIX doesn't care, but this repo runs on Windows).
console.log(`\nCopy left at ${copyPath} for inspection.`);
