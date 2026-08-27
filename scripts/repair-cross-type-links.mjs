// Repair the cross-type link merges that migration 23 makes impossible going
// forward (SM50, 2026-08-27).
//
// THE DAMAGE. `media_links` used to be UNIQUE(source, source_id), which claims a
// provider id names one work. Trakt and TMDB number movies and shows in separate
// sequences, so trakt movie 386 (Being John Malkovich) and trakt show 386
// (SpongeBob SquarePants) are two works with the same key. Whichever synced
// second found the other's row, took its media_item_id and overwrote the
// payload. Result on the live database: a show's official site, genres and
// certification merged into a FILM's projection on a public page, the show's
// episode-watch history filed against that film, and the real show row left at
// zero progress.
//
// Migration 23 widens the key so the two can coexist. It does NOT repair the
// rows already merged, on purpose: a migration must not decide which of two real
// works somebody's watch history belongs to. That decision is here, where it can
// be run against a copy first and prints exactly what it would do.
//
// WHAT IT DOES, per offender:
//   1. MOVES the hijacked link row to the item it actually describes (its
//      media_item_id and media_type), rather than deleting it — the stored
//      payload is the show's, so the show gets its Trakt link back and the film
//      stops carrying it.
//   2. MOVES the matching media_external_ids rows the same way.
//   3. MOVES the user_episode_state rows off the film onto the show.
//   4. Leaves `user_item_state` ALONE and reports it. A film can be legitimately
//      in the library on its own account, and nothing in the data separates
//      "watched this film" from state the merge dragged in. That is a call for a
//      person, not a script.
//
// Usage:
//   node scripts/repair-cross-type-links.mjs <db-path>            # report only
//   node scripts/repair-cross-type-links.mjs <db-path> --apply    # repair
//
// Run it on a COPY first. Copy the -wal and -shm alongside the .db or you are
// reading an older database than you think: a plain `cp data/rr.db` cost 9 rows
// of apparent difference while this was being written.
import Database from "better-sqlite3";

const dbPath = process.argv[2];
const apply = process.argv.includes("--apply");
if (!dbPath) {
  console.error("usage: node scripts/repair-cross-type-links.mjs <db-path> [--apply]");
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const cols = db.pragma("table_info(media_links)").map((c) => c.name);
if (!cols.includes("media_type")) {
  console.error("media_links has no media_type column: run `node scripts/migrate.mjs <db>` first (migration 23).");
  process.exit(1);
}

// Normalize for comparison the way a person would read the two titles side by
// side. Deliberately loose: the signal is "these name different WORKS", and a
// punctuation or numeral difference is not that.
const norm = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// Which media types a source can describe AT ALL. This is the load-bearing
// filter, not a nicety: the bug being repaired is a NAMESPACE collision, and a
// source with one namespace cannot have one. Steam, RAWG and IGDB serve games
// and nothing else, so a steam link can never turn out to be a show's.
//
// Leaving it out cost three false positives on the first run, and each would
// have made things worse: steam appid 38400 is the 1997 game *Fallout* sitting
// on the game *Fallout Online*, and rawg 4729 is the game *Assassin's Creed*
// sitting on *Assassin's Creed Jade*. Both are ordinary title mis-matches
// between two works of the SAME type, and the title lookup below happily found
// an unrelated show and film to "move" them to. Different bug, different fix,
// and moving them would have been a fresh cross-type merge made by the repair.
const SOURCE_TYPES = {
  trakt: ["movie", "show"],
  tmdb: ["movie", "show"],
  imdb: ["movie", "show"],
  letterboxd: ["movie"],
  steam: ["game"],
  rawg: ["game"],
  igdb: ["game"],
};

// A candidate is a link whose stored title names a different work than its
// owning item, where a row of ANOTHER type carrying that title exists AND both
// types are ones this source actually numbers. The cross-TYPE match is the
// signal — `media_links.title != media_items.title` on its own is mostly
// legitimate normalisation ("Atomic Heart 2" vs "Atomic Heart II"), and on the
// live database it returned 5 rows of which only 3 were real merges.
const links = db.prepare(`
  SELECT l.id AS link_id, l.source, l.source_id, l.media_type, l.title AS link_title,
         l.media_item_id AS owner_id, m.type AS owner_type, m.title AS owner_title, m.slug AS owner_slug
    FROM media_links l JOIN media_items m ON m.id = l.media_item_id
   WHERE l.title IS NOT NULL
`).all();

const itemsByNorm = new Map();
for (const it of db.prepare("SELECT id, type, title, slug FROM media_items").all()) {
  const k = norm(it.title);
  if (!itemsByNorm.has(k)) itemsByNorm.set(k, []);
  itemsByNorm.get(k).push(it);
}

const offenders = [];
for (const l of links) {
  if (norm(l.link_title) === norm(l.owner_title)) continue;
  const serves = SOURCE_TYPES[l.source];
  // One namespace, so no namespace collision is possible. Skip before the title
  // lookup can invent a target of a type this source never numbers.
  if (!serves || serves.length < 2 || !serves.includes(l.owner_type)) continue;
  const target = (itemsByNorm.get(norm(l.link_title)) ?? [])
    .find((it) => it.type !== l.owner_type && serves.includes(it.type));
  if (!target) continue;
  offenders.push({ ...l, target });
}

// No early exit on `offenders === 0`: pass 2 below scrubs merged payloads, and
// a database repaired by an earlier run of this script has zero offenders left
// and stale blobs still in place.

const countEpisodes = db.prepare("SELECT COUNT(*) c FROM user_episode_state WHERE media_item_id = ?");
const countState = db.prepare("SELECT COUNT(*) c FROM user_item_state WHERE media_item_id = ?");
const extIds = db.prepare("SELECT rowid, source, external_id FROM media_external_ids WHERE media_item_id = ?");

const plan = offenders.map((o) => {
  // The external ids to move are the ones this link contributed: its own
  // (source, source_id), plus any id of another namespace that the TARGET row
  // does not already hold and the owner cannot justify. Only the first is
  // provable from the row itself, so that is all this moves; the rest are
  // reported for a human to look at.
  const ownerExt = extIds.all(o.owner_id);
  return {
    link: `${o.source}:${o.source_id}`,
    linkTitle: o.link_title,
    from: { id: o.owner_id, type: o.owner_type, title: o.owner_title, slug: o.owner_slug },
    to: { id: o.target.id, type: o.target.type, title: o.target.title, slug: o.target.slug },
    episodeRowsOnWrongItem: countEpisodes.get(o.owner_id).c,
    userItemStateRowsLeftAlone: countState.get(o.owner_id).c,
    externalIdsOnOwner: ownerExt.map((e) => `${e.source}:${e.external_id}`),
    movesExternalId: `${o.source}:${o.source_id}`,
  };
});

console.log(JSON.stringify({ dbPath, offenders: plan.length, apply, plan }, null, 2));
if (!apply) {
  console.log("\nreport only. re-run with --apply to repair.");
  process.exit(0);
}

const alreadyThere = db.prepare(
  "SELECT id FROM media_links WHERE source = ? AND source_id = ? AND media_type = ? AND id != ?"
);

// Recompute one item's media_external_ids from the links it currently holds.
// The json paths mirror extractCrossIds() in matcher.ts, which stays the
// write-time source of truth; migration 2's backfill uses the same list for the
// same reason (a standalone script must not import a module that touches the DB
// or env at import time). Letterboxd's embedded tmdb id lives in a links[] array
// and is deliberately absent here, exactly as in migration 2.
const NAMESPACES = [
  ["trakt", "trakt", "$.ids.trakt"],
  ["trakt", "tmdb", "$.ids.tmdb"],
  ["tmdb", "tmdb", "$.id"],
  ["rawg", "rawg", "$.id"],
  ["steam", "steam", "$.appid"],
  ["igdb", "igdb", "$.id"],
  ["letterboxd", "letterboxd", "$.id"],
];
// The provider ids an item's OWN payloads name as belonging to it. Only ids a
// payload states outright, never one inferred from a title. Trakt's `ids` block
// is the useful one: it is the only place an imdb id appears in stored data.
function claimedIds(mediaItemId) {
  const out = [];
  for (const r of db.prepare("SELECT source, raw_data FROM media_links WHERE media_item_id = ?").all(mediaItemId)) {
    let d;
    try { d = JSON.parse(r.raw_data); } catch { continue; }
    if (r.source !== "trakt" || !d?.ids) continue;
    for (const ns of ["imdb", "tmdb", "tvdb"]) {
      if (d.ids[ns] != null) out.push({ source: ns, id: String(d.ids[ns]) });
    }
  }
  return out;
}

function rebuildExternalIds(mediaItemId) {
  db.prepare("DELETE FROM media_external_ids WHERE media_item_id = ?").run(mediaItemId);
  for (const [linkSource, namespace, jsonPath] of NAMESPACES) {
    db.prepare(
      `INSERT OR IGNORE INTO media_external_ids (media_item_id, source, external_id)
       SELECT media_item_id, ?, CAST(json_extract(raw_data, ?) AS TEXT)
         FROM media_links
        WHERE media_item_id = ? AND source = ? AND json_extract(raw_data, ?) IS NOT NULL`
    ).run(namespace, jsonPath, mediaItemId, linkSource, jsonPath);
  }
}

const tx = db.transaction(() => {
  for (const o of offenders) {
    // The target may already hold its own link for this id (it can, now that the
    // key includes the type). Moving would violate the UNIQUE, so drop the stray
    // instead and let the row that is already in the right place stand.
    const dup = alreadyThere.get(o.source, o.source_id, o.target.type, o.link_id);
    if (dup) db.prepare("DELETE FROM media_links WHERE id = ?").run(o.link_id);
    else db.prepare("UPDATE media_links SET media_item_id = ?, media_type = ? WHERE id = ?")
      .run(o.target.id, o.target.type, o.link_id);
    // External ids are REBUILT for both items rather than moved one pair at a
    // time. A trakt link contributes TWO namespaces (its own id and the tmdb id
    // embedded in the payload), so moving only the pair named on the link row
    // leaves the other behind: the first run of this script moved trakt:386 off
    // Being John Malkovich and left tmdb:387 (SpongeBob's TMDB id) sitting on
    // the film. Deriving the whole set from the links each item now holds is the
    // only version that can't leave a residue.
    // A merge drags in more than the one link that names the other work. On the
    // live database The Pursuit of Happyness ended up holding TWO imdb links,
    // one of them The Walking Dead's — and an imdb link stores no title, so the
    // title check above cannot see it. Move any link the TARGET's own payloads
    // claim as theirs by id. That is provable from stored data, unlike guessing
    // which of two imdb ids belongs to which work.
    for (const claim of claimedIds(o.target.id)) {
      const stray = db.prepare(
        "SELECT id FROM media_links WHERE media_item_id = ? AND source = ? AND source_id = ?"
      ).get(o.owner_id, claim.source, claim.id);
      if (!stray) continue;
      const clash = alreadyThere.get(claim.source, claim.id, o.target.type, stray.id);
      if (clash) db.prepare("DELETE FROM media_links WHERE id = ?").run(stray.id);
      else db.prepare("UPDATE media_links SET media_item_id = ?, media_type = ? WHERE id = ?")
        .run(o.target.id, o.target.type, stray.id);
    }

    rebuildExternalIds(o.owner_id);
    rebuildExternalIds(o.target.id);
    // Episode rows are keyed (user_id, media_item_id, season, episode). The
    // target is a show with no progress, so a collision means the same episode
    // is already ticked there; keep the target's row and drop the stray.
    db.prepare(`UPDATE OR IGNORE user_episode_state SET media_item_id = ? WHERE media_item_id = ?`)
      .run(o.target.id, o.owner_id);
    db.prepare("DELETE FROM user_episode_state WHERE media_item_id = ?").run(o.owner_id);
  }
});
tx();

// Both sides need re-projecting: the film to drop the show's genres/links, the
// show to pick up what it should have had. `projection_version = 0` is the
// repo's own "refetch and heal me" stamp (see SourceItem.thin), which is a safer
// instruction than reaching into projectRawData from a standalone script.
const reproject = db.prepare("UPDATE media_links SET projection_version = 0 WHERE media_item_id = ?");
for (const o of offenders) { reproject.run(o.owner_id); reproject.run(o.target.id); }

// ── Pass 2: scrub payload keys that belong to the OTHER media type ──────────
//
// Moving the link row is not the whole repair, because the BLOB was merged too.
// `mergeRawData` is `{...prev, ...next}`, so a hijacked row holds one work's
// keys under another's. Visible consequence, caught after the first apply:
// /show/spongebob-squarepants printed "Trakt Oct 29, 1999" — Being John
// Malkovich's release date, still sitting in the trakt blob as `released`, which
// a show payload never carries and normalize reads as a fallback.
//
// Shared keys need no thought: the LAST write wins, and the detection above only
// accepts a row whose stored title names the work it is moving to, so the last
// write was that work's. Only the exclusive keys can be stale, and each provider
// has a short, closed list of them (derived from projectRawData's own field
// lists in src/lib/sources/project.ts, which is what bounds a stored blob).
//
// This pass runs over EVERY link, not only the ones just moved. That makes it
// idempotent, lets it clean a database repaired by an earlier version of this
// script, and costs nothing on a correct row: a trakt movie payload has no
// `first_aired` to remove.
const TYPE_ONLY_KEYS = {
  trakt: {
    movie: ["released"],
    show: ["first_aired", "airs", "total_runtime", "network", "aired_episodes"],
  },
  tmdb: {
    // ⚠️ `adult` is NOT on this list, and that is measured, not assumed. It was,
    // on the first draft, and the pass then reported 443 blobs to scrub instead
    // of 4: TMDB's TV detail carries `adult` too, on 440 perfectly correct show
    // links. A key list written from what a MOVIE payload contains is not the
    // same list as what only a movie payload contains. Count the hits before
    // trusting one.
    movie: ["title", "original_title", "release_date", "budget", "revenue",
            "belongs_to_collection", "imdb_id"],
    show: ["name", "original_name", "first_air_date", "episode_run_time",
           "last_episode_to_air", "next_episode_to_air", "number_of_seasons",
           "number_of_episodes", "networks", "created_by", "content_ratings"],
  },
};

let scrubbed = 0;
const scrubTx = db.transaction(() => {
  for (const l of db.prepare("SELECT id, source, media_type, raw_data FROM media_links").all()) {
    const table = TYPE_ONLY_KEYS[l.source];
    if (!table) continue;
    // Keys exclusive to a type this row is NOT.
    const foreign = Object.entries(table)
      .filter(([type]) => type !== l.media_type)
      .flatMap(([, keys]) => keys);
    let d;
    try { d = JSON.parse(l.raw_data); } catch { continue; }
    if (!d || typeof d !== "object" || Array.isArray(d)) continue;
    const hits = foreign.filter((k) => k in d);
    if (hits.length === 0) continue;
    for (const k of hits) delete d[k];
    db.prepare("UPDATE media_links SET raw_data = ?, projection_version = 0 WHERE id = ?")
      .run(JSON.stringify(d), l.id);
    scrubbed++;
  }
});
scrubTx();

console.log(JSON.stringify({
  applied: true,
  repaired: offenders.length,
  blobsScrubbed: scrubbed,
  note: "affected links stamped projection_version = 0 so the next detail read re-projects them",
}, null, 2));
