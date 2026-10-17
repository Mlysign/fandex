// Month and day arithmetic for the calendar. A release date is a calendar day,
// not an instant, so shifting and formatting are done in UTC: local-time Date
// maths moves a day across a DST boundary. "Today" and "this month" are the
// one exception, because those mean the day on the person's own wall.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "November 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "Thu 19" for a YYYY-MM-DD. */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** "19 Nov 2026" for a YYYY-MM-DD, or null. */
/**
 * A date that names only a year ("1976") or a month ("1976-04"), as books and
 * board games often do: said as such, never as the 1st of January (2026-10-17).
 */
function partial(date: string): string | null {
  if (/^\d{4}$/.test(date)) return date;
  const m = /^(\d{4})-(\d{2})$/.exec(date);
  return m ? `${MONTHS[Number(m[2]) - 1]?.slice(0, 3) ?? ''} ${m[1]}`.trim() : null;
}

export function longDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const only = partial(date);
  if (only) return only;
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
}

/** "Nov 2026" for a YYYY-MM-DD: the date line on a poster card. "TBA" when there is none. */
export function monthYear(date: string | null | undefined): string {
  if (!date) return 'TBA';
  const only = partial(date);
  if (only) return only;
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
}

/** "Oct 10, 2026" for a YYYY-MM-DD or a unix time in seconds. */
export function shortDate(date: string | number | null | undefined): string | null {
  if (date == null) return null;
  const only = typeof date === 'string' ? partial(date) : null;
  if (only) return only;
  const d = typeof date === 'number' ? new Date(date * 1000) : new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return typeof date === 'number'
    ? `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`
    : `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** 12,345 -> "12.3k". For vote counts, where the exact figure is noise. */
export function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}
