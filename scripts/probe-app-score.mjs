// Does the app's Fandex Score agree with the site's?
//
// The app scores on the device with its own port of the maths
// (mobile/src/lib/fandexScore.ts), fed by what the Worker serves. This runs
// both over the same account and compares every title:
//
//   the site   buildProfile + computeFandexScore over a database snapshot
//   the app    the port, given the rated titles from that same snapshot and
//              the facets and taxonomy the LIVE Worker serves, which is what
//              a phone actually receives
//
// So a difference is one of three things: the port is wrong, the Worker
// derives a title's facets differently from the site, or D1 has drifted from
// the snapshot. The output says which titles differ and by how much.
//
//   BENCH_DB=/path/to/copy-of-snapshot.db node scripts/probe-app-score.mjs
//
// ⚠️ Point it at a COPY. Opening a database through db.ts runs its boot work.
import { registerHooks } from "node:module";
import fs from "node:fs";
import path from "node:path";
import "better-sqlite3";
import { resolve } from "./alias-hooks.mjs";

registerHooks({ resolve });

const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
for (const line of fs.readFileSync(path.join(REPO, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!process.env.BENCH_DB) throw new Error("Set BENCH_DB to a COPY of a database snapshot.");
process.env.DB_PATH = process.env.BENCH_DB;
const API = process.env.FANDEX_API ?? "https://fandex-api.fandex-worker.workers.dev";

const site = await import("@/lib/discovery");
const { query } = await import("@/lib/db");
const app = await import("../mobile/src/lib/fandexScore.ts");

// The account with the most ratings in the snapshot. No id is printed.
const userId = query(
  "SELECT user_id FROM user_item_state WHERE relation = 'library' AND rating > 0 GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1",
)[0]?.user_id;
if (!userId) throw new Error("The snapshot holds no rated titles.");

// ── The site's numbers ───────────────────────────────────────────────────────
site.find(userId, { limit: 1 }); // builds the pool
const siteProfile = site.buildProfile(userId);
const ctx = site.scoringContext();
const poolIds = query(`SELECT mi.id FROM media_items mi WHERE ${site.POOL_WHERE}`).map((r) => r.id);
const siteScores = new Map();
for (const id of poolIds) {
  const facets = site.getCatalogFacets(id);
  if (!facets) continue;
  const fx = site.computeFandexScore(facets, siteProfile, undefined, { mediaItemId: id, ctx });
  siteScores.set(id, fx ? fx.score : null);
}

// ── What a phone receives ────────────────────────────────────────────────────
const getJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
};
const taxonomy = app.prepareTaxonomy(await getJson(`${API}/v1/taxonomy`));
const facetsById = new Map();
let cursor = { since: 0, after: "" };
for (let page = 0; page < 500; page++) {
  const res = await getJson(`${API}/v1/catalog/delta?since=${cursor.since}&after=${encodeURIComponent(cursor.after)}&limit=200`);
  for (const it of res.items) facetsById.set(it.vector.id, it.facets);
  cursor = res.next;
  if (res.done) break;
}

// Your rating for a title: the average of the per-provider scores above zero,
// to one decimal. The same rule as the site's user_library view and the app's shelf.
const rated = query(
  `SELECT media_item_id id, ROUND(AVG(rating), 1) rating FROM user_item_state
    WHERE user_id = ? AND relation = 'library' AND rating > 0 GROUP BY media_item_id`,
  [userId],
);
const ratedTitles = rated.filter((r) => facetsById.has(r.id)).map((r) => ({ id: r.id, rating: r.rating, facets: facetsById.get(r.id) }));
const appProfile = app.buildProfile(ratedTitles, taxonomy);

// ── Compare ──────────────────────────────────────────────────────────────────
let both = 0, same = 0, within = 0, onlySite = 0, onlyApp = 0, nullDisagree = 0;
const diffs = [];
for (const [id, s] of siteScores) {
  const raw = facetsById.get(id);
  if (!raw) { onlySite++; continue; }
  const a = app.computeFandexScore(raw, id, appProfile, taxonomy)?.score ?? null;
  both++;
  if (s === null || a === null) {
    if (s === a) same++; else nullDisagree++;
    continue;
  }
  const d = Math.abs(s - a);
  if (d < 0.05) same++;
  else if (d <= 0.5) within++;
  if (d >= 0.05) diffs.push({ id, site: s, app: a, d });
}
for (const id of facetsById.keys()) if (!siteScores.has(id)) onlyApp++;
diffs.sort((x, y) => y.d - x.d);

console.log(`site: baseline ${siteProfile.baseline.toFixed(4)}, ${siteProfile.ratedItemCount} rated, ${siteProfile.w.size} facets with an opinion`);
console.log(`app:  baseline ${appProfile.baseline.toFixed(4)}, ${appProfile.ratedItemCount} rated, ${appProfile.w.size} facets with an opinion`);
console.log(`rated in the snapshot: ${rated.length}, of which the Worker serves ${ratedTitles.length}`);
console.log(`titles compared: ${both}  (in the snapshot's pool only: ${onlySite}, served by the Worker only: ${onlyApp})`);
console.log(`identical: ${same}   within half a point: ${within}   further apart: ${diffs.length - within}   one side has no score: ${nullDisagree}`);
if (diffs.length) {
  const title = (id) => query("SELECT title FROM media_items WHERE id = ?", [id])[0]?.title ?? id;
  console.log("largest differences:");
  for (const d of diffs.slice(0, 12)) console.log(`  ${d.d.toFixed(1).padStart(5)}  site ${String(d.site).padStart(6)}  app ${String(d.app).padStart(6)}  ${title(d.id)}`);
}
