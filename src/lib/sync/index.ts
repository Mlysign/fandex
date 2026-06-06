import { randomUUID } from "crypto";
import { query, run, get } from "@/lib/db";
import { upsertMediaItem, upsertWatchlistEntry, removeWatchlistSource } from "@/lib/matcher";
import { getTraktWatchlistMovies, getTraktWatchlistShows, refreshTraktToken } from "@/lib/sources/trakt";
import { getSteamWishlistIds, getSteamAppDetails, getSteamTagMap, resolveTagNames } from "@/lib/sources/steam";
import { getRawgUserToPlay, getRawgUserToPlayAuth } from "@/lib/sources/rawg";
import { getTmdbMovie, getTmdbShow, searchTmdbMovie, searchTmdbShow, tmdbPosterUrl } from "@/lib/sources/tmdb";
import { Source } from "@/types";

// ── Trakt sync ─────────────────────────────────────────────────────

export async function syncTrakt(userId: string) {
  const identity = get<any>(
    "SELECT * FROM user_identities WHERE user_id = ? AND provider = 'trakt'",
    [userId]
  );
  if (!identity) return { count: 0, error: "Trakt not connected" };

  let accessToken = identity.access_token;

  // Refresh if needed
  if (identity.token_expires_at && identity.token_expires_at < Math.floor(Date.now() / 1000) + 300) {
    try {
      const tokens = await refreshTraktToken(identity.refresh_token);
      accessToken = tokens.access_token;
      run(
        "UPDATE user_identities SET access_token = ?, refresh_token = ?, token_expires_at = ? WHERE id = ?",
        [tokens.access_token, tokens.refresh_token, Math.floor(Date.now() / 1000) + tokens.expires_in, identity.id]
      );
    } catch (e: any) {
      return { count: 0, error: `Token refresh failed: ${e.message}` };
    }
  }

  let count = 0;

  try {
    // Get current Trakt source_ids in local DB for this user
    const existingTraktMovies = query<{ media_item_id: string; source_id: string }>(
      `SELECT ml.media_item_id, ml.source_id
       FROM media_links ml
       JOIN user_watchlist uw ON uw.media_item_id = ml.media_item_id
       WHERE uw.user_id = ? AND ml.source = 'trakt'
       AND EXISTS (SELECT 1 FROM media_items mi WHERE mi.id = ml.media_item_id AND mi.type = 'movie')`,
      [userId]
    );
    const existingTraktShows = query<{ media_item_id: string; source_id: string }>(
      `SELECT ml.media_item_id, ml.source_id
       FROM media_links ml
       JOIN user_watchlist uw ON uw.media_item_id = ml.media_item_id
       WHERE uw.user_id = ? AND ml.source = 'trakt'
       AND EXISTS (SELECT 1 FROM media_items mi WHERE mi.id = ml.media_item_id AND mi.type = 'show')`,
      [userId]
    );

    // Movies – from /sync/watchlist/movies
    // Shape: [{ rank, id, listed_at, notes, type, movie: { title, year, ids, ... } }]
    const movies = await getTraktWatchlistMovies(accessToken);
    for (const entry of movies) {
      const movie = entry.movie;
      if (!movie) continue;

      // Enrich with TMDB
      let tmdbData: any = null;
      if (movie.ids?.tmdb) {
        try {
          tmdbData = await getTmdbMovie(movie.ids.tmdb);
          await new Promise((r) => setTimeout(r, 50));
        } catch { /* continue */ }
      } else {
        try {
          tmdbData = await searchTmdbMovie(movie.title, movie.year);
          await new Promise((r) => setTimeout(r, 50));
        } catch { /* continue */ }
      }

      const releaseDate = tmdbData?.release_date ?? (movie.year ? `${movie.year}-01-01` : null);
      const traktData = { ...movie, listed_at: entry.listed_at };

      const itemId = upsertMediaItem({
        source: "trakt",
        sourceId: String(movie.ids.trakt),
        type: "movie",
        title: movie.title,
        releaseDate,
        rawData: traktData,
      });

      if (tmdbData) {
        upsertMediaItem({
          source: "tmdb",
          sourceId: String(movie.ids.tmdb ?? tmdbData.id),
          type: "movie",
          title: tmdbData.title ?? movie.title,
          releaseDate: tmdbData.release_date ?? null,
          rawData: tmdbData,
        });
      }

      upsertWatchlistEntry(userId, itemId, "trakt");
      count++;
    }

    // Shows – from /sync/watchlist/shows
    // Shape: [{ rank, id, listed_at, notes, type, show: { title, year, ids, ... } }]
    const shows = await getTraktWatchlistShows(accessToken);
    for (const entry of shows) {
      const show = entry.show;
      if (!show) continue;

      let tmdbData: any = null;
      if (show.ids?.tmdb) {
        try {
          tmdbData = await getTmdbShow(show.ids.tmdb);
          await new Promise((r) => setTimeout(r, 50));
        } catch { /* continue */ }
      }

      const releaseDate = tmdbData?.first_air_date ?? (show.year ? `${show.year}-01-01` : null);
      const traktData = { ...show, listed_at: entry.listed_at };

      const itemId = upsertMediaItem({
        source: "trakt",
        sourceId: String(show.ids.trakt),
        type: "show",
        title: show.title,
        releaseDate,
        rawData: traktData,
      });

      if (tmdbData) {
        upsertMediaItem({
          source: "tmdb",
          sourceId: String(show.ids.tmdb ?? tmdbData.id),
          type: "show",
          title: tmdbData.name ?? show.title,
          releaseDate: tmdbData.first_air_date ?? null,
          rawData: tmdbData,
        });
      }

      upsertWatchlistEntry(userId, itemId, "trakt");
      count++;
    }

    // ── Remove items no longer in Trakt watchlist ─────────────────
    const syncedMovieIds = new Set(movies.map((e: any) => String(e.movie?.ids?.trakt)).filter(Boolean));
    for (const existing of existingTraktMovies) {
      if (!syncedMovieIds.has(existing.source_id)) {
        console.log(`[Trakt sync] Removing movie no longer in watchlist: ${existing.source_id}`);
        removeWatchlistSource(userId, existing.media_item_id, "trakt");
      }
    }

    const syncedShowIds = new Set(shows.map((e: any) => String(e.show?.ids?.trakt)).filter(Boolean));
    for (const existing of existingTraktShows) {
      if (!syncedShowIds.has(existing.source_id)) {
        console.log(`[Trakt sync] Removing show no longer in watchlist: ${existing.source_id}`);
        removeWatchlistSource(userId, existing.media_item_id, "trakt");
      }
    }

    logSync(userId, "trakt", count, "ok");
    return { count };
  } catch (e: any) {
    logSync(userId, "trakt", count, "error", e.message);
    return { count, error: e.message };
  }
}

// ── Steam sync ─────────────────────────────────────────────────────

export async function syncSteam(userId: string) {
  const identity = get<any>(
    "SELECT * FROM user_identities WHERE user_id = ? AND provider = 'steam'",
    [userId]
  );
  if (!identity) return { count: 0, error: "Steam not connected" };

  const steamId = identity.provider_user_id;
  let count = 0;

  try {
    const appIds = await getSteamWishlistIds(steamId);
    if (appIds.length === 0) return { count: 0 };

    const tagMap = await getSteamTagMap();
    const details = await getSteamAppDetails(appIds);

    for (const appId of appIds) {
      const data = details[appId];
      if (!data || data.item_type !== 0) continue; // skip non-games

      // Resolve tag names
      if (data.tagids && Object.keys(tagMap).length > 0) {
        data.resolvedTags = resolveTagNames(data.tagids, tagMap);
      }

      const releaseDate = extractSteamDate(data);

      const itemId = upsertMediaItem({
        source: "steam",
        sourceId: String(appId),
        type: "game",
        title: data.name ?? `App ${appId}`,
        releaseDate,
        rawData: { ...data, appid: appId },
      });

      // Try to enrich with RAWG by name search
      try {
        const { searchRawg, getRawgGame } = await import("@/lib/sources/rawg");
        const results = await searchRawg(data.name);
        const normalized = data.name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
        const exact = results.results?.find(
          (r: any) => r.name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim() === normalized
        );
        if (exact) {
          const rawgFull = await getRawgGame(exact.id);
          upsertMediaItem({
            source: "rawg",
            sourceId: String(exact.id),
            type: "game",
            title: rawgFull.name,
            releaseDate: rawgFull.released ?? null,
            rawData: rawgFull,
          });
        }
        await new Promise((r) => setTimeout(r, 150));
      } catch { /* continue without RAWG data */ }

      upsertWatchlistEntry(userId, itemId, "steam");
      count++;
    }

    // Remove items no longer in Steam wishlist
    const existingSteamItems = query<{ media_item_id: string; source_id: string }>(
      `SELECT ml.media_item_id, ml.source_id
       FROM media_links ml
       JOIN user_watchlist uw ON uw.media_item_id = ml.media_item_id
       WHERE uw.user_id = ? AND ml.source = 'steam'`,
      [userId]
    );
    const syncedSteamIds = new Set(appIds.map(String));
    for (const existing of existingSteamItems) {
      if (!syncedSteamIds.has(existing.source_id)) {
        console.log(`[Steam sync] Removing game no longer in wishlist: ${existing.source_id}`);
        removeWatchlistSource(userId, existing.media_item_id, "steam");
      }
    }

    logSync(userId, "steam", count, "ok");
    return { count };
  } catch (e: any) {
    logSync(userId, "steam", count, "error", e.message);
    return { count, error: e.message };
  }
}

// ── RAWG sync ─────────────────────────────────────────────────────

async function getRawgToken(identity: any): Promise<string> {
  // Try existing token first
  if (identity.access_token) {
    // Verify token still works with a lightweight call
    try {
      const res = await fetch("https://api.rawg.io/api/users/current", {
        headers: { Authorization: `Token ${identity.access_token}` },
      });
      if (res.ok) return identity.access_token;
    } catch { /* fall through to re-auth */ }
  }

  // Re-authenticate using stored encrypted password
  if (!identity.metadata) throw new Error("No RAWG credentials stored");
  const { passwordHash } = JSON.parse(identity.metadata);

  // We stored the hash but need the original password – we can't decrypt bcrypt
  // Instead, store the token and refresh via re-login only when user manually reconnects
  // For now, use the stored token and let it fail gracefully
  throw new Error("RAWG token expired – please reconnect in Settings");
}

export async function syncRawg(userId: string) {
  const identity = get<any>(
    "SELECT * FROM user_identities WHERE user_id = ? AND provider = 'rawg'",
    [userId]
  );
  if (!identity) return { count: 0, error: "RAWG not connected" };

  // Use email as username for the public "want to play" endpoint
  // Also try authenticated endpoint with token
  // Slug is stored in metadata (set during login)
  const metadata = identity.metadata ? JSON.parse(identity.metadata) : {};
  const slug = metadata.slug ?? identity.display_name ?? identity.provider_user_id;
  const token = identity.access_token;
  let count = 0;

  console.log(`[RAWG sync] Using slug: ${slug}, token: ${token ? "yes" : "no"}`);

  try {
    // Use authenticated endpoint with slug
    const games = token
      ? await getRawgUserToPlayAuth(token, slug)
      : await getRawgUserToPlay(slug);
    
    console.log(`[RAWG sync] Got ${games.length} games`);

    for (const game of games) {
      const itemId = upsertMediaItem({
        source: "rawg",
        sourceId: String(game.id),
        type: "game",
        title: game.name,
        releaseDate: game.released ?? null,
        rawData: game,
      });

      // Try to find on Steam by name
      try {
        const { searchSteamByName } = await import("@/lib/sources/steam");
        const found = await searchSteamByName(game.name);
        if (found) {
          const { getSteamTagMap, resolveTagNames } = await import("@/lib/sources/steam");
          const tagMap = await getSteamTagMap();
          if (found.data.tagids) found.data.resolvedTags = resolveTagNames(found.data.tagids, tagMap);
          upsertMediaItem({
            source: "steam",
            sourceId: String(found.appid),
            type: "game",
            title: found.data.name ?? game.name,
            releaseDate: extractSteamDate(found.data),
            rawData: { ...found.data, appid: found.appid },
          });
        }
        await new Promise((r) => setTimeout(r, 200));
      } catch { /* continue */ }

      upsertWatchlistEntry(userId, itemId, "rawg");
      count++;
    }

    // Remove items no longer in RAWG Want to Play
    const existingRawgItems = query<{ media_item_id: string; source_id: string }>(
      `SELECT ml.media_item_id, ml.source_id
       FROM media_links ml
       JOIN user_watchlist uw ON uw.media_item_id = ml.media_item_id
       WHERE uw.user_id = ? AND ml.source = 'rawg'`,
      [userId]
    );
    const syncedRawgIds = new Set(games.map((g: any) => String(g.id)));
    for (const existing of existingRawgItems) {
      if (!syncedRawgIds.has(existing.source_id)) {
        console.log(`[RAWG sync] Removing game no longer in Want to Play: ${existing.source_id}`);
        removeWatchlistSource(userId, existing.media_item_id, "rawg");
      }
    }

    logSync(userId, "rawg", count, "ok");
    return { count };
  } catch (e: any) {
    logSync(userId, "rawg", count, "error", e.message);
    return { count, error: e.message };
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function extractSteamDate(data: any): string | null {
  const r = data.release;
  if (!r) return null;
  if (r.steam_release_date) return new Date(r.steam_release_date * 1000).toISOString().split("T")[0];
  if (r.custom_release_date?.date) {
    const p = Date.parse(r.custom_release_date.date);
    if (!isNaN(p)) return new Date(p).toISOString().split("T")[0];
  }
  return null;
}

function logSync(userId: string, provider: string, count: number, status: string, error?: string) {
  run(
    "INSERT INTO sync_log (id, user_id, provider, item_count, status, error) VALUES (?, ?, ?, ?, ?, ?)",
    [randomUUID(), userId, provider, count, status, error ?? null]
  );
}
