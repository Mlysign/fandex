import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { initDb, get, run } from "@/lib/db";
import { upsertMediaItem, upsertWatchlistEntry, removeWatchlistSource } from "@/lib/matcher";
import { getRawgGame, addToRawgToPlay, removeFromRawgToPlay } from "@/lib/sources/rawg";
import { getTmdbMovie, getTmdbShow } from "@/lib/sources/tmdb";
import {
  addMovieToTraktWatchlist,
  addShowToTraktWatchlist,
  removeMovieFromTraktWatchlist,
  removeShowFromTraktWatchlist,
} from "@/lib/sources/trakt";

export async function POST(req: NextRequest) {
  try {
    initDb();
    const session = await requireSession();
    const body = await req.json();
    const { type, title, releaseDate, posterUrl, ids, targetProvider } = body;

    if (!ids || !type) return NextResponse.json({ error: "ids and type required" }, { status: 400 });

    let mediaItemId: string | null = null;

    // ── Fetch and store data for each known source ─────────────────

    if (ids.rawg) {
      try {
        const rawgData = await getRawgGame(ids.rawg);
        const id = upsertMediaItem({
          source: "rawg", sourceId: String(ids.rawg), type,
          title: rawgData.name ?? title,
          releaseDate: rawgData.released ?? releaseDate ?? null,
          rawData: rawgData,
        });
        if (!mediaItemId) mediaItemId = id;
      } catch (e) { console.error("[watchlist] RAWG fetch failed:", e); }
    }

    if (ids.tmdb) {
      try {
        const tmdbData = type === "movie" ? await getTmdbMovie(ids.tmdb) : await getTmdbShow(ids.tmdb);
        const resolvedTitle = tmdbData?.title ?? tmdbData?.name ?? title;
        const resolvedDate = tmdbData?.release_date ?? tmdbData?.first_air_date ?? releaseDate ?? null;
        const id = upsertMediaItem({
          source: "tmdb", sourceId: String(ids.tmdb), type,
          title: resolvedTitle, releaseDate: resolvedDate, rawData: tmdbData ?? { title, releaseDate },
        });
        if (!mediaItemId) mediaItemId = id;
      } catch (e) { console.error("[watchlist] TMDB fetch failed:", e); }
    }

    if (ids.trakt) {
      const id = upsertMediaItem({
        source: "trakt", sourceId: String(ids.trakt), type,
        title, releaseDate: releaseDate ?? null,
        rawData: { title, year: releaseDate?.slice(0, 4), ids },
      });
      if (!mediaItemId) mediaItemId = id;
    }

    if (ids.steam) {
      const id = upsertMediaItem({
        source: "steam", sourceId: String(ids.steam), type,
        title, releaseDate: releaseDate ?? null,
        rawData: { title, appid: ids.steam, ids },
      });
      if (!mediaItemId) mediaItemId = id;
    }

    if (!mediaItemId) {
      const fallbackSource = Object.keys(ids)[0] as any;
      const fallbackId = String(Object.values(ids)[0]);
      mediaItemId = upsertMediaItem({
        source: fallbackSource, sourceId: fallbackId, type,
        title, releaseDate: releaseDate ?? null,
        rawData: { title, releaseDate, posterUrl, ids },
      });
    }

    // Mark all found sources in watchlist
    const sources = Object.keys(ids).filter((k) => ids[k]);
    for (const source of sources) {
      upsertWatchlistEntry(session.userId, mediaItemId, source as any);
    }

    // ── Platform write-backs ──────────────────────────────────────
    // If targetProvider is set, only write-back to that one.
    // Otherwise write-back to all relevant platforms.
    const shouldWriteTo = (p: string) => !targetProvider || targetProvider === p;

    // RAWG write-back
    if (shouldWriteTo("rawg") && ids.rawg && type === "game") {
      const rawgIdentity = get<any>(
        "SELECT access_token FROM user_identities WHERE user_id = ? AND provider = 'rawg'",
        [session.userId]
      );
      if (rawgIdentity?.access_token) {
        try {
          await addToRawgToPlay(rawgIdentity.access_token, ids.rawg);
          upsertWatchlistEntry(session.userId, mediaItemId, "rawg");
          console.log(`[watchlist] Added to RAWG: ${ids.rawg}`);
        } catch (e) { console.error("[watchlist] RAWG write-back failed:", e); }
      }
    }

    // Trakt write-back
    if (shouldWriteTo("trakt") && ids.trakt && (type === "movie" || type === "show")) {
      const traktIdentity = get<any>(
        "SELECT access_token FROM user_identities WHERE user_id = ? AND provider = 'trakt'",
        [session.userId]
      );
      if (traktIdentity?.access_token) {
        try {
          if (type === "movie") {
            await addMovieToTraktWatchlist(traktIdentity.access_token, ids.trakt);
          } else {
            await addShowToTraktWatchlist(traktIdentity.access_token, ids.trakt);
          }
          upsertWatchlistEntry(session.userId, mediaItemId, "trakt");
          console.log(`[watchlist] Added to Trakt: ${ids.trakt}`);
        } catch (e) { console.error("[watchlist] Trakt write-back failed:", e); }
      }
    }

    return NextResponse.json({ ok: true, mediaItemId });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    initDb();
    const session = await requireSession();
    const { mediaItemId, source } = await req.json();

    const mediaItem = get<any>("SELECT type FROM media_items WHERE id = ?", [mediaItemId]);

    // ── Trakt write-back removal ──────────────────────────────────
    if (!source || source === "trakt") {
      const traktIdentity = get<any>(
        "SELECT access_token FROM user_identities WHERE user_id = ? AND provider = 'trakt'",
        [session.userId]
      );
      if (traktIdentity?.access_token) {
        const traktLink = get<any>(
          "SELECT source_id FROM media_links WHERE media_item_id = ? AND source = 'trakt'",
          [mediaItemId]
        );
        if (traktLink && mediaItem) {
          try {
            const traktId = parseInt(traktLink.source_id);
            if (mediaItem.type === "movie") {
              await removeMovieFromTraktWatchlist(traktIdentity.access_token, traktId);
            } else if (mediaItem.type === "show") {
              await removeShowFromTraktWatchlist(traktIdentity.access_token, traktId);
            }
            console.log(`[watchlist] Removed from Trakt: ${traktLink.source_id}`);
          } catch (e) { console.error("[watchlist] Trakt remove failed:", e); }
        }
      }
    }

    // ── RAWG write-back removal ───────────────────────────────────
    if (!source || source === "rawg") {
      const rawgIdentity = get<any>(
        "SELECT access_token FROM user_identities WHERE user_id = ? AND provider = 'rawg'",
        [session.userId]
      );
      if (rawgIdentity?.access_token) {
        const rawgLink = get<any>(
          "SELECT source_id FROM media_links WHERE media_item_id = ? AND source = 'rawg'",
          [mediaItemId]
        );
        if (rawgLink) {
          try {
            await removeFromRawgToPlay(rawgIdentity.access_token, parseInt(rawgLink.source_id));
            console.log(`[watchlist] Removed from RAWG: ${rawgLink.source_id}`);
          } catch (e) { console.error("[watchlist] RAWG remove failed:", e); }
        }
      }
    }

    // ── Local DB removal ──────────────────────────────────────────
    if (source) {
      removeWatchlistSource(session.userId, mediaItemId, source as any);
    } else {
      run("DELETE FROM user_watchlist WHERE user_id = ? AND media_item_id = ?", [session.userId, mediaItemId]);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
