// Hardcover helpers with no imports: the record a Hardcover book is kept as,
// the parsers that build it from the API's answers, and the address a copied
// cover is served from. The fetching half is sources/hardcover.ts.
//
// ⚠️ FACTS ONLY. Hardcover's API Rules (hardcover.app/pages/policies, read
// 2026-10-17) let a professional project use "facts (about books, editions,
// series, etc)" and nothing other users made: no ratings, no reviews, no lists,
// no counts of readers. The parsers below are the whole guarantee: a record
// holds exactly the fields named in `HardcoverBook`, so a rating cannot reach
// the catalog by accident. Do not add `rating`, `ratings_count`, `users_count`
// or `lists_count` here.

/** Where Hardcover serves its images. A cover is COPIED from here, never linked (their rules). */
export const HARDCOVER_ASSETS = "https://assets.hardcover.app/";

/**
 * Where a copied cover is served from: the API's public address. The website
 * hands /v1/* to the API Worker, so this address answers from anywhere; the
 * Worker overrides it with `COVER_ORIGIN` for a local run.
 */
export const DEFAULT_COVER_ORIGIN = "https://fandex.org";

/**
 * What a cover's path under assets.hardcover.app looks like: a folder, a
 * numeric id, a file name that is a hash, a uuid or a numbered size. Probed
 * 2026-10-17: `editions/19454574/9509867934646082.jpg`,
 * `edition/30399253/4012102f….jpeg`, `edition/31571207/601b0d78-4db6-….jpg`,
 * `external_data/60951398/fcce5973….jpeg`, `books/1/291303-L.jpg`,
 * `authors/142979/6691222-L.jpg`. Both spellings of a folder occur. Anything
 * else is refused by the cover route.
 */
export const HARDCOVER_COVER_PATH = /^(editions?|books?|external_data|images?|authors?|users?)\/\d{1,12}\/[A-Za-z0-9_-]{1,96}\.(jpe?g|png|webp)$/;

/** A Hardcover book as the catalog keeps it. Every field is a fact about the book. */
export interface HardcoverBook {
  id: number;
  title: string;
  subtitle: string | null;
  /** hardcover.app/books/{slug}. */
  slug: string | null;
  description: string | null;
  /** YYYY-MM-DD, or the year alone when Hardcover only knows that. */
  releaseDate: string | null;
  authors: string[];
  series: { name: string; position: number | null } | null;
  /** ISBN-13s, from the editions. What a book is matched on across providers. */
  isbns: string[];
  /** The cover as FANDEX serves it (/v1/cover/hardcover/…), or null. Never a Hardcover address. */
  cover: string | null;
  /** Hardcover's genres and tags, as plain names. */
  tags: string[];
  pages: number | null;
  editionsCount: number | null;
  compilation: boolean;
  /** Set when Hardcover filed this book as a duplicate of another. */
  canonicalId: number | null;
}

/** The asset path of a Hardcover image address, or null for any other address. */
export function hardcoverCoverPath(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith(HARDCOVER_ASSETS)) return null;
  const path = url.slice(HARDCOVER_ASSETS.length).split("?")[0];
  return HARDCOVER_COVER_PATH.test(path) ? path : null;
}

/** The address Fandex serves a copied cover from. */
export function hardcoverCoverUrl(path: string | null, origin: string = DEFAULT_COVER_ORIGIN): string | null {
  return path ? `${origin.replace(/\/+$/, "")}/v1/cover/hardcover/${path}` : null;
}

/** An ISBN as ISBN-13 digits, or null when it is neither an ISBN-10 nor an ISBN-13. */
export function isbn13(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).replace(/[-\s]/g, "").toUpperCase();
  if (/^\d{13}$/.test(s)) return s;
  if (!/^\d{9}[\dX]$/.test(s)) return null;
  const body = `978${s.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

const ISBN_CAP = 16;

/** Distinct ISBN-13s from a list of raw ISBNs, capped. */
export function isbnList(raws: unknown): string[] {
  const out: string[] = [];
  for (const r of Array.isArray(raws) ? raws : []) {
    const n = isbn13(r);
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= ISBN_CAP) break;
  }
  return out;
}

const int = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * A release date as the catalog keeps dates. ⚠️ January 1st reads as the year
 * alone, as Open Library's does (`bookDate`): a book whose day Hardcover does
 * not know carries "YYYY-01-01", and the calendar must not put every such book
 * on New Year's Day.
 */
export function hardcoverDate(date: unknown, year: unknown): string | null {
  if (typeof date === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date.trim());
    if (m) return m[2] === "01" && m[3] === "01" ? m[1] : `${m[1]}-${m[2]}-${m[3]}`;
  }
  // The search index carries the date as seconds since 1970 (`release_date_i`).
  if (typeof date === "number" && date > 1e8 && date < 1e11) {
    const iso = new Date(date * 1000).toISOString().slice(0, 10);
    return iso.endsWith("-01-01") ? iso.slice(0, 4) : iso;
  }
  const y = int(year);
  return y && y < 3000 ? String(y) : null;
}

/** Author names off a contributions list (authors and writers only), else the plain names list. */
export function hardcoverAuthors(contributions: unknown, names: unknown): string[] {
  const out: string[] = [];
  const add = (v: unknown) => { const s = str(v); if (s && !out.includes(s) && out.length < 6) out.push(s); };
  for (const c of Array.isArray(contributions) ? contributions : []) {
    const role = str(c?.contribution);
    if (role && !/author|writer/i.test(role)) continue;
    add(c?.author?.name ?? c?.name);
  }
  if (!out.length) for (const n of Array.isArray(names) ? names : []) add(n);
  return out;
}

/**
 * Genre and tag names off `cached_tags` (a JSON object keyed by category:
 * Genre, Mood, Tag, Content Warning) or off the search index's plain lists.
 * Genres and tags only: a content warning is not a tag, and a mood is too
 * subjective to file a book under.
 */
export function hardcoverTags(cached: unknown, genres?: unknown, tags?: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (v: unknown) => {
    const s = str(typeof v === "object" && v ? (v as any).tag ?? (v as any).name : v);
    if (!s || s.length > 40 || seen.has(s.toLowerCase())) return;
    seen.add(s.toLowerCase());
    if (out.length < 12) out.push(s);
  };
  let obj: any = cached;
  if (typeof obj === "string") { try { obj = JSON.parse(obj); } catch { obj = null; } }
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const key of ["Genre", "genre", "Tag", "tag"]) for (const t of Array.isArray(obj[key]) ? obj[key] : []) add(t);
  }
  for (const g of Array.isArray(genres) ? genres : []) add(g);
  for (const t of Array.isArray(tags) ? tags : []) add(t);
  return out;
}

/** The series a book is filed under, the featured one first. */
function seriesOf(d: any): HardcoverBook["series"] {
  const rows = [d?.featured_book_series, ...(Array.isArray(d?.book_series) ? d.book_series : [])];
  for (const r of rows) {
    const name = str(r?.series?.name ?? r?.name);
    if (name) return { name, position: typeof r?.position === "number" ? r.position : null };
  }
  // The search index: an object for the featured series, and plain names.
  const featured = str(d?.featured_series?.name ?? d?.featured_series?.series?.name) ?? str(Array.isArray(d?.series_names) ? d.series_names[0] : null);
  if (!featured) return null;
  const pos = typeof d?.featured_series_position === "number" ? d.featured_series_position : null;
  return { name: featured, position: pos };
}

/**
 * One book off the GraphQL `books` table, as a record. Null for a row without
 * an id or a title, and for one Hardcover has deleted (status 3). A duplicate
 * (status 4, or a `canonical_id`) is returned with `canonicalId` set, so the
 * caller can follow it.
 */
export function parseHardcoverBook(d: any, coverOrigin: string = DEFAULT_COVER_ORIGIN): HardcoverBook | null {
  const id = int(d?.id);
  const title = str(d?.title);
  if (!id || !title || d?.book_status_id === 3) return null;
  const isbns = isbnList([
    ...(Array.isArray(d?.editions) ? d.editions.flatMap((e: any) => [e?.isbn_13, e?.isbn_10]) : []),
    ...(Array.isArray(d?.isbns) ? d.isbns : []),
  ]);
  return {
    id,
    title,
    subtitle: str(d?.subtitle),
    slug: str(d?.slug),
    description: str(d?.description),
    releaseDate: hardcoverDate(d?.release_date ?? d?.release_date_i, d?.release_year),
    authors: hardcoverAuthors(d?.contributions, d?.author_names),
    series: seriesOf(d),
    isbns,
    cover: hardcoverCoverUrl(hardcoverCoverPath(d?.image?.url ?? d?.cached_image?.url), coverOrigin),
    tags: hardcoverTags(d?.cached_tags, d?.genres, d?.tags),
    pages: int(d?.pages),
    editionsCount: int(d?.editions_count),
    compilation: d?.compilation === true,
    canonicalId: int(d?.canonical_id) === id ? null : int(d?.canonical_id),
  };
}

/**
 * The documents of a search answer. The field is Typesense's response
 * (`{found, hits: [{document}]}`); a plain list of documents is accepted too,
 * so a change of wrapper does not read as "no results".
 */
export function searchDocuments(results: unknown): any[] {
  let r: any = results;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch { return []; } }
  const hits = Array.isArray(r?.hits) ? r.hits : Array.isArray(r) ? r : [];
  return hits.map((h: any) => (h && typeof h === "object" && "document" in h ? h.document : h)).filter((d: any) => d && typeof d === "object");
}

/** A book that is the book itself: not a piece of one, not a duplicate, not a deleted row. */
export function isWholeHardcoverBook(b: HardcoverBook | null, raw?: any): b is HardcoverBook {
  return !!b && b.canonicalId == null && raw?.is_partial_book !== true;
}
