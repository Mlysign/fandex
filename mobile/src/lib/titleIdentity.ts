// Whether a card from a provider (TMDB, IGDB, Open Library) and a card the
// device holds are the same title, so a page that merges the two lists shows
// it once: a person's or a studio's page, a franchise rail.
//
// By Fandex id when both have one, then by provider id (a held title's links
// against the provider card's own), else by medium, name and year. The year is
// the catch: a held card's `releaseDate` is the date in the device's country
// (lib/localDates.ts) and a provider dates a title worldwide, so a held card
// answers to its worldwide year as well. Spotlight is 2015 at TMDB and 2016 in
// Germany, and Liev Schreiber's page showed it twice (2026-11-02). The provider
// id comes first because a stored year can be wrong: Der Kanon mechanischer
// Seelen was held as "0030" and Search showed it twice, 0030 and 2017 (2026-11-13).

import { normalizeName } from '@/lib/normalize';

export interface TitleLike {
  id?: string | null;
  type: string;
  title: string;
  releaseDate?: string | null;
  /** The catalog's worldwide date, on a card the device holds (`catalog.world_date`). */
  worldDate?: string | null;
  /** A provider's card: the provider and its id for the title. */
  source?: string;
  sourceId?: string;
  /** A held card: every provider id the catalog links it to, as `source:sourceId` (`PROVIDER_LINKS_COLUMN`). */
  links?: readonly string[];
}

/**
 * The SQL that reads a catalog row's provider ids as one string, "openlibrary:OL21526941W
 * hardcover:2257108"; `providerLinks` splits it. A select that builds cards adds it, so the
 * card can be matched to a provider's by id. 11,515 rows: 11 ms plain, 33 ms with it (node:sqlite, 2026-11-13).
 */
export const PROVIDER_LINKS_COLUMN =
  "(SELECT group_concat(json_extract(value, '$.source') || ':' || json_extract(value, '$.sourceId'), ' ') FROM json_each(vector, '$.sources')) AS links";

/** `PROVIDER_LINKS_COLUMN`'s string as a list. */
export function providerLinks(raw: string | null | undefined): string[] | undefined {
  return raw ? raw.split(' ').filter(Boolean) : undefined;
}

/**
 * The provider-id keys a card answers to. Typed, because a provider id is unique only within a
 * media type (trakt 386 is a film and a show).
 */
function linkKeys(c: TitleLike): string[] {
  const own = c.source && c.sourceId ? [`${c.source}:${c.sourceId}`] : [];
  return [...own, ...(c.links ?? [])].map((l) => `${c.type}|${l}`);
}

/**
 * The name-and-year keys a card answers to. None for a title whose name has no
 * letter `normalizeName` keeps (a title in Japanese script): two of those in
 * one year would otherwise be one title.
 */
export function titleKeys(c: TitleLike): string[] {
  const name = normalizeName(c.title);
  if (!name) return [];
  const years = new Set([c.releaseDate?.slice(0, 4) ?? '', c.worldDate?.slice(0, 4) ?? '']);
  // A dateless card matches only a dateless one, as before: the year is half the name.
  if (years.size > 1) years.delete('');
  return [...years].map((y) => `${c.type}|${name}|${y}`);
}

/** A set of cards to ask "is this one of them?" of, with the one it is. */
export function titleIndex<T extends TitleLike>(cards: readonly T[]) {
  const byId = new Map<string, T>();
  const byLink = new Map<string, T>();
  const byKey = new Map<string, T>();
  const add = (c: T) => {
    if (c.id) byId.set(c.id, c);
    for (const k of linkKeys(c)) if (!byLink.has(k)) byLink.set(k, c);
    for (const k of titleKeys(c)) if (!byKey.has(k)) byKey.set(k, c);
  };
  for (const c of cards) add(c);
  const find = (c: TitleLike): T | undefined => {
    const held = c.id ? byId.get(c.id) : undefined;
    if (held) return held;
    for (const k of linkKeys(c)) {
      const hit = byLink.get(k);
      if (hit) return hit;
    }
    for (const k of titleKeys(c)) {
      const hit = byKey.get(k);
      if (hit) return hit;
    }
    return undefined;
  };
  return { add, find, has: (c: TitleLike) => find(c) !== undefined };
}
