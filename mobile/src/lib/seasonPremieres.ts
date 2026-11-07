// A new season of a show you are waiting for, on the calendar and in Up next.
//
// Nils's rule (2026-11-07): the calendar shows a new season only when you have
// watched every episode before it. Rings of Power, both seasons seen, season 3
// due: it is on the calendar. A show left halfway through season 1 when season 2
// comes: it is not, because you are not waiting for it, you have episodes left.
//
// "Watched every episode before it" is read off Up next's own answer from Trakt
// (`up_next`), never counted here: Trakt and TMDB number episodes differently
// often enough that counting ticks against TMDB's episode counts would hide
// shows that are complete. A show whose next episode is in season N or later,
// or that has nothing left to watch, has seen everything before season N. A
// show with no row is one you never started, and a hidden show has no row.
//
// The season dates come from the Worker (`/v1/catalog/season-premieres`), the
// same list for everybody, so what you watch never leaves the device.

import type { SQLiteDatabase } from 'expo-sqlite';
import { api, type SeasonPremiere } from '~/lib/api';
import type { CatalogRow } from '~/lib/db';

const TTL_MS = 60 * 60 * 1000;
const DAY = 86_400;

/** Per month: the Worker's answer, kept an hour. A failed call is not kept. */
const known = new Map<string, { at: number; seasons: Promise<SeasonPremiere[]> }>();

type Ask = (month: string) => Promise<{ seasons: SeasonPremiere[] }>;

export function seasonPremieres(month: string, ask: Ask = api.seasonPremieres): Promise<SeasonPremiere[]> {
  const held = known.get(month);
  if (held && Date.now() - held.at < TTL_MS) return held.seasons;
  // Inside a promise, so even a call that throws before it starts is a rejection the callers' catch sees.
  const seasons = Promise.resolve().then(() => ask(month)).then((r) => r.seasons);
  known.set(month, { at: Date.now(), seasons });
  seasons.catch(() => known.delete(month));
  return seasons;
}

/** For tests. */
export function forgetSeasonPremieres(): void {
  known.clear();
}

/**
 * Where you are in each show: the season of the next episode Up next offers,
 * or null when nothing is left to watch. Shows you hid are left out.
 */
export async function showProgress(db: SQLiteDatabase): Promise<Map<string, number | null>> {
  const rows = await db.getAllAsync<{ media_item_id: string; season: number | null }>(
    'SELECT media_item_id, season FROM up_next WHERE media_item_id NOT IN (SELECT media_item_id FROM hidden_item)',
  );
  return new Map(rows.map((r) => [r.media_item_id, r.season]));
}

/** The premieres you are waiting for: every episode before the season is watched. Pure, so the rule has a test. */
export function premieresYouWaitFor(premieres: SeasonPremiere[], progress: Map<string, number | null>): SeasonPremiere[] {
  return premieres.filter((p) => {
    if (!progress.has(p.id)) return false;
    const next = progress.get(p.id);
    return next == null || next >= p.season;
  });
}

/** The calendar's rows for those premieres: the show's catalog row, dated and keyed by the season. */
export async function premiereRows(db: SQLiteDatabase, month: string): Promise<(CatalogRow & { season: number })[]> {
  const [premieres, progress] = await Promise.all([seasonPremieres(month), showProgress(db)]);
  const mine = premieresYouWaitFor(premieres, progress);
  if (!mine.length) return [];
  const ids = [...new Set(mine.map((p) => p.id))];
  const rows = await db.getAllAsync<CatalogRow>(
    `SELECT id, type, title, slug, poster_url, release_date, year, community_score, community_votes
       FROM catalog WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return mine.flatMap((p) => {
    const show = byId.get(p.id);
    return show ? [{ ...show, release_date: p.airDate, poster_url: p.posterUrl ?? show.poster_url, season: p.season }] : [];
  });
}

/**
 * When Up next should ask Trakt about a caught-up show again because a new
 * season of it starts: the premiere day, and once more a day later in case
 * Trakt did not have the episode yet. Null when no premiere is due after the
 * last check. Without this a show finished months ago waited out its week-long
 * re-check (upNext.ts `TTL_DORMANT`) after its new season was out.
 */
export function premiereRecheckAt(checkedAt: number, airDates: string[]): number | null {
  let best: number | null = null;
  for (const date of airDates) {
    const at = Date.parse(`${date}T00:00:00Z`) / 1000;
    if (Number.isNaN(at)) continue;
    const next = [at, at + DAY].find((t) => t > checkedAt);
    if (next != null && (best == null || next < best)) best = next;
  }
  return best;
}
