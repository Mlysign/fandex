// What the item page's Fandex Score panel says, apart from how it is drawn
// (components/FandexScorePanel.tsx). The rules are the site's: FandexScoreBadge's
// bands and FandexScoreSection's one-line reason and row order.

import { companyKey, personKey, tagKey } from '@/lib/facets';
import { keyToSlug } from '@/lib/facetUrl';
import type { ScoreReason } from '~/lib/fandexScore';

/** How far from your own average a score has to be to read as strong or weak. The site's BAND_MARGIN. */
export const BAND_MARGIN = 10;

export type ScoreBand = 'high' | 'baseline' | 'low';

/** Bands sit around YOUR average, not around 50: a 70 is a weak match for somebody who rates everything 8. */
export function scoreBand(score: number, center: number | null): ScoreBand {
  const c = center ?? 50;
  return score >= c + BAND_MARGIN ? 'high' : score <= c - BAND_MARGIN ? 'low' : 'baseline';
}

const STRENGTH: Record<ScoreBand, string> = { high: 'Strong match', baseline: 'Typical match', low: 'Weak match' };

/** The band in words, and the strongest counted reason when there is one. */
export function scoreReasonLine(score: number, center: number | null, top: ScoreReason | undefined): string {
  const strength = STRENGTH[scoreBand(score, center)];
  if (!top) return `${strength} for your taste.`;
  return `${strength}. You rate ${top.label} ${top.contribution >= 0 ? 'highly' : 'lower than most'}.`;
}

/** Counted rows first, by what they add; rows that were left out sink to the end. */
export function sortReasons(reasons: ScoreReason[]): ScoreReason[] {
  return [...reasons].sort((a, b) => (!!a.capped === !!b.capped ? b.contribution - a.contribution : a.capped ? 1 : -1));
}

/** Where a reason's chip leads, or null for one with no page of its own (a franchise). */
export function reasonHref(r: ScoreReason): string | null {
  if (r.kind === 'tag') return `/tag/${keyToSlug(tagKey(r.label))}`;
  if (r.kind === 'person') return `/person/${keyToSlug(personKey(r.label))}`;
  if (r.kind === 'company') return `/studio/${keyToSlug(companyKey(r.label))}`;
  return null;
}

/** `+4.2`, `−1.0`: a real minus sign, the width of the plus. */
export const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;
