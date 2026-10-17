// Put well-known books into the scoring pool, on D1.
//
//   node worker/scripts/seed-books.mjs --local|--remote [--apply] [--limit 300]
//
// The pool grows only when somebody acts on a title, so on the day books arrived
// (2026-10-17) it held none, and Discover, "More like this" and the score's
// candidate list had no book to offer anybody. This fills it once with what
// Open Library's readers read most: its trending lists, plus the most wanted
// books of eight fiction subjects (trending alone is mostly self-help).
//
// What it does:
//   1. builds the list from Open Library directly (no Worker involved);
//   2. opens each through the Worker's own /v1/resolve, so every book is
//      ingested by the same code as a person opening it (browsed = 1);
//      paced under the route's 30 a minute;
//   3. with --apply, moves those rows into the pool (browsed = 0) and drops the
//      kept pool count in the same command (worker/src/keptCounts.ts).
//
// Without --apply it stops after step 2: the books exist as opened titles and
// nothing changes for anybody. Undoing step 3 is the same UPDATE with
// browsed = 1, plus dropping the pool count again.
//
// Cost: one resolve is one row in budget "fetch" (cap 2,000 a day) and roughly
// ten row writes. 300 books is about 3,000 of D1's 100,000 a day.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const flags = process.argv.slice(2);
const where = flags.includes("--remote") ? "--remote" : flags.includes("--local") ? "--local" : null;
if (!where) {
  console.error("usage: node worker/scripts/seed-books.mjs --local|--remote [--apply] [--limit 300]");
  process.exit(2);
}
const apply = flags.includes("--apply");
const limitAt = flags.indexOf("--limit");
const LIMIT = limitAt >= 0 ? Number(flags[limitAt + 1]) || 300 : 300;
const API = where === "--remote" ? "https://fandex-api.fandex-worker.workers.dev" : "http://127.0.0.1:8787";
const UA = "Fandex/1.0 (https://fandex.org; hello@fandex.org)";
const SUBJECTS = ["science_fiction", "fantasy", "mystery", "thriller", "romance", "horror", "young_adult_fiction", "classic_literature"];
const workerDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

async function ol(p) {
  const res = await fetch(`https://openlibrary.org${p}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Open Library ${res.status} ${p}`);
  return res.json();
}
const workId = (doc) => /\/works\/(OL\d+W)$/.exec(String(doc?.key ?? ""))?.[1] ?? null;

const ids = [];
const seen = new Set();
const add = (docs) => {
  for (const d of docs ?? []) {
    const id = workId(d);
    if (!id || seen.has(id) || !d.cover_i) continue;
    seen.add(id);
    ids.push(id);
  }
};
for (const p of ["monthly", "yearly"]) add((await ol(`/trending/${p}.json?limit=100`)).works);
for (const s of SUBJECTS) {
  add((await ol(`/search.json?subject=${s}&sort=want_to_read&fields=key,title,cover_i&limit=40`)).docs);
}
const list = ids.slice(0, LIMIT);
console.log(`${list.length} books to open through ${API}`);

const opened = [];
const failed = [];
for (const [i, id] of list.entries()) {
  const started = Date.now();
  const res = await fetch(`${API}/v1/resolve/openlibrary/book/${id}`);
  const body = await res.json().catch(() => null);
  if (res.ok && body?.id) opened.push(body.id);
  else failed.push({ id, status: res.status, body });
  if (res.status === 429) { console.log("rate limited, waiting a minute"); await new Promise((r) => setTimeout(r, 61_000)); }
  if ((i + 1) % 25 === 0) console.log(`${i + 1}/${list.length} opened, ${failed.length} failed`);
  const wait = 2100 - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
console.log(`opened ${opened.length}, failed ${failed.length}`);
if (failed.length) console.log(JSON.stringify(failed.slice(0, 10)));

const out = path.join(workerDir, "..", "data", "backups", `seed-books-${where.slice(2)}-${Date.now()}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ opened, failed }, null, 2));
console.log(`ids written to ${out}`);

if (!apply) {
  console.log("dry run: nothing moved into the pool. Re-run with --apply.");
  process.exit(0);
}
const unique = [...new Set(opened)];
const quoted = unique.map((id) => `'${id.replace(/'/g, "")}'`).join(",");
const sql = `UPDATE media_items SET browsed = 0, updated_at = unixepoch() WHERE browsed = 1 AND type = 'book' AND id IN (${quoted}); DELETE FROM kv WHERE key = 'pool_count';`;
// A file, not --command: 300 ids overrun Windows' 8,191-character command line.
const sqlFile = out.replace(/\.json$/, ".sql");
fs.writeFileSync(sqlFile, sql);
const wrangler = (args) => execFileSync("npx", ["wrangler", "d1", "execute", "fandex", where, ...args, "--json", "--yes"], {
  cwd: workerDir, encoding: "utf8", shell: true,
});
wrangler(["--file", JSON.stringify(sqlFile)]);
// --file reports no row counts, so the result is read back.
const books = JSON.parse(wrangler(["--command", JSON.stringify("SELECT COUNT(*) AS n FROM media_items WHERE type = 'book' AND browsed = 0")]));
console.log(`books in the pool now: ${books[0]?.results?.[0]?.n}; pool count dropped`);
