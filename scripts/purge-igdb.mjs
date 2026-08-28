// Remove every stored trace of IGDB, for the day the answer comes back "no".
//
// The kill switch (`IGDB_ENABLED=0`) stops the FLOW: no more calls, no more
// stored rows. It does nothing about what is already on disk. This is that
// second, deliberate step — separate because deleting catalog data is not
// something a config flag should ever do by itself.
//
//   node scripts/purge-igdb.mjs data/rr.db            # report, changes nothing
//   node scripts/purge-igdb.mjs data/rr.db --apply    # actually delete
//
// ⚠️ SET IGDB_ENABLED=0 AND DEPLOY IT FIRST. Purging a running app that still
// calls IGDB just refills what you deleted, and burns the quota doing it.
//
// ⚠️ IT DELETES LINKS, NOT ITEMS. A media_items row survives with its uuid,
// slug, title and every user relation intact — so nobody's library loses an
// entry and no public URL starts 404ing. What goes is the igdb link row (with
// its raw_data), and the derived projection of any item that had one, because
// that projection was computed FROM the payload being deleted.
//
// ⚠️ An item whose ONLY link was igdb keeps its own columns (title, poster,
// release date) because those live on media_items, but it will have no provider
// link left: no refresh path, and it derives to nothing. Those are reported
// separately BEFORE anything is deleted, because that set is the real decision
// here and its size is not guessable in advance.
//
// Same alias-hooks + dynamic-import pattern as the other standalone scripts.
import fs from "node:fs";
import Database from "better-sqlite3";

const dbPath = process.argv[2];
const apply = process.argv.includes("--apply");
if (!dbPath) {
  console.error("usage: node scripts/purge-igdb.mjs <db-path> [--apply]");
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

// ⚠️ A WAL-mode database is the .db file PLUS its -wal. Copying only the .db
// gives a pre-WAL snapshot, and it reads as a perfectly valid database with
// stale contents. It cost a wrong number in this script's own dry run: 1,580
// projections reported against the 908 actually there, because a recent DELETE
// was still in the WAL. That is a bad way to decide what to purge, so say it.
if (fs.existsSync(dbPath + "-wal")) {
  const walMb = fs.statSync(dbPath + "-wal").size / 1e6;
  if (walMb > 0.1) console.log(`note: reading ${walMb.toFixed(1)} MB of WAL alongside the db\n`);
} else if (!dbPath.endsWith("data/rr.db")) {
  console.log("no -wal file next to this database. If you copied it from a live one,");
  console.log("copy the -wal too, or these counts are a stale snapshot.\n");
}

const one = (sql, ...p) => db.prepare(sql).get(...p);
const n = (sql, ...p) => Object.values(one(sql, ...p) ?? {})[0] ?? 0;

const links = n(`SELECT COUNT(*) FROM media_links WHERE source = 'igdb'`);
const items = n(`SELECT COUNT(DISTINCT media_item_id) FROM media_links WHERE source = 'igdb'`);
const bytes = n(`SELECT COALESCE(SUM(LENGTH(raw_data)), 0) FROM media_links WHERE source = 'igdb'`);

// The set that matters: items IGDB is the only source for.
const orphaned = db.prepare(
  `SELECT mi.id, mi.title, mi.slug,
          (SELECT COUNT(*) FROM user_item_state s WHERE s.media_item_id = mi.id) acted
     FROM media_items mi
    WHERE EXISTS (SELECT 1 FROM media_links l WHERE l.media_item_id = mi.id AND l.source = 'igdb')
      AND NOT EXISTS (SELECT 1 FROM media_links l WHERE l.media_item_id = mi.id AND l.source <> 'igdb')`
).all();
const orphanedActed = orphaned.filter((o) => o.acted > 0);

const hasProjection = !!one(`SELECT name FROM sqlite_master WHERE name = 'media_item_projection'`);
const projections = hasProjection
  ? n(`SELECT COUNT(*) FROM media_item_projection p
        WHERE EXISTS (SELECT 1 FROM media_links l WHERE l.media_item_id = p.media_item_id AND l.source = 'igdb')`)
  : 0;

console.log(`db: ${dbPath}`);
console.log(`mode: ${apply ? "APPLY (deletes)" : "REPORT ONLY"}\n`);
console.log(`igdb links                    ${String(links).padStart(7)}   ${(bytes / 1e6).toFixed(1)} MB of raw_data`);
console.log(`items carrying one            ${String(items).padStart(7)}`);
console.log(`derived projections to drop   ${String(projections).padStart(7)}${hasProjection ? "" : "   (table absent)"}`);
console.log(`\nitems whose ONLY source is igdb: ${orphaned.length}`);
if (orphaned.length) {
  console.log(`  of those, acted on by a user:  ${orphanedActed.length}`);
  console.log(`  they keep their row, uuid, slug and user relations, but lose every provider link.`);
  for (const o of orphaned.slice(0, 10)) console.log(`    ${o.slug ?? o.id}  ${o.title}${o.acted ? "  [acted on]" : ""}`);
  if (orphaned.length > 10) console.log(`    … and ${orphaned.length - 10} more`);
}

if (!apply) {
  console.log(`\nNothing changed. Re-run with --apply to delete.`);
  process.exit(0);
}

// Bounded batches, because PR16 deleted 546,754 rows in one transaction for
// 12.8 GB of WAL churn to S3 and blew the Railway spend cap. Volumes here are
// small, but the shape is the rule → [[prod-incidents]].
const BATCH = 500;
let deletedProjections = 0;
if (hasProjection) {
  const stmt = db.prepare(
    `DELETE FROM media_item_projection WHERE media_item_id IN (
       SELECT p.media_item_id FROM media_item_projection p
        WHERE EXISTS (SELECT 1 FROM media_links l WHERE l.media_item_id = p.media_item_id AND l.source = 'igdb')
        LIMIT ?)`
  );
  for (;;) { const c = stmt.run(BATCH).changes; deletedProjections += c; if (c < BATCH) break; }
}

const delLinks = db.prepare(`DELETE FROM media_links WHERE id IN (SELECT id FROM media_links WHERE source = 'igdb' LIMIT ?)`);
let deletedLinks = 0;
for (;;) { const c = delLinks.run(BATCH).changes; deletedLinks += c; if (c < BATCH) break; }

// The cross-id index would otherwise keep pointing an igdb id at an item that
// no longer has an igdb link, which is what findMatchingItem reads.
const delIds = db.prepare(`DELETE FROM media_external_ids WHERE source = 'igdb'`).run().changes;

console.log(`\ndeleted: ${deletedLinks} links, ${deletedProjections} projections, ${delIds} external ids`);
console.log(`remaining igdb links: ${n(`SELECT COUNT(*) FROM media_links WHERE source = 'igdb'`)}`);
console.log(`integrity_check: ${one("PRAGMA integrity_check").integrity_check}`);
console.log(`\n⚠️ Deleting rows does not shrink the file. db.ts VACUUMs after a migration applies;`);
console.log(`   run VACUUM by hand if you need the space back now.`);
