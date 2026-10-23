// What the item page's Fandex Score panel says, apart from how it is drawn
// (components/FandexScorePanel.tsx). The rules are the site's: FandexScoreBadge's
// bands and FandexScoreSection's one-line reason and row order.

import { companyKey, ipKey, personKey, tagKey } from '@/lib/facets';
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

/**
 * The counted reason that agrees with the band: the biggest lift on a strong
 * match, the biggest drag on a weak one, the biggest either way on a typical
 * one. "Weak match. You rate X highly." named the top row whatever the band said.
 */
export function leadReason(band: ScoreBand, reasons: ScoreReason[]): ScoreReason | undefined {
  const counted = reasons.filter((r) => !r.capped && r.contribution !== 0);
  const pick = (better: (a: ScoreReason, b: ScoreReason) => boolean) =>
    counted.reduce<ScoreReason | undefined>((best, r) => (!best || better(r, best) ? r : best), undefined);
  if (band === 'high') return pick((a, b) => a.contribution > b.contribution);
  if (band === 'low') return pick((a, b) => a.contribution < b.contribution);
  return pick((a, b) => Math.abs(a.contribution) > Math.abs(b.contribution));
}

/** The band in words, and the counted reason that agrees with it when there is one. */
export function scoreReasonLine(score: number, center: number | null, reasons: ScoreReason[]): string {
  const band = scoreBand(score, center);
  const strength = STRENGTH[band];
  const top = leadReason(band, reasons);
  // A strong match whose every counted row pulls down (or the reverse) has no honest reason to name.
  if (!top || (band === 'high' && top.contribution < 0) || (band === 'low' && top.contribution > 0)) return `${strength} for your taste.`;
  return `${strength}. You rate ${top.label} ${top.contribution >= 0 ? 'highly' : 'lower than most'}.`;
}

/** Counted rows first, by what they add; rows that were left out sink to the end. */
export function sortReasons(reasons: ScoreReason[]): ScoreReason[] {
  return [...reasons].sort((a, b) => (!!a.capped === !!b.capped ? b.contribution - a.contribution : a.capped ? 1 : -1));
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
