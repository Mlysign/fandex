// One-off: what does the franchise/IP facet actually DO to a real library?
// Scores every library item twice — topIps 0 (franchise off) vs 1 (on) — and
// reports the franchises the user has an opinion about plus the biggest movers.
// Usage: node scripts/probe-ip-impact.mjs <db> [--config <json>]
import { registerHooks } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import "better-sqlite3";
import { resolve } from "./alias-hooks.mjs";
registerHooks({ resolve });

const argv = process.argv.slice(2);
const cf = argv.indexOf("--config");
const configPath = cf >= 0 ? argv.splice(cf, 2)[1] : null;
const sourcePath = argv[0];

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-ip-"));
const copyPath = path.join(workDir, "probe.db");
for (const [s, d] of [["", copyPath], ["-wal", `${copyPath}-wal`], ["-shm", `${copyPath}-shm`]]) {
  if (fs.existsSync(`${sourcePath}${s}`)) fs.copyFileSync(`${sourcePath}${s}`, d);
}
process.env.DB_PATH = copyPath;

const { query, get } = await import("../src/lib/db.ts");
const { buildProfile, computeFandexScore } = await import("../src/lib/discovery.ts");
const { getScoringConfig } = await import("../src/lib/scoringConfig.ts");
const { mergeLinks } = await import("../src/lib/merge.ts");
const { extractFacets } = await import("../src/lib/facets.ts");
const { getUserCountry } = await import("../src/lib/userCountry.ts");

const userId = argv[1] ?? get("SELECT id FROM users ORDER BY created_at LIMIT 1")?.id;
const imported = configPath ? JSON.parse(fs.readFileSync(configPath, "utf8")) : null;
const base = imported?.config ?? getScoringConfig();
const categoryWeights = imported?.categories
  ? new Map(imported.categories.map((c) => [c.id, { weight: c.weight, ignored: !!c.ignored }]))
  : undefined;

const rows = query(
  `SELECT mi.id, mi.type, mi.title, ml.source, ml.source_id, ml.raw_data, ml.release_date rd
     FROM user_library ul JOIN media_items mi ON mi.id = ul.media_item_id
     LEFT JOIN media_links ml ON ml.media_item_id = mi.id WHERE ul.user_id = ?`,
  [userId]
);
const items = new Map();
for (const r of rows) {
  if (!items.has(r.id)) items.set(r.id, { title: r.title, type: r.type, links: [] });
  if (r.source) items.get(r.id).links.push({
    id: "", mediaItemId: r.id, source: r.source, sourceId: r.source_id,
    title: null, releaseDate: r.rd, rawData: JSON.parse(r.raw_data ?? "{}"), lastSynced: 0,
  });
}
const country = getUserCountry(userId);

const profile = buildProfile(userId, { config: base, categoryWeights });
console.log(`\nYour rating baseline: ${profile.baseline.toFixed(2)} (center ${(profile.baseline * 10).toFixed(1)})\n`);

// What the profile learned about franchises.
const ipStats = [];
for (const [id, m] of profile.meta) {
  if (m.kind === "ip") ipStats.push({ label: m.label, dev: profile.w.get(id), BA: m.BA, n: m.n });
}
ipStats.sort((a, b) => b.BA - a.BA);
console.log(`Franchises your profile has an opinion about: ${ipStats.length}\n`);
const show = (list, head) => {
  console.log(head);
  for (const s of list) {
    console.log(`  ${s.label.padEnd(34)} you rate ${s.BA.toFixed(2)} over ${String(s.n).padStart(2)} rated → dev ${s.dev >= 0 ? "+" : ""}${s.dev.toFixed(2)}`);
  }
  console.log("");
};
show(ipStats.filter((s) => s.n >= 3).slice(0, 12), "── Highest-rated franchises (3+ rated titles) ──");
show(ipStats.filter((s) => s.n >= 3).slice(-8), "── Lowest-rated franchises (3+ rated titles) ──");

function scoreAll(topIps) {
  const cfg = { ...base, topIps };
  const p = buildProfile(userId, { config: cfg, categoryWeights });
  const out = new Map();
  for (const [id, { title, type, links }] of items) {
    const merged = mergeLinks(links, type, country);
    const fx = computeFandexScore(extractFacets(links, type, merged), p, cfg);
    if (fx) out.set(id, { title, type, score: fx.score });
  }
  return out;
}
const off = scoreAll(0);
const on = scoreAll(1);

const moved = [];
for (const [id, a] of off) {
  const b = on.get(id);
  if (b && Math.abs(b.score - a.score) > 0.05) moved.push({ ...a, after: b.score, delta: b.score - a.score });
}
moved.sort((a, b) => b.delta - a.delta);
console.log(`Items whose score MOVED: ${moved.length} of ${off.size}\n`);
const row = (m) => `  ${(m.delta >= 0 ? "+" : "") + m.delta.toFixed(1)}`.padEnd(9) + `${m.score.toFixed(0)} → ${m.after.toFixed(0)}`.padEnd(12) + `${m.type.padEnd(6)} ${m.title}`;
console.log("── Biggest gains ──");
moved.slice(0, 12).forEach((m) => console.log(row(m)));
console.log("\n── Biggest drops ──");
moved.slice(-8).forEach((m) => console.log(row(m)));
console.log(`\nCopy left at ${copyPath}`);
