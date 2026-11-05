// What each tag, person and studio on the Insights page does to your Fandex
// Score: the same taste points a facet's own page shows.
//
// Read off one index of the whole profile (`tasteImpactIndex`, facetImpact.ts),
// built once per profile. Until 2026-11-05 each row asked `impactsFor`, which
// scans the profile per facet: a thousand rows filled in for seconds with only
// a faint "…" in each cell, and Nils could not tell whether the page had loaded.

import { useMemo } from 'react';
import { classWeightOf, type ScoreFacet, type Taxonomy } from './fandexScore';
import { tasteImpactOf, type ImpactKind, type TasteIndex } from './facetImpact';

/** A tag, person or studio as Insights counts it, in one role. */
export interface ImpactTarget { kind: string; role?: string; key: string; label: string; category?: string }

export const impactId = (f: { kind: string; role?: string; key: string }) => `${f.kind}|${f.role ?? ''}|${f.key}`;

/** Taste points for one facet in the role it was rated in, or null when the score does not weigh it. */
export function impactOf(f: ImpactTarget, index: TasteIndex, tax: Taxonomy | null): number | null {
  if (tax && classWeightOf(f as ScoreFacet, tax).weight === 0) return null;
  return tasteImpactOf(index, f.kind as ImpactKind, f.role, f.key);
}

/** Impacts by `impactId`, or null while there is no profile to read them from yet. */
export function useFacetImpacts(targets: ImpactTarget[], tasteIndex: () => TasteIndex | null, tax: Taxonomy | null): ReadonlyMap<string, number | null> | null {
  return useMemo(() => {
    const index = tasteIndex();
    if (!index) return null;
    return new Map(targets.map((f) => [impactId(f), impactOf(f, index, tax)] as const));
  }, [targets, tasteIndex, tax]);
}
