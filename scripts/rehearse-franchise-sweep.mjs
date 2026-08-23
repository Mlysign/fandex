// Rehearse the franchise membership sweep against a COPY of the database.
//
// Same shape and the same ordering constraint as scripts/probe-pool.mjs and
// scripts/rehearse-prune.mjs: alias-hooks only affects LATER imports, and
// DB_PATH must be set before db.ts is imported because it reads the path at
// module load.
//
// This makes REAL provider calls (TMDB /collection/{id}, IGDB /games) and WRITES
// franchise_members rows, so point it at a copy:
//
//   cp data/rr.db /tmp/probe.db
//   DB_PATH=/tmp/probe.db node scripts/rehearse-franchise-sweep.mjs
//
// It exists because the sweep's own route is admin-gated and there is no shell
// on the Railway volume — this is how the logic gets exercised end to end
// before it reaches prod, and how the per-provider member counts that decided
// the design (TMDB ~4.8 per collection, IGDB ~78) can be re-measured.
import { registerHooks } from "node:module";
import fs from "node:fs";
import path from "node:path";
// Load-bearing, same as in migrate.mjs — see the comment there before "tidying".
import "better-sqlite3";
import { resolve } from "./alias-hooks.mjs";

registerHooks({ resolve });

const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));

// Minimal .env reader — the app relies on Next to inject these, and this runs
// under plain node.
const envPath = path.join(REPO, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

if (!process.env.DB_PATH) {
  console.error("Refusing to run without DB_PATH — this WRITES. Point it at a copy.");
  process.exit(1);
}

const TMDB_N = Number(process.env.SWEEP_TMDB ?? 8);
const IGDB_N = Number(process.env.SWEEP_IGDB ?? 3);

const { surveyFranchises, runFranchiseSweep } = await import("@/lib/franchiseSweep");
const { franchiseSweepStats, getFranchiseMembers } = await import("@/lib/franchiseMembers");

const targets = surveyFranchises();
const bySource = { tmdb: 0, igdb: 0 };
for (const t of targets) bySource[t.source]++;
console.log(`survey: ${targets.length} targets (tmdb ${bySource.tmdb}, igdb ${bySource.igdb})`);

for (const [source, n] of [["tmdb", TMDB_N], ["igdb", IGDB_N]]) {
  if (!n) continue;
  console.log(`\n--- sweeping ${n} ${source} ---`);
  // maxAgeSec 0 = re-sweep everything, so a rehearsal is repeatable.
  const r = await runFranchiseSweep({ source, maxItems: n, maxAgeSec: 0, budgetMs: 90_000 });
  console.log(`processed=${r.processed} written=${r.written} failed=${r.failed} remaining=${r.remaining}`);
  for (const d of r.detail) {
    console.log(`   ${String(d.members).padStart(4)}  ${d.name}${d.error ? "   ERROR " + d.error : ""}`);
  }
  const withMembers = r.detail.filter((d) => !d.error);
  if (withMembers.length) {
    const avg = withMembers.reduce((s, d) => s + d.members, 0) / withMembers.length;
    console.log(`   avg members per ${source} franchise: ${avg.toFixed(1)}`);
  }
}

console.log("\n--- stored ---");
console.log(franchiseSweepStats());

const probe = process.env.SWEEP_PROBE_KEY ?? "star wars";
const members = getFranchiseMembers(probe);
console.log(`\n--- getFranchiseMembers(${JSON.stringify(probe)}) → ${members.length} ---`);
for (const m of members.slice(0, 8)) {
  console.log(`   [${m.source}] ${m.title} (${m.releaseDate ?? "?"})  pop=${m.popularity ?? "-"}`);
}
