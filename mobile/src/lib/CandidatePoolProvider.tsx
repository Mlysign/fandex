// The titles a recommendation may be: everything the catalog copy holds that
// is not in your library, each with the Fandex Score its full facets earn.
//
// Home's Recommended rail chose from this on its own (lib/useHomeRails.ts)
// until the Recommendations page needed the same set. Scoring the whole copy
// is the slow part of both, and every screen stays mounted, so the pool is
// built once here and shared: one pass, and the two screens never disagree on
// a title's number.
//
// Built only once a screen asks (`useCandidatePool`), so a visit that opens on
// a title's page does not score ten thousand titles for a rail nobody sees.

import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '~/lib/AuthProvider';
import { cardFromCatalog, type CardItem } from '~/lib/cards';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { catalogCandidates } from '~/lib/db';
import { jsHeapMB } from '~/lib/jsHeap';
import { useScores, type RowScore } from '~/lib/ScoreProvider';

/** The catalog copy's titles not in your library (no DLC or pack), each with the score its full facets earn. */
export interface CandidatePool { cards: CardItem[]; scores: Map<string, RowScore> }

interface Value { pool: CandidatePool | null; retain: () => () => void }

const Ctx = createContext<Value | null>(null);

export function CandidatePoolProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();
  const { scoresFor, center, revision } = useScores();
  const signedIn = auth.status === 'signedIn';

  const [users, setUsers] = useState(0);
  const retain = useCallback(() => {
    setUsers((n) => n + 1);
    return () => setUsers((n) => n - 1);
  }, []);
  const wanted = users > 0;

  // Re-read when your rows, the copy or the profile change. Null until there
  // is a taste profile to score with (signed out, or fewer than three ratings).
  const [pool, setPool] = useState<CandidatePool | null>(null);
  useEffect(() => {
    let live = true;
    if (!signedIn || center == null) {
      setPool(null);
      return;
    }
    if (!wanted) return;
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
  }, [db, signedIn, center, scoresFor, revision, catalog.revision, auth.rowsRevision, wanted]);

  const value = useMemo<Value>(() => ({ pool, retain }), [pool, retain]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The pool, for a screen that recommends from it. Null until it is scored, and with no taste profile. */
export function useCandidatePool(): CandidatePool | null {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCandidatePool must be used inside <CandidatePoolProvider>');
  const { retain } = v;
  useEffect(() => retain(), [retain]);
  return v.pool;
}
