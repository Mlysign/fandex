// "Your rows": the per-user state a signed-in client reads and writes.
//
// The client is the one that talks to Trakt and TMDB now, so it is also the one
// that knows what a sync found. It writes the RESULT here, and this is the only
// place it is kept across devices. Game ratings and wishlists have no provider
// home at all, which is the reason accounts exist (docs/app-plan.md).
//
// ⚠️ THE PRUNE INVARIANT LIVES ON THE CLIENT NOW. This API takes explicit
// upserts and explicit deletes and never infers one from the other: there is no
// "replace everything from source X" call. A sync that failed half way sends
// nothing, and nothing is deleted. A server-side replace would turn a client's
// failed pull into a wiped library, which is the bug the invariant is about.
//
// Rows travel to SQLite as ONE JSON parameter and are expanded there with
// json_each. A statement may bind at most 100 values and an invocation may run
// at most 50 queries, so a row-per-statement write would cap a request at a few
// dozen rows.

import { normalizeCountry } from "@/lib/countries";
import { capFrom, spend } from "./budget";
import { first, run } from "./d1";
import type { Env } from "./env";
import { DROP_POOL_COUNT_SQL, dropStateCounts, type StateKind } from "./keptCounts";

export const MAX_ROWS_PER_WRITE = 2000;
export const STATE_PAGE_DEFAULT = 3000;
export const STATE_PAGE_MAX = 4000;
/** User-state row writes allowed per UTC day, across everyone. See budget.ts. */
export const DEFAULT_DAILY_USER_WRITE_CAP = 40_000;

const RELATIONS = new Set(["wishlist", "library", "ignored"]);
const SOURCES = new Set(["trakt", "tmdb", "steam", "rawg", "igdb", "letterboxd", "local"]);
const MEDIA_TYPES = new Set(["game", "movie", "show"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequest";
  }
}

// ── Profile and preferences ──────────────────────────────────────────────────

export async function profileJson(db: D1Database, userId: string): Promise<string | null> {
  const [user, identities] = await db.batch<{ j: string | null }>([
    db.prepare(
      `SELECT json_object('id', id, 'createdAt', created_at, 'country', country,
              'platforms', CASE WHEN json_valid(platforms) THEN json(platforms) END,
              'mediaTypes', CASE WHEN json_valid(media_types) THEN json(media_types) END) j
         FROM users WHERE id = ?`,
    ).bind(userId),
    db.prepare(
      `SELECT json_group_array(json_object('provider', provider, 'displayName', display_name, 'avatarUrl', avatar_url)) j
         FROM (SELECT provider, display_name, avatar_url FROM user_identities WHERE user_id = ? ORDER BY created_at)`,
    ).bind(userId),
  ]);
  const u = user.results?.[0]?.j;
  if (!u) return null;
  return `{"user":${u},"identities":${identities.results?.[0]?.j ?? "[]"}}`;
}

export interface PrefsPatch {
  country?: string | null;
  platforms?: string[] | null;
  mediaTypes?: string[] | null;
}

/**
 * Validate a preferences patch. A key that is ABSENT is left alone; a key that
 * is null clears the preference, which means "not configured" and yields
 * everything. "Owns nothing" and "uses no media type" are deliberately
 * inexpressible: an empty list is stored as null.
 *
 * ⚠️ These are DISPLAY preferences. They filter what a person sees and must
 * never reach a sync, a snapshot or the Fandex Score. Nothing server-side reads
 * them; they are stored so every device shows the same thing.
 */
export function parsePrefs(body: unknown): PrefsPatch {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequest("Expected an object");
  const b = body as Record<string, unknown>;
  const out: PrefsPatch = {};

  if ("country" in b) {
    if (b.country === null) out.country = null;
    else {
      const c = typeof b.country === "string" ? normalizeCountry(b.country) : null;
      if (!c) throw new BadRequest("Unsupported country");
      out.country = c;
    }
  }
  if ("platforms" in b) {
    if (b.platforms === null) out.platforms = null;
    else {
      if (!Array.isArray(b.platforms) || b.platforms.length > 300) throw new BadRequest("platforms must be a list");
      const list = b.platforms.filter((p): p is string => typeof p === "string" && p.length > 0 && p.length <= 80);
      if (list.length !== b.platforms.length) throw new BadRequest("platforms must be short strings");
      out.platforms = list.length ? [...new Set(list)] : null;
    }
  }
  if ("mediaTypes" in b) {
    if (b.mediaTypes === null) out.mediaTypes = null;
    else {
      if (!Array.isArray(b.mediaTypes)) throw new BadRequest("mediaTypes must be a list");
      const list = b.mediaTypes.filter((t): t is string => typeof t === "string" && MEDIA_TYPES.has(t));
      if (list.length !== b.mediaTypes.length) throw new BadRequest("Unknown media type");
      out.mediaTypes = list.length ? [...new Set(list)] : null;
    }
  }
  return out;
}

export async function writePrefs(db: D1Database, userId: string, patch: PrefsPatch): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if ("country" in patch) { sets.push("country = ?"); params.push(patch.country); }
  if ("platforms" in patch) { sets.push("platforms = ?"); params.push(patch.platforms ? JSON.stringify(patch.platforms) : null); }
  if ("mediaTypes" in patch) { sets.push("media_types = ?"); params.push(patch.mediaTypes ? JSON.stringify(patch.mediaTypes) : null); }
  if (!sets.length) return;
  await run(db, `UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [...params, userId]);
}

// ── Reading state ────────────────────────────────────────────────────────────

function pageLimit(raw: string | null): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(STATE_PAGE_MAX, Math.floor(n)) : STATE_PAGE_DEFAULT;
}

/**
 * One page of the user's item state, in primary-key order, as a JSON string.
 * A page shorter than `limit` is the last. The cursor is the key of the last
 * row the client received, which it already holds.
 */
export async function itemStateJson(db: D1Database, userId: string, q: URLSearchParams): Promise<string> {
  const limit = pageLimit(q.get("limit"));
  const row = await first<{ j: string | null; n: number }>(
    db,
    `SELECT json_group_array(json_object('mediaItemId', media_item_id, 'source', source, 'relation', relation,
            'status', status, 'rating', rating, 'review', review, 'reviewedAt', reviewed_at,
            'addedAt', added_at, 'updatedAt', updated_at)) j, COUNT(*) n
       FROM (SELECT * FROM user_item_state
              WHERE user_id = ?1 AND (media_item_id, source, relation) > (?2, ?3, ?4)
              ORDER BY media_item_id, source, relation
              LIMIT ?5)`,
    [userId, q.get("afterItem") ?? "", q.get("afterSource") ?? "", q.get("afterRelation") ?? "", limit],
  );
  return `{"rows":${row?.j ?? "[]"},"limit":${limit},"done":${(row?.n ?? 0) < limit}}`;
}

export async function episodeStateJson(db: D1Database, userId: string, q: URLSearchParams): Promise<string> {
  const limit = pageLimit(q.get("limit"));
  const afterSeason = Number(q.get("afterSeason") ?? -1);
  const afterEpisode = Number(q.get("afterEpisode") ?? -1);
  const row = await first<{ j: string | null; n: number }>(
    db,
    `SELECT json_group_array(json_object('mediaItemId', media_item_id, 'season', season_number,
            'episode', episode_number, 'watchedAt', watched_at,
            'sources', CASE WHEN json_valid(sources) THEN json(sources) ELSE json('[]') END)) j, COUNT(*) n
       FROM (SELECT * FROM user_episode_state
              WHERE user_id = ?1 AND (media_item_id, season_number, episode_number) > (?2, ?3, ?4)
              ORDER BY media_item_id, season_number, episode_number
              LIMIT ?5)`,
    [userId, q.get("afterItem") ?? "", Number.isFinite(afterSeason) ? afterSeason : -1,
     Number.isFinite(afterEpisode) ? afterEpisode : -1, limit],
  );
  return `{"rows":${row?.j ?? "[]"},"limit":${limit},"done":${(row?.n ?? 0) < limit}}`;
}

export async function hiddenJson(db: D1Database, userId: string): Promise<string> {
  const row = await first<{ j: string | null }>(
    db,
    `SELECT json_group_array(json_object('mediaItemId', media_item_id, 'hiddenAt', hidden_at)) j
       FROM (SELECT media_item_id, hidden_at FROM user_hidden_items WHERE user_id = ? ORDER BY hidden_at DESC LIMIT 5000)`,
    [userId],
  );
  return `{"rows":${row?.j ?? "[]"}}`;
}

// ── Writing state ────────────────────────────────────────────────────────────

interface ItemKey { mediaItemId: string; source: string; relation: string }
interface ItemRow extends ItemKey {
  status: string | null;
  rating: number | null;
  review: string | null;
  reviewedAt: number | null;
  addedAt: number | null;
}
interface EpisodeKey { mediaItemId: string; season: number; episode: number }
interface EpisodeRow extends EpisodeKey {
  watchedAt: number | null;
  sources: string;
}

export interface StateWrite {
  itemUpserts: ItemRow[];
  itemDeletes: ItemKey[];
  episodeUpserts: EpisodeRow[];
  episodeDeletes: EpisodeKey[];
  hide: string[];
  unhide: string[];
}

const list = (v: unknown, name: string): unknown[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new BadRequest(`${name} must be a list`);
  return v;
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new BadRequest(`${name} must be an item id`);
  return v.toLowerCase();
};
const optInt = (v: unknown, name: string): number | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new BadRequest(`${name} must be a number`);
  return Math.floor(v);
};
const smallInt = (v: unknown, name: string): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100_000) throw new BadRequest(`${name} must be a whole number`);
  return v;
};

function itemKey(v: unknown): ItemKey {
  if (!isObj(v)) throw new BadRequest("Each item row must be an object");
  const source = v.source;
  const relation = v.relation;
  if (typeof source !== "string" || !SOURCES.has(source)) throw new BadRequest("Unknown source");
  if (typeof relation !== "string" || !RELATIONS.has(relation)) throw new BadRequest("Unknown relation");
  return { mediaItemId: uuid(v.mediaItemId, "mediaItemId"), source, relation };
}

function itemRow(v: unknown): ItemRow {
  const key = itemKey(v);
  const o = v as Record<string, unknown>;
  let rating: number | null = null;
  if (o.rating !== undefined && o.rating !== null) {
    // 0-10, the scale every provider's score is stored on.
    if (typeof o.rating !== "number" || !Number.isFinite(o.rating) || o.rating < 0 || o.rating > 10) {
      throw new BadRequest("rating must be between 0 and 10");
    }
    rating = o.rating;
  }
  const text = (x: unknown, name: string, max: number): string | null => {
    if (x === undefined || x === null) return null;
    if (typeof x !== "string" || x.length > max) throw new BadRequest(`${name} is too long`);
    return x;
  };
  return {
    ...key,
    status: text(o.status, "status", 40),
    rating,
    review: text(o.review, "review", 20_000),
    reviewedAt: optInt(o.reviewedAt, "reviewedAt"),
    addedAt: optInt(o.addedAt, "addedAt"),
  };
}

function episodeKey(v: unknown): EpisodeKey {
  if (!isObj(v)) throw new BadRequest("Each episode row must be an object");
  return {
    mediaItemId: uuid(v.mediaItemId, "mediaItemId"),
    season: smallInt(v.season, "season"),
    episode: smallInt(v.episode, "episode"),
  };
}

function episodeRow(v: unknown): EpisodeRow {
  const key = episodeKey(v);
  const o = v as Record<string, unknown>;
  const sources = o.sources === undefined || o.sources === null ? ["local"] : o.sources;
  if (!Array.isArray(sources) || sources.length > 8 || !sources.every((s) => typeof s === "string" && SOURCES.has(s))) {
    throw new BadRequest("sources must be a list of known sources");
  }
  return { ...key, watchedAt: optInt(o.watchedAt, "watchedAt"), sources: JSON.stringify(sources) };
}

/** Validate a state write. Throws BadRequest; never partially accepts. */
export function parseStateWrite(body: unknown): StateWrite {
  if (!isObj(body)) throw new BadRequest("Expected an object");
  const items = isObj(body.items) ? body.items : {};
  const episodes = isObj(body.episodes) ? body.episodes : {};
  const hidden = isObj(body.hidden) ? body.hidden : {};

  const w: StateWrite = {
    itemUpserts: list(items.upsert, "items.upsert").map(itemRow),
    itemDeletes: list(items.delete, "items.delete").map(itemKey),
    episodeUpserts: list(episodes.upsert, "episodes.upsert").map(episodeRow),
    episodeDeletes: list(episodes.delete, "episodes.delete").map(episodeKey),
    hide: list(hidden.add, "hidden.add").map((v) => uuid(v, "hidden.add")),
    unhide: list(hidden.remove, "hidden.remove").map((v) => uuid(v, "hidden.remove")),
  };
  const total = stateWriteSize(w);
  if (total === 0) throw new BadRequest("Nothing to write");
  if (total > MAX_ROWS_PER_WRITE) throw new BadRequest(`At most ${MAX_ROWS_PER_WRITE} rows per request`);
  return w;
}

export function stateWriteSize(w: StateWrite): number {
  return w.itemUpserts.length + w.itemDeletes.length + w.episodeUpserts.length +
    w.episodeDeletes.length + w.hide.length + w.unhide.length;
}

/** The titles of an item write that nobody has acted on before. `?1` is the rows, as JSON. */
const NOT_YET_IN_POOL = "browsed = 1 AND id IN (SELECT j.value ->> 'mediaItemId' FROM json_each(?1) j)";

export type StateWriteResult =
  | { ok: true; applied: Record<string, number>; skipped: number }
  | { ok: false; reason: "budget" };

/**
 * Apply a validated state write. One batch, so a request applies whole or not
 * at all.
 *
 * A row naming an item the catalog does not hold is SKIPPED, not an error: the
 * client resolves a title before it writes state for it, so a miss means a
 * stale id, and failing two thousand good rows over one stale one would make
 * every sync fragile. `skipped` reports how many, so the client can tell.
 */
export async function applyStateWrite(env: Env, userId: string, w: StateWrite): Promise<StateWriteResult> {
  const db = env.DB;
  const size = stateWriteSize(w);
  if (!(await spend(db, "user_writes", capFrom(env.DAILY_USER_WRITE_CAP, DEFAULT_DAILY_USER_WRITE_CAP), size))) {
    return { ok: false, reason: "budget" };
  }

  const statements: { name: string; stmt: D1PreparedStatement; sent: number }[] = [];
  // Bookkeeping that rides in the same batch and is not part of what the write
  // reports: the kept counts this write makes untrue (keptCounts.ts). `before`
  // runs ahead of the named statements and `after` behind them.
  const before: D1PreparedStatement[] = [];
  const touched: StateKind[] = [];
  if (w.itemUpserts.length || w.itemDeletes.length) touched.push("items");
  if (w.episodeUpserts.length || w.episodeDeletes.length) touched.push("episodes");
  if (w.hide.length || w.unhide.length) touched.push("hidden");
  const after = touched.length ? [dropStateCounts(db, userId, touched)] : [];

  if (w.itemDeletes.length) {
    statements.push({
      name: "itemsDeleted", sent: w.itemDeletes.length,
      stmt: db.prepare(
        `DELETE FROM user_item_state
          WHERE user_id = ?1 AND (media_item_id, source, relation) IN (
            SELECT j.value ->> 'mediaItemId', j.value ->> 'source', j.value ->> 'relation' FROM json_each(?2) j)`,
      ).bind(userId, JSON.stringify(w.itemDeletes)),
    });
  }
  if (w.itemUpserts.length) {
    const json = JSON.stringify(w.itemUpserts);
    statements.push({
      name: "itemsUpserted", sent: w.itemUpserts.length,
      // added_at: what the client says, else what the row already had, else now.
      // The client's value is the provider's own "added" time and is the truth
      // when present; a re-sync that omits it must not reset it to today.
      stmt: db.prepare(
        `INSERT INTO user_item_state
           (user_id, media_item_id, source, relation, status, rating, review, reviewed_at, added_at, updated_at)
         SELECT ?1, j.value ->> 'mediaItemId', j.value ->> 'source', j.value ->> 'relation',
                j.value ->> 'status', j.value ->> 'rating', j.value ->> 'review', j.value ->> 'reviewedAt',
                COALESCE(j.value ->> 'addedAt',
                         (SELECT x.added_at FROM user_item_state x
                           WHERE x.user_id = ?1 AND x.media_item_id = j.value ->> 'mediaItemId'
                             AND x.source = j.value ->> 'source' AND x.relation = j.value ->> 'relation'),
                         unixepoch()),
                unixepoch()
           FROM json_each(?2) j
          WHERE EXISTS (SELECT 1 FROM media_items mi WHERE mi.id = j.value ->> 'mediaItemId')
         ON CONFLICT(user_id, media_item_id, source, relation) DO UPDATE SET
           status = excluded.status, rating = excluded.rating, review = excluded.review,
           reviewed_at = excluded.reviewed_at, added_at = excluded.added_at, updated_at = excluded.updated_at`,
      ).bind(userId, json),
    });
    // Acting on a title is what puts it in the scoring pool. Bumping updated_at
    // is what makes the next delta sync carry it to every other device.
    statements.push({
      name: "promoted", sent: 0,
      stmt: db.prepare(`UPDATE media_items SET browsed = 0, updated_at = unixepoch() WHERE ${NOT_YET_IN_POOL}`).bind(json),
    });
    // The pool is about to grow, so its kept size goes, and only then: rating a
    // film that is already in the pool must not cost the next sync a count. It
    // asks the promotion's own question, ahead of it, while the answer is still
    // "yes". ⚠️ A promotion that did not drop the count would leave it too low,
    // which is the one direction that is not allowed (poolSize in keptCounts.ts).
    before.push(db.prepare(`${DROP_POOL_COUNT_SQL} AND EXISTS (SELECT 1 FROM media_items WHERE ${NOT_YET_IN_POOL})`).bind(json));
  }
  if (w.episodeDeletes.length) {
    statements.push({
      name: "episodesDeleted", sent: w.episodeDeletes.length,
      stmt: db.prepare(
        `DELETE FROM user_episode_state
          WHERE user_id = ?1 AND (media_item_id, season_number, episode_number) IN (
            SELECT j.value ->> 'mediaItemId', j.value ->> 'season', j.value ->> 'episode' FROM json_each(?2) j)`,
      ).bind(userId, JSON.stringify(w.episodeDeletes)),
    });
  }
  if (w.episodeUpserts.length) {
    statements.push({
      name: "episodesUpserted", sent: w.episodeUpserts.length,
      stmt: db.prepare(
        `INSERT INTO user_episode_state
           (user_id, media_item_id, season_number, episode_number, watched_at, sources, updated_at)
         SELECT ?1, j.value ->> 'mediaItemId', j.value ->> 'season', j.value ->> 'episode',
                j.value ->> 'watchedAt', j.value ->> 'sources', unixepoch()
           FROM json_each(?2) j
          WHERE EXISTS (SELECT 1 FROM media_items mi WHERE mi.id = j.value ->> 'mediaItemId')
         ON CONFLICT(user_id, media_item_id, season_number, episode_number) DO UPDATE SET
           watched_at = excluded.watched_at, sources = excluded.sources, updated_at = excluded.updated_at`,
      ).bind(userId, JSON.stringify(w.episodeUpserts)),
    });
  }
  if (w.unhide.length) {
    statements.push({
      name: "unhidden", sent: w.unhide.length,
      stmt: db.prepare(
        `DELETE FROM user_hidden_items
          WHERE user_id = ?1 AND media_item_id IN (SELECT j.value FROM json_each(?2) j)`,
      ).bind(userId, JSON.stringify(w.unhide)),
    });
  }
  if (w.hide.length) {
    statements.push({
      name: "hidden", sent: w.hide.length,
      stmt: db.prepare(
        `INSERT OR IGNORE INTO user_hidden_items (user_id, media_item_id)
         SELECT ?1, j.value FROM json_each(?2) j
          WHERE EXISTS (SELECT 1 FROM media_items mi WHERE mi.id = j.value)`,
      ).bind(userId, JSON.stringify(w.hide)),
    });
  }

  const results = await db.batch([...before, ...statements.map((s) => s.stmt), ...after]);
  const applied: Record<string, number> = {};
  let skipped = 0;
  statements.forEach((s, i) => {
    const n = results[before.length + i].meta.changes ?? 0;
    applied[s.name] = n;
    // Only the inserts can skip (an unknown item). A delete matching fewer rows
    // than it named is a row that was already gone, which is the outcome asked for.
    if (s.name === "itemsUpserted" || s.name === "episodesUpserted") skipped += Math.max(0, s.sent - n);
  });
  return { ok: true, applied, skipped };
}
