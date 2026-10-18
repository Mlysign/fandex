// Home's rails as a hook, because the profile page shows one of them too.
// What the rails are made from is lib/homeFeed.ts.

import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '~/lib/AuthProvider';
import { cardFromCatalog, useCardStates, type CardItem } from '~/lib/cards';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { todayIso } from '~/lib/dates';
import { catalogCandidates } from '~/lib/db';
import { useHiddenIds } from '~/lib/hidden';
import { genreFacets, loadHomeFeed, recommend, tierOf, upcomingRail, type Candidate, type HomeFeed } from '~/lib/homeFeed';
import { useScores } from '~/lib/ScoreProvider';
import { useTypeFilter } from '~/lib/typeFilter';

/** The catalog copy's titles not in your library, each with the score its full facets earn. */
interface Pool { cards: CardItem[]; scores: Map<string, number> }

export function useHomeRails() {
  const auth = useAuth();
  const db = useSQLiteContext();
  const catalog = useCatalogSync();
  const scores = useScores();
  const { region } = auth;

  const [feed, setFeed] = useState<HomeFeed | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    loadHomeFeed(region).then(setFeed).catch(() => setFailed(true));
  }, [region]);
  useEffect(load, [load]);

  const hidden = useHiddenIds();
  const signedIn = auth.status === 'signedIn';
  const { score, scoresFor, center, revision } = scores;
  // The types the viewer is looking at: each gets an even share of the two
  // personal rails, so a catalog that is a third games does not make a rail
  // that is all games (Nils, 2026-10-18). Filtering afterwards would do the
  // opposite: a balanced fifteen cut to two types is six cards.
  const { shown } = useTypeFilter();
  const typesKey = shown.join(',');
  const types = useMemo(() => typesKey.split(',').filter(Boolean), [typesKey]);
  const upcoming = useMemo(() => (feed ? upcomingRail(feed.candidates, types) : null), [feed, types]);

  // "Recommended for you" chooses from the whole catalog copy, not only from
  // the calendar's next months: those alone, scored by genre, left one green
  // card (Nils, 2026-10-17). A catalog row is scored with everything it
  // carries. Re-read when your rows, the copy or the profile change.
  const [pool, setPool] = useState<Pool | null>(null);
  useEffect(() => {
    let live = true;
    if (!signedIn || center == null) {
      setPool(null);
      return;
    }
    (async () => {
      const cards = (await catalogCandidates(db)).map(cardFromCatalog);
      const found = await scoresFor(cards.map((c) => c.id as string));
      if (live) setPool({ cards, scores: found });
    })();
    return () => { live = false; };
  }, [db, signedIn, center, scoresFor, revision, catalog.revision, auth.rowsRevision]);

  const candidates = feed?.candidates;
  const stateOf = useCardStates(useMemo(() => (candidates ?? []).map((c) => c.id), [candidates]));
  /**
   * Null until there is a taste profile to rank by (signed out, or fewer than
   * three ratings) and the catalog copy is scored. Empty when nothing scores a
   * strong match for you, which draws no rail at all.
   */
  const recommendation = useMemo(() => {
    if (!candidates || center == null || !pool) return null;
    const today = todayIso();
    // Still to come, then out in the last year, then the rest of the catalog.
    const tiers: Candidate[][] = [[], [], []];
    for (const c of pool.cards) tiers[tierOf(c.releaseDate, today)].push(c);
    // The calendar's upcoming titles join the first tier, after the catalog's
    // own: a row of the same title is scored from its full facets and wins.
    tiers[0].push(...candidates);
    return recommend(
      tiers,
      // A catalog row's score from everything it carries; a calendar card carries its genres and nothing finer.
      (c) => (c.id && pool.scores.has(c.id) ? (pool.scores.get(c.id) as number) : score(c.id ?? c.key, genreFacets(c.genres ?? []))?.score ?? null),
      // Not what you already watched or played, and not what you asked not to be shown.
      (c) => (c.id ? hidden.has(c.id) || stateOf(c.id).inLibrary : false),
      center,
      types,
    );
  }, [candidates, center, pool, score, hidden, stateOf, types]);

  const withoutHidden = useCallback(<T extends CardItem>(items: T[]) => items.filter((i) => !(i.id && hidden.has(i.id))), [hidden]);

  return {
    feed, failed, load, recommendation, withoutHidden, signedIn,
    /** Today's Upcoming rail for the types on screen; null until the feed is in. */
    upcoming,
    /** Signed in, and the personal rail cannot be drawn yet. */
    personalPending: signedIn && (!feed || !scores.ready || (center != null && !pool)) && !failed,
  };
}
