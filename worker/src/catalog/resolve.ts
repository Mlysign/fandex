// "Updated by the users", in the one form that is safe (docs/app-plan.md).
//
// A client names a title by (provider, type, id). The Worker looks it up, and on
// a miss fetches it from the provider with ITS credentials and writes the row.
// A client never supplies catalog data: anything else would hand the catalog's
// write access to whoever unzips the APK.
//
// The old site's /r/{source}/{type}/{id} page did this job, and its four guards
// carry over: a title already held costs one indexed read and no provider call,
// the ids are validated before anything is fetched, a failed fetch writes
// nothing, and the whole thing sits behind a budget.

import { getTmdbMovie, getTmdbShow } from "@/lib/sources/tmdb";
import { getIgdbGame, igdbReleaseDate, setIgdbTokenStore } from "@/lib/sources/igdb";
import type { MediaType } from "@/types";
import { capFrom, kvGet, kvSet, spend } from "../budget";
import { first } from "../d1";
import type { Env } from "../env";
import { upsertMediaItem, type SourceItem } from "./ingest";
import { bookDate, getOpenLibraryWork } from "@/lib/sources/openlibrary";
import { getBggThing } from "@/lib/sources/bgg";
import { useBggToken } from "../shelves";

export type ResolveSource = "tmdb" | "igdb" | "openlibrary" | "bgg";

export type ResolveOutcome =
  | { ok: true; id: string; created: boolean }
  | { ok: false; reason: "bad-request" | "not-found" | "budget" | "provider" | "rate-limited" };

/**
 * Which types each provider holds, and what its ids look like. Explicit per
 * source: the rule used to be "TMDB is anything but a game", which a new type
 * would have slipped through (2026-10-17).
 */
const TARGETS: Record<ResolveSource, { types: Set<string>; id: RegExp }> = {
  tmdb: { types: new Set(["movie", "show"]), id: /^\d{1,12}$/ },
  igdb: { types: new Set(["game"]), id: /^\d{1,12}$/ },
  openlibrary: { types: new Set(["book"]), id: /^OL\d{1,12}W$/ },
  bgg: { types: new Set(["boardgame"]), id: /^\d{1,9}$/ },
};
const TYPES = new Set<string>(["movie", "show", "game", "book", "boardgame"]);
const DEFAULT_DAILY_FETCH_CAP = 2000;
const TWITCH_TOKEN_KEY = "twitch_app_token";

/**
 * Point the IGDB module's token cache at D1, so every isolate shares one Twitch
 * app token instead of minting its own. Cheap and idempotent; called at the top
 * of any path that may reach IGDB.
 */
export function useSharedIgdbToken(env: Env): void {
  setIgdbTokenStore({
    async get() {
      const raw = await kvGet(env.DB, TWITCH_TOKEN_KEY);
      if (!raw) return null;
      try {
        const t = JSON.parse(raw) as { token: string; expiresAt: number };
        return typeof t.token === "string" && typeof t.expiresAt === "number" ? t : null;
      } catch {
        return null;
      }
    },
    async set(t) {
      const ttl = Math.max(60, Math.floor((t.expiresAt - Date.now()) / 1000));
      await kvSet(env.DB, TWITCH_TOKEN_KEY, JSON.stringify(t), ttl);
    },
  });
}

export function validResolveTarget(source: string, type: string, id: string): boolean {
  const target = Object.prototype.hasOwnProperty.call(TARGETS, source) ? TARGETS[source as ResolveSource] : null;
  return !!target && target.types.has(type) && target.id.test(id);
}

/** The item a provider id already maps to, or null. One indexed read. */
export async function findByProviderId(db: D1Database, source: string, type: string, id: string): Promise<string | null> {
  const row = await first<{ media_item_id: string }>(
    db,
    "SELECT media_item_id FROM media_links WHERE source = ? AND source_id = ? AND media_type = ?",
    [source, id, type],
  );
  return row?.media_item_id ?? null;
}

/**
 * `mayFetch` is the caller's rate limiter. It is asked only on a MISS: a title
 * already held is one indexed read with no provider call and no write, and a
 * client syncing a library resolves hundreds of those in a row.
 */
export async function resolveItem(
  env: Env,
  source: string,
  type: string,
  id: string,
  mayFetch?: () => Promise<boolean>,
): Promise<ResolveOutcome> {
  if (!validResolveTarget(source, type, id)) return { ok: false, reason: "bad-request" };

  const held = await findByProviderId(env.DB, source, type, id);
  if (held) return { ok: true, id: held, created: false };

  if (mayFetch && !(await mayFetch())) return { ok: false, reason: "rate-limited" };

  // Counted before the fetch, so a provider that is down still spends budget.
  // That is the safe direction: a caller hammering a dead provider is exactly
  // what the cap is for.
  if (!(await spend(env.DB, "fetch", capFrom(env.DAILY_FETCH_CAP, DEFAULT_DAILY_FETCH_CAP)))) {
    return { ok: false, reason: "budget" };
  }

  let item: SourceItem | null;
  try {
    item = await fetchFromProvider(env, source as ResolveSource, type as MediaType, id);
  } catch (e) {
    console.warn("resolve_fetch_failed", { source, type, id, error: e instanceof Error ? e.message : String(e) });
    return { ok: false, reason: "provider" };
  }
  if (!item) return { ok: false, reason: "not-found" };

  // An IGDB port or edition opens its main game: IGDB keeps each console port
  // and each "Gold Edition" as a game of its own, often with the same name and
  // year, and holding both made one game two titles (66 folded on 2026-10-15).
  // Search already leaves them out; this covers a link that names one.
  const main = item.source === "igdb" ? mainGameId(item.rawData) : null;
  if (main) {
    const heldMain = await findByProviderId(env.DB, "igdb", "game", main);
    if (heldMain) return { ok: true, id: heldMain, created: false };
    try {
      item = (await fetchFromProvider(env, "igdb", "game", main)) ?? item;
    } catch (e) {
      // The port itself was fetched fine. Better the port than nothing.
      console.warn("resolve_main_game_failed", { id, main, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // browsed = 1: a title somebody opened is not yet a title somebody acted on,
  // and only acted-on rows belong in the scoring pool every device shares.
  const res = await upsertMediaItem(env.DB, item, { browsed: 1 });
  return { ok: true, id: res.id, created: res.created };
}

// ── Looking up many at once ──────────────────────────────────────────────────

export const LOOKUP_MAX = 2000;

export interface ProviderRef {
  source: string;
  type: string;
  id: string;
}

/** Validate a lookup body. Returns null when it is not a list of plausible refs. */
export function parseRefs(body: unknown): ProviderRef[] | null {
  const refs = (body as { refs?: unknown } | null)?.refs;
  if (!Array.isArray(refs) || refs.length === 0 || refs.length > LOOKUP_MAX) return null;
  const out: ProviderRef[] = [];
  for (const r of refs) {
    if (!r || typeof r !== "object") return null;
    const { source, type, id } = r as Record<string, unknown>;
    // Wider than resolve's two sources on purpose: a Trakt or Steam id can be
    // looked up (the seeded catalog holds those links) even though only TMDB and
    // IGDB can be fetched.
    if (typeof source !== "string" || !/^[a-z]{2,16}$/.test(source)) return null;
    if (typeof type !== "string" || !TYPES.has(type)) return null;
    const sid = typeof id === "number" ? String(id) : id;
    if (typeof sid !== "string" || !/^[A-Za-z0-9_.:-]{1,64}$/.test(sid)) return null;
    out.push({ source, type, id: sid });
  }
  return out;
}

/**
 * Which of these provider ids the catalog already holds, as a JSON string:
 * `{"found":[{source,type,id,mediaItemId},…],"missing":[{source,type,id},…]}`.
 *
 * This is what a client sync calls instead of resolve-per-title. A Trakt
 * library is a thousand ids of which nearly all are held; one statement and N
 * primary-key reads answer that, with no provider call and no write. Only the
 * `missing` ones are worth a resolve each.
 */
export async function lookupRefsJson(db: D1Database, refs: ProviderRef[]): Promise<string> {
  const row = await first<{ found: string | null; missing: string | null }>(
    db,
    `SELECT
       json_group_array(json_object('source', s, 'type', t, 'id', sid, 'mediaItemId', mid, 'slug', slug)) FILTER (WHERE mid IS NOT NULL) found,
       json_group_array(json_object('source', s, 'type', t, 'id', sid)) FILTER (WHERE mid IS NULL) missing
       FROM (SELECT j.value ->> 'source' s, j.value ->> 'type' t, j.value ->> 'id' sid, l.media_item_id mid, m.slug slug
               FROM json_each(?1) j
               LEFT JOIN media_links l
                 ON l.source = j.value ->> 'source' AND l.source_id = j.value ->> 'id' AND l.media_type = j.value ->> 'type'
               -- The slug, so a card links /{type}/{slug} and not /item/{id} (SM80).
               -- One primary-key read per held title.
               LEFT JOIN media_items m ON m.id = l.media_item_id)`,
    [JSON.stringify(refs)],
  );
  return `{"found":${row?.found ?? "[]"},"missing":${row?.missing ?? "[]"}}`;
}

/**
 * The game an IGDB port (game_type 11) or edition (version_parent) belongs to,
 * or null. Only those two: a DLC, an expansion, a remaster or a remake also
 * has a parent_game, and each of those is a work of its own.
 */
export function mainGameId(g: any): string | null {
  const id = g?.version_parent ?? (g?.game_type === 11 ? g?.parent_game : null);
  return Number.isInteger(id) && id > 0 && id !== g.id ? String(id) : null;
}

/** One provider detail call. Null means the provider answered and has no such title. */
async function fetchFromProvider(env: Env, source: ResolveSource, type: MediaType, id: string): Promise<SourceItem | null> {
  if (source === "tmdb") {
    try {
      if (type === "movie") {
        const d = await getTmdbMovie(Number(id));
        if (!d?.id || !d?.title) return null;
        return { source: "tmdb", sourceId: String(d.id), type: "movie", title: d.title, releaseDate: d.release_date || null, rawData: d };
      }
      const d = await getTmdbShow(Number(id));
      if (!d?.id || !d?.name) return null;
      return { source: "tmdb", sourceId: String(d.id), type: "show", title: d.name, releaseDate: d.first_air_date || null, rawData: d };
    } catch (e) {
      // tmdbGet throws "TMDB error: 404 /movie/…" for an id that does not exist.
      // That is an answer, not an outage.
      if (e instanceof Error && /TMDB error: 404/.test(e.message)) return null;
      throw e;
    }
  }

  if (source === "openlibrary") {
    const w = await getOpenLibraryWork(id);
    if (!w?.title) return null;
    // A merged work answers under its new id: that one is stored, so the next lookup finds it.
    return { source: "openlibrary", sourceId: w.id, type: "book", title: w.title, releaseDate: bookDate(w), rawData: w };
  }

  if (source === "bgg") {
    useBggToken(env);
    const t = await getBggThing(id);
    if (!t) return null;
    return { source: "bgg", sourceId: t.id, type: "boardgame", title: t.name, releaseDate: t.year ? String(t.year) : null, rawData: t };
  }

  useSharedIgdbToken(env);
  const g = await getIgdbGame(Number(id));
  if (!g?.id || !g?.name) return null;
  return { source: "igdb", sourceId: String(g.id), type: "game", title: g.name, releaseDate: igdbReleaseDate(g), rawData: g };
}
