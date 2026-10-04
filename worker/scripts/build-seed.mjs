// Build the D1 seed from a snapshot of the Railway database.
//
//   node worker/scripts/build-seed.mjs <snapshot.db> [out-dir]
//
// Writes numbered .sql files, to be applied in order with
// `wrangler d1 execute fandex --remote --file=<file>` (see seed-d1.mjs), and a
// summary.json with the row counts and the row-WRITE estimate.
//
// ⚠️ The output holds one person's library and identity rows. It goes under
// data/, which is gitignored. Never write it anywhere git can see.
//
// What moves and what does not:
//
//   • ITEMS: everything somebody acted on (`browsed = 0`) plus anything a user
//     row points at. Thin rows nobody touched are left behind on purpose: the
//     Worker refetches a title on demand, and every row seeded is row writes
//     out of a 100,000-a-day allowance.
//   • DOCS: derived HERE, by the Worker's own deriveItem(), from the stored
//     blobs. Not copied from media_item_projection: that table is a lazy cache
//     and a row in it can be stale.
//   • SLUGS: copied verbatim. A slug is immutable; recomputing one would move a
//     public url.
//   • IDENTITIES: google, trakt and steam only, and never a token. Trakt and
//     TMDB tokens live on the device now; the others are not sign-ins any more.
//   • franchise_members is written to its own file and is NOT in the default
//     apply list: it is 10k rows the minimal app does not read, and day one's
//     write budget is better spent elsewhere.

import { registerHooks } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { resolve } from "../../scripts/alias-hooks.mjs";

registerHooks({ resolve });
const here = path.dirname(fileURLToPath(import.meta.url));
const { deriveItem, buildVector, DERIVE_VERSION } = await import("../src/catalog/derive.ts");
const { normalizeName } = await import("../../src/lib/normalize.ts");

const snapshotPath = process.argv[2];
const outDir = process.argv[3] ?? path.join(here, "..", "..", "data", "d1-seed");
if (!snapshotPath) {
  console.error("usage: node worker/scripts/build-seed.mjs <snapshot.db> [out-dir]");
  process.exit(1);
}

const src = new Database(snapshotPath, { readonly: true, fileMustExist: true });
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) if (/\.(sql|json)$/.test(f)) fs.unlinkSync(path.join(outDir, f));

// ── SQL writing ──────────────────────────────────────────────────────────────

/** A SQL literal. Strings are single-quoted with quotes doubled; nothing else needs escaping in SQLite. */
function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  const s = String(v);
  if (s.includes("\u0000")) throw new Error("NUL byte in a seeded value");
  return `'${s.replace(/'/g, "''")}'`;
}

// D1 caps a statement at 100,000 bytes. Rows are packed into multi-row INSERTs
// up to well under that; a single row over it would have to be handled by hand.
const MAX_STATEMENT_BYTES = 90_000;

const summary = { files: [], rows: {}, writeEstimate: {}, notes: [] };

/**
 * @param {string} file           output file name
 * @param {string} table
 * @param {string[]} columns
 * @param {Iterable<any[]>} rows
 * @param {number} writesPerRow   b-trees one row touches (the table plus each index it lands in)
 */
function writeTable(file, table, columns, rows, writesPerRow) {
  const fd = fs.openSync(path.join(outDir, file), "a");
  const head = `INSERT INTO ${table} (${columns.join(", ")}) VALUES\n`;
  let pending = [];
  let pendingBytes = 0;
  let n = 0;
  const flush = () => {
    if (!pending.length) return;
    fs.writeSync(fd, head + pending.join(",\n") + ";\n");
    pending = [];
    pendingBytes = 0;
  };
  for (const row of rows) {
    const tuple = `(${row.map(lit).join(", ")})`;
    const bytes = Buffer.byteLength(tuple, "utf8");
    if (bytes + head.length > MAX_STATEMENT_BYTES) {
      throw new Error(`${table}: one row is ${bytes} bytes, over the statement limit`);
    }
    if (pendingBytes + bytes > MAX_STATEMENT_BYTES - head.length) flush();
    pending.push(tuple);
    pendingBytes += bytes + 2;
    n++;
  }
  flush();
  fs.closeSync(fd);
  summary.rows[table] = (summary.rows[table] ?? 0) + n;
  const writes = typeof writesPerRow === "function" ? writesPerRow(n) : n * writesPerRow;
  summary.writeEstimate[table] = (summary.writeEstimate[table] ?? 0) + writes;
  if (!summary.files.includes(file)) summary.files.push(file);
  return n;
}

// ── What to seed ─────────────────────────────────────────────────────────────

const SEED_WHERE = `(
  mi.browsed = 0
  OR mi.id IN (SELECT media_item_id FROM user_item_state)
  OR mi.id IN (SELECT media_item_id FROM user_episode_state)
  OR mi.id IN (SELECT media_item_id FROM user_hidden_items)
)`;

src.exec(`CREATE TEMP TABLE seed_items AS SELECT mi.id FROM media_items mi WHERE ${SEED_WHERE}`);
src.exec("CREATE INDEX temp.seed_items_id ON seed_items(id)");

// The site's pool is "browsed = 0 OR referenced by user_item_state". D1 has one
// flag for it, so a browsed row somebody holds state on is promoted here.
const inItemState = new Set(src.prepare("SELECT DISTINCT media_item_id id FROM user_item_state").all().map((r) => r.id));

const items = src.prepare(
  `SELECT mi.id, mi.type, mi.title, mi.release_date, mi.poster_url, mi.slug, mi.browsed, mi.created_at, mi.updated_at
     FROM media_items mi JOIN seed_items s ON s.id = mi.id ORDER BY mi.id`,
).all();

const linksByItem = new Map();
for (const l of src.prepare(
  `SELECT l.media_item_id, l.source, l.source_id, l.media_type, l.title, l.release_date, l.raw_data,
          l.last_synced, l.projection_version
     FROM media_links l JOIN seed_items s ON s.id = l.media_item_id
    ORDER BY l.media_item_id, l.last_synced`,
).all()) {
  const list = linksByItem.get(l.media_item_id);
  if (list) list.push(l); else linksByItem.set(l.media_item_id, [l]);
}

// ── Taxonomy first: nothing depends on the catalog ───────────────────────────

const copy = (file, table, columns, sql, writes = 1) =>
  writeTable(file, table, columns, src.prepare(sql).all().map((r) => columns.map((c) => r[c])), writes);

copy("01_taxonomy.sql", "tag_category", ["id", "label", "color", "weight", "ignored", "sort_order", "updated_at"],
  "SELECT id, label, color, weight, ignored, sort_order, updated_at FROM tag_category");
copy("01_taxonomy.sql", "tag_category_override", ["tag_key", "category_id", "updated_at"],
  "SELECT tag_key, category_id, updated_at FROM tag_category_override");
copy("01_taxonomy.sql", "tag_alias", ["alias_key", "canonical_key", "updated_at"],
  "SELECT alias_key, canonical_key, updated_at FROM tag_alias");
copy("01_taxonomy.sql", "ip_alias", ["alias_key", "canonical_key", "updated_at"],
  "SELECT alias_key, canonical_key, updated_at FROM ip_alias");
copy("01_taxonomy.sql", "item_ip_override", ["media_item_id", "ip_key", "label", "mode", "source", "updated_at"],
  "SELECT media_item_id, ip_key, label, mode, source, updated_at FROM item_ip_override");
copy("01_taxonomy.sql", "facet_label_override", ["kind", "key", "label", "updated_at"],
  "SELECT kind, key, label, updated_at FROM facet_label_override");
copy("01_taxonomy.sql", "scoring_config", ["id", "config", "version", "updated_at"],
  "SELECT id, config, version, updated_at FROM scoring_config");

// ── Items, docs, links ───────────────────────────────────────────────────────

const itemRows = [];
const docRows = [];
const linkRows = [];
let canonicalDrift = 0;
let poolCount = 0;

for (const it of items) {
  const links = linksByItem.get(it.id) ?? [];
  if (!links.length) {
    summary.notes.push(`skipped ${it.id} (${it.title}): no links`);
    continue;
  }
  if (!it.slug) throw new Error(`item ${it.id} has no slug; run the site's slug backfill first`);

  const parsed = links.map((l) => {
    let data = {};
    try { data = JSON.parse(l.raw_data); } catch { summary.notes.push(`unparseable blob on ${l.source}:${l.source_id}`); }
    return { source: l.source, sourceId: l.source_id, releaseDate: l.release_date, lastSynced: l.last_synced, data };
  });
  const derived = deriveItem(it.type, parsed);
  const vector = buildVector(derived, { id: it.id, slug: it.slug, createdAt: it.created_at });

  // The site wrote these three with the same mergeForCanonical. A difference
  // means its row was stale; the derived value is the one the doc agrees with.
  if (derived.canonical.title !== it.title || derived.canonical.releaseDate !== it.release_date) canonicalDrift++;

  const browsed = it.browsed === 0 || inItemState.has(it.id) ? 0 : 1;
  if (browsed === 0) poolCount++;

  itemRows.push([
    it.id, it.type, derived.canonical.title, normalizeName(derived.canonical.title), derived.canonical.releaseDate,
    derived.canonical.posterUrl, it.slug, browsed, derived.voteCount, derived.voteAverage, it.created_at, it.updated_at,
  ]);
  docRows.push([
    it.id, JSON.stringify(vector), JSON.stringify(derived.facets), JSON.stringify(derived.merged), DERIVE_VERSION,
  ]);
  for (const l of links) {
    linkRows.push([
      l.source, l.source_id, l.media_type, l.media_item_id, l.title, l.release_date, l.last_synced,
      l.projection_version, l.raw_data,
    ]);
  }
}
const seededIds = new Set(itemRows.map((r) => r[0]));

// One write for the table, one each for the (type, slug) and (type, norm_title)
// indexes, and one more for the partial pool index when the row is in the pool.
writeTable("02_items.sql", "media_items",
  ["id", "type", "title", "norm_title", "release_date", "poster_url", "slug", "browsed", "vote_count", "vote_average", "created_at", "updated_at"],
  itemRows, (n) => n * 3 + poolCount);
writeTable("03_docs.sql", "item_doc", ["media_item_id", "vector", "facets", "merged", "derive_version"], docRows, 1);

// The blobs are most of the bytes. Split so no single upload is enormous.
const LINKS_PER_FILE = 3000;
for (let i = 0; i < linkRows.length; i += LINKS_PER_FILE) {
  const part = String(i / LINKS_PER_FILE + 1).padStart(2, "0");
  writeTable(`04_links_${part}.sql`, "media_links",
    ["source", "source_id", "media_type", "media_item_id", "title", "release_date", "last_synced", "projection_version", "raw_data"],
    linkRows.slice(i, i + LINKS_PER_FILE), 2);
}

writeTable("05_external_ids.sql", "media_external_ids", ["source", "external_id", "media_item_id"],
  src.prepare(
    `SELECT DISTINCT e.source, e.external_id, e.media_item_id
       FROM media_external_ids e JOIN seed_items s ON s.id = e.media_item_id`,
  ).all().filter((r) => seededIds.has(r.media_item_id)).map((r) => [r.source, r.external_id, r.media_item_id]), 2);

writeTable("06_shows.sql", "show_seasons",
  ["media_item_id", "season_number", "name", "episode_count", "air_date", "poster_url", "overview", "updated_at"],
  src.prepare(
    `SELECT x.media_item_id, x.season_number, x.name, x.episode_count, x.air_date, x.poster_url, x.overview, x.updated_at
       FROM show_seasons x JOIN seed_items s ON s.id = x.media_item_id`,
  ).all().filter((r) => seededIds.has(r.media_item_id)).map((r) => Object.values(r)), 1);
writeTable("06_shows.sql", "show_episodes",
  ["media_item_id", "season_number", "episode_number", "title", "air_date", "runtime_minutes", "overview", "still_url", "updated_at"],
  src.prepare(
    `SELECT x.media_item_id, x.season_number, x.episode_number, x.title, x.air_date, x.runtime_minutes, x.overview,
            x.still_url, x.updated_at
       FROM show_episodes x JOIN seed_items s ON s.id = x.media_item_id`,
  ).all().filter((r) => seededIds.has(r.media_item_id)).map((r) => Object.values(r)), 1);

// ── Accounts ─────────────────────────────────────────────────────────────────

copy("07_users.sql", "users", ["id", "created_at", "last_seen_at", "country", "session_epoch", "platforms", "media_types"],
  "SELECT id, created_at, last_seen_at, country, session_epoch, platforms, media_types FROM users");
// Explicit columns, and no token column is even named. google / trakt / steam
// are the three ways to sign in; everything else was a sync credential.
copy("07_users.sql", "user_identities", ["provider", "provider_user_id", "user_id", "display_name", "avatar_url", "created_at"],
  `SELECT provider, provider_user_id, user_id, display_name, avatar_url, created_at
     FROM user_identities WHERE provider IN ('google', 'trakt', 'steam')`, 2);

const stateFilter = (rows) => rows.filter((r) => seededIds.has(r.media_item_id));
writeTable("08_user_state.sql", "user_item_state",
  ["user_id", "media_item_id", "source", "relation", "status", "rating", "review", "reviewed_at", "added_at", "updated_at"],
  stateFilter(src.prepare(
    `SELECT user_id, media_item_id, source, relation, status, rating, review, reviewed_at, added_at, added_at AS updated_at
       FROM user_item_state`,
  ).all()).map((r) => Object.values(r)), 1);
writeTable("08_user_state.sql", "user_hidden_items", ["user_id", "media_item_id", "hidden_at"],
  stateFilter(src.prepare("SELECT user_id, media_item_id, hidden_at FROM user_hidden_items").all()).map((r) => Object.values(r)), 1);
writeTable("09_user_episodes.sql", "user_episode_state",
  ["user_id", "media_item_id", "season_number", "episode_number", "watched_at", "sources", "updated_at"],
  stateFilter(src.prepare(
    `SELECT user_id, media_item_id, season_number, episode_number, watched_at, sources, updated_at FROM user_episode_state`,
  ).all()).map((r) => Object.values(r)), 1);

// ── Telemetry counters, so the history is not cut at the move ────────────────

copy("10_telemetry.sql", "page_view_daily", ["day", "path_key", "authed", "count"], "SELECT day, path_key, authed, count FROM page_view_daily");
copy("10_telemetry.sql", "referrer_daily", ["day", "ref_class", "count"], "SELECT day, ref_class, count FROM referrer_daily");
copy("10_telemetry.sql", "crawler_view_daily", ["day", "count"], "SELECT day, count FROM crawler_view_daily");

// ── Deferred: not in the default apply list ──────────────────────────────────

copy("90_franchise_members.deferred.sql", "franchise_members",
  ["ip_key", "source", "source_id", "type", "title", "release_date", "poster_url", "popularity", "fetched_at"],
  "SELECT ip_key, source, source_id, type, title, release_date, poster_url, popularity, fetched_at FROM franchise_members");

// ── Summary ──────────────────────────────────────────────────────────────────

const deferredWrites = summary.writeEstimate.franchise_members ?? 0;
const totalWrites = Object.values(summary.writeEstimate).reduce((a, b) => a + b, 0);
summary.items = { seeded: itemRows.length, pool: poolCount, canonicalDrift };
summary.totalWriteEstimate = { today: totalWrites - deferredWrites, deferred: deferredWrites };
summary.bytes = Object.fromEntries(summary.files.map((f) => [f, fs.statSync(path.join(outDir, f)).size]));
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

console.log(`seed written to ${outDir}`);
console.log(`items ${itemRows.length} (pool ${poolCount}), links ${linkRows.length}, canonical drift ${canonicalDrift}`);
console.log("rows", summary.rows);
console.log("row-write estimate", summary.totalWriteEstimate);
if (summary.notes.length) console.log("notes", summary.notes.slice(0, 10), summary.notes.length > 10 ? `(+${summary.notes.length - 10} more)` : "");
