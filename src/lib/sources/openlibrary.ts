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
import { bookDate, bookRating, bookSubjects, coverUrl, isWholeBook, OL_WORK_ID, seriesFromEditions, seriesFromSubjects, type BookCard } from "@/lib/sources/bookPure";
import { isbnList } from "@/lib/sources/hardcoverPure";

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
  const record = { ...trimDoc(doc), id, description, subjects_work: Array.isArray(work.subjects) ? work.subjects.slice(0, 40) : undefined };
  // The search row names a series for a few works only; the editions name it
  // for most ("The Stormlight Archive #1"). One more request, for a book with
  // no series on its row, is what puts it in its franchise (Nils, 2026-10-17).
  if (!record.series_name?.length) {
    const series = await seriesOfWork(id, work.subjects);
    if (series) record.series_name = [series];
  }
  return record;
}

/** A work's series off its English editions, else off a "series:" subject; null when neither names one. */
async function seriesOfWork(id: string, subjects: unknown): Promise<string | null> {
  let fromEditions: string | null = null;
  try {
    const editions = await getJson(`/works/${id}/editions.json?limit=50`);
    fromEditions = seriesFromEditions(editions?.entries);
  } catch { /* a series is a nicety: the book is stored without one */ }
  return fromEditions ?? seriesFromSubjects(subjects);
}

export type { BookCard };

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
    authors: (Array.isArray(doc.author_name) ? doc.author_name : []).filter((a: unknown): a is string => typeof a === "string").slice(0, 6),
    // The search row's ISBNs are every edition's: what a Hardcover card is matched on (bookPure.ts, mergeBookCards).
    isbns: isbnList(doc.isbn),
  };
}

/**
 * The work an ISBN belongs to, or null when Open Library has no edition with
 * it. Asked with several at once: a Hardcover book's editions carry a handful,
 * and any one hit names the work. What turns a Hardcover id into an Open
 * Library identity (worker/src/catalog/resolve.ts).
 *
 * ⚠️ A STUB does not count. Open Library holds "The Doors of Stone" as
 * "Untitled Rothfuss 3 Of 3" (OL35688235W): no cover, not one rating, and the
 * placeholder editions' ISBNs, which Hardcover's editions carry too (probed
 * 2026-10-17). Handing the Hardcover book to that work would title it
 * "Untitled Rothfuss 3 Of 3". The rule is `relevantBooks`'s: a work with no
 * cover and no rating is a stub, and a stub cannot claim a book.
 */
export async function openLibraryWorkByIsbn(isbns: string[]): Promise<string | null> {
  const clean = isbns.filter((i) => /^\d{9}[\dX]$|^\d{13}$/i.test(i)).slice(0, 6);
  if (!clean.length) return null;
  const q = clean.length === 1 ? `isbn:${clean[0]}` : `isbn:(${clean.join(" OR ")})`;
  const data = await getJson(`/search.json?q=${encodeURIComponent(q)}&fields=key,title,language,cover_i,ratings_count&limit=5`, BROWSE_BUDGET_MS);
  const workId = (d: any): string | null => /\/works\/(OL\d+W)$/.exec(String(d?.key ?? ""))?.[1] ?? null;
  const real = ((data?.docs ?? []) as any[]).filter((d) => workId(d) && (d.cover_i || Number(d.ratings_count) > 0));
  const pick = real.find(isWholeBook) ?? real[0];
  return pick ? workId(pick) : null;
}

/**
 * Rows as cards, one per book: a translation filed as its own work and a split
 * edition or a box set are left out (bookPure.ts, `isWholeBook`), so an author's
 * or a series' books come back once each rather than once per language.
 */
const cards = (docs: unknown): BookCard[] => ((docs ?? []) as any[]).filter(isWholeBook).map(bookCard).filter((c): c is BookCard => !!c);

/** Books matching a query, best match first. */
export async function searchOpenLibrary(query: string, limit = 20): Promise<BookCard[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const data = await getJson(`/search.json?q=${encodeURIComponent(q)}&fields=${OL_FIELDS}&limit=40`, BROWSE_BUDGET_MS);
  return cards(relevantBooks(data?.docs, q)).slice(0, limit);
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** Summaries, study guides and workbooks of a book are not the book. */
const NOT_THE_BOOK = /\b(summary|summaries|study guide|workbook|analysis of|sparknotes|cliffs ?notes|quicklet|book review)\b/i;

/**
 * Open Library's search is full text: "project hail mary" also brings Macbeth
 * and Romeo and Juliet (seen 2026-10-17). A book is kept when its title and
 * authors together hold every word typed, and it is not a summary of another.
 */
export function relevantBooks(docs: unknown, query: string): any[] {
  const words = fold(query).split(" ").filter((w) => w.length > 1);
  const kept = ((docs ?? []) as any[]).filter((d) => {
    if (typeof d?.title !== "string" || NOT_THE_BOOK.test(d.title)) return false;
    const hay = ` ${fold(`${d.title} ${(d.author_name ?? []).join(" ")}`)} `;
    return words.every((w) => hay.includes(` ${w}`));
  });
  // A record with no cover and not one rating is a stub ("Project Hail Mary: A
  // Novel", 0 ratings, beside the real one with 184): left out when a real one is there.
  const real = kept.filter((d) => d.cover_i || Number(d.ratings_count) > 0);
  return real.length ? real : kept;
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

/**
 * A series' books (the franchise rail of a book page), first published first.
 * Two fields hold a series: `series_name` on the work's search row (The
 * Kingkiller Chronicle) and `series` on its editions (The Stormlight Archive,
 * which has no `series_name` at all). An OR of the two answers nothing
 * (probed 2026-10-17), so both are asked and the answers joined.
 */
export async function seriesOpenLibrary(series: string, limit = 40): Promise<BookCard[]> {
  const s = series.trim().replace(/"/g, "").slice(0, 100);
  if (s.length < 2) return [];
  const ask = (field: string) =>
    getJson(`/search.json?q=${encodeURIComponent(`${field}:"${s}"`)}&sort=old&fields=${OL_FIELDS}&limit=${Math.min(60, limit)}`, BROWSE_BUDGET_MS);
  const [byName, byEdition] = await Promise.all([ask("series_name"), ask("series")]);
  const seen = new Set<string>();
  return cards([...(byName?.docs ?? []), ...(byEdition?.docs ?? [])].filter((d) => (seen.has(d?.key) ? false : (seen.add(d?.key), true))))
    .sort((a, b) => (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999"))
    .slice(0, limit);
}

/**
 * Books first published in a month (YYYY-MM), the most wanted first: the
 * calendar's books. Open Library has no first-publication DATE to ask by, only
 * a year, so the year is asked by "want to read" (sorting by "new" brings up
 * reprints of 1900s monographs dated this year) and each book is placed by its
 * own date (`bookDate`). Checked 2026-10-17: Freida McFadden, Alice Feeney and
 * Rebecca Yarros near the top of 2026.
 */
export async function upcomingOpenLibrary(month: string, pages = 3): Promise<BookCard[]> {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const year = month.slice(0, 4);
  // ⚠️ Open Library knows little about books not out yet: of its 500 most wanted
  // of 2026, six fall in October and none in November (measured 2026-10-17). Three
  // pages are where more stops paying; a month a request is cached for a day.
  const answers = await Promise.all(Array.from({ length: pages }, (_, i) =>
    getJson(`/search.json?q=${encodeURIComponent(`first_publish_year:${year}`)}&sort=want_to_read&fields=${OL_FIELDS}&limit=100&page=${i + 1}`, BROWSE_BUDGET_MS)
      .catch(() => null)));
  return answers.flatMap((a) => cards(a?.docs)).filter((c) => !!c.releaseDate?.startsWith(month));
}
