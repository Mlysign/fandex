// What a tag, a person or a studio does to your Fandex Score, for its own page.
// The site's "Fandex impact" line (src/components/facet/PublicFacetView.tsx,
// fed by /api/facet/mine's tagImpact), read off the profile on the device.
//
// The site showed it for tags only. A person or a studio is one profile entry
// per role (a director and a cast member are scored apart), so their page gets
// one row per role you have rated them in.

import { tagKey } from '@/lib/facets';
import { ROLE_LABEL } from './creditLine';
import { PULL_SHOWN } from './scoreReasons';
import { facetImpact, facetId, facetPull, MIN_RATED_FOR_FANDEX_SCORE, type FacetPull, type Profile, type ScoreFacet, type Taxonomy } from './fandexScore';

/**
 * What a facet page knows of a title nobody holds, as the facets a Fandex Score
 * is estimated from: the page's own facet (the author, the franchise, the tag),
 * in the roles the card came with, and the card's genres (a book's subjects,
 * IGDB's genres and themes, TMDB's genres).
 *
 * The page's facet alone scored only what you had rated that person or tag on
 * before, so an author you had not read showed the crowd's rating on every card
 * (Paolo Bacigalupi, Nils, 2026-10-18). The genres are what Home's calendar
 * cards are scored from, for the same reason.
 */
export function estimateFacets(kind: 'tag' | 'person' | 'studio' | 'franchise', key: string, label: string, roles: string[] | undefined, genres: string[] | undefined): ScoreFacet[] {
  let own: ScoreFacet[];
  if (kind === 'tag') own = [{ kind: 'tag', key, label }];
  else if (kind === 'franchise') own = [{ kind: 'ip', role: 'ip', key, label }];
  else {
    const had = roles?.length ? roles : [kind === 'person' ? 'cast' : 'studio'];
    own = had.map((role) => ({ kind: kind === 'person' ? 'person' : 'company', role, key, label }));
  }
  const seen = new Set(own.filter((f) => f.kind === 'tag').map((f) => f.key));
  const tags: ScoreFacet[] = [];
  for (const g of genres ?? []) {
    const k = tagKey(g);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    tags.push({ kind: 'tag', key: k, label: g });
  }
  return [...own, ...tags];
}

/** A stored key as an address spells it: hyphens and runs of spaces are one space (src/lib/facetUrl.ts, slugToKey). */
export const spokenKey = (key: string) => key.toLowerCase().replace(/-+/g, ' ').replace(/\s+/g, ' ').trim();

export type ImpactDirection = 'up' | 'down' | 'neutral';

export interface PageImpact {
  /** The profile's id for this entry (`kind|role|key`): what a follow is keyed by. */
  facetId: string;
  /** Absent for a tag. */
  role?: string;
  /** Taste: points this adds to, or takes from, a title that carries it. Null when none of your rated titles carry it, and only pull speaks. */
  points: number | null;
  direction: ImpactDirection;
  /** How many of your rated titles carry it. */
  ratedCount: number;
  /** Pull: how much more or less often you pick it than average, or null when the model gives it no weight (or there is no model yet). */
  pull: FacetPull | null;
}

/** Under half a point either way reads as "about the same": the site's threshold. */
const directionOf = (points: number): ImpactDirection => (Math.abs(points) < 0.5 ? 'neutral' : points > 0 ? 'up' : 'down');

/**
 * The impact rows for one facet page. `key` is the page's key, as `slugToKey`
 * returns it. Empty when there is no score to speak of, or when none of your
 * rated titles carry the facet (or its tag category is ignored).
 */
export type ImpactKind = 'tag' | 'person' | 'company' | 'ip';

/** The profile learned a bundled tag or franchise under its canonical key, so a member spelling's page reads that entry. */
function profileKey(kind: ImpactKind, key: string, tax: Taxonomy): string {
  if (kind === 'tag' || kind === 'ip') {
    for (const [alias, canonical] of kind === 'tag' ? tax.tagAliases : tax.ipAliases) {
      if (spokenKey(alias) === key) return spokenKey(canonical);
    }
  }
  return key;
}

export function pageImpacts(kind: ImpactKind, key: string, profile: Profile, tax: Taxonomy): PageImpact[] {
  if (profile.ratedItemCount < MIN_RATED_FOR_FANDEX_SCORE) return [];
  const target = profileKey(kind, key, tax);
  const rows: PageImpact[] = [];
  for (const m of profile.meta.values()) {
    if (m.kind !== kind || spokenKey(m.key) !== target) continue;
    const points = facetImpact(facetId(m), profile, tax);
    if (points == null) continue;
    const pull = facetPull({ kind: m.kind as ScoreFacet['kind'], role: m.role, key: m.key, label: m.label, category: m.category }, profile, tax);
    rows.push({ facetId: facetId(m), role: kind === 'tag' || kind === 'ip' ? undefined : m.role, points, direction: directionOf(points), ratedCount: m.n, pull });
  }
  // A facet you pick but never rated a title of: pull speaks, taste does not.
  // Not while pull is off the screen, or the page shows nothing and says no reason.
  const seen = new Set(rows.map((r) => r.facetId));
  for (const id of PULL_SHOWN ? new Set([...(profile.pull?.beta.keys() ?? []), ...profile.follows.keys()]) : []) {
    const [k, role, ...rest] = id.split('|');
    const key = rest.join('|');
    if (k !== kind || seen.has(id) || spokenKey(key) !== target) continue;
    const pull = facetPull({ kind: k as ScoreFacet['kind'], role: role || undefined, key, label: key }, profile, tax);
    if (pull) rows.push({ facetId: id, role: kind === 'tag' || kind === 'ip' ? undefined : role || undefined, points: null, direction: 'neutral', ratedCount: 0, pull });
  }
  // Two stored spellings of one tag can speak the same: the one you rated more is the tag.
  if (kind === 'tag' || kind === 'ip') return rows.sort((a, b) => b.ratedCount - a.ratedCount).slice(0, 1);
  return rows.sort((a, b) => Math.abs(b.points ?? 0) - Math.abs(a.points ?? 0));
}

/**
 * Every facet's taste points at once, for a page that shows hundreds (Insights).
 * `pageImpacts` scans the whole profile per facet, and a thousand rows of that
 * kept Insights filling in for seconds with nothing on screen saying so (Nils,
 * 2026-11-05). This is the same taste numbers from one pass: a tag or franchise
 * under its canonical spelling, the most-rated spelling winning as there; a
 * person or company per role. Pull is left out: Insights shows taste only.
 */
export interface TasteIndex {
  /** Points by `kind|role|spoken key` (no role for a tag or a franchise). */
  points: Map<string, number>;
  /** A bundled tag's or franchise's spoken spelling to its canonical one's. */
  aliases: Map<string, string>;
}

const indexKey = (kind: string, role: string | undefined, spoken: string) => `${kind}|${kind === 'tag' || kind === 'ip' ? '' : role ?? ''}|${spoken}`;

export function tasteImpactIndex(profile: Profile, tax: Taxonomy): TasteIndex {
  const aliases = new Map<string, string>();
  for (const [alias, canonical] of tax.tagAliases) aliases.set(`tag|${spokenKey(alias)}`, spokenKey(canonical));
  for (const [alias, canonical] of tax.ipAliases) aliases.set(`ip|${spokenKey(alias)}`, spokenKey(canonical));
  const points = new Map<string, number>();
  if (profile.ratedItemCount < MIN_RATED_FOR_FANDEX_SCORE) return { points, aliases };
  const ratedOf = new Map<string, number>();
  for (const m of profile.meta.values()) {
    const p = facetImpact(facetId(m), profile, tax);
    if (p == null) continue;
    const k = indexKey(m.kind, m.role, spokenKey(m.key));
    // Two stored spellings of one tag can speak the same: the one you rated more is the tag (as pageImpacts).
    if ((ratedOf.get(k) ?? -1) >= m.n) continue;
    ratedOf.set(k, m.n);
    points.set(k, p);
  }
  return { points, aliases };
}

/** One facet's taste points from the index, or null when the score does not weigh it. */
export function tasteImpactOf(index: TasteIndex, kind: ImpactKind, role: string | undefined, key: string): number | null {
  const spoken = spokenKey(key);
  const canonical = kind === 'tag' || kind === 'ip' ? index.aliases.get(`${kind}|${spoken}`) ?? spoken : spoken;
  return index.points.get(indexKey(kind, role, canonical)) ?? null;
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
  // Rated titles carry it, but its class weighs nothing: say that, never "none of your titles carries it"
  // over a page that counts the ones you rated (Western under a zero-weight Genre, Nils, 2026-11-01).
  const target = profileKey(kind, key, tax);
  const zero = [...profile.unweighted.values()].filter((u) => u.kind === kind && spokenKey(u.key) === target);
  if (zero.length) {
    const tail = `so ${name} does not move it, however you rate those titles.`;
    if (kind === 'tag') {
      const category = zero[0].category ?? 'other';
      const label = tax.categories.get(category)?.label ?? category;
      return `Tags filed under ${label} carry no weight in your Fandex Score, ${tail}`;
    }
    if (kind === 'ip') return `Franchises carry no weight in your Fandex Score, ${tail}`;
    const roles = [...new Set(zero.map((u) => ROLE_LABEL[u.role ?? ''] ?? u.role ?? kind))];
    const credits = roles.length > 1 ? `${roles.slice(0, -1).join(', ')} and ${roles[roles.length - 1]}` : roles[0];
    return `${credits} credits carry no weight in your Fandex Score, ${tail}`;
  }
  const what = kind === 'tag' ? 'this tag' : kind === 'ip' ? 'this franchise' : 'them';
  return `Not in your Fandex Score yet: none of the ${profile.ratedItemCount} titles you rated carries ${what}.`;
}
