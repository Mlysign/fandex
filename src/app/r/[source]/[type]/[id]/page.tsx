import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { get } from "@/lib/db";
import { rateLimit } from "@/lib/rateLimit";
import { upsertMediaItem } from "@/lib/matcher";
import { getTmdbMovie, getTmdbShow } from "@/lib/sources/tmdb";
import { getIgdbGame } from "@/lib/sources/igdb";
import { isPublicType } from "@/lib/publicUrl";
import { log, errorFields } from "@/lib/logger";
import type { MediaType } from "@/types";

// ── /r/{source}/{type}/{id} — resolve a provider title to a real item page ───
//
// WHY THIS EXISTS (2026-08-23). The franchise rail now lists what a franchise
// ACTUALLY contains, not just the slice we happen to hold — measured that day,
// 167 of 249 TMDB collections held exactly one catalog title, so two thirds of
// franchises showed nothing. A member we do not hold has no uuid, no slug and
// therefore no url. This is that url: it ingests the one title on demand and
// forwards to its real page.
//
// ⚠️ THE ALTERNATIVE WAS PRE-INGESTING EVERY MEMBER, AND THE NUMBERS KILLED IT.
// IGDB franchises average 78 games (largest 394) against TMDB's 4.8 films, so
// pre-ingesting would take the catalog from 2,569 to ~16,500 items: a 6.4x
// resident discovery pool (discovery.ts holds a vector per item, and Railway
// bills RAM at ~$10/GB-month against a $5 Hobby credit) and a 6.4x crawl
// surface. Here, cost tracks CLICKS instead of catalog breadth — 500 clicks is
// 500 rows, not 13,100.
//
// ⚠️ FOUR THINGS KEEP THIS OFF THE CRAWL BUDGET, and all four are load-bearing:
//   1. `noindex, nofollow` below.
//   2. A `Disallow: /r/` in robots.ts, so a well-behaved crawler never fetches
//      it. Both are needed: noindex requires a FETCH to be seen, and Disallow
//      alone would not stop a link being followed from elsewhere.
//   3. A per-IP rate limit, because 1 and 2 are cooperative and this route
//      makes a provider call and writes a row.
//   4. A title we ALREADY hold never reaches the provider at all — that branch
//      is a pure DB lookup and a redirect.
//
// Rows created here are real catalog rows (`browsed = 0`), deliberately. A thin
// `browsed = 1` write would be deleted by the next boot prune, so a link someone
// shared would 404 a day later — the exact url-churn failure that moved item
// addresses off the uuid in the first place (see publicUrl.ts).

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Never indexed: this is a doorway, and the destination is the canonical page.
  robots: { index: false, follow: false },
};

const SOURCES = new Set(["tmdb", "igdb"]);

/** Per IP. Generous for a person clicking through a rail, tight enough that a
 *  misbehaving client cannot turn this into a provider-call amplifier. */
const RESOLVE_LIMIT = 20;
const RESOLVE_WINDOW_MS = 60_000;

interface Params { source: string; type: string; id: string }

export default async function ResolvePage({ params }: { params: Promise<Params> }) {
  const { source, type, id } = await params;

  if (!SOURCES.has(source) || !isPublicType(type) || !/^\d+$/.test(id)) notFound();
  const mediaType = type as MediaType;

  // Already held → straight to the real page. No provider call, no write, and
  // no rate limit: this is the common case once a franchise has been walked
  // once, and it costs a single indexed lookup.
  const existing = get<{ slug: string | null; type: string; media_item_id: string }>(
    `SELECT mi.slug AS slug, mi.type AS type, ml.media_item_id AS media_item_id
       FROM media_links ml JOIN media_items mi ON mi.id = ml.media_item_id
      WHERE ml.source = ? AND ml.source_id = ?`,
    [source, id]
  );
  if (existing) {
    redirect(existing.slug ? `/${existing.type}/${existing.slug}` : `/${existing.type}/${existing.media_item_id}`);
  }

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!rateLimit(`resolve:${ip}`, RESOLVE_LIMIT, RESOLVE_WINDOW_MS).allowed) {
    // A 404 rather than a 429 page: this is a redirect doorway with no UI of
    // its own, and the person who trips it is far more likely to be a script
    // than someone waiting on a page.
    notFound();
  }

  let mediaItemId: string;
  try {
    mediaItemId = await ingestOne(source, mediaType, id);
  } catch (e) {
    // A provider being down must not render an error page here. The rail card
    // that linked here is a title we do not hold; failing to hold it is the
    // status quo, not a broken page.
    log.warn("resolve_ingest_failed", { source, type, id, ...errorFields(e) });
    notFound();
  }

  const row = get<{ slug: string | null; type: string }>(
    "SELECT slug, type FROM media_items WHERE id = ?",
    [mediaItemId]
  );
  if (!row) notFound();
  redirect(row.slug ? `/${row.type}/${row.slug}` : `/${row.type}/${mediaItemId}`);
}

/** One provider detail call + one upsert. Throws on anything unexpected; the
 *  caller turns that into a 404 rather than a 500. */
async function ingestOne(source: string, type: MediaType, id: string): Promise<string> {
  if (source === "tmdb") {
    if (type === "movie") {
      const d = await getTmdbMovie(Number(id));
      if (!d?.id || !d?.title) throw new Error("tmdb movie not found");
      return upsertMediaItem({
        source: "tmdb", sourceId: String(d.id), type: "movie",
        title: d.title, releaseDate: d.release_date || null, rawData: d,
      });
    }
    if (type === "show") {
      const d = await getTmdbShow(Number(id));
      if (!d?.id || !d?.name) throw new Error("tmdb show not found");
      return upsertMediaItem({
        source: "tmdb", sourceId: String(d.id), type: "show",
        title: d.name, releaseDate: d.first_air_date || null, rawData: d,
      });
    }
    throw new Error(`tmdb cannot serve type ${type}`);
  }

  // igdb — games only.
  if (type !== "game") throw new Error(`igdb cannot serve type ${type}`);
  const g = await getIgdbGame(Number(id));
  if (!g?.id || !g?.name) throw new Error("igdb game not found");
  const first = typeof g.first_release_date === "number"
    ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10)
    : null;
  return upsertMediaItem({
    source: "igdb", sourceId: String(g.id), type: "game",
    title: g.name, releaseDate: first, rawData: g,
  });
}
