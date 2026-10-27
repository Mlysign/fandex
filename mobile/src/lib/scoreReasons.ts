// What the score says, apart from how it is drawn: the sentence under the
// number, the centre line, the pull line, the honesty lines, each row's
// sentence, and where a row leads. Components (FandexScorePanel, cards,
// ScoreExplainer, FacetScreen) read from here so the wording lives in one
// place. Nils, 2026-10-27: a flat number, read as "what I'd rate it".

import { companyKey, ipKey, personKey, tagKey } from '@/lib/facets';
import { keyToSlug } from '@/lib/facetUrl';
import type { FandexScore, ScoreReason } from '~/lib/fandexScore';
import type { MediumCalibration } from '~/lib/scoreCalibration';

const TYPE_PLURAL: Record<string, string> = { movie: 'films', show: 'shows', game: 'games', book: 'books', boardgame: 'board games' };

/** "films", "games", or "titles" for a medium the app does not name. */
export const mediumPlural = (type?: string): string => (type ? TYPE_PLURAL[type] : undefined) ?? 'titles';

/** The rating a score stands for: 72 is "a 7". A whole number, because the score is right to about a point, not a tenth. */
export const ratingOf = (score: number): number => Math.round(score / 10);

/** The one sentence under the number: "You'd probably give this a 7, above your usual for films." */
export function scoreSentence(fx: Pick<FandexScore, 'score' | 'band'>, type?: string): string {
  const what = mediumPlural(type);
  const where = fx.band === 'high' ? 'above' : fx.band === 'low' ? 'below' : 'about';
  const rating = ratingOf(fx.score);
  return `You'd probably give this ${rating === 8 ? 'an' : 'a'} ${rating}, ${where} your usual for ${what}.`;
}

/** The anchor: "You give films 6.4 on average." `leftOut` for a title you rated, scored without that rating. */
export function centreSentence(center: number, type?: string, leftOut?: boolean): string {
  return `You give ${mediumPlural(type)} ${(center / 10).toFixed(1)} on average${leftOut ? ', this one left out' : ''}.`;
}

/** "5 times", "1.4 times": a whole number from two up, one decimal below. */
function timesWord(x: number): string {
  return x >= 1.95 ? `${Math.round(x)} times` : `${(Math.round(x * 10) / 10).toFixed(1)} times`;
}

/**
 * Pull, beside the number and not in it: "You pick films like this 3 times
 * more often than average." Null without a pull axis. "Average" is the
 * baseline: ordinary titles drawn at random (docs/fandex-score.md §3.7).
 */
export function pullLine(pull: FandexScore['pull'], type?: string): string | null {
  if (!pull) return null;
  const what = mediumPlural(type);
  if (pull.times >= 1.45) return `You pick ${what} like this ${timesWord(pull.times)} more often than average.`;
  if (pull.times <= 1 / 1.45) return `You pick ${what} like this ${timesWord(1 / pull.times)} less often than average.`;
  return `You pick ${what} like this about as often as average.`;
}

/** Below this many rated titles in a medium, the honesty lines say nothing rather than quote a share of six. */
export const MIN_CALIBRATION = 30;
/** Below this many rated titles on a rung, the rung line says nothing. */
export const MIN_RUNG = 10;

const pct = (share: number) => `${Math.round(100 * share)}%`;

/**
 * The honesty line, from this device's own measurement (scoreCalibration.ts),
 * for the medium the measurement is of (`all` reads as titles): "On the 939
 * films you rated it was within one point of your rating 44% of the time, and
 * within two 76%." Null until there is enough to say.
 */
export function calibrationLine(cal: MediumCalibration | null): string | null {
  if (!cal || cal.n < MIN_CALIBRATION) return null;
  return `On the ${cal.n} ${mediumPlural(cal.medium)} you rated, it was within one point of your rating ${pct(cal.withinOne / cal.n)} of the time, and within two ${pct(cal.withinTwo / cal.n)}.`;
}

/** The rung this score sits on: "When it said 70 to 75, you gave 7.4 on average (92 films)." Null without ten titles there. */
export function rungLine(cal: MediumCalibration | null, score: number): string | null {
  const rung = cal?.rungs.find((r) => score >= r.lo && score < r.hi);
  if (!cal || !rung || rung.n < MIN_RUNG) return null;
  const range = rung.lo === 0 ? `under ${rung.hi}` : rung.hi > 100 ? `${rung.lo} or more` : `${rung.lo} to ${rung.hi}`;
  return `When it said ${range}, you gave ${rung.mean.toFixed(1)} on average (${rung.n} ${mediumPlural(cal.medium)}).`;
}

/** Counted rows first, by what they add; rows that were left out sink to the end. Within that, the axis order the sheet shows. */
export function sortReasons(reasons: ScoreReason[]): ScoreReason[] {
  return [...reasons].sort((a, b) => (!!a.capped === !!b.capped ? b.contribution - a.contribution : a.capped ? 1 : -1));
}

/** The counted rows of one axis, biggest lift first: taste by what it added, pull by its own points. */
export function axisRows(reasons: ScoreReason[], axis: 'taste' | 'pull'): ScoreReason[] {
  const value = (r: ScoreReason) => (axis === 'pull' ? r.impact : r.contribution);
  return reasons.filter((r) => r.axis === axis && !r.capped).sort((a, b) => value(b) - value(a));
}

/** The rows that matched but did not count, biggest would-be value first. */
export function cappedRows(reasons: ScoreReason[]): ScoreReason[] {
  return reasons.filter((r) => r.capped).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
}

/**
 * A pull row in one sentence, Nils's wording (2026-10-26): "you pick it 5
 * times more often than average (88 of your films)", or "3 times less often".
 * With `name`, the facet page's form: "You pick anime 5 times more often…".
 * The count says how much evidence stands behind the number; it names the
 * medium when all of those titles share one. "Average" is the baseline: the
 * ordinary titles drawn at random (docs/fandex-score.md §3.7).
 */
export function pullSentence(r: Pick<ScoreReason, 'kind' | 'times' | 'titles' | 'media' | 'followed'>, name?: string): string {
  const who = name ?? (r.kind === 'person' || r.kind === 'company' ? 'them' : 'it');
  const start = name ? 'You' : 'you';
  const n = r.titles ?? 0;
  const media = r.media ?? [];
  const what = media.length === 1 && TYPE_PLURAL[media[0]] ? TYPE_PLURAL[media[0]] : 'titles';
  const count = n > 0 ? ` (${n} of your ${what})` : '';
  if (r.followed === 'follow') return `${start} follow ${who}${count}`;
  if (r.followed === 'avoid') return `${start} asked not to be shown ${who}`;
  const times = r.times ?? 1;
  if (times >= 1) return `${start} pick ${who} ${timesWord(times)} more often than average${count}`;
  return `${start} pick ${who} ${timesWord(1 / times)} less often than average${count}`;
}

/** A taste row in one sentence: "you rate it 7.6 over 41 titles". */
export function tasteSentence(r: ScoreReason): string {
  return `you rate ${r.kind === 'person' || r.kind === 'company' ? 'them' : 'it'} ${r.BA.toFixed(1)} over ${r.n} title${r.n === 1 ? '' : 's'}`;
}

/** Where a reason's chip leads, or null for one with no page of its own. A franchise has one since 2026-10-18. */
export function reasonHref(r: ScoreReason): string | null {
  if (r.kind === 'tag') return `/tag/${keyToSlug(tagKey(r.label))}`;
  if (r.kind === 'person') return `/person/${keyToSlug(personKey(r.label))}`;
  if (r.kind === 'company') return `/studio/${keyToSlug(companyKey(r.label))}`;
  if (r.kind === 'ip') return franchiseHref(r.label);
  return null;
}

/** A franchise page's address from any spelling of its name: "Star Wars Collection" and "Star Wars" lead to one page. */
export function franchiseHref(name: string): string | null {
  const key = ipKey(name);
  return key ? `/franchise/${keyToSlug(key)}` : null;
}

/** `+4.2`, `−1.0`: a real minus sign, the width of the plus. */
export const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;
