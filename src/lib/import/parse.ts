import { readCsvTable, cell, hasColumn, type CsvTable } from "./csv";
import { readZip, looksLikeZip, ZipError } from "./zip";

// PL4 — turn an uploaded export into rows we can match.
//
// Nils's scope (2026-08-23): RATINGS and WATCHLIST only. No diary, reviews,
// lists, likes or comments, even though the archive contains them.
//
// ⚠️ EVERY column name below is from secondary sources. Neither Letterboxd nor
// IMDb publishes a schema, so the names are what third-party tools and guides
// report. That is why lookup is BY NAME with several accepted spellings, and why
// a file whose headers match nothing produces a LOUD error naming the headers it
// actually saw. The failure mode to avoid is an import that reads zero rows and
// reports success.

export type ImportRelation = "library" | "wishlist";

export interface ImportRow {
  title: string;
  year: number | null;
  /** 0–10, already converted from the source's scale. Null on a watchlist row. */
  rating: number | null;
  relation: ImportRelation;
  /** IMDb's tconst when the source carries one. Letterboxd does not. */
  imdbId: string | null;
  /** ISO date the source recorded, when it has one. */
  ratedAt: string | null;
}

export interface ParsedImport {
  source: "letterboxd" | "imdb";
  rows: ImportRow[];
  /** Files we read something out of, for the UI to report honestly. */
  filesRead: string[];
  /** Files present in the archive that this import deliberately ignores. */
  filesSkipped: string[];
}

export class ImportParseError extends Error {}

// ── shared cell readers ──────────────────────────────────────────────────────

function readYear(v: string | null): number | null {
  if (!v) return null;
  const m = v.match(/(\d{4})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  // A four-digit number that is not a plausible release year is more likely a
  // runtime or a vote count that drifted into this column.
  return y >= 1870 && y <= 2200 ? y : null;
}

function isoDate(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// ── Letterboxd ───────────────────────────────────────────────────────────────

// Letterboxd rates in HALF STARS from 0.5 to 5.0. Doubling lands exactly on our
// 0–10 integer scale with no rounding, which is worth preserving: a user who
// gave four and a half stars should see 9, not "about 9".
function letterboxdRating(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 5) return null;
  return n * 2;
}

function letterboxdRows(table: CsvTable, relation: ImportRelation): ImportRow[] {
  const out: ImportRow[] = [];
  for (const row of table.rows) {
    const title = cell(table, row, "Name", "Title", "Film");
    if (!title) continue;
    out.push({
      title,
      year: readYear(cell(table, row, "Year")),
      rating: relation === "library" ? letterboxdRating(cell(table, row, "Rating")) : null,
      relation,
      imdbId: null,   // Letterboxd's export carries no external id, only its own URI
      ratedAt: isoDate(cell(table, row, "Date", "Watched Date")),
    });
  }
  return out;
}

// ── IMDb ─────────────────────────────────────────────────────────────────────

// IMDb rates 1–10 already, which is our scale.
function imdbRating(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
}

// IMDb exports mix films and TV into one file and name the kind in a column.
// Everything that is not a film or a series is noise for us (video games,
// episodes, shorts sometimes).
function imdbTypeIsWanted(v: string | null): boolean {
  if (!v) return true;                       // no column: keep and let matching decide
  const t = v.toLowerCase();
  if (t.includes("game")) return false;
  if (t.includes("episode")) return false;
  return true;
}

function imdbRows(table: CsvTable): ImportRow[] {
  const out: ImportRow[] = [];
  // A ratings export has a rating column; a watchlist export does not. That is
  // the only reliable way to tell the two apart, since both carry Const/Title.
  const isRatings = hasColumn(table, "Your Rating");
  for (const row of table.rows) {
    const title = cell(table, row, "Title", "Original Title", "Primary Title");
    if (!title) continue;
    if (!imdbTypeIsWanted(cell(table, row, "Title Type"))) continue;
    const id = cell(table, row, "Const", "tconst", "IMDb ID");
    out.push({
      title,
      year: readYear(cell(table, row, "Year", "Release Date", "Start Year")),
      rating: isRatings ? imdbRating(cell(table, row, "Your Rating")) : null,
      relation: isRatings ? "library" : "wishlist",
      imdbId: id && /^tt\d+$/i.test(id) ? id.toLowerCase() : null,
      ratedAt: isoDate(cell(table, row, "Date Rated", "Created", "Date Added")),
    });
  }
  return out;
}

// ── entry point ──────────────────────────────────────────────────────────────

const WANTED = [
  { match: /(^|\/)ratings\.csv$/i,   relation: "library"  as const },
  { match: /(^|\/)watchlist\.csv$/i, relation: "wishlist" as const },
];

/**
 * Parse an upload. Accepts the Letterboxd ZIP as downloaded, a single CSV, or
 * several CSVs.
 *
 * `files` is whatever the user handed us: one entry for a single CSV, or the ZIP
 * itself which is expanded here.
 */
export function parseImport(files: { name: string; data: Buffer }[]): ParsedImport {
  const flat: { name: string; data: Buffer }[] = [];
  for (const f of files) {
    if (looksLikeZip(f.data)) {
      try {
        // Pull only what we use. Reviews, diary, lists, likes and comments are
        // in there and are deliberately never decompressed: the cheapest way to
        // honour "ratings and watchlist only" is to not read the rest at all.
        flat.push(...readZip(f.data, { nameFilter: (n) => WANTED.some((w) => w.match.test(n)) }));
      } catch (e) {
        throw e instanceof ZipError ? new ImportParseError(e.message) : e;
      }
    } else {
      flat.push(f);
    }
  }

  const rows: ImportRow[] = [];
  const filesRead: string[] = [];
  const filesSkipped: string[] = [];
  let source: "letterboxd" | "imdb" | null = null;
  const seenHeaders: string[] = [];

  for (const f of flat) {
    if (!/\.csv$/i.test(f.name)) { filesSkipped.push(f.name); continue; }
    const table = readCsvTable(f.data.toString("utf8"));
    if (!table.headers.length) { filesSkipped.push(f.name); continue; }
    seenHeaders.push(`${f.name}: ${table.headers.join(", ")}`);

    // IMDb is identified by its stable id column, which Letterboxd has no
    // equivalent of. That is a stronger signal than the filename, which the user
    // may have renamed.
    if (hasColumn(table, "Const", "tconst")) {
      source ??= "imdb";
      const got = imdbRows(table);
      if (got.length) { rows.push(...got); filesRead.push(f.name); } else filesSkipped.push(f.name);
      continue;
    }

    const wanted = WANTED.find((w) => w.match.test(f.name));
    if (!wanted) { filesSkipped.push(f.name); continue; }
    if (!hasColumn(table, "Name", "Title", "Film")) { filesSkipped.push(f.name); continue; }
    source ??= "letterboxd";
    const got = letterboxdRows(table, wanted.relation);
    if (got.length) { rows.push(...got); filesRead.push(f.name); } else filesSkipped.push(f.name);
  }

  if (!rows.length) {
    // Name the headers we saw. Without them the only diagnosis available to the
    // person is "it didn't work", and the likeliest cause is a column rename we
    // have no other way of learning about.
    throw new ImportParseError(
      seenHeaders.length
        ? `No ratings or watchlist rows were found. The columns present were: ${seenHeaders.join(" | ")}`
        : "No CSV data was found in that file. Upload the ZIP exactly as it downloaded, or a ratings.csv / watchlist.csv.",
    );
  }

  return { source: source ?? "letterboxd", rows: dedupe(rows), filesRead, filesSkipped };
}

// A title can appear in both ratings.csv and watchlist.csv, and a diary-heavy
// account can repeat one within a file. Library beats wishlist: having rated
// something is the stronger statement, and Fandex drops an item off the wishlist
// when it is rated anyway.
function dedupe(rows: ImportRow[]): ImportRow[] {
  const byKey = new Map<string, ImportRow>();
  for (const r of rows) {
    const key = `${r.title.toLowerCase().trim()}|${r.year ?? "?"}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, r); continue; }
    if (prev.relation === "wishlist" && r.relation === "library") byKey.set(key, r);
    else if (prev.rating == null && r.rating != null) byKey.set(key, r);
  }
  return [...byKey.values()];
}
