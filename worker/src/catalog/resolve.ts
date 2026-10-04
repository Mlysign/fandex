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

export type ResolveSource = "tmdb" | "igdb";

export type ResolveOutcome =
  | { ok: true; id: string; created: boolean }
  | { ok: false; reason: "bad-request" | "not-found" | "budget" | "provider" | "rate-limited" };

const SOURCES = new Set<string>(["tmdb", "igdb"]);
const TYPES = new Set<string>(["movie", "show", "game"]);
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
  if (!SOURCES.has(source) || !TYPES.has(type) || !/^\d{1,12}$/.test(id)) return false;
  // TMDB holds films and shows, IGDB holds games. Nothing else is askable.
  return source === "tmdb" ? type !== "game" : type === "game";
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
       json_group_array(json_object('source', s, 'type', t, 'id', sid, 'mediaItemId', mid)) FILTER (WHERE mid IS NOT NULL) found,
       json_group_array(json_object('source', s, 'type', t, 'id', sid)) FILTER (WHERE mid IS NULL) missing
       FROM (SELECT j.value ->> 'source' s, j.value ->> 'type' t, j.value ->> 'id' sid, l.media_item_id mid
               FROM json_each(?1) j
               LEFT JOIN media_links l
                 ON l.source = j.value ->> 'source' AND l.source_id = j.value ->> 'id' AND l.media_type = j.value ->> 'type')`,
    [JSON.stringify(refs)],
  );
  return `{"found":${row?.found ?? "[]"},"missing":${row?.missing ?? "[]"}}`;
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

  useSharedIgdbToken(env);
  const g = await getIgdbGame(Number(id));
  if (!g?.id || !g?.name) return null;
  return { source: "igdb", sourceId: String(g.id), type: "game", title: g.name, releaseDate: igdbReleaseDate(g), rawData: g };
}
