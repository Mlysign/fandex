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
import { isPieceOfBook, type BookCard } from "@/lib/sources/bookPure";
import {
  DEFAULT_COVER_ORIGIN, isWholeHardcoverBook, parseHardcoverBook, searchDocuments, type HardcoverBook,
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
    throw new Error(`Hardcover error: ${body.errors[0]?.message ?? JSON.stringify(body.errors[0]).slice(0, 120)}`);
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
function listable(raw: any): HardcoverBook | null {
  const b = parseHardcoverBook(raw, hardcoverCoverOrigin());
  return isWholeHardcoverBook(b, raw) && b.cover && !isPieceOfBook(b.title) ? b : null;
}

/** Rows as cards, one per book, listable books only, in the order given. */
function cards(rows: unknown): BookCard[] {
  const out: BookCard[] = [];
  const seen = new Set<number>();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const b = listable(raw);
    if (!b || seen.has(b.id)) continue;
    seen.add(b.id);
    out.push(hardcoverCard(b));
  }
  return out;
}

/** Books matching a query, Hardcover's order (best text match, then most shelved). */
export async function searchHardcover(query: string, limit = 20): Promise<BookCard[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const data = await graphql(
    `query ($q: String!, $n: Int!) { search(query: $q, query_type: "Book", per_page: $n, page: 1) { results } }`,
    { q, n: Math.min(25, Math.max(limit, 1)) },
    BROWSE_BUDGET_MS,
  );
  return cards(searchDocuments(data?.search?.results)).slice(0, limit);
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
 * A series' books in order (the franchise rail of a book page). Two requests:
 * the series is found by search, since a name filter needs `_ilike`, which the
 * API disables, and `_eq` would miss "the" and a capital. The exact spelling
 * wins when one of the hits has it; otherwise the first hit does.
 */
export async function seriesHardcover(series: string, limit = 40): Promise<BookCard[]> {
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
    `query ($id: Int!, $n: Int!) { series(where: {id: {_eq: $id}}, limit: 1) { name book_series(order_by: {position: asc}, limit: $n) { position book { ${BOOK_FIELDS} } } } }`,
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
    const b = listable(r?.book);
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
export async function upcomingHardcover(month: string, limit = 60): Promise<BookCard[]> {
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
             order_by: [{users_count: desc}, {id: asc}], limit: $n) { ${BOOK_FIELDS} } }`,
    { from, to, n: Math.min(60, Math.max(limit, 1)) },
    BROWSE_BUDGET_MS,
  );
  return cards(data?.books).slice(0, limit);
}
