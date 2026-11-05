// What each tag, person and studio on the Insights page does to your Fandex
// Score: the same "Taste +0.4" a facet's own page shows (`impactsFor`).
//
// `impactsFor` walks the whole profile once per facet, about 0.5 ms a call in
// Node against 6,800 profile facets, and a rating box can hold hundreds. So the
// work runs in slices (mobile/CLAUDE.md, long work), skips a class the score
// gives no weight (cast, writers), and is kept per profile: a second visit, or
// a new minimum, only computes what it has not seen.

import { useEffect, useState } from 'react';
import { classWeightOf, type ScoreFacet, type Taxonomy } from './fandexScore';
import { spokenKey, type ImpactKind, type PageImpact } from './facetImpact';
import { runSliced, SliceCancelled, type Steps } from './timeSlice';

/** A tag, person or studio as Insights counts it, in one role. */
export interface ImpactTarget { kind: string; role?: string; key: string; label: string; category?: string }
type ImpactsFor = (kind: ImpactKind, key: string) => PageImpact[];

export const impactId = (f: { kind: string; role?: string; key: string }) => `${f.kind}|${f.role ?? ''}|${f.key}`;

/** Taste points for one facet in the role it was rated in, or null when the score does not weigh it. */
export function impactOf(f: ImpactTarget, impactsFor: ImpactsFor, tax: Taxonomy | null): number | null {
  if (tax && classWeightOf(f as ScoreFacet, tax).weight === 0) return null;
  const rows = impactsFor(f.kind as ImpactKind, spokenKey(f.key));
  // A person's page has one row per role; this row is about one of them.
  const row = f.kind === 'tag' ? rows[0] : rows.find((r) => r.role === f.role);
  return row?.points ?? null;
}

function* steps(todo: ImpactTarget[], impactsFor: ImpactsFor, tax: Taxonomy | null, into: Map<string, number | null>): Steps<void> {
  for (const f of todo) {
    into.set(impactId(f), impactOf(f, impactsFor, tax));
    yield;
  }
}

/** Answers per profile: `impactsFor` is a new function whenever the profile or the taxonomy is rebuilt. */
const caches = new WeakMap<ImpactsFor, Map<string, number | null>>();
function cacheFor(impactsFor: ImpactsFor): Map<string, number | null> {
  let c = caches.get(impactsFor);
  if (!c) caches.set(impactsFor, (c = new Map()));
  return c;
}

/** Impacts by `impactId`, or null while any of `targets` is still being worked out. */
export function useFacetImpacts(targets: ImpactTarget[], impactsFor: ImpactsFor, tax: Taxonomy | null): ReadonlyMap<string, number | null> | null {
  // The answer is a copy taken when a run ends, never the cache itself: the React
  // Compiler (app.json) memoises a render, and a read of a mutated Map would stay stale.
  const [snap, setSnap] = useState<{ of: ImpactsFor; map: ReadonlyMap<string, number | null> } | null>(null);
  useEffect(() => {
    const cache = cacheFor(impactsFor);
    const todo = targets.filter((f) => !cache.has(impactId(f)));
    const publish = () => setSnap({ of: impactsFor, map: new Map(cache) });
    if (!todo.length) { publish(); return; }
    let live = true;
    runSliced(steps(todo, impactsFor, tax, cache), { alive: () => live })
      .then(() => { if (live) publish(); })
      // Cancelled means the page moved on; what was computed stays in the cache for the next run.
      .catch((e: unknown) => { if (!(e instanceof SliceCancelled)) console.warn('insights impacts', e); });
    return () => { live = false; };
  }, [targets, impactsFor, tax]);
  return snap && snap.of === impactsFor && targets.every((f) => snap.map.has(impactId(f))) ? snap.map : null;
}
