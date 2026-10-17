// Open Library: books (2026-10-17). Free and open data, no key. Their one ask
// is a User-Agent that names the app and a way to reach it, and that heavy use
// goes to the bulk dumps instead of the API.
//
// A book is a WORK here (`/works/OL893414W`), not an edition: one title across
// its printings, which is what a person rates. The record kept for it is the
// work's row from `search.json`, which carries in one request what the score
// and the page need: authors, subjects, series, publishers, the community
// rating (out of 5), the page count and the editions' dates. The work's own
// JSON adds the description, fetched once with it.
//
// Imported by the Worker (worker/src/catalog/resolve.ts and its routes): no
// Node APIs, no `@/lib/db`.

import { httpFetch, BROWSE_BUDGET_MS } from "@/lib/http";
import { bookDate, bookRating, bookSubjects, coverUrl, OL_WORK_ID } from "@/lib/sources/bookPure";

export * from "@/lib/sources/bookPure";

const BASE = "https://openlibrary.org";
const USER_AGENT = "Fandex/1.0 (https://fandex.org; hello@fandex.org)";

/** The search fields a book record holds. Asked for by name: the default set is large and has no series. */
export const OL_FIELDS = [
  "key", "title", "subtitle", "author_name", "author_key", "first_publish_year", "publish_date",
  "cover_i", "subject", "publisher", "ratings_average", "ratings_count", "number_of_pages_median",
  "edition_count", "series_name", "series_key", "language", "want_to_read_count", "already_read_count",
  "id_wikidata", "isbn",
].join(",");

async function getJson(path: string, budgetMs?: number): Promise<any> {
  const res = await httpFetch(`${BASE}${path}`, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    ...(budgetMs ? { budgetMs } : {}),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Open Library error: ${res.status} ${path}`);
  return res.json();
}

/** Trim a search row to what a record keeps: the ISBN and date lists alone can run to hundreds. */
function trimDoc(doc: any): any {
  if (!doc || typeof doc !== "object") return doc;
  const { isbn, publish_date, publisher, ...rest } = doc;
  return {
    ...rest,
    isbn: Array.isArray(isbn) ? isbn.slice(0, 4) : undefined,
    publish_date: Array.isArray(publish_date) ? publish_date.slice(0, 40) : undefined,
    publisher: Array.isArray(publisher) ? publisher.slice(0, 10) : undefined,
  };
}

/**
 * One work, as a record: its search row plus the description from the work's
 * JSON. Null when Open Library has no such work. A work that was merged into
 * another is followed once (Open Library answers with a redirect record).
 */
export async function getOpenLibraryWork(workId: string): Promise<any | null> {
  if (!OL_WORK_ID.test(workId)) return null;
  let id = workId;
  let work = await getJson(`/works/${id}.json`);
  if (work?.type?.key === "/type/redirect" && typeof work.location === "string") {
    const next = /\/works\/(OL\d+W)$/.exec(work.location)?.[1];
    if (next) { id = next; work = await getJson(`/works/${id}.json`); }
  }
  if (!work) return null;
  const search = await getJson(`/search.json?q=${encodeURIComponent(`key:/works/${id}`)}&fields=${OL_FIELDS}&limit=1`);
  const doc = search?.docs?.[0] ?? { key: `/works/${id}`, title: work.title };
  const description = typeof work.description === "string" ? work.description : work.description?.value ?? null;
  return { ...trimDoc(doc), id, description, subjects_work: Array.isArray(work.subjects) ? work.subjects.slice(0, 40) : undefined };
}

export interface BookCard {
  source: "openlibrary";
  sourceId: string;
  type: "book";
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  votes: number;
  /** 0-100, from Open Library's 1-5 stars. */
  rating: number | null;
  /** How many readers shelved it (want to read + read): Open Library's reach. */
  popularity: number;
  genres: string[];
}

/** A search or list row as a card. Null for a row with no work key or no title. */
export function bookCard(doc: any): BookCard | null {
  const id = /\/works\/(OL\d+W)$/.exec(String(doc?.key ?? ""))?.[1];
  if (!id || typeof doc?.title !== "string") return null;
  return {
    source: "openlibrary", sourceId: id, type: "book", title: doc.title,
    releaseDate: bookDate(doc), posterUrl: coverUrl(doc.cover_i),
    votes: Number(doc.ratings_count ?? 0) || 0,
    rating: bookRating(doc.ratings_average),
    popularity: (Number(doc.want_to_read_count) || 0) + (Number(doc.already_read_count) || 0),
    genres: bookSubjects(doc, 6),
  };
}

const cards = (docs: unknown): BookCard[] => ((docs ?? []) as any[]).map(bookCard).filter((c): c is BookCard => !!c);

/** Books matching a query, best match first. */
export async function searchOpenLibrary(query: string, limit = 20): Promise<BookCard[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const data = await getJson(`/search.json?q=${encodeURIComponent(q)}&fields=${OL_FIELDS}&limit=${Math.min(40, limit)}`, BROWSE_BUDGET_MS);
  return cards(data?.docs);
}

/** What people are reading (Open Library's trending), as cards: Home's popular books. */
export async function trendingOpenLibrary(period: "daily" | "weekly" | "monthly" = "weekly", limit = 30): Promise<BookCard[]> {
  const data = await getJson(`/trending/${period}.json?limit=${Math.min(60, limit)}`, BROWSE_BUDGET_MS);
  return cards(data?.works);
}

/** Books on a subject, best rated first: a tag page's books. */
export async function subjectOpenLibrary(subject: string, limit = 40): Promise<BookCard[]> {
  const s = subject.trim().slice(0, 100);
  if (s.length < 2) return [];
  const data = await getJson(`/search.json?subject=${encodeURIComponent(s)}&sort=rating&fields=${OL_FIELDS}&limit=${Math.min(60, limit)}`, BROWSE_BUDGET_MS);
  return cards(data?.docs);
}

/** An author's books, most wanted first: a person page's books. */
export async function authorOpenLibrary(name: string, limit = 40): Promise<BookCard[]> {
  const s = name.trim().slice(0, 100);
  if (s.length < 2) return [];
  const data = await getJson(`/search.json?author=${encodeURIComponent(s)}&sort=want_to_read&fields=${OL_FIELDS}&limit=${Math.min(60, limit)}`, BROWSE_BUDGET_MS);
  return cards(data?.docs);
}

/** A publisher's books, most wanted first: a studio page's books. */
export async function publisherOpenLibrary(name: string, limit = 40): Promise<BookCard[]> {
  const s = name.trim().slice(0, 100);
  if (s.length < 2) return [];
  const data = await getJson(`/search.json?publisher=${encodeURIComponent(s)}&sort=want_to_read&fields=${OL_FIELDS}&limit=${Math.min(60, limit)}`, BROWSE_BUDGET_MS);
  return cards(data?.docs);
}

/** A series' books (the franchise rail of a book page), first published first. */
export async function seriesOpenLibrary(series: string, limit = 40): Promise<BookCard[]> {
  const s = series.trim().replace(/"/g, "").slice(0, 100);
  if (s.length < 2) return [];
  const data = await getJson(`/search.json?q=${encodeURIComponent(`series_name:"${s}"`)}&sort=old&fields=${OL_FIELDS}&limit=${Math.min(60, limit)}`, BROWSE_BUDGET_MS);
  return cards(data?.docs);
}

/**
 * Books first published in a month (YYYY-MM), the most wanted first: the
 * calendar's books. Open Library has no first-publication DATE to ask by, only
 * a year, so the year is asked by "want to read" (sorting by "new" brings up
 * reprints of 1900s monographs dated this year) and each book is placed by its
 * own date (`bookDate`). Checked 2026-10-17: Freida McFadden, Alice Feeney and
 * Rebecca Yarros near the top of 2026.
 */
export async function upcomingOpenLibrary(month: string, limit = 100): Promise<BookCard[]> {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const year = month.slice(0, 4);
  const data = await getJson(`/search.json?q=${encodeURIComponent(`first_publish_year:${year}`)}&sort=want_to_read&fields=${OL_FIELDS}&limit=${Math.min(100, limit)}`, BROWSE_BUDGET_MS);
  return cards(data?.docs).filter((c) => !!c.releaseDate?.startsWith(month));
}
