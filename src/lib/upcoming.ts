import { compareAsc, parseISO, startOfDay } from "date-fns";

// SM18 (2026-07-28): /api/calendar deliberately returns the FULL wishlist,
// oldest-first, no future filter — /calendar's Month grid and MyStuffView's
// Wishlist tab both need that complete history. /profile's "Coming up" rail
// took the same feed and just sliced the first 5, so it showed decades-old
// releases (Seven Samurai, 1954) as "upcoming". This is the one shared
// definition of "upcoming" for any caller that wants it: releaseDate today or
// later, undated items dropped, input order preserved (callers sort first if
// they need chronological order).
export function upcomingFrom<T extends { releaseDate: string | null }>(items: T[], now: Date): T[] {
  const today = startOfDay(now);
  return items.filter((it) => it.releaseDate && compareAsc(parseISO(it.releaseDate), today) >= 0);
}
