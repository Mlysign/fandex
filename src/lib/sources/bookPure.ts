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
  const days = ((doc?.publish_date ?? []) as unknown[]).map(parseDay).filter((d): d is string => !!d && d.startsWith(String(year))).sort();
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
    if (/\b(accessible|protected daisy|in library|large type|reviewed|lending library|internet archive|award|translations? into|open library|staff picks|overdrive|juvenile literature)\b/i.test(t)) continue;
    if (/^(fiction|nonfiction|non-fiction|literature|english|american|novel|novels|general|books|reading)$/i.test(t)) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t[0].toUpperCase() + t.slice(1));
    if (out.length >= limit) break;
  }
  return out;
}
