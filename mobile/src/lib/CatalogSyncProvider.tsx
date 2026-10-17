// Runs the catalog sync once when the app opens and tells the screens how it
// is going. One sync at a time, app-wide: two overlapping syncs would both
// advance the same cursor.

import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '~/lib/api';
import { useAuth } from '~/lib/AuthProvider';
import { lastSyncedAt, resetCatalog, syncCatalog } from '~/lib/catalogSync';
import { catalogCount } from '~/lib/db';
import { fillRegionalDates, pointDatesAt } from '~/lib/localDates';

export type SyncState = 'idle' | 'syncing' | 'done' | 'error';

interface CatalogSync {
  state: SyncState;
  /** Titles on the device right now. */
  total: number;
  /** Titles written by the sync in progress (or the last one). */
  written: number;
  /** Why the last sync failed, in words a person can act on. */
  error: string | null;
  /** Unix ms of the last sync that finished. */
  syncedAt: number | null;
  /** Bumped whenever the catalog's contents change, so a list can re-query. */
  revision: number;
  sync: () => void;
  resync: () => void;
}

const Ctx = createContext<CatalogSync | null>(null);

function describe(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'offline') return 'No connection. Showing what is already on this device.';
    return `The catalog server answered ${e.status || e.code}.`;
  }
  return e instanceof Error ? e.message : 'The sync failed.';
}

export function CatalogSyncProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [state, setState] = useState<SyncState>('idle');
  const [total, setTotal] = useState(0);
  const [written, setWritten] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const running = useRef(false);

  const run = useCallback(async (fromScratch: boolean) => {
    if (running.current) return;
    running.current = true;
    setState('syncing');
    setError(null);
    setWritten(0);
    try {
      if (fromScratch) {
        await resetCatalog(db);
        setTotal(0);
        setRevision((r) => r + 1);
      }
      const result = await syncCatalog(db, (p) => {
        setWritten(p.written);
        setTotal(p.total);
        // Lists refresh as pages land, so a first sync fills in as it goes.
        if (p.written) setRevision((r) => r + 1);
      });
      setTotal(result.total);
      setSyncedAt(await lastSyncedAt(db));
      setState('done');
    } catch (e) {
      // Whatever landed before the failure stays. The device keeps working
      // from its copy, which is the point of having one.
      setTotal(await catalogCount(db).catch(() => 0));
      setError(describe(e));
      setState('error');
    } finally {
      running.current = false;
    }
  }, [db]);

  useEffect(() => {
    let live = true;
    (async () => {
      const [n, at] = await Promise.all([catalogCount(db), lastSyncedAt(db)]);
      if (!live) return;
      setTotal(n);
      setSyncedAt(at);
      void run(false);
    })();
    return () => { live = false; };
  }, [db, run]);

  // Writing state for a title puts it in the pool, so a change to your rows can
  // mean a title this device does not hold yet. One delta request finds out.
  const { rowsRevision } = useAuth();
  const seenRows = useRef(rowsRevision);
  useEffect(() => {
    if (seenRows.current === rowsRevision) return;
    seenRows.current = rowsRevision;
    void run(false);
  }, [rowsRevision, run]);

  // Every film's date in the country you chose (lib/localDates.ts): pointed at
  // that country at once, from what this device already knows, then the films
  // it does not know yet are asked about. After every sync, because a sync
  // brings new films, and on a change of country.
  const { region } = useAuth();
  const wantedRegion = useRef(region);
  // Declared before the effect that reads it, so it runs first.
  useEffect(() => { wantedRegion.current = region; }, [region]);
  const dating = useRef(false);
  useEffect(() => {
    if (state === 'syncing' || dating.current) return;
    dating.current = true;
    (async () => {
      // A change of country while a run is under way is picked up when it ends.
      let done: string | null = null;
      while (done !== wantedRegion.current) {
        const r: string = wantedRegion.current;
        try {
          if (await pointDatesAt(db, r)) setRevision((v) => v + 1);
          if ((await fillRegionalDates(db, r)) > 0) setRevision((v) => v + 1);
        } catch (e) {
          // The worldwide date stays where nothing better is known.
          console.warn('local_dates_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
        }
        done = r;
      }
      dating.current = false;
    })();
  }, [db, region, state, syncedAt]);

  const sync = useCallback(() => void run(false), [run]);
  const resync = useCallback(() => void run(true), [run]);

  return (
    <Ctx.Provider value={{ state, total, written, error, syncedAt, revision, sync, resync }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCatalogSync(): CatalogSync {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCatalogSync must be used inside <CatalogSyncProvider>');
  return v;
}
