// Open Library helpers with no imports, so the app and the facet code can use
// them without pulling the fetch module in (sources/openlibrary.ts fetches).

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
 * A book's date as the catalog keeps dates: the earliest full edition date in
 * its first year of publication (the first printing, as near as Open Library
 * gets), else the year alone ("1965").
 * ⚠️ Never a made-up January 1st: a year-only date would put every book of that
 * year on the calendar's first day.
 */
export function bookDate(doc: any): string | null {
  const year = Number(doc?.first_publish_year);
  if (!Number.isInteger(year) || year <= 0) return null;
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

/**
 * Whether a work has an edition in English, or says nothing about languages.
 * Open Library files a translation as a WORK of its own ("Der Weg der Könige"
 * beside "The Way of Kings"), so an author's or a series' books came back once
 * per language (Nils, 2026-10-17). The catalog is in English, as TMDB's titles
 * are, so a work with editions only in other languages is left out and the
 * English work stands for it. A record with no language list is kept: unknown
 * is not "not English".
 */
export function hasEnglishEdition(doc: any): boolean {
  const langs = doc?.language;
  return !Array.isArray(langs) || langs.length === 0 || langs.includes("eng");
}

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

/** A work that is the book itself, in a language the catalog shows: what every shelf answer keeps. */
export const isWholeBook = (doc: any): boolean => hasEnglishEdition(doc) && !isPieceOfBook(doc?.title);

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

const foldKey = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * What one book looks like whichever provider names it: the title before any
 * subtitle, without a leading article, plus the first author's surname. "The
 * Doors of Stone" at Hardcover and "Doors of Stone" at Open Library are one key.
 */
export function bookIdentityKey(card: { title: string; authors?: string[] }): string {
  const title = foldKey(card.title.split(/[:(]/)[0]).replace(/^(the|a|an) /, "");
  const author = card.authors?.[0] ? foldKey(card.authors[0]).split(" ").pop() ?? "" : "";
  return `${title}|${author}`;
}

/**
 * Two providers' cards as one list: the first list in full, then whatever the
 * second holds that the first does not. The same book is one that shares an
 * ISBN-13, or the same title and author. Open Library goes first, so its
 * work stays the book's identity; a Hardcover card survives only for a book
 * Open Library did not answer with. A book both know keeps Open Library's
 * cover and takes Hardcover's only when Open Library has none (Nils,
 * 2026-10-17: "covers only if the other provider has none").
 */
export function mergeBookCards(primary: BookCard[], secondary: BookCard[]): BookCard[] {
  const byIsbn = new Map<string, BookCard>();
  const byKey = new Map<string, BookCard>();
  const note = (c: BookCard) => {
    for (const i of c.isbns ?? []) if (!byIsbn.has(i)) byIsbn.set(i, c);
    const k = bookIdentityKey(c);
    if (!byKey.has(k)) byKey.set(k, c);
  };
  // Copies: filling a cover in must not change the caller's card.
  const out = primary.map((c) => ({ ...c }));
  for (const c of out) note(c);
  for (const c of secondary) {
    const twin = (c.isbns ?? []).map((i) => byIsbn.get(i)).find((t): t is BookCard => !!t) ?? byKey.get(bookIdentityKey(c));
    if (twin) {
      if (!twin.posterUrl && c.posterUrl) twin.posterUrl = c.posterUrl;
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
