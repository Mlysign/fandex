// What a tag, a person or a studio does to your Fandex Score, for its own page.
// The site's "Fandex impact" line (src/components/facet/PublicFacetView.tsx,
// fed by /api/facet/mine's tagImpact), read off the profile on the device.
//
// The site showed it for tags only. A person or a studio is one profile entry
// per role (a director and a cast member are scored apart), so their page gets
// one row per role you have rated them in.

import { facetImpact, facetId, MIN_RATED_FOR_FANDEX_SCORE, type Profile, type Taxonomy } from './fandexScore';

/** A stored key as an address spells it: hyphens and runs of spaces are one space (src/lib/facetUrl.ts, slugToKey). */
export const spokenKey = (key: string) => key.toLowerCase().replace(/-+/g, ' ').replace(/\s+/g, ' ').trim();

export type ImpactDirection = 'up' | 'down' | 'neutral';

export interface PageImpact {
  /** Absent for a tag. */
  role?: string;
  /** Points this adds to, or takes from, a title that carries it. */
  points: number;
  direction: ImpactDirection;
  /** How many of your rated titles carry it. */
  ratedCount: number;
}

/** Under half a point either way reads as "about the same": the site's threshold. */
const directionOf = (points: number): ImpactDirection => (Math.abs(points) < 0.5 ? 'neutral' : points > 0 ? 'up' : 'down');

/**
 * The impact rows for one facet page. `key` is the page's key, as `slugToKey`
 * returns it. Empty when there is no score to speak of, or when none of your
 * rated titles carry the facet (or its tag category is ignored).
 */
export type ImpactKind = 'tag' | 'person' | 'company' | 'ip';

export function pageImpacts(kind: ImpactKind, key: string, profile: Profile, tax: Taxonomy): PageImpact[] {
  if (profile.ratedItemCount < MIN_RATED_FOR_FANDEX_SCORE) return [];
  // The profile learned a bundled tag or franchise under its canonical key, so a member spelling's page reads that entry.
  let target = key;
  if (kind === 'tag' || kind === 'ip') {
    for (const [alias, canonical] of kind === 'tag' ? tax.tagAliases : tax.ipAliases) {
      if (spokenKey(alias) === key) { target = spokenKey(canonical); break; }
    }
  }
  const rows: PageImpact[] = [];
  for (const m of profile.meta.values()) {
    if (m.kind !== kind || spokenKey(m.key) !== target) continue;
    const points = facetImpact(facetId(m), profile, tax);
    if (points == null) continue;
    rows.push({ role: kind === 'tag' || kind === 'ip' ? undefined : m.role, points, direction: directionOf(points), ratedCount: m.n });
  }
  // Two stored spellings of one tag can speak the same: the one you rated more is the tag.
  if (kind === 'tag' || kind === 'ip') return rows.sort((a, b) => b.ratedCount - a.ratedCount).slice(0, 1);
  return rows.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

/**
 * Why a page shows no impact row, in words, so an empty space never reads as
 * a broken feature (AGENTS.md: a component that renders null must know why).
 * Null when there IS a row to show, or when nobody is signed in.
 */
export function impactAbsence(kind: ImpactKind, key: string, profile: Profile | null, tax: Taxonomy | null, name: string): string | null {
  if (!profile || !tax) return null;
  if (profile.ratedItemCount < MIN_RATED_FOR_FANDEX_SCORE) return `Rate ${MIN_RATED_FOR_FANDEX_SCORE} titles and this page will say what ${name} does to your Fandex Score.`;
  if (pageImpacts(kind, key, profile, tax).length) return null;
  const what = kind === 'tag' ? 'this tag' : kind === 'ip' ? 'this franchise' : 'them';
  return `Not in your Fandex Score yet: none of the ${profile.ratedItemCount} titles you rated carries ${what}.`;
}
