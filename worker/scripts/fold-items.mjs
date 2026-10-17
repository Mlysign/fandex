// Fold duplicate titles into the title they duplicate, on D1.
//
//   node worker/scripts/fold-items.mjs <pairs.json> --local|--remote [--apply] [--move-user-rows]
//
// pairs.json is [{ port, target, title }], item ids. Without --apply it checks
// and backs up, and prints what it would do. With --apply it runs the deletes.
//
// Written for the 66 IGDB console ports and editions that sat in the pool as
// titles of their own (2026-10-15, docs/archive/history.md "game ports"). The
// door they came in by is shut in two places: game search leaves ports out
// (src/lib/sources/igdb.ts) and opening one opens its main game
// (worker/src/catalog/resolve.ts).
//
// What it does, per pair:
//
//   • REFUSES if any user row points at the duplicate (state, episodes,
//     hidden, a taxonomy denial). Moving a person's rating means choosing which
//     of two ratings wins, and that is a decision for a person, not a script
//     (AGENTS.md, the OAuth merge rule). On 2026-10-15 none did.
//   • moves item_ip_override (no foreign key, so nothing cascades into it);
//   • deletes the duplicate's doc, external ids, links and row, each by name
//     rather than trusting the cascade;
//   • then drops the kept pool count and every kept user count
//     (worker/src/keptCounts.ts): a device holding more titles than the pool
//     re-downloads its catalog once, which is how a phone forgets the deleted
//     rows.
//
// The backup (every deleted row, raw_data included) goes to data/backups/,
// which is gitignored. Undoing is re-inserting those rows and dropping the
// kept counts again.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [pairsFile, ...flags] = process.argv.slice(2);
const where = flags.includes("--remote") ? "--remote" : flags.includes("--local") ? "--local" : null;
if (!pairsFile || !where) {
  console.error("usage: node worker/scripts/fold-items.mjs <pairs.json> --local|--remote [--apply]");
  process.exit(2);
}
const apply = flags.includes("--apply");
const WORKER = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
const ROOT = path.resolve(WORKER, "..");

const pairs = JSON.parse(fs.readFileSync(pairsFile, "utf8"));
const UUID = /^[0-9a-f-]{36}$/;
if (!pairs.length || pairs.some((p) => !UUID.test(p.port) || !UUID.test(p.target) || p.port === p.target)) throw new Error("pairs must be distinct item ids");
const ports = new Set(pairs.map((p) => p.port));
if (pairs.some((p) => ports.has(p.target))) throw new Error("a target is itself being folded");

// Wrangler's own script under node, with no shell: through `npx.cmd` Windows
// splits a SQL argument at its spaces.
const WRANGLER = path.join(WORKER, "node_modules", "wrangler", "bin", "wrangler.js");
function d1(args) {
  const out = execFileSync(process.execPath, [WRANGLER, "d1", "execute", "fandex", where, "--json", ...args], { cwd: WORKER, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.slice(out.indexOf("[")));
}
/** One SELECT, with the id list inlined (ids are checked against UUID above). */
function query(sql) {
  const [r] = d1(["--command", sql.replace(/\s+/g, " ")]);
  return r.results;
}
const list = (ids) => ids.map((id) => `'${id}'`).join(",");
const portList = list([...ports]);

// ── 1. Nothing personal on a duplicate ───────────────────────────────────────
//
// With --move-user-rows, a library or wishlist row on a duplicate is carried
// over instead of refused, in the two cases where no choice is involved
// (2026-10-17, the RAWG-only and Steam-only game twins):
//   • the kept title has no row for that account, source and relation: the
//     row moves to it, and nothing is lost;
//   • it has one with the same status and rating: the duplicate's is the same
//     fact twice, and it is dropped.
// Any other overlap (two ratings that differ, a status that differs) still
// refuses: which one wins is the person's call (AGENTS.md, the merge rule).
const moveUserRows = flags.includes("--move-user-rows");
const userSql = [];
let userBackup = [];
if (moveUserRows) {
  const onPorts = query(`SELECT * FROM user_item_state WHERE media_item_id IN (${portList})`);
  const targetOf = new Map(pairs.map((p) => [p.port, p.target]));
  const onTargets = query(`SELECT * FROM user_item_state WHERE media_item_id IN (${list([...new Set(pairs.map((p) => p.target))])})`);
  const conflicts = [];
  for (const r of onPorts) {
    const target = targetOf.get(r.media_item_id);
    const same = onTargets.find((t) => t.media_item_id === target && t.user_id === r.user_id && t.source === r.source && t.relation === r.relation);
    const at = `user_id = '${r.user_id}' AND media_item_id = '${r.media_item_id}' AND source = '${r.source}' AND relation = '${r.relation}'`;
    if (!same) userSql.push(`UPDATE user_item_state SET media_item_id = '${target}', updated_at = unixepoch() WHERE ${at};`);
    else if (same.rating === r.rating && same.status === r.status) userSql.push(`DELETE FROM user_item_state WHERE ${at};`);
    else conflicts.push(`${r.source}/${r.relation} on ${r.media_item_id}: ${r.status} ${r.rating ?? "-"} here, ${same.status} ${same.rating ?? "-"} on ${target}`);
  }
  if (conflicts.length) throw new Error(`these rows disagree with the kept title's, and which wins is a person's call:\n  ${conflicts.join("\n  ")}`);
  userBackup = onPorts;
  if (/[^0-9a-z_-]/i.test(onPorts.map((r) => r.user_id + r.source + r.relation).join(""))) throw new Error("unexpected characters in a user row key");
  console.log(`${onPorts.length} user row(s) on the duplicates: ${userSql.filter((s) => s.startsWith("UPDATE")).length} move, ${userSql.filter((s) => s.startsWith("DELETE")).length} are the same fact twice and go.`);
}
const personal = [
  ...(moveUserRows ? [] : [["user_item_state", `media_item_id IN (${portList})`]]),
  ["user_episode_state", `media_item_id IN (${portList})`],
  ["user_hidden_items", `media_item_id IN (${portList})`],
  ["taxonomy_suggestion_dismissed", `substr(ref, 1, 36) IN (${portList})`],
];
for (const [table, cond] of personal) {
  const [{ n }] = query(`SELECT COUNT(*) n FROM ${table} WHERE ${cond}`);
  if (n) throw new Error(`${n} row(s) in ${table} point at a duplicate. Refusing: decide those by hand first.`);
}
const targets = query(`SELECT id FROM media_items WHERE id IN (${list([...new Set(pairs.map((p) => p.target))])})`);
if (targets.length !== new Set(pairs.map((p) => p.target)).size) throw new Error("a target is missing from media_items");
const present = query(`SELECT id FROM media_items WHERE id IN (${portList})`).map((r) => r.id);
console.log(`${pairs.length} pairs, ${present.length} duplicates still present${moveUserRows ? '' : ', no user rows on any'}.`);
if (!present.length) process.exit(0);

// ── 2. Back up every row that goes ───────────────────────────────────────────
const backup = {};
for (const table of ["media_items", "media_links", "item_doc", "media_external_ids", "item_ip_override"]) {
  backup[table] = query(`SELECT * FROM ${table} WHERE ${table === "media_items" ? "id" : "media_item_id"} IN (${portList})`);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupFile = path.join(ROOT, "data", "backups", `fold-items-${where.slice(2)}-${stamp}.json`);
fs.mkdirSync(path.dirname(backupFile), { recursive: true });
fs.writeFileSync(backupFile, JSON.stringify({ pairs, rows: { ...backup, user_item_state: userBackup } }));
console.log(`backup: ${path.relative(ROOT, backupFile)} (${Object.entries(backup).map(([t, r]) => `${t} ${r.length}`).join(", ")})`);

// ── 3. The statements ───────────────────────────────────────────────────────
const sql = [...userSql];
for (const { port, target } of pairs) {
  sql.push(`UPDATE OR IGNORE item_ip_override SET media_item_id = '${target}' WHERE media_item_id = '${port}';`);
  for (const t of ["item_ip_override", "item_doc", "media_external_ids", "media_links"]) sql.push(`DELETE FROM ${t} WHERE media_item_id = '${port}';`);
  sql.push(`DELETE FROM media_items WHERE id = '${port}';`);
}
sql.push("DELETE FROM kv WHERE key = 'pool_count';");
sql.push("UPDATE users SET counted_items = NULL, counted_episodes = NULL, counted_hidden = NULL WHERE counted_items IS NOT NULL OR counted_episodes IS NOT NULL OR counted_hidden IS NOT NULL;");
const sqlFile = backupFile.replace(/\.json$/, ".sql");
fs.writeFileSync(sqlFile, sql.join("\n") + "\n");
console.log(`${sql.length} statements in ${path.relative(ROOT, sqlFile)}`);

if (!apply) {
  console.log("Dry run. Add --apply to run them.");
  process.exit(0);
}
d1(["--file", sqlFile, "--yes"]);

// ── 4. Check ─────────────────────────────────────────────────────────────────
const [{ n: left }] = query(`SELECT COUNT(*) n FROM media_items WHERE id IN (${portList})`);
const [{ n: links }] = query(`SELECT COUNT(*) n FROM media_links WHERE media_item_id IN (${portList})`);
const [{ n: docs }] = query(`SELECT COUNT(*) n FROM item_doc WHERE media_item_id IN (${portList})`);
const [{ n: kept }] = query("SELECT COUNT(*) n FROM kv WHERE key = 'pool_count'");
console.log(`after: ${left} duplicates, ${links} links, ${docs} docs left; pool count kept: ${kept ? "yes (recounted since)" : "dropped"}`);
if (left || links || docs) process.exit(1);
