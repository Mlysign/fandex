// Home's rails as a hook, because the profile page shows one of them too.
// What the rails are made from is lib/homeFeed.ts.

import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '~/lib/AuthProvider';
import { cardFromCatalog, premiereCard, useCardStates, type CardItem } from '~/lib/cards';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { currentMonth, shiftMonth, todayIso } from '~/lib/dates';
import { catalogCandidates } from '~/lib/db';
import { useHiddenIds } from '~/lib/hidden';
import { jsHeapMB } from '~/lib/jsHeap';
import { genreFacets, loadHomeFeed, recommend, tierOf, upcomingRail, type Candidate, type FeedCard, type HomeFeed } from '~/lib/homeFeed';
import { useScores, type RowScore } from '~/lib/ScoreProvider';
import { premiereRows } from '~/lib/seasonPremieres';
import { useTypeFilter } from '~/lib/typeFilter';

/** The catalog copy's titles not in your library, each with the score its full facets earn. */
interface Pool { cards: CardItem[]; scores: Map<string, RowScore> }

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
  // A card the device holds is scored from its full facets (the card's own row
  // score wins, components/cards.tsx). One it does not hold carries only its
  // genres, the same fallback Recommended uses: without it the card showed the
  // crowd's "7.6/10" where a Fandex Score belongs (Nils, Miro board, 2026-11-05).
  const byGenre = useCallback(<T extends FeedCard>(items: T[]): T[] => items.map((c) => {
    if (c.match || !c.genres.length) return c;
    const fx = score(c.id ?? c.key, genreFacets(c.genres), c.type);
    return fx ? { ...c, match: { score: fx.score, band: fx.band } } : c;
  }), [score]);
  // New seasons of the shows you are caught up on (lib/seasonPremieres.ts),
  // from last month to two months out: the calendar's rule, on Home's rails
  // (Nils, 2026-11-07). Each is scored from the show's full facets, which a
  // show in your library does not get from the pool below.
  const [premieres, setPremieres] = useState<{ cards: FeedCard[]; scores: Map<string, RowScore> }>({ cards: [], scores: new Map() });
  useEffect(() => {
    let live = true;
    if (!signedIn) { setPremieres({ cards: [], scores: new Map() }); return; }
    const now = currentMonth();
    void (async () => {
      const lists = await Promise.all([shiftMonth(now, -1), now, shiftMonth(now, 1), shiftMonth(now, 2)]
        .map((m) => premiereRows(db, m).catch(() => [])));
      const cards = lists.flat().map(premiereCard);
      const found = cards.length ? await scoresFor([...new Set(cards.map((c) => c.id as string))], () => live) : new Map<string, RowScore>();
      if (live) setPremieres({ cards, scores: found });
    })().catch((e: unknown) => console.warn('home_premieres_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e)));
    return () => { live = false; };
  }, [db, signedIn, scoresFor, revision, catalog.revision, auth.rowsRevision]);
  const today = todayIso();
  /** The ones still to come: Upcoming always carries them, and Recommended counts them as still to come. */
  const comingSeasons = useMemo(() => premieres.cards.filter((c) => (c.releaseDate ?? '') > today), [premieres, today]);

  const upcoming = useMemo(() => (feed ? byGenre(upcomingRail(feed.candidates, types, comingSeasons)) : null), [feed, types, byGenre, comingSeasons]);
  // A show that is trending while its new season is out or due says which season, as its calendar card does.
  const trending = useMemo(() => {
    if (!feed) return null;
    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const label = new Map<string, string>();
    for (const c of premieres.cards) if ((c.releaseDate ?? '') >= monthAgo && c.id) label.set(c.id, c.role as string);
    return byGenre(feed.trending.map((c) => (c.id && label.has(c.id) ? { ...c, role: label.get(c.id) } : c)));
  }, [feed, byGenre, premieres]);

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
    // A start rebuilds the profile two or three times (the stored taxonomy, the
    // fresh one, your rows arriving), and each rebuild starts this again. A run
    // it replaced stops between chunks: it used to score the whole catalog anyway,
    // on the same thread as the run whose answer the rail is waiting for (RV31).
    (async () => {
      const started = Date.now();
      const cards = (await catalogCandidates(db)).map(cardFromCatalog);
      const found = await scoresFor(cards.map((c) => c.id as string), () => live);
      if (!live) return;
      setPool({ cards, scores: found });
      console.log('fandex_pool', JSON.stringify({ titles: cards.length, ms: Date.now() - started, js: jsHeapMB() }));
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
    // Still to come, then out in the last year, then the rest of the catalog.
    const tiers: Candidate[][] = [[], [], []];
    for (const c of pool.cards) tiers[tierOf(c.releaseDate, today)].push(c);
    // A new season you are waiting for is still to come, and joins the first
    // tier: it is recommended when the show is a strong match, like any title.
    tiers[0].push(...comingSeasons);
    // The calendar's upcoming titles join the first tier, after the catalog's
    // own: a row of the same title is scored from its full facets and wins.
    tiers[0].push(...candidates);
    return recommend(
      tiers,
      // A catalog row's score from everything it carries; a calendar card carries its genres and nothing finer.
      (c) => {
        if (c.id && pool.scores.has(c.id)) return pool.scores.get(c.id) as RowScore;
        if (c.season && c.id && premieres.scores.has(c.id)) return premieres.scores.get(c.id) as RowScore;
        const fx = score(c.id ?? c.key, genreFacets(c.genres ?? []), c.type);
        return fx ? { score: fx.score, band: fx.band } : null;
      },
      // Not what you already watched or played, not what you asked not to be
      // shown, and no DLC or pack. A new season is of a show you watched: that
      // is the point of it, so only hiding the show keeps it out.
      (c) => !!c.addon || (c.id ? hidden.has(c.id) || (!c.season && stateOf(c.id).inLibrary) : false),
      center,
      types,
      (c) => (c.id && !c.season ? stateOf(c.id).wishlisted : false),
    );
  }, [candidates, center, pool, score, hidden, stateOf, types, today, comingSeasons, premieres]);

  const withoutHidden = useCallback(<T extends CardItem>(items: T[]) => items.filter((i) => !(i.id && hidden.has(i.id))), [hidden]);

  return {
    feed, failed, load, recommendation, withoutHidden, signedIn,
    /** Today's Upcoming rail for the types on screen; null until the feed is in. */
    upcoming,
    /** Popular right now, each card scored by genre when the device does not hold it; null until the feed is in. */
    trending,
    /** Signed in, and the personal rail cannot be drawn yet. */
    personalPending: signedIn && (!feed || !scores.ready || (center != null && !pool)) && !failed,
  };
}
