// What the score says, apart from how it is drawn: the label's words, the one
// sentence that names both axes, the odds line, and where a row leads.
// Components (FandexScorePanel, cards, ScoreExplainer, FacetScreen) read from
// here so the wording lives in one place; the labels are placeholders Nils will
// rename (2026-10-25).

import { companyKey, ipKey, personKey, tagKey } from '@/lib/facets';
import { keyToSlug } from '@/lib/facetUrl';
import { DEFAULT_LABEL_EVIDENCE, DEFAULT_LABEL_ODDS, MIN_LABEL_EVIDENCE } from '@/lib/scoringDefaults';
import type { AxisBand, FandexScore, ScoreLabel, ScoreReason } from '~/lib/fandexScore';

/** How far from your own average the combined score has to be to read as strong or weak: what the Recommended rail filters by. */
export const BAND_MARGIN = 10;

export type ScoreBand = 'high' | 'baseline' | 'low';

/** Bands sit around YOUR average, not around 50: a 70 is a weak match for somebody who rates everything 8. */
export function scoreBand(score: number, center: number | null): ScoreBand {
  const c = center ?? 50;
  return score >= c + BAND_MARGIN ? 'high' : score <= c - BAND_MARGIN ? 'low' : 'baseline';
}

/** The label as a person reads it (Nils's words, 2026-10-25). One place, so renaming is one edit. */
export const LABEL_TEXT: Record<ScoreLabel, string> = {
  'safe-bet': 'Safe bet',
  'hidden-gem': 'Hidden gem',
  tryout: 'Tryout',
  bycatch: 'Bycatch',
  skip: 'Skip',
  usual: 'Your usual',
};

/** Which of the theme's colours a label wears: green for the safe bet, gold for the two worth a look, orange and red for the two to think twice about. */
export type LabelTone = 'high' | 'gold' | 'low' | 'danger' | 'base';
export const LABEL_TONE: Record<ScoreLabel, LabelTone> = {
  'safe-bet': 'high',
  'hidden-gem': 'gold',
  tryout: 'gold',
  bycatch: 'low',
  skip: 'danger',
  usual: 'base',
};

/** An axis's band in a word, as the bar ends. */
export function axisWord(axis: 'taste' | 'pull', band: AxisBand): string {
  if (axis === 'taste') return band === 'high' ? 'above usual' : band === 'low' ? 'below usual' : 'usual';
  return band === 'high' ? 'high' : band === 'low' ? 'low' : 'usual';
}

/** The one sentence under the label: both axes, in the order pull then taste. */
export function labelSentence(fx: Pick<FandexScore, 'taste' | 'pull'>): string {
  const t = fx.taste.band;
  const p = fx.pull?.band ?? 'usual';
  if (p === 'high' && t === 'high') return 'You seek this out, and you rate it well.';
  if (p === 'low' && t === 'high') return 'Not your usual pick, but you rate this kind of thing well.';
  if (p === 'high' && t === 'low') return 'You seek this out, but you tend not to love it.';
  if (p === 'low' && t === 'low') return 'Not your kind of thing, and you tend not to love it.';
  if (t === 'high') return 'You rate this kind of thing well.';
  if (t === 'low') return 'You tend not to love this kind of thing.';
  if (p === 'high') return 'You seek this out.';
  if (p === 'low') return 'Not your usual pick.';
  return 'About your usual, on both counts.';
}

const TYPE_PLURAL: Record<string, string> = { movie: 'Films', show: 'Shows', game: 'Games', book: 'Books', boardgame: 'Board games' };

/** A ratio as the odds line prints it: one decimal, no ".0". */
const times = (x: number) => `${(Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '')}×`;

/** The Wilson interval of k in n at 90%: where the true share of 8s plausibly sits. */
function wilson(k: number, n: number): [number, number] {
  const z = 1.645;
  const p = k / n;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/**
 * The odds line: for titles with this label, how much more often than usual
 * people gave an 8 or more, with the range the counts behind it allow, or
 * "too few" when fewer than `MIN_LABEL_EVIDENCE` rated titles stand behind it
 * (Nils, 2026-10-26: make the Why sheet honest). `odds` and `evidence` are
 * the Worker's summed ladder when it has one, else the shipped defaults; the
 * medium's own when it knows the label, else every medium's. Null when
 * neither knows this label.
 */
export function oddsLine(
  label: ScoreLabel, type: string | undefined,
  odds: Record<string, Partial<Record<string, number>>> = DEFAULT_LABEL_ODDS,
  evidence: Record<string, { base: number; labels: Partial<Record<string, [number, number]>> }> = DEFAULT_LABEL_EVIDENCE,
): string | null {
  const medium = type && odds[type]?.[label] != null ? type : 'all';
  const ratio = odds[medium]?.[label];
  const counts = evidence[medium]?.labels[label];
  const what = type && TYPE_PLURAL[type] ? `${TYPE_PLURAL[type]} like this` : 'Titles like this';
  if (counts && counts[0] < MIN_LABEL_EVIDENCE) return `${what}: too few rated titles with this label yet to say how often they reach an 8.`;
  if (ratio == null) return null;
  const howOften = ratio >= 1.15 ? `about ${times(ratio)} as often as usual`
    : ratio > 0.85 ? 'about as often as usual'
    : ratio > 0.6 ? 'less often than usual'
    : 'about half as often as usual';
  const base = evidence[medium]?.base;
  if (!counts || !base) return `${what}: an 8 or more ${howOften}.`;
  const [lo, hi] = wilson(counts[1], counts[0]);
  return `${what}: an 8 or more ${howOften} (${times(lo / base)} to ${times(hi / base)}).`;
}

/** Counted rows first, by what they add; rows that were left out sink to the end. Within that, the axis order the sheet shows. */
export function sortReasons(reasons: ScoreReason[]): ScoreReason[] {
  return [...reasons].sort((a, b) => (!!a.capped === !!b.capped ? b.contribution - a.contribution : a.capped ? 1 : -1));
}

/** The counted rows of one axis, biggest lift first. */
export function axisRows(reasons: ScoreReason[], axis: 'taste' | 'pull'): ScoreReason[] {
  return reasons.filter((r) => r.axis === axis && !r.capped).sort((a, b) => b.contribution - a.contribution);
}

/** The rows that matched but did not count, biggest would-be value first. */
export function cappedRows(reasons: ScoreReason[]): ScoreReason[] {
  return reasons.filter((r) => r.capped).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
}

const MEDIUM_PLURAL: Record<string, string> = { movie: 'films', show: 'shows', game: 'games', book: 'books', boardgame: 'board games' };

/** "5 times", "1.4 times": a whole number from two up, one decimal below. */
function timesWord(x: number): string {
  return x >= 1.95 ? `${Math.round(x)} times` : `${(Math.round(x * 10) / 10).toFixed(1)} times`;
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
  const what = media.length === 1 && MEDIUM_PLURAL[media[0]] ? MEDIUM_PLURAL[media[0]] : 'titles';
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
