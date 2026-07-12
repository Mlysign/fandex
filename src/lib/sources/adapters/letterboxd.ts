import { get, run } from "@/lib/db";
import { linkSourceToItem } from "@/lib/matcher";
import { MediaSource, PulledItem } from "../types";
import { CATALOG } from "../catalog";
import {
  refreshLetterboxdToken, findLetterboxdFilmByTmdb,
  addToLetterboxdWatchlist, removeFromLetterboxdWatchlist, logLetterboxdEntry,
  getLetterboxdWatchlist, getLetterboxdLogEntries, posterFromFilm, releaseDateFromFilm,
} from "../letterboxd";
import { METADATA } from "@/lib/metadata/registry";
import { decryptSecret, decryptNullable, encryptSecret, encryptNullable } from "@/lib/crypto";

function toUnix(s: any): number | null {
  if (!s) return null;
  const p = Date.parse(s);
  return isNaN(p) ? null : Math.floor(p / 1000);
}

// Letterboxd adapter (movies only). OAuth — `context()` refreshes the token when
// a refresh token is present (Letterboxd doesn't expose an expiry, so we always
// attempt a refresh, falling back to the stored token).
//
// NOTE: pull* (watchlist/log-entry reads) not migrated yet — legacy sync paths
// cross-enrich with TMDB. Writes, auth, capabilities, id-resolution are migrated.
export const letterboxdSource: MediaSource = {
  ...CATALOG.letterboxd,

  async context(userId) {
    const identity = get<any>(
      "SELECT * FROM user_identities WHERE user_id = ? AND provider = 'letterboxd'",
      [userId]
    );
    if (!identity) return null;
    let token: string | null = decryptNullable(identity.access_token);
    if (identity.refresh_token) {
      try {
        const t = await refreshLetterboxdToken(decryptSecret(identity.refresh_token));
        token = t.access_token;
        run(
          "UPDATE user_identities SET access_token = ?, refresh_token = ? WHERE id = ?",
          [encryptSecret(t.access_token), encryptNullable(t.refresh_token), identity.id]
        );
      } catch { /* fall back to the existing token */ }
    }
    return { userId, identity, token, slug: identity.provider_user_id };
  },

  async resolveSourceId(_ctx, _type, ids, meta) {
    if (ids.letterboxd != null) return String(ids.letterboxd);
    if (ids.tmdb != null) {
      const film = await findLetterboxdFilmByTmdb(
        Number(ids.tmdb), meta?.title ?? "", meta?.year ?? undefined
      );
      return film?.id ?? null;
    }
    return null;
  },

  matches(item, ids) {
    if (ids.letterboxd != null && item.sourceId === String(ids.letterboxd)) return true;
    if (ids.tmdb == null) return false;
    return !!item.rawData?.links?.some((l: any) => l.type === "tmdb" && String(l.id) === String(ids.tmdb));
  },

  async pushWishlist(ctx, sourceId, _type, add) {
    if (!ctx.token) return;
    if (add) await addToLetterboxdWatchlist(sourceId, ctx.token);
    else await removeFromLetterboxdWatchlist(sourceId, ctx.token);
  },

  // A Letterboxd log-entry records the watch AND the rating in one call.
  async pushRating(ctx, sourceId, _type, appRating) {
    if (!ctx.token) return;
    await logLetterboxdEntry(sourceId, ctx.token, appRating);
  },

  async pushStatus(ctx, sourceId) {
    if (!ctx.token) return;
    await logLetterboxdEntry(sourceId, ctx.token);
  },

  async pullWishlist(ctx) {
    if (!ctx.token || !ctx.slug) return [];
    const films = await getLetterboxdWatchlist(ctx.slug, ctx.token);
    return films.map((film): PulledItem => ({
      sourceId: film.id, title: film.name, type: "movie",
      releaseDate: releaseDateFromFilm(film),
      rawData: { ...film, posterUrl: posterFromFilm(film) },
    }));
  },

  async pullLibrary(ctx) {
    if (!ctx.token || !ctx.slug) return [];
    const entries = await getLetterboxdLogEntries(ctx.slug, ctx.token);
    const items: PulledItem[] = [];
    for (const entry of entries) {
      const film = entry.film;
      if (!film?.id) continue;
      items.push({
        sourceId: film.id, title: film.name, type: "movie",
        releaseDate: releaseDateFromFilm(film),
        rawData: { ...film, posterUrl: posterFromFilm(film) },
        status: "watched",
        rating: typeof entry.rating === "number" ? entry.rating * 2 : null, // 0.5-5 → 0-10
        review: entry.review?.text ?? null,
        reviewedAt: toUnix(entry.diaryDetails?.diaryDate) ?? toUnix(entry.whenCreated),
      });
    }
    return items;
  },

  // Cross-enrich with TMDB via the film's own links (cheap) — wishlist & library.
  async enrich(item, mediaItemId) {
    const film = item.rawData;
    const tmdbLink = film?.links?.find((l: any) => l.type === "tmdb");
    if (!tmdbLink || !METADATA.tmdb?.fetchById) return;
    try {
      const link = await METADATA.tmdb.fetchById(String(tmdbLink.id), "movie");
      if (link) {
        linkSourceToItem(mediaItemId, {
          source: "tmdb", sourceId: link.sourceId, type: "movie",
          title: link.title || film.name,
          releaseDate: link.releaseDate ?? releaseDateFromFilm(film),
          rawData: link.rawData,
        });
      }
    } catch { /* enrichment optional */ }
  },
};
