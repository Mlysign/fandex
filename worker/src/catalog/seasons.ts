// A show's season list, stored from TMDB.
//
// `show_seasons` is what the app's episode tracker draws (GET
// /v1/shows/{id}/episodes): with no rows the tracker says "Fandex has no
// episode list for this show yet". The old site filled it lazily on a page
// view; until 2026-10-30 nothing on this stack wrote it, so only the seeded
// shows had seasons. Now it is written two ways:
//
//   • every full TMDB show payload ingest stores (a resolve, the retention
//     refresh, the projection walk) carries `seasons`, and they are stored
//     with it. No extra TMDB call.
//   • the cron walks the TMDB shows that have none (`runShowSeasonsStep` in
//     cron.ts), one small `/tv/{id}` call each, and parks when through.
//
// Episode LISTS stay where they were: the device asks TMDB for a season the
// catalog holds none for. A stored list whose season changed its episode count
// is dropped, so the device asks again rather than drawing a short season.
//
// Upsert only. A season missing from a payload keeps its row: the table is a
// cache the tracker draws, and a payload that says less is not proof of less.

import { tmdbPosterUrl } from "@/lib/sources/tmdb";
import { all, stmt } from "../d1";

/** TMDB's "Specials". Left out, as on the old site: it breaks the "n of total" a season row reads. */
const SPECIALS_SEASON = 0;

export interface SeasonRow {
  season_number: number;
  name: string | null;
  episode_count: number;
  air_date: string | null;
  poster_url: string | null;
  overview: string | null;
}

/**
 * The rows a TMDB `seasons` array gives, or null when the payload carries no
 * array at all. Null says nothing about the show; `[]` is a show TMDB lists no
 * numbered season for.
 */
export function seasonRowsFromTmdb(seasons: unknown): SeasonRow[] | null {
  if (!Array.isArray(seasons)) return null;
  return seasons
    .filter((s) => Number.isInteger(s?.season_number) && s.season_number !== SPECIALS_SEASON)
    .map((s) => ({
      season_number: s.season_number,
      name: typeof s.name === "string" && s.name ? s.name : null,
      episode_count: Number.isInteger(s.episode_count) && s.episode_count > 0 ? s.episode_count : 0,
      air_date: typeof s.air_date === "string" && s.air_date ? s.air_date : null,
      poster_url: tmdbPosterUrl(typeof s.poster_path === "string" ? s.poster_path : null, "w342"),
      overview: typeof s.overview === "string" && s.overview ? s.overview : null,
    }));
}

const SAME: (keyof SeasonRow)[] = ["name", "episode_count", "air_date", "poster_url", "overview"];

/**
 * Store a show's seasons, writing only the rows that changed. Every row is one
 * of the day's 100,000 writes, so a refresh that changed nothing writes nothing.
 * Returns the seasons written.
 */
export async function storeShowSeasons(db: D1Database, mediaItemId: string, rows: SeasonRow[]): Promise<number> {
  if (!rows.length) return 0;
  const stored = new Map((await all<SeasonRow>(
    db,
    "SELECT season_number, name, episode_count, air_date, poster_url, overview FROM show_seasons WHERE media_item_id = ?",
    [mediaItemId],
  )).map((r) => [r.season_number, r]));

  const statements: D1PreparedStatement[] = [];
  let written = 0;
  for (const row of rows) {
    const had = stored.get(row.season_number);
    if (had && SAME.every((k) => had[k] === row[k])) continue;
    written++;
    statements.push(stmt(
      db,
      `INSERT INTO show_seasons (media_item_id, season_number, name, episode_count, air_date, poster_url, overview, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(media_item_id, season_number) DO UPDATE SET
         name = excluded.name, episode_count = excluded.episode_count, air_date = excluded.air_date,
         poster_url = excluded.poster_url, overview = excluded.overview, updated_at = excluded.updated_at`,
      [mediaItemId, row.season_number, row.name, row.episode_count, row.air_date, row.poster_url, row.overview],
    ));
    // A stored list for a season that grew (or shrank) is no longer the season.
    if (had && had.episode_count !== row.episode_count) {
      statements.push(stmt(
        db,
        "DELETE FROM show_episodes WHERE media_item_id = ? AND season_number = ?",
        [mediaItemId, row.season_number],
      ));
    }
  }
  if (statements.length) await db.batch(statements);
  return written;
}
