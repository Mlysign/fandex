// A title's names in other languages (Nils, 2026-11-21).
//
// One work, one entry, whatever it is called: "Kimi no Na wa" and "Your Name."
// find the same film, shown once, under the account's language ("Your Name. -
// Gestern, heute und für immer" for an account set to Germany). Every media
// type: films and shows from TMDB's translations and alternative titles, games
// from IGDB's alternative names, books from Hardcover's editions.
//
// Two lists ride on a title's record (the merged doc and the catalog vector):
//
//  • `titles`: a display title per language, ISO 639-1 ("de", "en"). Only the
//    languages an account can be set to, plus the original's. A title that is
//    the same as the canonical one is stored as "" (known, and the same), so a
//    missing key keeps meaning "not known" and the next language is tried.
//  • `aka`: names that FIND the title but are never shown: the original
//    ("君の名は。"), a romanization ("Kimi no Na wa."), a game's other names.
//
// The account's language is its country's (Settings, `users.country`): the
// country's languages first, then English, then the canonical title.

import { bookLanguagesFor } from "./sources/bookPure";

/** Open Library's MARC codes (what the book code speaks) as ISO 639-1. */
const MARC_TO_ISO1: Record<string, string> = {
  eng: "en", ger: "de", fre: "fr", ita: "it", dut: "nl", spa: "es", por: "pt", swe: "sv", nor: "no",
  dan: "da", fin: "fi", pol: "pl", cze: "cs", gre: "el", jpn: "ja", kor: "ko", hin: "hi", afr: "af",
};

/** A MARC code as ISO 639-1, or null for a language no account reads. */
export const iso1FromMarc = (code: string | null | undefined): string | null => (code ? MARC_TO_ISO1[code] ?? null : null);

/** The languages a title keeps a display name for: every one an account's country can name. */
export const TITLE_LANGUAGES: ReadonlySet<string> = new Set(Object.values(MARC_TO_ISO1));

/** TMDB writes Norwegian Bokmål as "nb" as often as "no". */
const ISO1_ALIASES: Record<string, string> = { nb: "no" };

/** An ISO 639-1 code as this module keys it, or null for one it does not keep. */
export function titleLanguage(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const c = code.trim().toLowerCase();
  const k = ISO1_ALIASES[c] ?? c;
  return TITLE_LANGUAGES.has(k) ? k : null;
}

/** The country whose translation a language's title is taken from first ("en" from the US, "de" from Germany). */
const LANGUAGE_HOME: Record<string, string> = {
  en: "US", ja: "JP", ko: "KR", sv: "SE", da: "DK", cs: "CZ", el: "GR", hi: "IN", af: "ZA",
};
export const languageHome = (lang: string): string => LANGUAGE_HOME[lang] ?? lang.toUpperCase();

/** The countries a film or show comes from, as TMDB names them: whose alternative titles are search names. */
export function tmdbOriginCountries(d: any): Set<string> {
  const out = new Set<string>();
  for (const c of Array.isArray(d?.origin_country) ? d.origin_country : []) if (typeof c === "string") out.add(c);
  for (const c of Array.isArray(d?.production_countries) ? d.production_countries : []) if (typeof c?.iso_3166_1 === "string") out.add(c.iso_3166_1);
  return out;
}

/** The languages an account reads titles in, best first: its country's, then English. */
export function titleLanguagesFor(country: string | null | undefined): string[] {
  const marc = bookLanguagesFor(country);
  const own = marc.filter((m) => m !== "eng").map((m) => MARC_TO_ISO1[m]).filter((x): x is string => !!x);
  return [...own, "en"];
}

/** At most this many search-only names a title. */
export const AKA_CAP = 10;

export interface TitleNames {
  titles?: Record<string, string>;
  aka?: string[];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Per-language names, first source wins a language, compacted against the
 * canonical title: kept languages only, "" for one that reads the same, and
 * search-only names that repeat nothing already known. Empty lists are left
 * off, so a title with nothing extra carries nothing extra.
 */
export function compactTitleNames(canonical: string, sources: TitleNames[]): TitleNames {
  const titles: Record<string, string> = {};
  for (const s of sources) {
    for (const [lang, raw] of Object.entries(s.titles ?? {})) {
      const k = titleLanguage(lang);
      if (!k || k in titles || typeof raw !== "string" || !raw.trim()) continue;
      titles[k] = same(raw, canonical) ? "" : raw.trim();
    }
  }
  const known = [canonical, ...Object.values(titles).filter(Boolean)];
  const aka: string[] = [];
  for (const s of sources) {
    for (const raw of s.aka ?? []) {
      if (typeof raw !== "string" || !raw.trim() || aka.length >= AKA_CAP) continue;
      if (known.some((k) => same(k, raw)) || aka.some((k) => same(k, raw))) continue;
      aka.push(raw.trim());
    }
  }
  return {
    ...(Object.keys(titles).length ? { titles } : {}),
    ...(aka.length ? { aka } : {}),
  };
}

/** The title to show in `langs` (best first): the first language known, else the canonical one. */
export function displayTitle(item: { title: string; titles?: Record<string, string> | null }, langs: readonly string[]): string {
  const t = item.titles;
  if (t) {
    for (const l of langs) {
      const v = t[l];
      if (v === "") return item.title;
      if (typeof v === "string" && v) return v;
    }
  }
  return item.title;
}

/**
 * Every name a search may find the title by, for an account reading `langs`:
 * the canonical title, English, the account's languages and the search-only
 * names. Not every language: an Italian title finds nothing for a German account.
 */
export function searchTitles(item: { title: string; titles?: Record<string, string> | null; aka?: string[] | null }, langs: readonly string[]): string[] {
  const out = [item.title];
  const t = item.titles ?? {};
  for (const l of new Set([...langs, "en"])) if (t[l]) out.push(t[l]);
  for (const a of item.aka ?? []) if (typeof a === "string" && a) out.push(a);
  return [...new Set(out)];
}
