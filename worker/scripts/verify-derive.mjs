// Does the Worker derive the same item docs the site stored?
//
//   node worker/scripts/verify-derive.mjs <snapshot.db>
//
// The Worker's deriveItem() and the site's getDerivedForItem() call the same
// mergeLinks and extractFacets, so they SHOULD agree byte for byte. This checks
// that they do, over every pool item of a real snapshot, against the rows the
// site itself wrote to media_item_projection. A projection row that is stale
// (its freshness token no longer matches the links) is skipped, not counted as
// a difference: it is the site's cache that is behind there, not the port.
//
// Read-only. Point it at a COPY of the database, and a complete one: a WAL-mode
// file copied without its -wal is silently stale.

import { registerHooks } from "node:module";
import Database from "better-sqlite3";
import { resolve } from "../../scripts/alias-hooks.mjs";

registerHooks({ resolve });
const { deriveItem } = await import("../src/catalog/derive.ts");

const snapshotPath = process.argv[2];
if (!snapshotPath) {
  console.error("usage: node worker/scripts/verify-derive.mjs <snapshot.db>");
  process.exit(1);
}
const db = new Database(snapshotPath, { readonly: true, fileMustExist: true });

const items = db.prepare("SELECT id, type, title FROM media_items WHERE browsed = 0").all();
const linkStmt = db.prepare(
  "SELECT source, source_id, release_date, last_synced, raw_data FROM media_links WHERE media_item_id = ?",
);
const projStmt = db.prepare(
  "SELECT facets, merged, last_synced, raw_len FROM media_item_projection WHERE media_item_id = ? AND region = 'US'",
);

const out = { pool: items.length, identical: 0, facetsDiffer: 0, mergedDiffer: 0, noProjection: 0, staleProjection: 0 };
const examples = [];

for (const it of items) {
  const links = linkStmt.all(it.id);
  const proj = projStmt.get(it.id);
  if (!proj) { out.noProjection++; continue; }

  const maxSynced = links.reduce((m, l) => Math.max(m, l.last_synced), 0);
  const rawLen = links.reduce((n, l) => n + Buffer.byteLength(l.raw_data, "utf8"), 0);
  if (proj.last_synced !== maxSynced || proj.raw_len !== rawLen) { out.staleProjection++; continue; }

  const derived = deriveItem(it.type, links.map((l) => ({
    source: l.source, sourceId: l.source_id, releaseDate: l.release_date, lastSynced: l.last_synced,
    data: JSON.parse(l.raw_data),
  })));
  const facetsSame = JSON.stringify(derived.facets) === proj.facets;
  const mergedSame = JSON.stringify(derived.merged) === proj.merged;
  if (facetsSame && mergedSame) { out.identical++; continue; }
  if (!facetsSame) out.facetsDiffer++;
  if (!mergedSame) out.mergedDiffer++;
  if (examples.length < 5) {
    const theirs = JSON.parse(proj.merged);
    examples.push({
      title: it.title,
      mergedFields: Object.keys(derived.merged).filter((k) => JSON.stringify(derived.merged[k]) !== JSON.stringify(theirs[k])),
      facets: facetsSame ? "same" : `${derived.facets.length} vs ${JSON.parse(proj.facets).length}`,
    });
  }
}

console.log(out);
if (examples.length) console.log("first differences:", JSON.stringify(examples, null, 2));
process.exit(out.facetsDiffer || out.mergedDiffer ? 1 : 0);
