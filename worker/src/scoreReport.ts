/**
 * The score's goalpost: how each person's match compares with their own
 * ratings, as counts the device works out and sends (migration 0006), and the
 * sum over everybody the admin Score page draws.
 *
 * Counts, not titles, on purpose. A row says "for this person's films, the
 * match was two points under their rating 93 times" and "71 of their 249
 * sure things were rated 8 or more". Nothing in it names a title or a rating.
 */

import { BadRequest } from "./me";
import { all } from "./d1";

/** The first bin is (rating − match ÷ 10) rounded to −6; the last is +5. */
export const BIN_FROM = -6;
export const BIN_COUNT = 12;
/** The score's version the rows were computed with. Bump with any change to the maths, so old rows read apart. */
export const SCORE_VERSION = 2;

const MEDIA = new Set(["movie", "show", "game", "book", "boardgame"]);
const LABELS = new Set(["safe-bet", "hidden-gem", "tryout", "bycatch", "skip", "usual"]);

export interface ScoreReport {
  medium: string;
  /** Rated titles the device could score, in this medium. */
  rated: number;
  /** Twelve counts, bins of (rating − match ÷ 10) from −6 to +5. */
  bins: number[];
  /** Per label: [rated titles with this label, of those rated 8 or more]. */
  labels: Record<string, [number, number]>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const whole = (v: unknown, name: string, max = 1_000_000): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > max) throw new BadRequest(`${name} must be a whole number`);
  return v;
};

/** `{reports: [...]}`, at most one report per medium, or a refusal. */
export function parseScoreReports(body: unknown): ScoreReport[] {
  if (!isObj(body) || !Array.isArray(body.reports) || body.reports.length > MEDIA.size) throw new BadRequest("Expected {reports: [...]}, at most one per medium");
  const seen = new Set<string>();
  return body.reports.map((r) => {
    if (!isObj(r)) throw new BadRequest("Each report must be an object");
    if (typeof r.medium !== "string" || !MEDIA.has(r.medium)) throw new BadRequest("Unknown medium");
    if (seen.has(r.medium)) throw new BadRequest("One report per medium");
    seen.add(r.medium);
    const rated = whole(r.rated, "rated");
    if (!Array.isArray(r.bins) || r.bins.length !== BIN_COUNT) throw new BadRequest(`bins must hold ${BIN_COUNT} counts`);
    const bins = r.bins.map((b) => whole(b, "bin"));
    if (bins.reduce((a, b) => a + b, 0) > rated) throw new BadRequest("bins add up to more than rated");
    if (!isObj(r.labels)) throw new BadRequest("labels must be an object");
    const labels: Record<string, [number, number]> = {};
    for (const [label, pair] of Object.entries(r.labels)) {
      if (!LABELS.has(label)) throw new BadRequest("Unknown label");
      if (!Array.isArray(pair) || pair.length !== 2) throw new BadRequest("A label's value is [rated, eightPlus]");
      const n = whole(pair[0], "label count"), eight = whole(pair[1], "label 8+ count");
      if (eight > n || n > rated) throw new BadRequest("A label cannot count more than was rated");
      labels[label] = [n, eight];
    }
    return { medium: r.medium, rated, bins, labels };
  });
}

/** Replace this person's rows for the media reported. A medium not reported keeps its last row. */
export async function saveScoreReports(db: D1Database, userId: string, reports: ScoreReport[]): Promise<void> {
  if (!reports.length) return;
  const put = db.prepare(
    `INSERT INTO score_report (user_id, medium, rated, bins, labels, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(user_id, medium) DO UPDATE SET rated = excluded.rated, bins = excluded.bins, labels = excluded.labels,
       version = excluded.version, updated_at = excluded.updated_at`,
  );
  await db.batch(reports.map((r) => put.bind(userId, r.medium, r.rated, JSON.stringify(r.bins), JSON.stringify(r.labels), SCORE_VERSION)));
}

export interface ScoreSummaryMedium {
  medium: string;
  users: number;
  rated: number;
  bins: number[];
  labels: Record<string, { rated: number; eightPlus: number }>;
}

export interface ScoreSummary {
  version: number;
  binFrom: number;
  media: ScoreSummaryMedium[];
  /** Every medium summed. */
  all: ScoreSummaryMedium;
}

/**
 * The sum over everybody, per medium and in all. An admin route called a few
 * times a day: the sums are done in SQL, and the rows are as many as there are
 * users times five at most.
 */
export async function scoreSummary(db: D1Database): Promise<ScoreSummary> {
  const [heads, bins, labels] = await Promise.all([
    all<{ medium: string; users: number; rated: number }>(db, `SELECT medium, COUNT(*) users, SUM(rated) rated FROM score_report WHERE version = ? GROUP BY medium`, [SCORE_VERSION]),
    all<{ medium: string; bin: number; n: number }>(db,
      `SELECT r.medium, CAST(je.key AS INTEGER) bin, SUM(je.value) n FROM score_report r, json_each(r.bins) je WHERE r.version = ? GROUP BY r.medium, je.key`, [SCORE_VERSION]),
    all<{ medium: string; label: string; rated: number; eight: number }>(db,
      `SELECT r.medium, je.key label, SUM(json_extract(je.value, '$[0]')) rated, SUM(json_extract(je.value, '$[1]')) eight
         FROM score_report r, json_each(r.labels) je WHERE r.version = ? GROUP BY r.medium, je.key`, [SCORE_VERSION]),
  ]);
  const media = new Map<string, ScoreSummaryMedium>();
  const of = (medium: string) => {
    let m = media.get(medium);
    if (!m) media.set(medium, (m = { medium, users: 0, rated: 0, bins: new Array(BIN_COUNT).fill(0), labels: {} }));
    return m;
  };
  for (const h of heads) { const m = of(h.medium); m.users = h.users; m.rated = h.rated; }
  for (const b of bins) if (b.bin >= 0 && b.bin < BIN_COUNT) of(b.medium).bins[b.bin] += b.n;
  for (const l of labels) of(l.medium).labels[l.label] = { rated: l.rated, eightPlus: l.eight };
  const sum: ScoreSummaryMedium = { medium: "all", users: 0, rated: 0, bins: new Array(BIN_COUNT).fill(0), labels: {} };
  for (const m of media.values()) {
    sum.users = Math.max(sum.users, m.users);
    sum.rated += m.rated;
    m.bins.forEach((n, i) => { sum.bins[i] += n; });
    for (const [label, v] of Object.entries(m.labels)) {
      const s = sum.labels[label] ?? (sum.labels[label] = { rated: 0, eightPlus: 0 });
      s.rated += v.rated; s.eightPlus += v.eightPlus;
    }
  }
  return { version: SCORE_VERSION, binFrom: BIN_FROM, media: [...media.values()].sort((a, b) => a.medium.localeCompare(b.medium)), all: sum };
}
