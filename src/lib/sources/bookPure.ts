// Open Library helpers with no imports but normalize.ts (itself import-free),
// so the app and the facet code can use them without pulling the fetch module
// in (sources/openlibrary.ts fetches).

import { searchKey } from "@/lib/normalize";

/** A work id as Open Library writes it: OL, digits, W. */
export const OL_WORK_ID = /^OL\d{1,12}W$/;

/** Open Library's 1-5 average on Fandex's 0-100. */
export function bookRating(average: unknown): number | null {
  return typeof average === "number" && average >= 1 ? Math.round(((average - 1) / 4) * 100) : null;
}

export function coverUrl(coverId: unknown, size: "M" | "L" = "L"): string | null {
  return typeof coverId === "number" && coverId > 0 ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg` : null;
}

/** An author's photo, by Open Library author id. Open Library answers a blank image for none, so `?default=false` makes that a 404. */
export function authorPhotoUrl(authorKey: unknown): string | null {
  return typeof authorKey === "string" && /^OL\d+A$/.test(authorKey) ? `https://covers.openlibrary.org/a/olid/${authorKey}-M.jpg?default=false` : null;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * A year a book can have been published in: from printing (1450) to five years
 * out. Open Library and Hardcover both hold typos ("Der Kanon mechanischer
 * Seelen", year 30), and a year outside this is no date rather than a wrong one.
 */
export function plausibleBookYear(year: number, now = new Date()): boolean {
  return Number.isInteger(year) && year >= 1450 && year <= now.getUTCFullYear() + 5;
}

/**
 * A book's date as the catalog keeps dates: the earliest full edition date in
 * its first year of publication (the first printing, as near as Open Library
 * gets), else the year alone ("1965").
 * ⚠️ Never a made-up January 1st: a year-only date would put every book of that
 * year on the calendar's first day.
 */
export function bookDate(doc: any): string | null {
  const year = Number(doc?.first_publish_year);
  if (!plausibleBookYear(year)) return null;
  // ⚠️ January 1st is how Open Library writes "some time that year" (Dune's 1965
  // editions read "January 1, 1965"), so it counts as the year alone, not a day.
  const days = ((doc?.publish_date ?? []) as unknown[]).map(parseDay)
    .filter((d): d is string => !!d && d.startsWith(String(year)) && !d.endsWith("-01-01")).sort();
  return days[0] ?? String(year);
}

/** One edition's date as YYYY-MM-DD, or null when it names no day or is ambiguous (03/04/2026 is). */
export function parseDay(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  const valid = (y: string, m: string, d: string) => {
    const mm = Number(m), dd = Number(d);
    return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : null;
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return valid(m[1], m[2], m[3]);
  m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/.exec(t);
  if (m && MONTHS[m[1].toLowerCase()]) return valid(m[3], MONTHS[m[1].toLowerCase()], m[2]);
  m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]*\.? (\d{4})$/.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) return valid(m[3], MONTHS[m[2].toLowerCase()], m[1]);
  return null;
}

// ── The languages a book list shows (2026-11-03) ─────────────────────────────

/**
 * A book language, as Open Library writes it (MARC codes: "eng", "ger"), with
 * the names and ISO codes another provider may use for it. Hardcover names an
 * edition's language in words ("German").
 */
const BOOK_LANGUAGE_NAMES: Record<string, string[]> = {
  eng: ["english", "en"], ger: ["german", "deutsch", "de", "deu"], fre: ["french", "fr", "fra"],
  ita: ["italian", "it"], spa: ["spanish", "castilian", "es"], por: ["portuguese", "pt"],
  dut: ["dutch", "flemish", "nl", "nld"], swe: ["swedish", "sv"], nor: ["norwegian", "bokmal", "nynorsk", "no", "nb", "nob", "nn", "nno"],
  dan: ["danish", "da"], fin: ["finnish", "fi"], pol: ["polish", "pl"], cze: ["czech", "cs", "ces"],
  gre: ["greek", "el", "ell"], jpn: ["japanese", "ja"], kor: ["korean", "ko"], hin: ["hindi", "hi"], afr: ["afrikaans", "af"],
};

/**
 * The languages a country reads besides English, by the country the user set
 * (Nils, 2026-11-03: "English and the language set in the user's settings";
 * the setting is the country). A country with more than one gets each.
 */
const COUNTRY_BOOK_LANGUAGES: Record<string, string[]> = {
  DE: ["ger"], AT: ["ger"], CH: ["ger", "fre", "ita"], FR: ["fre"], BE: ["dut", "fre"], NL: ["dut"],
  ES: ["spa"], MX: ["spa"], AR: ["spa"], PT: ["por"], BR: ["por"], IT: ["ita"], SE: ["swe"], NO: ["nor"],
  DK: ["dan"], FI: ["fin", "swe"], PL: ["pol"], CZ: ["cze"], GR: ["gre"], JP: ["jpn"], KR: ["kor"],
  CA: ["fre"], IN: ["hin"], ZA: ["afr"],
};

/** English alone: what a list shows when no country is given. */
export const ENGLISH_ONLY: readonly string[] = ["eng"];

/** The languages a list shows for a country: English first, then the country's own. */
export function bookLanguagesFor(country: string | null | undefined): string[] {
  const extra = COUNTRY_BOOK_LANGUAGES[String(country ?? "").trim().toUpperCase()] ?? [];
  return ["eng", ...extra.filter((l) => l !== "eng")];
}

/** A language as a provider wrote it ("German", "de", "/languages/ger") as Open Library's code, or null. */
export function bookLanguageCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace("/languages/", "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!t) return null;
  if (BOOK_LANGUAGE_NAMES[t]) return t;
  for (const [code, names] of Object.entries(BOOK_LANGUAGE_NAMES)) {
    if (names.includes(t) || names.some((n) => n.length > 3 && t.split(/[^a-z]+/).includes(n))) return code;
  }
  return null;
}

/**
 * Whether a work has an edition in one of `accepted`, or says nothing about
 * languages. Open Library files a translation as a WORK of its own ("Der Weg
 * der Könige" beside "The Way of Kings"), so an author's or a series' books
 * came back once per language (Nils, 2026-10-17). A list shows English and
 * the user's country's languages (`bookLanguagesFor`); a work with editions
 * only in others is left out. A record with no language list is kept: unknown
 * is not "another language".
 */
export function hasEditionIn(doc: any, accepted: readonly string[] = ENGLISH_ONLY): boolean {
  const langs = doc?.language;
  return !Array.isArray(langs) || langs.length === 0 || langs.some((l) => accepted.includes(String(l)));
}

/** An edition as a list reads it for its language: its own title, and its language as the provider wrote it. */
export interface EditionLanguage {
  title?: unknown;
  language?: unknown;
}

/**
 * A book filed with its editions (Hardcover's shape), read for the languages a
 * list shows: whether to keep it, and under which title. Hardcover titles a
 * book after one of its editions, which can be a translation: Sam Feuerbach's
 * "Der Hüter der Elixiere" was "Il custode delle essenze" (seen 2026-11-03).
 *
 *  • No edition names a language: kept as it is. Unknown is not "another language".
 *  • An edition in `accepted`: kept. When no accepted edition carries the
 *    book's own title, the title of the first accepted edition is shown,
 *    English before the country's language.
 *  • Every edition seen is in another language: left out, but only when all
 *    of them were seen (`editionsCount` at most the number given). A book
 *    with more editions than were asked for may have an accepted one among
 *    the rest, and a book left out by a guess is worse than one shown.
 */
export function editionsInLanguages(
  bookTitle: string, editions: readonly EditionLanguage[] | null | undefined, editionsCount: number | null, accepted: readonly string[] = ENGLISH_ONLY,
): { keep: boolean; title: string } {
  const named = (editions ?? []).map((e) => ({ title: typeof e?.title === "string" ? e.title.trim() : "", code: bookLanguageCode(e?.language) }))
    .filter((e): e is { title: string; code: string } => !!e.code);
  if (!named.length) return { keep: true, title: bookTitle };
  const ok = named.filter((e) => accepted.includes(e.code));
  if (!ok.length) return { keep: editionsCount != null && editionsCount > (editions ?? []).length, title: bookTitle };
  const head = (t: string) => foldKey(withoutEditionMarker(t).split(/[:(]/)[0]);
  const same = (t: string) => head(t) === head(bookTitle);
  if (ok.some((e) => e.title && same(e.title))) return { keep: true, title: bookTitle };
  for (const code of accepted) {
    const e = ok.find((x) => x.code === code && x.title);
    if (e) return { keep: true, title: e.title };
  }
  return { keep: true, title: bookTitle };
}

/** `hasEditionIn` for English alone: what a lookup by ISBN prefers. */
export const hasEnglishEdition = (doc: any): boolean => hasEditionIn(doc, ENGLISH_ONLY);

/**
 * A work that is a piece or a bundle of another, catalogued on its own: a
 * split edition ("Words of Radiance, Part Two", "The Wise Man's Fear [1/2]",
 * "Oathbringer part 1") or a box set ("Stormlight Archive MM Boxed Set I,
 * Books 1-3", "4 Books Collection Set"). Beside the book itself they are
 * duplicates with a worse cover and no ratings.
 */
export function isPieceOfBook(title: unknown): boolean {
  if (typeof title !== "string") return false;
  return /(,\s*|\s+)part\s+(one|two|three|four|\d+)\s*$/i.test(title)
    || /\[\s*\d+\s*\/\s*\d+\s*\]|\(\s*\d+\s+of\s+\d+\s*\)/i.test(title)
    || /\b(boxed?\s+sets?|collection\s+sets?|books?\s+(collection|bundles?)|bundles?\s+sets?|\d+\s+books?\s+(collection|sets?|bundles?)|books\s+\d+\s*-\s*\d+)\b/i.test(title);
}

/** A work that is the book itself, in a language the list shows: what every shelf answer keeps. */
export const isWholeBook = (doc: any, accepted: readonly string[] = ENGLISH_ONLY): boolean =>
  hasEditionIn(doc, accepted) && !isPieceOfBook(doc?.title);

/** What an edition's `series` string adds after the name: "#1", ", 2", ", book 3", ", Day 2", " -- bk. 1", "(1)", "Band I". */
const SERIES_NUMBERING = /(\s*--\s*.*|[,;]\s*.*|\s*#\s*\d+.*|\s*\(\s*\d+\s*\)\s*|\s+(book|bk\.?|band|vol\.?|volume|day|no\.?|part)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|[ivx]+)\b.*|\s+\d+)\s*$/i;

/**
 * A work's series, from its editions: Open Library's search row carries
 * `series_name` for a few works only ("The Kingkiller Chronicle" yes, "The
 * Stormlight Archive" no, seen 2026-10-17), while the editions say "The
 * Stormlight Archive #1", "The Stormlight Archive, 2". English editions only,
 * or the German printing's name wins by count. The name is the spelling most
 * editions share once the numbering is taken off; null when no edition names one.
 */
export function seriesFromEditions(entries: unknown): string | null {
  const counts = new Map<string, { label: string; n: number }>();
  for (const ed of (Array.isArray(entries) ? entries : []) as any[]) {
    const langs = ((ed?.languages ?? []) as any[]).map((l) => String(l?.key ?? l ?? "").replace("/languages/", ""));
    if (langs.length && !langs.includes("eng")) continue;
    for (const raw of (ed?.series ?? []) as unknown[]) {
      if (typeof raw !== "string") continue;
      const label = raw.replace(SERIES_NUMBERING, "").trim();
      if (label.length < 2 || /^\d+$/.test(label)) continue;
      const k = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const c = counts.get(k) ?? { label, n: 0 };
      c.n += 1;
      counts.set(k, c);
    }
  }
  let best: { label: string; n: number } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best?.label ?? null;
}

/** A series named in a work's subjects, the way Open Library tags some ("series:Stormlight Archive"). */
export function seriesFromSubjects(subjects: unknown): string | null {
  for (const s of (Array.isArray(subjects) ? subjects : []) as unknown[]) {
    const m = typeof s === "string" ? /^series:\s*(.+)$/i.exec(s.trim()) : null;
    if (m && m[1].trim().length >= 2) return m[1].trim();
  }
  return null;
}

/**
 * Subjects that describe the book, not the library's handling of it. Open
 * Library's list mixes "Science fiction" with "Accessible book", "New York
 * Times reviewed", "nyt:hardcover-fiction=2021-01-03" and comma-chained
 * catalogue headings; only the first kind is a tag.
 */
export function bookSubjects(doc: any, limit = 20): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of [...(doc?.subject ?? []), ...(doc?.subjects_work ?? [])]) {
    if (typeof s !== "string") continue;
    const t = s.trim();
    if (!t || t.length > 40 || /[:=]/.test(t) || /,|\(|\)|--/.test(t)) continue;
    if (/\b(accessible|protected daisy|in library|large type|reviewed|lending library|internet archive|award|translations? into|open library|staff picks|overdrive|juvenile literature|bestsellers?|best sellers?|manual for civilization|long now|reading level|textbooks?)\b/i.test(t)) continue;
    if (/^(fiction|nonfiction|non-fiction|literature|english|american|novel|novels|general|books|reading)$/i.test(t)) continue;
    // "Science-fiction" and "Science fiction" are one subject.
    const k = t.toLowerCase().replace(/[-_]+/g, " ");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t[0].toUpperCase() + t.slice(1));
    if (out.length >= limit) break;
  }
  return out;
}

// ── Cards, and the two book sources as one list (2026-10-17) ─────────────────

/** A book as the app's provider card, the shape /v1/search/books answers with. */
export interface BookCard {
  source: "openlibrary" | "hardcover";
  sourceId: string;
  type: "book";
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  votes: number;
  /** 0-100, from Open Library's 1-5 stars. Null for Hardcover: its ratings are not ours to show. */
  rating: number | null;
  /** How many readers shelved it at Open Library. 0 for Hardcover (a count of readers is theirs). */
  popularity: number;
  genres: string[];
  authors: string[];
  /** ISBN-13s, for matching the two sources. Dropped from the wire (`stripIsbns`). */
  isbns?: string[];
}

// a to z only, so a title in another script folds to "" ("東京 2" to "2").
// `searchKey` keeps those letters, and is the key whenever it holds any:
// Greek through the CJK and Hangul blocks, leaving out the symbol blocks in
// between, so a "™" does not move a Latin title off the Latin key.
const OTHER_SCRIPT = /[Ͱ-῿Ⰰ-퟿豈-﫿ｦ-ￜ]/;
const foldKey = (s: string) => {
  const kept = searchKey(s);
  if (OTHER_SCRIPT.test(kept)) return kept;
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
};

/**
 * A printing's label at the end of a title, which Open Library keeps when it
 * files an audiobook or a large print as a work of its own: "Blood, Sweat, and
 * Pixels Lib/E" (a library audiobook, beside the book itself, seen 2026-11-03),
 * "… (Unabridged)", "… [Audiobook]", "… Large Print". Repeated, since a
 * title can carry two ("Lib/E Unabridged").
 */
const EDITION_MARKER = /[\s,;:-]*[([]?\s*(lib\s*\/\s*e|library edition|un-?abridged|abridged|audio\s*books?|audio\s*cd|mp3\s*cd|large\s*(print|type)|ebook|e-book|kindle edition)\s*[)\]]?\s*$/i;

export function withoutEditionMarker(title: string): string {
  let t = title.trim();
  for (let i = 0; i < 3; i += 1) {
    const next = t.replace(EDITION_MARKER, "").trim();
    if (next === t || !next) break;
    t = next;
  }
  return t;
}

/** Whether a title carries a printing's label (`withoutEditionMarker`). */
export const hasEditionMarker = (title: string): boolean => withoutEditionMarker(title) !== title.trim();

/**
 * What one book looks like whichever provider names it: the title before any
 * subtitle, without a leading article, plus the first author's surname. "The
 * Doors of Stone" at Hardcover and "Doors of Stone" at Open Library are one key.
 * ⚠️ Never an empty title: every title in another script once keyed "|", and
 * `mergeBookCards` folded them all into the first. A title nothing can key is
 * its own book, keyed by the provider's id.
 */
export function bookIdentityKey(card: { title: string; authors?: string[]; source?: string; sourceId?: string }): string {
  const title = foldKey(withoutEditionMarker(card.title).split(/[:(]/)[0]).replace(/^(the|a|an) /, "");
  const author = card.authors?.[0] ? foldKey(card.authors[0]).split(" ").pop() ?? "" : "";
  if (!title) return `id:${card.source ?? ""}:${card.sourceId ?? card.title}`;
  return `${title}|${author}`;
}

/**
 * A book about another book that exists to ride its search traffic: "Summary
 * of Andy Weir's Project Hail Mary", "SUMMARY AND ANALYSIS OF …", "Workbook
 * for Atomic Habits", "Epilogue for …". Hardcover lists a dozen per bestseller.
 */
export function isCompanionBook(title: string): boolean {
  return /^(?:an? )?(?:(?:summary|analysis|study guide|workbook|epilogue|quicklet|trivia|conversation starters|cliffsnotes|sparknotes)\b.*?\b(?:of|for|to|on)\b|summary\s*(?:&|and)\s*analysis\b)/i.test(title.trim());
}

/**
 * Two providers' cards as one list: the first list in full, then whatever the
 * second holds that the first does not. The same book is one that shares an
 * ISBN-13, or the same title and author. Open Library goes first, so its
 * work stays the book's identity; a Hardcover card survives only for a book
 * Open Library did not answer with. A book both know keeps Open Library's
 * cover and takes Hardcover's only when Open Library has none (Nils,
 * 2026-10-17: "covers only if the other provider has none").
 *
 * Since 2026-10-23 the same book twice in ONE list is one card too ("witcher"
 * answered nine "The Witcher" works), and a summary, study guide or workbook
 * of somebody else's book is no card at all. Of two cards from the SAME
 * provider, the one with more votes is kept, and on a tie the one whose title
 * carries no printing's label, so an audiobook work listed first does not
 * stand for the book (2026-11-03). Across providers the first list still wins.
 */
export function mergeBookCards(primary: BookCard[], secondary: BookCard[]): BookCard[] {
  const byIsbn = new Map<string, BookCard>();
  const byKey = new Map<string, BookCard>();
  const note = (c: BookCard) => {
    for (const i of c.isbns ?? []) if (!byIsbn.has(i)) byIsbn.set(i, c);
    const k = bookIdentityKey(c);
    if (!byKey.has(k)) byKey.set(k, c);
  };
  const better = (c: BookCard, held: BookCard) => c.source === held.source
    && (c.votes > held.votes || (c.votes === held.votes && hasEditionMarker(held.title) && !hasEditionMarker(c.title)));
  // Copies: filling a cover in must not change the caller's card.
  const out: BookCard[] = [];
  for (const c of [...primary, ...secondary]) {
    if (isCompanionBook(c.title)) continue;
    const twin = (c.isbns ?? []).map((i) => byIsbn.get(i)).find((t): t is BookCard => !!t) ?? byKey.get(bookIdentityKey(c));
    if (twin) {
      if (better(c, twin)) {
        // The kept card takes the place of the one it beats, so the maps and the order still hold.
        const isbns = [...new Set([...(c.isbns ?? []), ...(twin.isbns ?? [])])];
        Object.assign(twin, c, { posterUrl: c.posterUrl ?? twin.posterUrl, ...(isbns.length ? { isbns } : {}) });
        note(twin);
      } else if (!twin.posterUrl && c.posterUrl) twin.posterUrl = c.posterUrl;
      continue;
    }
    const copy = { ...c };
    note(copy);
    out.push(copy);
  }
  return out;
}

/** Cards for the wire: the ISBN lists are for matching, not for a client. */
export function stripIsbns(cards: BookCard[]): BookCard[] {
  return cards.map(({ isbns: _isbns, ...rest }) => rest);
}
