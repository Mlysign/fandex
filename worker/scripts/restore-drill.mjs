// Restore one day of the nightly D1 export into a scratch database, and say
// what came back and what did not.
//
//   node worker/scripts/restore-drill.mjs                # latest complete day
//   node worker/scripts/restore-drill.mjs 2026-10-05
//   node worker/scripts/restore-drill.mjs --no-base      # the export alone
//   node worker/scripts/restore-drill.mjs --no-live      # skip the comparison with live D1
//
// Why this exists (2026-10-05): Railway is gone, so D1 is the only live copy
// of the library, and an export nobody has read back is a hope, not a backup.
//
// The scratch database is a LOCAL SQLite file, not a second D1. A scratch D1
// would spend most of the account's 100,000 row writes for the day, and the
// live database shares that allowance.
//
// The export leaves out the provider blobs and the derived docs on purpose
// (worker/src/cron.ts), so on its own it restores every row and none of the
// catalog's content. The BASE fills that in: the seed built from the last
// Railway snapshot (data/d1-seed, from worker/scripts/build-seed.mjs). The
// drill applies the base, lays the export over it, and reports what is still
// missing a blob afterwards. That list is what a real restore would have to
// refetch from the providers.
//
// Read-only against R2 and D1. Writes under data/d1-restore/, which git ignores.
// Needs `wrangler` logged in (cd worker && npx wrangler login).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.join(here, "..");
const root = path.join(workerDir, "..");
const BUCKET = "fandex-backups";

const args = process.argv.slice(2);
const useBase = !args.includes("--no-base");
const useLive = !args.includes("--no-live");
const dayArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const seedDir = path.join(root, "data", "d1-seed");

/** Run wrangler, resolve with its output. Never rejects: the caller decides what a failure means. */
function wrangler(argv) {
  return new Promise((resolve) => {
    // shell: true so the `npx` shim resolves on Windows. Every argument is built
    // from constants and validated identifiers in this file.
    const child = spawn("npx", ["wrangler", ...argv], { cwd: workerDir, shell: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

/**
 * Fetch one object. `null` means the key does not exist, which is how a table's
 * chunk chain ends. Any OTHER failure throws: a download error read as "no more
 * chunks" would restore a truncated table and call it complete.
 */
async function getObject(key, dest) {
  for (let attempt = 1; ; attempt++) {
    const res = await wrangler(["r2", "object", "get", `${BUCKET}/${key}`, "--file", JSON.stringify(dest), "--jurisdiction", "eu", "--remote"]);
    if (res.code === 0 && fs.existsSync(dest)) return fs.readFileSync(dest, "utf8");
    const text = `${res.out}\n${res.err}`;
    if (/does not exist|NoSuchKey|not found|10007/i.test(text)) return null;
    if (attempt >= 3) throw new Error(`could not fetch ${key}: ${text.trim().split("\n").slice(-2).join(" | ")}`);
  }
}

/** Run `tasks` (functions returning promises) at most `limit` at a time. */
async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  }));
  return results;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// ── 1. Find the day and download it ──────────────────────────────────────────

const candidates = dayArg ? [dayArg] : [utcDay(Date.now()), utcDay(Date.now() - 86_400_000)];
let day = null;
let manifest = null;
let outDir = null;
for (const d of candidates) {
  const dir = path.join(root, "data", "d1-restore", d);
  fs.mkdirSync(dir, { recursive: true });
  const text = await getObject(`d1/${d}/manifest.json`, path.join(dir, "manifest.json"));
  if (text) { day = d; manifest = JSON.parse(text); outDir = dir; break; }
}
if (!manifest) {
  console.error(`no manifest for ${candidates.join(" or ")}. A day without one is half an export and is not restored.`);
  process.exit(1);
}
console.log(`export ${day}: completed ${manifest.completedAt}, ${manifest.tables.length} tables, ${manifest.rows} rows`);

const exported = new Map();
let objects = 0;
await pool(manifest.tables.map((table) => async () => {
  if (!IDENT.test(table)) throw new Error(`refusing table name ${table}`);
  const rows = [];
  for (let offset = 0; ; ) {
    const part = String(offset).padStart(8, "0");
    const text = await getObject(`d1/${day}/${table}-${part}.json`, path.join(outDir, `${table}-${part}.json`));
    if (text === null) break;
    const chunk = JSON.parse(text);
    objects++;
    rows.push(...chunk);
    if (!chunk.length) break;
    offset += chunk.length;
  }
  exported.set(table, rows);
}), 6);

const exportedRows = [...exported.values()].reduce((a, r) => a + r.length, 0);
console.log(`downloaded ${objects} objects, ${exportedRows} rows`);

const problems = [];
// The check that catches a chunk chain cut short, whatever cut it.
if (exportedRows !== manifest.rows) problems.push(`row total ${exportedRows} differs from the manifest's ${manifest.rows}`);

// ── 2. Build the scratch database ────────────────────────────────────────────

const dbPath = path.join(outDir, "restore.db");
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
const db = new Database(dbPath);
db.pragma("journal_mode = OFF");
db.pragma("foreign_keys = OFF");
for (const f of fs.readdirSync(path.join(workerDir, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  db.exec(fs.readFileSync(path.join(workerDir, "migrations", f), "utf8"));
}

let baseFiles = [];
if (useBase) {
  baseFiles = fs.existsSync(seedDir)
    ? fs.readdirSync(seedDir).filter((f) => f.endsWith(".sql") && !f.includes(".deferred.")).sort()
    : [];
  if (!baseFiles.length) problems.push(`no base seed in ${path.relative(root, seedDir)}; restored the export alone`);
  for (const f of baseFiles) db.exec(fs.readFileSync(path.join(seedDir, f), "utf8"));
}
console.log(baseFiles.length ? `base: ${baseFiles.length} seed files applied` : "base: none");
// When each base blob was fetched, kept so a link the Worker has refreshed
// since can be told from one whose base blob is still current.
db.exec("CREATE TEMP TABLE base_links AS SELECT source, source_id, media_type, last_synced FROM media_links");

// Parents first, so the deletes below cascade the way they would in D1.
const order = ["tag_category", "users", "media_items", ...manifest.tables.filter((t) => !["tag_category", "users", "media_items"].includes(t))]
  .filter((t) => exported.has(t));

const perTable = {};
db.pragma("foreign_keys = ON");
for (const table of order) {
  const rows = exported.get(table);
  const info = db.prepare(`PRAGMA table_info("${table}")`).all();
  if (!info.length) { problems.push(`${table} is in the export and not in the schema`); continue; }
  const pk = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  const cols = rows.length ? Object.keys(rows[0]).filter((c) => IDENT.test(c)) : [];
  const unknown = cols.filter((c) => !info.some((i) => i.name === c));
  if (unknown.length) problems.push(`${table}: exported columns the schema lacks: ${unknown.join(", ")}`);
  // A column the export leaves out and the schema requires. The row cannot be
  // inserted without it, so it gets an empty marker and is counted below.
  const missingRequired = info.filter((c) => c.notnull && c.dflt_value === null && !c.pk && !cols.includes(c.name)).map((c) => c.name);

  // The same key twice means the OFFSET paging moved under a write between two
  // cron runs. One copy is kept; the count is reported.
  const seen = new Set();
  let duplicates = 0;
  const unique = [];
  for (const r of rows) {
    const k = JSON.stringify(pk.map((c) => r[c]));
    if (seen.has(k)) { duplicates++; continue; }
    seen.add(k);
    unique.push(r);
  }

  db.exec(`CREATE TEMP TABLE keep_${table} (k TEXT PRIMARY KEY) WITHOUT ROWID`);
  const keep = db.prepare(`INSERT INTO keep_${table} VALUES (?)`);
  const keyExpr = `json_array(${pk.map((c) => `"${c}"`).join(", ")})`;
  const run = db.transaction(() => {
    for (const k of seen) keep.run(k);
    // The export says which rows exist. A base row it does not name was deleted since.
    const removed = db.prepare(`DELETE FROM "${table}" WHERE ${keyExpr} NOT IN (SELECT k FROM keep_${table})`).run().changes;
    let inserted = 0;
    let updated = 0;
    if (cols.length) {
      const insertCols = [...cols, ...missingRequired];
      const exists = db.prepare(`SELECT 1 FROM "${table}" WHERE ${pk.map((c) => `"${c}" IS ?`).join(" AND ")}`);
      const insert = db.prepare(
        `INSERT INTO "${table}" (${insertCols.map((c) => `"${c}"`).join(", ")}) VALUES (${[...cols.map(() => "?"), ...missingRequired.map(() => "''")].join(", ")})`,
      );
      const setCols = cols.filter((c) => !pk.includes(c));
      const update = setCols.length
        ? db.prepare(`UPDATE "${table}" SET ${setCols.map((c) => `"${c}" = ?`).join(", ")} WHERE ${pk.map((c) => `"${c}" IS ?`).join(" AND ")}`)
        : null;
      for (const r of unique) {
        const key = pk.map((c) => r[c]);
        if (exists.get(...key)) { update?.run(...setCols.map((c) => r[c]), ...key); updated++; }
        else { insert.run(...cols.map((c) => r[c])); inserted++; }
      }
    }
    return { removed, inserted, updated };
  });
  const res = run();
  const restored = db.prepare(`SELECT COUNT(*) c FROM "${table}"`).get().c;
  perTable[table] = { exported: rows.length, duplicates, restored, ...res, missingRequired };
  if (duplicates) problems.push(`${table}: ${duplicates} rows exported twice`);
  if (restored !== unique.length) problems.push(`${table}: restored ${restored}, the export holds ${unique.length}`);
}

// ── 3. Is it whole? ──────────────────────────────────────────────────────────

const integrity = db.pragma("integrity_check", { simple: true });
if (integrity !== "ok") problems.push(`integrity_check: ${integrity}`);
const fk = db.prepare("PRAGMA foreign_key_check").all();
if (fk.length) {
  const by = {};
  for (const v of fk) by[`${v.table} -> ${v.parent}`] = (by[`${v.table} -> ${v.parent}`] ?? 0) + 1;
  problems.push(`foreign keys broken: ${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(", ")}`);
}

const q = (sql) => db.prepare(sql).all();
const content = {
  poolItems: q("SELECT COUNT(*) c FROM media_items WHERE browsed = 0")[0].c,
  poolItemsWithoutDoc: q("SELECT COUNT(*) c FROM media_items mi WHERE browsed = 0 AND NOT EXISTS (SELECT 1 FROM item_doc d WHERE d.media_item_id = mi.id)")[0].c,
  itemsWithoutDoc: q("SELECT COUNT(*) c FROM media_items mi WHERE NOT EXISTS (SELECT 1 FROM item_doc d WHERE d.media_item_id = mi.id)")[0].c,
  linksWithoutBlob: q("SELECT source, COUNT(*) c FROM media_links WHERE raw_data = '' GROUP BY source ORDER BY 2 DESC"),
  // The Worker refreshed these since the base was cut, so the restore holds the
  // older blob under the newer sync time. Refetchable, and stale until refetched.
  blobsOlderThanTheirLink: q(`SELECT l.source, COUNT(*) c FROM media_links l
                               JOIN base_links b ON b.source = l.source AND b.source_id = l.source_id AND b.media_type = l.media_type
                              WHERE l.last_synced > b.last_synced GROUP BY l.source ORDER BY 2 DESC`),
  userStateOnItemsWithoutDoc: q(`SELECT COUNT(DISTINCT s.media_item_id) c FROM user_item_state s
                                  WHERE NOT EXISTS (SELECT 1 FROM item_doc d WHERE d.media_item_id = s.media_item_id)`)[0].c,
  showsWithWatchedEpisodesAndNoEpisodeList: q(`SELECT COUNT(DISTINCT e.media_item_id) c FROM user_episode_state e
                                  WHERE NOT EXISTS (SELECT 1 FROM show_episodes x WHERE x.media_item_id = e.media_item_id)`)[0].c,
};

// ── 4. Against the live database ─────────────────────────────────────────────

let live = null;
if (useLive) {
  const d1 = async (sql) => {
    const res = await wrangler(["d1", "execute", "fandex", "--remote", "--json", "--command", JSON.stringify(sql)]);
    if (res.code !== 0) throw new Error(`d1 query failed: ${(res.err || res.out).trim().split("\n").slice(-2).join(" | ")}`);
    return JSON.parse(res.out.slice(res.out.indexOf("[")))[0].results;
  };
  const counts = (await d1(`SELECT ${order.map((t) => `(SELECT COUNT(*) FROM "${t}") "${t}"`).join(", ")}`))[0];
  live = { counts, drift: {} };
  // The personal tables row by row. The export is hours old, so a difference
  // here is drift to read, not a failure: it is what a restore would lose.
  for (const [table, key, cmp] of [
    ["user_item_state", ["user_id", "media_item_id", "source", "relation"], ["status", "rating", "review"]],
    ["user_episode_state", ["user_id", "media_item_id", "season_number", "episode_number"], ["watched_at"]],
    ["user_hidden_items", ["user_id", "media_item_id"], []],
  ]) {
    if (!exported.has(table)) continue;
    const colsSql = [...key, ...cmp].map((c) => `"${c}"`).join(", ");
    const liveRows = await d1(`SELECT ${colsSql} FROM "${table}"`);
    const mine = new Map(q(`SELECT ${colsSql} FROM "${table}"`).map((r) => [JSON.stringify(key.map((c) => r[c])), JSON.stringify(cmp.map((c) => r[c]))]));
    let onlyLive = 0;
    let differ = 0;
    const seenLive = new Set();
    for (const r of liveRows) {
      const k = JSON.stringify(key.map((c) => r[c]));
      seenLive.add(k);
      if (!mine.has(k)) onlyLive++;
      else if (mine.get(k) !== JSON.stringify(cmp.map((c) => r[c]))) differ++;
    }
    let onlyRestore = 0;
    for (const k of mine.keys()) if (!seenLive.has(k)) onlyRestore++;
    live.drift[table] = { live: liveRows.length, restored: mine.size, addedSinceExport: onlyLive, removedSinceExport: onlyRestore, changedSinceExport: differ };
  }
}

// ── 4b. The files a real restore would apply ─────────────────────────────────

// Written with --emit-sql, then loaded into a second empty database to prove
// they apply. For a real restore: a new D1, the migrations, then each file in
// order with `npx wrangler d1 execute <name> --remote --file=<file> --yes`.
// ⚠️ That is about as many row writes as the seed was (80,000), so it is a
// whole day's allowance on the free plan.
let emitted = null;
if (args.includes("--emit-sql")) {
  const sqlDir = path.join(outDir, "sql");
  fs.rmSync(sqlDir, { recursive: true, force: true });
  fs.mkdirSync(sqlDir);
  // Never restored: secrets and cursors (kv), counters that reset daily, and D1's own bookkeeping.
  const skip = new Set(["kv", "daily_budget", "d1_migrations"]);
  const all = q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((r) => r.name).filter((t) => !skip.has(t));
  const parents = ["tag_category", "users", "media_items"];
  const tables = [...parents, ...all.filter((t) => !parents.includes(t)).sort()];
  const lit = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const MAX = 90_000; // D1 caps a statement at 100,000 bytes
  emitted = { files: 0, rows: 0 };
  tables.forEach((table, i) => {
    const cols = db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
    const head = `INSERT INTO ${table} (${cols.join(", ")}) VALUES\n`;
    const file = path.join(sqlDir, `${String(i + 1).padStart(2, "0")}_${table}.sql`);
    const fd = fs.openSync(file, "w");
    let pending = [];
    let bytes = 0;
    let n = 0;
    const flush = () => { if (pending.length) fs.writeSync(fd, head + pending.join(",\n") + ";\n"); pending = []; bytes = 0; };
    for (const row of db.prepare(`SELECT * FROM "${table}"`).iterate()) {
      const tuple = `(${cols.map((c) => lit(row[c])).join(", ")})`;
      const size = Buffer.byteLength(tuple, "utf8");
      if (size + head.length > MAX) throw new Error(`${table}: one row is ${size} bytes, over the statement limit`);
      if (bytes + size > MAX - head.length) flush();
      pending.push(tuple);
      bytes += size + 2;
      n++;
    }
    flush();
    fs.closeSync(fd);
    if (n) { emitted.files++; emitted.rows += n; } else fs.unlinkSync(file);
  });

  const check = new Database(":memory:");
  for (const f of fs.readdirSync(path.join(workerDir, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    check.exec(fs.readFileSync(path.join(workerDir, "migrations", f), "utf8"));
  }
  check.pragma("foreign_keys = ON");
  for (const f of fs.readdirSync(sqlDir).sort()) check.exec(fs.readFileSync(path.join(sqlDir, f), "utf8"));
  for (const t of tables) {
    const a = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
    const b = check.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
    if (a !== b) problems.push(`emitted SQL: ${t} loads ${b} rows, the scratch database holds ${a}`);
  }
  if (check.prepare("PRAGMA foreign_key_check").all().length) problems.push("emitted SQL: foreign keys broken after loading");
  check.close();
  console.log(`\nemitted ${emitted.files} SQL files, ${emitted.rows} rows, and loaded them into an empty database with foreign keys on`);
}
db.close();

// ── 5. Report ────────────────────────────────────────────────────────────────

console.log("\ntable                     exported restored   live  note");
for (const t of order) {
  const p = perTable[t];
  if (!p) continue;
  const note = [p.duplicates ? `${p.duplicates} dup` : "", p.removed ? `${p.removed} base rows dropped` : "", p.inserted && baseFiles.length ? `${p.inserted} new since base` : "",
    p.missingRequired.length ? `no ${p.missingRequired.join(", ")}` : ""].filter(Boolean).join("; ");
  console.log(`${t.padEnd(25)} ${String(p.exported).padStart(8)} ${String(p.restored).padStart(8)} ${String(live?.counts?.[t] ?? "").padStart(6)}  ${note}`);
}
console.log("\ncontent", JSON.stringify(content, null, 2));
if (live) console.log("\nsince the export (live D1 against the restore)", JSON.stringify(live.drift, null, 2));

const report = { day, manifest, base: baseFiles, perTable, content, live, integrity, problems };
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(`\nscratch database: ${path.relative(root, dbPath)}`);
if (problems.length) {
  console.log(`\nPROBLEMS (${problems.length})`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(2);
}
console.log("\nno problems: every exported row restored, keys and foreign keys intact");
