// Hardcover: a second book source, facts only (2026-10-17).
//
// Open Library is the books provider and a book's identity (an OL work id).
// Hardcover adds what Open Library lacks: books announced but not out ("The
// Doors of Stone" is "Untitled Rothfuss 3 Of 3" there, no cover, dated 2012),
// curated covers, and series with every member in order.
//
// ⚠️ Their rules, read 2026-10-17 (hardcover.app/pages/policies, docs.hardcover.app/api/getting-started):
//   • a professional project may use "facts (about books, editions, series,
//     etc)" and must not use other users' ratings, reviews, lists or counts.
//     `hardcoverPure.ts` is the guarantee: a record holds the fields it names.
//   • no hot-linking of images: a cover is copied once into R2 and served from
//     Fandex (worker/src/covers.ts). A record carries the Fandex address.
//   • a Personal Access Token, made at hardcover.app/account/api with READ
//     scopes only; it expires on a date Nils picks. The free plan allows
//     5,000 requests a day and 60 a minute, a burst of 10; each top-level
//     query field is one request, so every query here has exactly one.
//   • "queries are not allowed to run in the browser": these run on the Worker
//     and nowhere else. The app never holds the token.
//   • their images are user-uploaded, so a site showing them lists a takedown
//     contact (the support page does).
//
// Until `HARDCOVER_TOKEN` is set, every function here answers "not configured"
// without a request, and `HARDCOVER_ENABLED=0` switches it off with the token
// in place, the way IGDB_ENABLED does. Nothing else breaks: the book routes
// answer exactly as they did before Hardcover existed.
//
// Imported by the Worker: no Node APIs, no `@/lib/db`.

import { httpFetch, BROWSE_BUDGET_MS } from "@/lib/http";
import { editionsInLanguages, ENGLISH_ONLY, isPieceOfBook, type BookCard } from "@/lib/sources/bookPure";
import {
  DEFAULT_COVER_ORIGIN, isbnList, isWholeHardcoverBook, parseHardcoverBook, pickHardcoverBook, searchDocuments,
  type HardcoverBook, type HardcoverMatchWant,
} from "@/lib/sources/hardcoverPure";

export * from "@/lib/sources/hardcoverPure";

const ENDPOINT = "https://api.hardcover.app/v1/graphql";
const USER_AGENT = "Fandex/1.0 (https://fandex.org; hello@fandex.org)";

export interface HardcoverEnv {
  /** The Personal Access Token. "Bearer " in front, as Hardcover's page shows it, is fine. */
  token?: string;
  /** "0" or "false" switches Hardcover off. Anything else, unset included, leaves it on. */
  enabled?: string;
  /** Where copied covers are served from. The public API address unless a local run says otherwise. */
  coverOrigin?: string;
}

let envSource: () => HardcoverEnv = () => (typeof process !== "undefined"
  ? { token: process.env?.HARDCOVER_TOKEN, enabled: process.env?.HARDCOVER_ENABLED, coverOrigin: process.env?.COVER_ORIGIN }
  : {});

/** The Worker hands its secret and switch over here (worker/src/hardcover.ts); tests hand fakes. */
export function setHardcoverEnv(read: () => HardcoverEnv): void {
  envSource = read;
}

/**
 * Read at CALL time, never at module load (AGENTS.md: a gate read once is a
 * gate nothing tests). Default ON, and only an explicit "0" or "false" is
 * off: a typo must leave the site working.
 */
export function hardcoverKilled(): boolean {
  const v = (envSource().enabled ?? "").trim().toLowerCase();
  return v === "0" || v === "false";
}

export function hardcoverConfigured(): boolean {
  return !!envSource().token?.trim() && !hardcoverKilled();
}

export function hardcoverCoverOrigin(): string {
  return envSource().coverOrigin?.trim() || DEFAULT_COVER_ORIGIN;
}

export class HardcoverNotConfigured extends Error {
  constructor() {
    super("Hardcover is switched off: no token (HARDCOVER_TOKEN) or HARDCOVER_ENABLED=0.");
    this.name = "HardcoverNotConfigured";
  }
}

/** Hardcover answered, and refused the query itself (a field or a filter it does not allow). Not an outage. */
export class HardcoverQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HardcoverQueryError";
  }
}

/** One GraphQL request. ONE top-level field per query: each costs a request against the daily 5,000. */
async function graphql(query: string, variables: Record<string, unknown>, budgetMs?: number): Promise<any> {
  if (!hardcoverConfigured()) throw new HardcoverNotConfigured();
  const token = (envSource().token ?? "").trim().replace(/^bearer\s+/i, "");
  const res = await httpFetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ query, variables }),
    // Our token, for everybody: a run of 401s means it expired or was revoked,
    // and the latch stops the Worker asking 5,000 times a day to learn that.
    appScopedAuth: true,
    ...(budgetMs ? { budgetMs } : {}),
  });
  if (!res.ok) throw new Error(`Hardcover error: ${res.status}`);
  const body = await res.json();
  if (Array.isArray(body?.errors) && body.errors.length) {
    throw new HardcoverQueryError(`Hardcover error: ${body.errors[0]?.message ?? JSON.stringify(body.errors[0]).slice(0, 120)}`);
  }
  return body?.data ?? null;
}

/** The fields a record is built from (hardcoverPure.ts). No rating, no count of readers: see the header. */
const BOOK_FIELDS = `
  id title subtitle slug description release_date release_year pages editions_count compilation is_partial_book canonical_id book_status_id
  image { url }
  cached_tags
  contributions { contribution author { name } }
  featured_book_series { position series { id name } }
  book_series { position series { id name } }
  editions(limit: 12) { isbn_13 isbn_10 }`;

/**
 * What a LIST reads besides a book's fields: each edition's title and
 * language, for the languages a list shows (bookPure.ts, `editionsInLanguages`).
 * Aliased, since `editions` is already selected above with other fields. Kept
 * out of BOOK_FIELDS on purpose: a book page and the ingest never ask for it,
 * so a refusal of these fields can only empty a list's Hardcover half, which
 * `hardcoverHalf` turns into Open Library's answer alone.
 */
const LANGUAGE_FIELDS = `lang_editions: editions(limit: 12) { title language { language } }`;
const LIST_FIELDS = `${BOOK_FIELDS}
  ${LANGUAGE_FIELDS}`;

/** A record as the app's card. No votes and no rating: Hardcover's are not ours to show. */
export function hardcoverCard(b: HardcoverBook): BookCard {
  return {
    source: "hardcover", sourceId: String(b.id), type: "book", title: b.title,
    releaseDate: b.releaseDate, posterUrl: b.cover, votes: 0, rating: null, popularity: 0,
    genres: b.tags.slice(0, 6), authors: b.authors, isbns: b.isbns,
  };
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * A row as a record fit for a list, or null: a whole book with a cover that is
 * not a box set or a part. Probed 2026-10-17 on The Kingkiller Chronicle:
 * beside the books, Hardcover lists a Russian and a French translation with no
 * cover, a "Limited Edition - Full Color", a "3 Books Set" and "The Name of
 * the Wind, Book 1" (a part), each a book of its own. A record without a cover
 * is nearly always one of those; a real book somebody would look for has one.
 */
function listable(raw: any, accepted: readonly string[]): HardcoverBook | null {
  const b = parseHardcoverBook(raw, hardcoverCoverOrigin());
  if (!isWholeHardcoverBook(b, raw) || !b.cover || isPieceOfBook(b.title)) return null;
  // Only in languages the list does not show, or titled after a translation (2026-11-03).
  const editions = Array.isArray(raw?.lang_editions)
    ? (raw.lang_editions as any[]).map((e) => ({ title: e?.title, language: e?.language?.language ?? e?.language }))
    : null;
  const lang = editionsInLanguages(b.title, editions, b.editionsCount, accepted);
  return lang.keep ? { ...b, title: lang.title } : null;
}

/** Rows as cards, one per book, listable books only, in the order given. */
function cards(rows: unknown, accepted: readonly string[]): BookCard[] {
  const out: BookCard[] = [];
  const seen = new Set<number>();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const b = listable(raw, accepted);
    if (!b || seen.has(b.id)) continue;
    seen.add(b.id);
    out.push(hardcoverCard(b));
  }
  return out;
}

/**
 * Books matching a query, Hardcover's order (best text match, then most
 * shelved). TWO requests since 2026-11-03: the search index's documents carry
 * no edition languages, so the hits' editions are asked for by id, to drop a
 * translation into a language the list does not show and to title a book
 * after an edition the reader can read (`listable`).
 */
export const SEARCH_HARDCOVER_REQUESTS = 2;

export async function searchHardcover(query: string, limit = 20, accepted: readonly string[] = ENGLISH_ONLY): Promise<BookCard[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const data = await graphql(
    `query ($q: String!, $n: Int!) { search(query: $q, query_type: "Book", per_page: $n, page: 1) { results } }`,
    { q, n: Math.min(25, Math.max(limit, 1)) },
    BROWSE_BUDGET_MS,
  );
  const docs = searchDocuments(data?.search?.results);
  const ids = [...new Set(docs.map((d) => Number(d?.id)).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return [];
  const langs = await graphql(
    `query ($ids: [Int!]!) { books(where: {id: {_in: $ids}}, limit: ${ids.length}) { id editions_count ${LANGUAGE_FIELDS} } }`,
    { ids },
    BROWSE_BUDGET_MS,
  );
  const byId = new Map<number, any>(((langs?.books ?? []) as any[]).map((b) => [Number(b?.id), b]));
  return cards(docs.map((d) => {
    const l = byId.get(Number(d?.id));
    return l ? { ...d, editions_count: l.editions_count ?? d?.editions_count, lang_editions: l.lang_editions } : d;
  }), accepted).slice(0, limit);
}

/**
 * One book by Hardcover id, as a record. Null when Hardcover has no such book.
 * A book filed as a duplicate is followed once to the one it duplicates, the
 * way an Open Library redirect is.
 */
export async function getHardcoverBook(id: string | number): Promise<HardcoverBook | null> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const one = async (bookId: number): Promise<any | null> => {
    const data = await graphql(`query ($id: Int!) { books(where: {id: {_eq: $id}}, limit: 1) { ${BOOK_FIELDS} } }`, { id: bookId });
    return data?.books?.[0] ?? null;
  };
  let raw = await one(n);
  let book = raw ? parseHardcoverBook(raw, hardcoverCoverOrigin()) : null;
  if (book?.canonicalId) {
    raw = await one(book.canonicalId);
    book = raw ? parseHardcoverBook(raw, hardcoverCoverOrigin()) : null;
  }
  return book && book.canonicalId == null ? book : null;
}

/**
 * The Hardcover book that is a book Fandex holds from Open Library, found by
 * its ISBNs and, failing that, by a search for its title and first author
 * (2026-11-02: an Open Library book had no Hardcover link, so its page showed
 * none of Hardcover's genres or moods). A hit counts only when it is the same
 * book (`isSameHardcoverBook`): the same title, and a shared author.
 *
 * `mayAsk` is asked before each request (at most two) and spends the budget.
 * Answers the record, null when Hardcover has no such book, or undefined when
 * `mayAsk` said no before an answer was reached: that says nothing about the
 * book, and the caller must not file it as "not on Hardcover". A provider
 * failure throws.
 */
export async function findHardcoverBook(
  want: HardcoverMatchWant & { isbns: string[] },
  mayAsk: () => Promise<boolean>,
): Promise<HardcoverBook | null | undefined> {
  const origin = hardcoverCoverOrigin();
  const isbns = isbnList(want.isbns).slice(0, 8);
  if (isbns.length) {
    if (!(await mayAsk())) return undefined;
    let data: any = null;
    try {
      data = await graphql(
        `query ($isbns: [String!]!) { editions(where: {isbn_13: {_in: $isbns}}, limit: 10) { book { ${BOOK_FIELDS} } } }`,
        { isbns },
      );
    } catch (e) {
      // This query's shape was not probed live (2026-11-02). Refused as a
      // query, it must not stop the search below; an outage still throws.
      if (!(e instanceof HardcoverQueryError)) throw e;
      console.warn("hardcover_isbn_query_refused", { error: e.message });
    }
    const rows = (Array.isArray(data?.editions) ? data.editions : []).map((e: any) => e?.book).filter(Boolean);
    const hit = pickHardcoverBook(rows.map((r: any) => (r.is_partial_book === true ? null : parseHardcoverBook(r, origin))), want, true);
    if (hit) return hit;
  }
  const author = want.authors[0]?.trim();
  if (!author) return null;
  if (!(await mayAsk())) return undefined;
  const q = `${want.title} ${author}`.slice(0, 100);
  const found = await graphql(
    `query ($q: String!) { search(query: $q, query_type: "Book", per_page: 10, page: 1) { results } }`,
    { q },
  );
  const docs = searchDocuments(found?.search?.results);
  return pickHardcoverBook(docs.map((d) => (d?.is_partial_book === true ? null : parseHardcoverBook(d, origin))), want, false);
}

/**
 * A series' books in order (the franchise rail of a book page). Two requests:
 * the series is found by search, since a name filter needs `_ilike`, which the
 * API disables, and `_eq` would miss "the" and a capital. The exact spelling
 * wins when one of the hits has it; otherwise the first hit does.
 */
export async function seriesHardcover(series: string, limit = 40, accepted: readonly string[] = ENGLISH_ONLY): Promise<BookCard[]> {
  const s = series.trim().slice(0, 100);
  if (s.length < 2) return [];
  const found = await graphql(
    `query ($q: String!) { search(query: $q, query_type: "Series", per_page: 5, page: 1) { results } }`,
    { q: s },
    BROWSE_BUDGET_MS,
  );
  const docs = searchDocuments(found?.search?.results).filter((d) => Number.isInteger(Number(d?.id)) && Number(d.id) > 0);
  const exact = docs.find((d) => typeof d?.name === "string" && fold(d.name) === fold(s));
  const pick = exact ?? docs[0];
  if (!pick) return [];
  const data = await graphql(
    `query ($id: Int!, $n: Int!) { series(where: {id: {_eq: $id}}, limit: 1) { name book_series(order_by: {position: asc}, limit: $n) { position book { ${LIST_FIELDS} } } } }`,
    { id: Number(pick.id), n: Math.min(60, Math.max(limit, 1)) },
    BROWSE_BUDGET_MS,
  );
  // One book per position. A translation, a limited edition or a box set is
  // filed at the SAME position as the book it is a copy of (twelve members at
  // positions 0.6 to 1.1 for the Kingkiller Chronicle, probed 2026-10-17); the
  // edition count tells them apart: 108 for The Name of the Wind, 1 for each
  // translation. The map keeps position order, which the query sorted.
  const best = new Map<string, HardcoverBook>();
  for (const r of (data?.series?.[0]?.book_series ?? []) as any[]) {
    const b = listable(r?.book, accepted);
    if (!b) continue;
    const key = typeof r?.position === "number" ? `pos:${r.position}` : `id:${b.id}`;
    const held = best.get(key);
    if (!held || (b.editionsCount ?? 0) > (held.editionsCount ?? 0)) best.set(key, b);
  }
  return [...best.values()].map(hardcoverCard).slice(0, limit);
}

/**
 * Books due in a month (YYYY-MM): the calendar's upcoming books, which Open
 * Library knows next to nothing about. Hardcover's own order, most shelved
 * first, which is what its site uses too. ⚠️ That number is the sort key of
 * the request and nothing else: it is not asked for, stored or shown.
 */
export async function upcomingHardcover(month: string, limit = 60, accepted: readonly string[] = ENGLISH_ONLY): Promise<BookCard[]> {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return [];
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return [];
  const from = `${month}-01`;
  const to = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
  const data = await graphql(
    `query ($from: date!, $to: date!, $n: Int!) {
       books(where: {release_date: {_gte: $from, _lt: $to}, book_status_id: {_in: [1, 2]}, canonical_id: {_is_null: true}},
             order_by: [{users_count: desc}, {id: asc}], limit: $n) { ${LIST_FIELDS} } }`,
    { from, to, n: Math.min(60, Math.max(limit, 1)) },
    BROWSE_BUDGET_MS,
  );
  return cards(data?.books, accepted).slice(0, limit);
}
