// The two halves of the matcher that touch no database, split out of matcher.ts
// on 2026-10-04 so the Cloudflare Worker (worker/src/catalog/ingest.ts) can run
// the same rules against D1. matcher.ts imports `@/lib/db`, which is
// better-sqlite3, and nothing reachable from the Worker may.
//
// matcher.ts re-exports `extractCrossIds`, so every existing import still works.
// ⚠️ Keep this file free of imports that are not type-only.
import type { Source } from "@/types";

// Preserve detail-only fields when a sparser payload re-syncs over a richer one
// (D9). List endpoints (Steam owned-games = appid/name/playtime, RAWG played-list)
// omit `developers`/`publishers`/`screenshots` that a prior detail fetch persisted,
// so a plain overwrite would drop them every sync. Shallow-merge new over old:
// fresh fields win, but keys absent from the new payload are kept.
export function mergeRawData(prevJson: string | null | undefined, next: any): any {
  if (!prevJson) return next;
  let prev: any;
  try { prev = JSON.parse(prevJson); } catch { return next; }
  const plain = (v: any) => v && typeof v === "object" && !Array.isArray(v);
  return plain(prev) && plain(next) ? { ...prev, ...next } : next;
}

// Cross-reference ids this source item carries. Used to tell apart two distinct
// works that share a title and a year, like two different "Dracula" films.
export function extractCrossIds(source: Source, rawData: any): Record<string, string> {
  const ids: Record<string, string> = {};
  if (!rawData) return ids;
  switch (source) {
    case "trakt":
      if (rawData.ids?.trakt != null) ids.trakt = String(rawData.ids.trakt);
      if (rawData.ids?.tmdb != null) ids.tmdb = String(rawData.ids.tmdb);
      break;
    case "tmdb":
      if (rawData.id != null) ids.tmdb = String(rawData.id);
      break;
    case "letterboxd": {
      if (rawData.id != null) ids.letterboxd = String(rawData.id);
      const t = (rawData.links ?? []).find((l: any) => l.type === "tmdb");
      if (t?.id != null) ids.tmdb = String(t.id);
      break;
    }
    case "rawg":  if (rawData.id != null) ids.rawg = String(rawData.id); break;
    case "steam": if (rawData.appid != null) ids.steam = String(rawData.appid); break;
    case "igdb":  if (rawData.id != null) ids.igdb = String(rawData.id); break;
  }
  return ids;
}
