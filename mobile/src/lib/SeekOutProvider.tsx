// What you seek out, kept for the two places that show it: Insights' section
// and the Recommendations page (lib/seekOut.ts says what it is).
//
// It is the pull model (lib/pullModel.ts), fitted here and nowhere near the
// score. Until 0.3.48 the fit was part of the score's profile, and every score
// waited for it: seconds on each rebuild, two minutes after a sign-in. So:
//
//   - Nothing is fitted until a screen that shows it is in front
//     (`useSeekOut`). Somebody who never opens one pays nothing.
//   - The score's profile never waits for it and is never rebuilt by it.
//   - A fit that has started is finished even when its reader leaves, and only
//     a change in what it is made of (your rows, the catalog copy, the
//     taxonomy, who is signed in) stops it. A reader who bounces between two
//     pages must not restart it every time.
//   - The list is kept on the device beside the fit it came from
//     (`PULL_FIT_KEY`, forgotten at sign-out). While your picks, the baseline
//     and the taxonomy are what they were, a start shows it without reading a
//     title. When they moved, it is shown at once all the same and the fresh
//     fit replaces it when it lands: one title more barely changes it.
//
// Only the list is kept in memory. The model itself holds a count for every
// facet any title carries (megabytes), and nothing reads it once the list is made.

import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '~/lib/AuthProvider';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { buildPullModelSteps, type ScoreFacet, type Taxonomy } from '~/lib/fandexScore';
import type { PullModel } from '~/lib/pullModel';
import {
  baselineIdentity, baselinePresent, baselineTitles, consumedTitles, keepPullFit, pickWeights, PULL_FIT_MAX_AGE_MS, pullFitKey,
  pullSignature, storedBaseline, storedPullFitRow, useScores,
} from '~/lib/ScoreProvider';
import { parseSeekList, SEEK_LIST_VERSION, SEEK_OUT_LIVE, seekFacets, type SeekFacet, type SeekList } from '~/lib/seekOut';
import { runSliced, SliceCancelled } from '~/lib/timeSlice';

/**
 * - `off`: nobody is signed in, or there is no taxonomy to read facets with.
 * - `idle`: nothing has asked yet.
 * - `working`: being worked out, with nothing to show meanwhile.
 * - `ready`: `facets` is the list (empty when the model weighs nothing yet).
 * - `no-picks`: your library and wishlist hold nothing the catalog copy has.
 * - `no-baseline`: the device holds none of the ordinary titles your picks are compared with yet.
 */
export type SeekStatus = 'off' | 'idle' | 'working' | 'ready' | 'no-picks' | 'no-baseline';

export interface SeekOut {
  status: SeekStatus;
  /** What you seek out, strongest first. */
  facets: SeekFacet[];
  /** How many of your titles the model compared, and with how many ordinary ones. */
  picks: number;
  baseline: number;
  /** A fresh fit is on its way; what is shown stands until it lands. */
  updating: boolean;
}

interface Value extends SeekOut {
  /** A screen that shows the list is in front. Returns what to call when it no longer is. */
  want: () => () => void;
}

const blank = (status: SeekStatus): SeekOut => ({ status, facets: [], picks: 0, baseline: 0, updating: false });
const OFF = blank('off');
const IDLE = blank('idle');

const Ctx = createContext<Value | null>(null);

/** A beat after a reader comes to the front, so its own first frame is drawn before the reads start. */
const START_DELAY_MS = 250;

export function SeekOutProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();
  const { taxonomy } = useScores();
  const signedIn = auth.status === 'signedIn';
  const userId = auth.profile?.user.id ?? null;

  const [seek, setSeek] = useState<SeekOut>(IDLE);
  const [readers, setReaders] = useState(0);
  const want = useCallback(() => {
    setReaders((n) => n + 1);
    return () => setReaders((n) => n - 1);
  }, []);
  const wanted = readers > 0;

  // What a fit is made of. Each change is a new generation: a fit under way
  // for an older one stops at its next pause, and the next reader starts anew.
  // Declared before the effect that starts a fit, so it has run by then.
  const generation = useRef(0);
  /** The generation a fit was last started for: one start per generation, however often its reader comes and goes. */
  const started = useRef(-1);
  /** The key of the fit `seek` shows, when it is a fit of exactly today's picks. */
  const shownKey = useRef<string | null>(null);
  useEffect(() => {
    generation.current++;
  }, [db, signedIn, userId, taxonomy, auth.rowsRevision, catalog.revision]);

  const filling = catalog.filling;
  const rowsSyncing = auth.rowsSyncing;
  useEffect(() => {
    if (!SEEK_OUT_LIVE) return;
    if (!signedIn || !taxonomy) {
      shownKey.current = null;
      started.current = -1;
      setSeek(signedIn ? IDLE : OFF);
      return;
    }
    // Not on half a library or half a catalog copy: what stands, stands until both are whole.
    if (!wanted || filling || rowsSyncing) return;
    const mine = generation.current;
    if (started.current === mine) return;
    started.current = mine;
    const alive = () => generation.current === mine;
    // No cleanup: a reader leaving must not stop the fit (above). `alive` does, when the fit's inputs change.
    setTimeout(() => {
      if (!alive()) return;
      void workOut(db, taxonomy, alive, shownKey, setSeek).catch((e: unknown) => {
        if (e instanceof SliceCancelled || !alive()) return;
        console.warn('fandex_seek_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
        // The next visit tries again; what was on screen stays.
        started.current = -1;
        setSeek((s) => (s.status === 'working' ? IDLE : { ...s, updating: false }));
      });
    }, START_DELAY_MS);
  }, [db, signedIn, userId, taxonomy, wanted, filling, rowsSyncing, auth.rowsRevision, catalog.revision]);

  const value = useMemo<Value>(() => ({ ...seek, want }), [seek, want]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The list a model makes, with the sizes the screens quote. */
function listOf(model: PullModel, named: Map<string, ScoreFacet>, tax: Taxonomy): SeekList {
  let picks = 0;
  let baseline = 0;
  for (const m of model.media.values()) { picks += m.picks; baseline += m.baseline; }
  const facets = seekFacets(model, named, (f) => tax.tagCategoryOverrides.get(f.key) ?? f.category ?? 'other');
  return { v: SEEK_LIST_VERSION, facets, picks: Math.round(picks), baseline };
}

const shown = (list: SeekList, updating: boolean): SeekOut => ({ status: 'ready', facets: list.facets, picks: list.picks, baseline: list.baseline, updating });

async function workOut(
  db: ReturnType<typeof useSQLiteContext>, tax: Taxonomy, alive: () => boolean,
  shownKey: { current: string | null }, setSeek: (next: SeekOut | ((s: SeekOut) => SeekOut)) => void,
): Promise<void> {
  const started = Date.now();
  // What the device kept goes up first, after one small read: a start has a
  // queue of reads ahead of the questions below, and the list should not wait
  // behind them. The row is forgotten at sign-out, so it is this account's.
  const row = await storedPullFitRow(db);
  if (!alive()) return;
  const keptList = row ? parseSeekList(row.seek) : null;
  if (keptList) setSeek((s) => (s.status === 'ready' ? s : shown(keptList, true)));

  // Then the cheap question: is what is shown, or what was kept, a fit of
  // exactly these picks? If so no title is read at all.
  const picks = await pickWeights(db);
  if (!alive()) return;
  if (!picks.length) { shownKey.current = null; setSeek(blank('no-picks')); return; }
  const present = await baselinePresent(db);
  if (!alive()) return;
  if (!present) { shownKey.current = null; setSeek(blank('no-baseline')); return; }
  const key = pullFitKey(tax, pullSignature(picks, present, await baselineIdentity(db)));
  if (!alive()) return;
  if (key && shownKey.current === key) {
    // A fit an older generation started and never finished may have left the flag up.
    setSeek((s) => (s.updating ? { ...s, updating: false } : s));
    return;
  }
  const current = !!key && !!row && row.key === key && Date.now() - row.at <= PULL_FIT_MAX_AGE_MS;
  const log = (how: 'kept' | 'refitted' | 'fitted', list: SeekList, model?: PullModel) => console.log('fandex_seek', JSON.stringify({
    how, picks: picks.length, baseline: present, listed: list.facets.length, ...(model ? { weighed: model.beta.size, sweeps: model.sweeps } : {}), ms: Date.now() - started,
  }));
  // The list kept from exactly these picks, baseline and taxonomy, under a week old: it is the answer.
  if (current && keptList) {
    shownKey.current = key;
    setSeek(shown(keptList, false));
    log('kept', keptList);
    return;
  }
  // Any other kept list stands in until the fresh one lands. One title more barely moves it.
  setSeek((s) => (s.status === 'ready' ? { ...s, updating: true } : blank('working')));

  const [consumed, baseline] = await Promise.all([consumedTitles(db), storedBaseline(db).then((list) => baselineTitles(db, list))]);
  if (!alive()) return;
  // A fit kept from exactly these inputs without its list (the score's own path keeps one) is reused: only the counts are made again.
  const stored = current ? row?.fit : undefined;
  const named = new Map<string, ScoreFacet>();
  const model = await runSliced(buildPullModelSteps(consumed, baseline, tax, stored, named), { alive });
  if (!alive()) return;
  if (!model) {
    // A baseline, and picks, but no medium that has both.
    shownKey.current = null;
    setSeek(blank('no-baseline'));
    return;
  }
  const list = listOf(model, named, tax);
  shownKey.current = key;
  setSeek(shown(list, false));
  log(stored ? 'refitted' : 'fitted', list, model);
  if (key) void keepPullFit(db, key, model, list);
}

/**
 * What you seek out, for a screen that shows it. The screen being in front is
 * what asks for it: the first one to come up starts the work.
 */
export function useSeekOut(): SeekOut {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSeekOut must be used inside <SeekOutProvider>');
  const { want } = v;
  useFocusEffect(useCallback(() => want(), [want]));
  return v;
}
