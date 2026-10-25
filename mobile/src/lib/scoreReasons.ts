// What the score says, apart from how it is drawn: the label's words, the one
// sentence that names both axes, the odds line, and where a row leads.
// Components (FandexScorePanel, cards, ScoreExplainer, FacetScreen) read from
// here so the wording lives in one place; the labels are placeholders Nils will
// rename (2026-10-25).

import { companyKey, ipKey, personKey, tagKey } from '@/lib/facets';
import { keyToSlug } from '@/lib/facetUrl';
import { DEFAULT_LABEL_ODDS } from '@/lib/scoringDefaults';
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

/**
 * The odds line: for titles with this label, how much more often than usual
 * people gave an 8 or more. `odds` is the Worker's summed ladder when it has
 * one, else the shipped defaults. Null when neither knows this label.
 */
export function oddsLine(label: ScoreLabel, type: string | undefined, odds: Record<string, Partial<Record<string, number>>> = DEFAULT_LABEL_ODDS): string | null {
  const ratio = (type ? odds[type]?.[label] : undefined) ?? odds.all?.[label];
  if (ratio == null) return null;
  const what = type && TYPE_PLURAL[type] ? `${TYPE_PLURAL[type]} like this` : 'Titles like this';
  const howOften = ratio >= 1.15 ? `about ${(Math.round(ratio * 10) / 10).toFixed(1).replace(/\.0$/, '')}× as often as usual`
    : ratio > 0.85 ? 'about as often as usual'
    : ratio > 0.6 ? 'less often than usual'
    : 'about half as often as usual';
  return `${what}: an 8 or more ${howOften}.`;
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

/** A pull row in one sentence: "you've seen 46 of 64", a wishlisted title counting half. */
export function pullSentence(r: ScoreReason, type?: string): string {
  const verb = type === 'game' ? 'played' : type === 'book' ? 'read' : 'seen';
  const seen = r.consumed ?? 0;
  const shown = Number.isInteger(seen) ? String(seen) : seen.toFixed(1);
  return `you've ${verb} ${shown} of ${r.catalog ?? 0}`;
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
