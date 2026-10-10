// Whose turn it is to run the app, in a browser.
//
// On a phone there is one app. In a browser there can be several tabs, and the
// app's database can be open in only ONE of them: expo-sqlite's web build keeps
// its files behind exclusive handles on a whole storage folder (wa-sqlite's
// AccessHandlePoolVFS), so a second tab failed with "Access Handles cannot be
// created if there is another open Access Handle" and never started. Seen on
// fandex.org on 2026-10-10, with the site already open in another tab.
//
// ⚠️ A different file name per tab does not help, and was tried: the lock is on
// the folder, taken when the library starts, before any file is named. An
// in-memory database does not help either, for the same reason.
//
// So one tab runs the app at a time, and says so. The turn is a Web Lock, which
// the browser releases by itself when the tab closes, reloads or crashes. A tab
// that finds the turn taken waits for it and offers "Use Fandex here"; the tab
// that has it gives it up by reloading, and then waits in turn. A static title
// page needs no turn: it is complete without the app.
//
// The real fix is a database that several tabs can share (one worker for all of
// them). Until then this is the honest version of a hard limit.

import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { DATABASE_NAME } from '~/lib/db';

const LOCK = 'fandex-app';
const CHANNEL = 'fandex-tabs';
/**
 * After being handed the turn, how long to wait before opening the database.
 * The tab that gave it up is being torn down, and its handles outlive its lock
 * by about a second (the same race a quick reload hits, see app/_layout.tsx).
 */
const HANDOVER_MS = 1800;

type LockManager = {
  request: (name: string, options: { ifAvailable?: boolean }, cb: (lock: unknown) => Promise<void> | void) => Promise<void>;
};

type Phase = 'pending' | 'waiting' | 'ready';

export type TabTurn =
  | { state: 'pending' }
  /** Another tab is running the app. `takeOver` asks it to stand down. */
  | { state: 'waiting'; takeOver: () => void }
  | { state: 'ready'; name: string };

/** What the message listener reads. It must see the current phase without being re-created. */
const current: { phase: Phase } = { phase: 'pending' };

export function useDatabaseName(): TabTurn {
  const [phase, setPhase] = useState<Phase>(Platform.OS === 'web' ? 'pending' : 'ready');
  useEffect(() => { current.phase = phase; }, [phase]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const locks = (globalThis.navigator as unknown as { locks?: LockManager } | undefined)?.locks;
    // A browser without Web Locks behaves as before: the first tab works.
    if (!locks) { setPhase('ready'); return; }

    let live = true;
    /** Hold the lock for the rest of this page's life. */
    const hold = () => new Promise<void>(() => {});
    void locks.request(LOCK, { ifAvailable: true }, (lock) => {
      if (lock) {
        if (live) setPhase('ready');
        return hold();
      }
      if (live) setPhase('waiting');
      // Queue for it. Granted when the tab that has it closes, reloads or stands down.
      void locks.request(LOCK, {}, async () => {
        await new Promise((r) => setTimeout(r, HANDOVER_MS));
        if (live) setPhase('ready');
        return hold();
      });
    });

    // The tab that has the turn stands down when another asks: it reloads, which
    // releases everything, and comes back up waiting behind the one that asked.
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
    if (channel) {
      channel.onmessage = (e) => {
        if (e.data === 'take-over' && current.phase === 'ready') globalThis.location?.reload();
      };
    }
    return () => { live = false; channel?.close(); };
  }, []);

  const takeOver = useCallback(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage('take-over');
    channel.close();
  }, []);

  return phase === 'ready' ? { state: phase, name: DATABASE_NAME } : phase === 'waiting' ? { state: phase, takeOver } : { state: phase };
}
