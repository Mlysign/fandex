// The catalog write path on D1: find or create the item a provider payload
// belongs to, store the link, and re-derive what clients are served.
//
// A port of src/lib/matcher.ts, and the rules are the same ones:
//
//   • identity is (source, source_id, media_type). A provider id is unique only
//     WITHIN a media type, so every lookup that turns one into an item carries
//     the type.
//   • a thin (list-payload) write is insert-only and never touches a stored link.
//   • a slug is assigned once, when the row is created, and never changes.
//
// What is different is the database. D1 has no interactive transaction: a
// read-then-write is two round trips and another request can land between them.
// So the guard is the schema, not a lock:
//
//   • creating an item is ONE batch (item + link + doc + cross ids). A batch is
//     atomic, and the link's primary key is the provider identity, so of two
//     requests resolving the same new title exactly one batch commits. The
//     loser gets a constraint error, re-reads the link and returns the winner.
//   • the slug's uniqueness is the (type, slug) index, checked the same way.
//
// And the cost model is different. Every row written here is one of the
// 100,000 a day the free plan allows, so nothing is rewritten that did not
// change: cross ids are diffed rather than deleted and re-inserted.

import { projectRawData, PROJECTION_VERSION } from "@/lib/sources/project";
import { normalizeName } from "@/lib/normalize";
import { extractYear } from "@/lib/merge";
import { extractCrossIds, mergeRawData } from "@/lib/matcherPure";
import { slugCandidate } from "@/lib/publicUrl";
import type { MediaType, Source } from "@/types";
import { all, first, isConstraintError, stmt } from "../d1";
import { DROP_POOL_COUNT_SQL } from "../keptCounts";
import { buildVector, deriveItem, DERIVE_VERSION, type ParsedLink } from "./derive";

export interface SourceItem {
  source: Source;
  sourceId: string;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  rawData: any;
  /** A provider LIST payload: insert-only, stamped projection_version 0. */
  thin?: boolean;
}

export interface UpsertResult {
  id: string;
  created: boolean;
}

export interface UpsertOptions {
  /**
   * 1 for a row created by an on-demand resolve. It keeps the row out of the
   * scoring pool (the delta sync serves `browsed = 0` only) until somebody acts
   * on it, and the user-state write path promotes it. Only read on CREATE: an
   * existing row is never demoted by someone browsing past it.
   */
  browsed?: 0 | 1;
}

interface LinkRow {
  source: string;
  source_id: string;
  media_type: string;
  release_date: string | null;
  last_synced: number;
  raw_data: string;
}

interface ItemRow {
  id: string;
  type: string;
  slug: string | null;
  created_at: number;
}

const SLUG_CANDIDATES_PER_TRY = 4;
const MAX_CREATE_ATTEMPTS = 3;

export async function upsertMediaItem(db: D1Database, item: SourceItem, opts: UpsertOptions = {}): Promise<UpsertResult> {
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    // 1. The exact link, type included.
    const existing = await first<{ media_item_id: string; raw_data: string }>(
      db,
      "SELECT media_item_id, raw_data FROM media_links WHERE source = ? AND source_id = ? AND media_type = ?",
      [item.source, item.sourceId, item.type],
    );
    if (existing) {
      // A thin write never degrades a stored link.
      if (item.thin) return { id: existing.media_item_id, created: false };
      const projected = projectRawData(item.source, mergeRawData(existing.raw_data, item.rawData));
      await writeLinkAndRederive(db, existing.media_item_id, item, projected, PROJECTION_VERSION);
      return { id: existing.media_item_id, created: false };
    }

    const projected = projectRawData(item.source, item.rawData);

    // 2. An existing item this is another source's view of.
    const matchId = await findMatchingItem(db, item);
    if (matchId) {
      await writeLinkAndRederive(db, matchId, item, projected, linkVersion(item));
      return { id: matchId, created: false };
    }

    // 3. A new item.
    try {
      return { id: await createItem(db, item, projected, opts.browsed ?? 0), created: true };
    } catch (e) {
      // Someone else created the link or took the slug between our read and our
      // batch. Loop: the re-read at the top finds their row, or a new slug is picked.
      if (!isConstraintError(e) || attempt === MAX_CREATE_ATTEMPTS - 1) throw e;
    }
  }
  throw new Error("upsertMediaItem: gave up after repeated conflicts");
}

/**
 * Attach a link to an item already identified, with no title matching. The
 * link's media_type comes from the TARGET row, not the payload: this function's
 * whole job is "attach to the item I found", so the target is the authority.
 */
export async function linkSourceToItem(db: D1Database, mediaItemId: string, item: SourceItem): Promise<string> {
  const owner = await first<{ type: string }>(db, "SELECT type FROM media_items WHERE id = ?", [mediaItemId]);
  const mediaType = (owner?.type ?? item.type) as MediaType;
  const typed: SourceItem = { ...item, type: mediaType };

  const existing = await first<{ media_item_id: string; raw_data: string }>(
    db,
    "SELECT media_item_id, raw_data FROM media_links WHERE source = ? AND source_id = ? AND media_type = ?",
    [item.source, item.sourceId, mediaType],
  );
  if (existing) {
    const projected = projectRawData(item.source, mergeRawData(existing.raw_data, item.rawData));
    await writeLinkAndRederive(db, existing.media_item_id, typed, projected, PROJECTION_VERSION);
    return existing.media_item_id;
  }
  await writeLinkAndRederive(db, mediaItemId, typed, projectRawData(item.source, item.rawData), PROJECTION_VERSION);
  return mediaItemId;
}

// Current for a detail payload, 0 for a list payload so the first detail read refetches it.
function linkVersion(item: SourceItem): number {
  return item.thin ? 0 : PROJECTION_VERSION;
}

async function findMatchingItem(db: D1Database, item: SourceItem): Promise<string | null> {
  const normalized = normalizeName(item.title);
  const year = extractYear(item.releaseDate);
  const incomingEntries = Object.entries(extractCrossIds(item.source, item.rawData)); // [namespace, id]

  // 1. A definitive cross-id match: an incoming (namespace, id) already mapped
  //    to an item of the same type is the same work, whatever the titles say.
  if (incomingEntries.length) {
    const ors = incomingEntries.map(() => "(e.source = ? AND e.external_id = ?)").join(" OR ");
    const hit = await first<{ media_item_id: string }>(
      db,
      `SELECT e.media_item_id
         FROM media_external_ids e JOIN media_items mi ON mi.id = e.media_item_id
        WHERE mi.type = ? AND (${ors})
        LIMIT 1`,
      [item.type, ...incomingEntries.flat()],
    );
    if (hit) return hit.media_item_id;
  }

  // 2. Title + year among same-type candidates, EXCLUDING any that carries a
  //    conflicting id (same namespace, different id): a different work sharing
  //    the title.
  const candidates = await all<{ id: string; release_date: string | null }>(
    db,
    "SELECT id, release_date FROM media_items WHERE type = ? AND norm_title = ? LIMIT 40",
    [item.type, normalized],
  );
  if (!candidates.length) return null;

  const idsByCandidate = new Map<string, Map<string, string>>();
  if (incomingEntries.length) {
    const rows = await all<{ media_item_id: string; source: string; external_id: string }>(
      db,
      `SELECT media_item_id, source, external_id FROM media_external_ids
        WHERE media_item_id IN (${candidates.map(() => "?").join(",")})`,
      candidates.map((c) => c.id),
    );
    for (const r of rows) {
      let m = idsByCandidate.get(r.media_item_id);
      if (!m) idsByCandidate.set(r.media_item_id, (m = new Map()));
      m.set(r.source, r.external_id);
    }
  }

  for (const c of candidates) {
    const candidateYear = extractYear(c.release_date);
    if (year && candidateYear && Math.abs(year - candidateYear) > 1) continue;
    const cmap = idsByCandidate.get(c.id);
    if (cmap && incomingEntries.some(([ns, id]) => cmap.has(ns) && cmap.get(ns) !== id)) continue;
    return c.id;
  }
  return null;
}

function parseLink(l: LinkRow): ParsedLink {
  let data: any = {};
  try { data = JSON.parse(l.raw_data); } catch { /* a corrupt blob derives as empty, like a missing one */ }
  return { source: l.source as Source, sourceId: l.source_id, releaseDate: l.release_date, lastSynced: l.last_synced, data };
}

/** The (namespace, id) pairs an item's links carry, as "ns\u0000id" keys. */
function crossIdKeys(links: ParsedLink[]): Set<string> {
  const keys = new Set<string>();
  for (const l of links) {
    for (const [ns, id] of Object.entries(extractCrossIds(l.source, l.data))) keys.add(`${ns}\u0000${id}`);
  }
  return keys;
}

const UPSERT_DOC_SQL = `
  INSERT INTO item_doc (media_item_id, vector, facets, merged, derive_version, derived_at)
  VALUES (?, ?, ?, ?, ?, unixepoch())
  ON CONFLICT(media_item_id) DO UPDATE SET
    vector = excluded.vector, facets = excluded.facets, merged = excluded.merged,
    derive_version = excluded.derive_version, derived_at = excluded.derived_at`;

async function createItem(
  db: D1Database,
  item: SourceItem,
  projected: any,
  browsed: 0 | 1,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const link: ParsedLink = {
    source: item.source, sourceId: item.sourceId, releaseDate: item.releaseDate, lastSynced: now, data: projected,
  };
  const derived = deriveItem(item.type, [link]);
  // The MERGED title, not the source's: matcher.ts ran remergeItem before
  // ensureItemSlug for the same reason. The slug is built from the title the
  // page will show, and it never changes afterwards.
  const title = derived.canonical.title;
  // The year is the slug's collision tie-break, so look past a canonical date
  // the merge could not find to the one the link row carries.
  const slug = await pickFreeSlug(db, item.type, title, derived.canonical.releaseDate ?? item.releaseDate);

  const id = crypto.randomUUID();
  const vector = buildVector(derived, { id, slug, createdAt: now });

  const statements: D1PreparedStatement[] = [
    stmt(
      db,
      `INSERT INTO media_items (id, type, title, norm_title, release_date, poster_url, slug, browsed, vote_count, vote_average, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, item.type, title, normalizeName(title), derived.canonical.releaseDate, derived.canonical.posterUrl,
       slug, browsed, derived.voteCount, derived.voteAverage, now, now],
    ),
    // A plain INSERT, deliberately not an upsert: a primary-key conflict here is
    // the signal that another request created this title first, and it has to
    // fail the whole batch so no orphan item row is left behind.
    stmt(
      db,
      `INSERT INTO media_links (source, source_id, media_type, media_item_id, title, release_date, last_synced, projection_version, raw_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.source, item.sourceId, item.type, id, item.title, item.releaseDate, now, linkVersion(item), JSON.stringify(projected)],
    ),
    stmt(db, UPSERT_DOC_SQL, [
      id, JSON.stringify(vector), JSON.stringify(derived.facets), JSON.stringify(derived.merged), DERIVE_VERSION,
    ]),
  ];
  for (const key of crossIdKeys([link])) {
    const [ns, ext] = key.split("\u0000");
    statements.push(stmt(
      db,
      "INSERT OR IGNORE INTO media_external_ids (source, external_id, media_item_id) VALUES (?, ?, ?)",
      [ns, ext, id],
    ));
  }
  // A title created straight into the pool makes the pool's kept size untrue.
  // In the batch, so a create that loses its race drops nothing.
  if (browsed === 0) statements.push(db.prepare(DROP_POOL_COUNT_SQL));
  await db.batch(statements);
  return id;
}

/**
 * The first slug candidate nobody of this type holds. One query for the first
 * few candidates rather than one per candidate. A lost race needs no special
 * handling: the retry re-reads, and the slug that was taken in between now
 * shows as taken.
 */
async function pickFreeSlug(
  db: D1Database,
  type: MediaType,
  title: string,
  releaseDate: string | null,
): Promise<string> {
  for (let base = 0; base < 48; base += SLUG_CANDIDATES_PER_TRY) {
    const candidates: string[] = [];
    for (let i = 0; i < SLUG_CANDIDATES_PER_TRY; i++) candidates.push(slugCandidate(title, releaseDate, base + i));
    const unique = [...new Set(candidates)];
    const taken = new Set(
      (await all<{ slug: string }>(
        db,
        `SELECT slug FROM media_items WHERE type = ? AND slug IN (${unique.map(() => "?").join(",")})`,
        [type, ...unique],
      )).map((r) => r.slug),
    );
    const free = unique.find((c) => !taken.has(c));
    if (free) return free;
  }
  return `${slugCandidate(title, releaseDate, 0)}-${Date.now().toString(36)}`;
}

/**
 * Store (or refresh) one link on an existing item, then recompute everything
 * derived from the item's links. One read batch, one write batch.
 */
async function writeLinkAndRederive(
  db: D1Database,
  mediaItemId: string,
  item: SourceItem,
  projected: any,
  projectionVersion: number,
): Promise<void> {
  const [itemRes, linksRes, extRes] = await db.batch([
    stmt(db, "SELECT id, type, slug, created_at FROM media_items WHERE id = ?", [mediaItemId]),
    stmt(
      db,
      "SELECT source, source_id, media_type, release_date, last_synced, raw_data FROM media_links WHERE media_item_id = ?",
      [mediaItemId],
    ),
    stmt(db, "SELECT source, external_id FROM media_external_ids WHERE media_item_id = ?", [mediaItemId]),
  ]);
  const row = (itemRes.results as ItemRow[])[0];
  if (!row) throw new Error(`writeLinkAndRederive: no media_items row ${mediaItemId}`);

  const now = Math.floor(Date.now() / 1000);
  const incoming: ParsedLink = {
    source: item.source, sourceId: item.sourceId, releaseDate: item.releaseDate, lastSynced: now, data: projected,
  };
  // Every other link on the item, plus the incoming one in place of its old self.
  const others = (linksRes.results as LinkRow[])
    .filter((l) => !(l.source === item.source && l.source_id === item.sourceId && l.media_type === item.type))
    .map(parseLink);
  const links = [...others, incoming];

  const statements: D1PreparedStatement[] = [
    // ON CONFLICT leaves media_item_id alone: a link never moves between items here.
    stmt(
      db,
      `INSERT INTO media_links (source, source_id, media_type, media_item_id, title, release_date, last_synced, projection_version, raw_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source, source_id, media_type) DO UPDATE SET
         title = excluded.title, release_date = excluded.release_date, last_synced = excluded.last_synced,
         projection_version = excluded.projection_version, raw_data = excluded.raw_data`,
      [item.source, item.sourceId, item.type, mediaItemId, item.title, item.releaseDate, now, projectionVersion, JSON.stringify(projected)],
    ),
    ...rederiveStatements(db, row, links, extRes.results as { source: string; external_id: string }[]),
  ];
  await db.batch(statements);
}

/**
 * The statements that bring media_items, item_doc and media_external_ids in
 * line with `links`. Shared by the write path above and the cron's re-derive.
 */
export function rederiveStatements(
  db: D1Database,
  row: ItemRow,
  links: ParsedLink[],
  storedExternalIds: { source: string; external_id: string }[],
): D1PreparedStatement[] {
  const derived = deriveItem(row.type as MediaType, links);
  const vector = buildVector(derived, { id: row.id, slug: row.slug, createdAt: row.created_at });

  const statements: D1PreparedStatement[] = [
    stmt(
      db,
      `UPDATE media_items
          SET title = ?, norm_title = ?, release_date = ?, poster_url = ?,
              vote_count = ?, vote_average = ?, updated_at = unixepoch()
        WHERE id = ?`,
      [derived.canonical.title, normalizeName(derived.canonical.title), derived.canonical.releaseDate,
       derived.canonical.posterUrl, derived.voteCount, derived.voteAverage, row.id],
    ),
    stmt(db, UPSERT_DOC_SQL, [
      row.id, JSON.stringify(vector), JSON.stringify(derived.facets), JSON.stringify(derived.merged), DERIVE_VERSION,
    ]),
  ];

  // Cross ids: write the difference only. matcher.ts deleted and re-inserted the
  // whole set on every sync, which on D1 would spend four row writes per id to
  // change nothing.
  const want = crossIdKeys(links);
  const have = new Set(storedExternalIds.map((r) => `${r.source}\u0000${r.external_id}`));
  for (const key of want) {
    if (have.has(key)) continue;
    const [ns, ext] = key.split("\u0000");
    statements.push(stmt(
      db,
      "INSERT OR IGNORE INTO media_external_ids (source, external_id, media_item_id) VALUES (?, ?, ?)",
      [ns, ext, row.id],
    ));
  }
  for (const key of have) {
    if (want.has(key)) continue;
    const [ns, ext] = key.split("\u0000");
    statements.push(stmt(
      db,
      "DELETE FROM media_external_ids WHERE source = ? AND external_id = ? AND media_item_id = ?",
      [ns, ext, row.id],
    ));
  }
  return statements;
}
