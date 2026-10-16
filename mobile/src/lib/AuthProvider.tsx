// Who is signed in on this device, and the Trakt sign-in that gets them there.
//
// Two tokens, and they are different things:
//
//   the Fandex session   proves to the Worker which ACCOUNT this device is.
//                        Minted by the Worker, revocable there.
//   the Trakt tokens     let this device talk to Trakt as the person. They stay
//                        here. The Worker sees the access token once, to ask
//                        Trakt whose it is.
//
// Signing in with Trakt is: the person approves at trakt.tv (in a browser tab
// that returns to the app, or by confirming a code), the device receives Trakt
// tokens, hands the access token to the Worker, and gets a Fandex session back.
// After that the device pulls the account's rows.

import { useSQLiteContext } from 'expo-sqlite';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { api, ApiError, setSessionToken, type PrefsPatch, type Profile } from '~/lib/api';
import { deviceRegion } from '~/lib/region';
import { traktConfigured } from '~/lib/config';
import { clearState, syncState } from '~/lib/stateSync';
import { onRowsChangedElsewhere } from '~/lib/rowsBus';
import { secretDelete, secretGet, secretSet, SESSION_KEY } from '~/lib/storage';
import { publishWidget } from '~/lib/widget';
import {
  clearTraktTokens, codeFromRedirect, exchangeCode, loadTraktTokens, pollDeviceToken, requestDeviceCode, saveTraktTokens,
  startBrowserSignIn, TRAKT_REDIRECT_URI, TraktAuthError, traktSignInMessage, type TraktTokens,
} from '~/lib/trakt';
import { clearUpNext } from '~/lib/upNext';
import { clearTraktSync, syncTrakt, traktSyncedAt, TraktSyncRefused, type TraktSyncResult } from '~/lib/traktSync';


export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export type TraktFlow =
  | { phase: 'idle' }
  | { phase: 'starting' }
  /** Waiting for the person to approve `userCode` at `verificationUrl`. */
  | { phase: 'waiting'; userCode: string; verificationUrl: string; expiresAt: number }
  | { phase: 'finishing' }
  | { phase: 'error'; message: string };

interface Auth {
  status: AuthStatus;
  /** Null while signed in but offline: the device knows it has a session and nothing more. */
  profile: Profile | null;
  trakt: TraktFlow;
  /** The platform's default: Trakt's page in a browser tab on Android, a code on the web. */
  startTraktSignIn: () => void;
  /** The code flow, for when the browser one does not come back. */
  startTraktCodeSignIn: () => void;
  cancelTraktSignIn: () => void;
  /**
   * Trade what Google sent back for a Fandex session (lib/google.ts). For an
   * account that is already signed in it adds Google as a way in. Throws with
   * the reason, in words, when it did not work.
   */
  finishGoogleSignIn: (idToken: string, secret: string) => Promise<void>;
  /** Sign in as a test account. Only against a Worker on this machine; anywhere else it reports that there is none. */
  devSignIn: (account: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Pulling your rows from the Worker. */
  rowsSyncing: boolean;
  rowsError: string | null;
  /** Bumped whenever the device's copy of your rows changes, so a list can re-query. */
  rowsRevision: number;
  syncRows: () => void;
  /** A screen wrote to the device's copy of your rows (a rating, the wishlist). */
  rowsChanged: () => void;
  traktSync: TraktSyncState;
  syncTraktNow: () => void;
  /** The country release dates and "where to watch" use: the account's, or the device's until one is chosen. */
  region: string;
  /** Save a preference to the account. Throws when it did not save. */
  savePrefs: (patch: PrefsPatch) => Promise<void>;
  /** Remove a way of signing in and the rows that came from it. Throws with the reason when refused. */
  disconnect: (provider: string) => Promise<void>;
  /** Delete the account and everything Fandex holds for it, then forget it on this device. */
  deleteAccount: () => Promise<void>;
}

export interface TraktSyncState {
  running: boolean;
  /** Why the last run did not finish, in words. Nothing was deleted. */
  error: string | null;
  /** Trakt dropped this device's sign-in. Only signing in to Trakt again fixes it. */
  needsSignIn: boolean;
  /**
   * Whether this device holds a Trakt sign-in; null until it has looked. An
   * account signed in with Google can have Trakt connected and still hold no
   * Trakt tokens here, because they never leave the device that got them.
   */
  onDevice: boolean | null;
  last: TraktSyncResult | null;
  /** Unix ms of the last run that finished. */
  syncedAt: number | null;
}

/** A sync on opening the app runs when the last one is older than this. */
const TRAKT_STALE_MS = 6 * 60 * 60 * 1000;
/** Coming back to the app asks for your rows again only when the last ask is older than this. */
const FOREGROUND_PULL_MS = 60 * 1000;
/** A build made with this set works out what a sync would change, logs the counts, and writes nothing. */
const TRAKT_SYNC_DRY_RUN = process.env.EXPO_PUBLIC_TRAKT_SYNC_DRY_RUN === '1';

const Ctx = createContext<Auth | null>(null);

function signInMessage(e: unknown, provider: 'Trakt' | 'Google' = 'Trakt'): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'offline': return 'No connection. Try again when you are online.';
      case 'identity-rejected': return `${provider} did not confirm the sign-in. Try again.`;
      case 'provider-unavailable': return `${provider} is not answering right now. Try again in a minute.`;
      case 'rate-limited': return 'Too many attempts. Give it a minute.';
      // The Worker found that this provider account already belongs to a
      // different Fandex account. Joining two accounts is a decision the person
      // has to make, and the form for it is not in the app yet. Say so; never guess.
      case 'merge-required':
      case 'provider-taken':
        return `This ${provider} account already belongs to another Fandex account. Joining two accounts is not in the app yet.`;
    }
  }
  // A request that never got an answer. The browser's own words for it ("Failed to fetch") help nobody.
  if (e instanceof TypeError) return `Could not reach ${provider}. Check your connection and try again.`;
  return e instanceof Error ? e.message : 'The sign-in did not finish.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [trakt, setTrakt] = useState<TraktFlow>({ phase: 'idle' });
  const [rowsSyncing, setRowsSyncing] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [rowsRevision, setRowsRevision] = useState(0);

  /** Bumped to abandon a sign-in in progress: a poll that wakes up later sees it and stops. */
  const flow = useRef(0);
  const pulling = useRef(false);
  /** When the last pull started, so coming back to the app does not ask every few seconds. */
  const lastPull = useRef(0);
  // Set once `forget` exists, below. A pull the Worker answers 401 means this
  // session was signed out on another device: "Sign out" there signs out every
  // device, and until this a running app only found out on its next start (SM77).
  const onRevoked = useRef<() => void>(() => undefined);

  const pullRows = useCallback(async (force = false) => {
    if (pulling.current) return;
    pulling.current = true;
    lastPull.current = Date.now();
    setRowsSyncing(true);
    setRowsError(null);
    try {
      const res = await syncState(db, force);
      if (res.changed) setRowsRevision((r) => r + 1);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onRevoked.current();
        return;
      }
      // The old rows are still there: a failed pull writes nothing.
      console.warn('rows_pull_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      setRowsError(e instanceof ApiError && e.code === 'offline'
        ? 'No connection. Showing what is already on this device.'
        : 'Could not refresh your library.');
    } finally {
      pulling.current = false;
      setRowsSyncing(false);
    }
  }, [db]);

  // ── Trakt, synced from this device ──
  const [traktSync, setTraktSync] = useState<TraktSyncState>({ running: false, error: null, needsSignIn: false, onDevice: null, last: null, syncedAt: null });
  const syncingTrakt = useRef(false);

  /** False when there is no Trakt on this device to sync from, so nothing ran. */
  const runTraktSync = useCallback(async (onlyIfStale: boolean): Promise<boolean> => {
    if (syncingTrakt.current) return true;
    if (!(await loadTraktTokens())) {
      // Signed in some other way, or this device has not signed in to Trakt yet:
      // there is no Trakt to sync from here.
      setTraktSync((s) => ({ ...s, onDevice: false }));
      return false;
    }
    const syncedAt = await traktSyncedAt(db);
    if (onlyIfStale && syncedAt && Date.now() - syncedAt < TRAKT_STALE_MS) {
      setTraktSync((s) => ({ ...s, syncedAt, onDevice: true }));
      return true;
    }
    syncingTrakt.current = true;
    setTraktSync((s) => ({ ...s, running: true, error: null, needsSignIn: false, onDevice: true }));
    try {
      const last = await syncTrakt(db, { dryRun: TRAKT_SYNC_DRY_RUN });
      setTraktSync({ running: false, error: null, needsSignIn: false, onDevice: true, last, syncedAt: await traktSyncedAt(db) });
      // The rows on the device changed, and a title new to the catalog is now in
      // the pool. Rows pulled from the Worker first count too: a rating made on
      // another device, when Trakt itself had nothing new.
      if (last.rowsPulled || last.itemsChanged + last.itemsRemoved + last.episodesChanged + last.episodesRemoved > 0) setRowsRevision((r) => r + 1);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setTraktSync((s) => ({ ...s, running: false }));
        onRevoked.current();
        return true;
      }
      // Whatever went wrong, nothing was deleted: see traktSync.ts.
      const needsSignIn = e instanceof TraktAuthError;
      const error =
        needsSignIn ? traktSignInMessage(e, '')
        : e instanceof TraktSyncRefused ? e.message
        : e instanceof ApiError && e.code === 'offline' ? 'No connection. Your library is unchanged.'
        : e instanceof ApiError && e.code === 'budget-exhausted' ? 'Fandex cannot save more changes until tomorrow.'
        : 'The Trakt sync did not finish. Your library is unchanged.';
      console.warn('trakt_sync_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      setTraktSync((s) => ({ ...s, running: false, error, needsSignIn }));
    } finally {
      syncingTrakt.current = false;
    }
    return true;
  }, [db]);

  const forget = useCallback(async () => {
    setSessionToken(null);
    await Promise.all([secretDelete(SESSION_KEY), clearTraktTokens(), clearState(db), clearTraktSync(db), clearUpNext(db)]);
    setTraktSync({ running: false, error: null, needsSignIn: false, onDevice: false, last: null, syncedAt: null });
    setProfile(null);
    setRowsRevision((r) => r + 1);
    setStatus('signedOut');
  }, [db]);
  useEffect(() => { onRevoked.current = () => void forget(); }, [forget]);

  // On start: is there a session, and is it still good?
  useEffect(() => {
    let live = true;
    (async () => {
      const token = await secretGet(SESSION_KEY);
      if (!live) return;
      if (!token) {
        setStatus('signedOut');
        return;
      }
      setSessionToken(token);
      try {
        const me = await api.me();
        if (!live) return;
        setProfile(me);
        setStatus('signedIn');
        // The Trakt sync pulls the rows itself first, so it replaces the plain
        // pull when there is a Trakt to sync and it is due.
        void pullRows().then(() => runTraktSync(true));
        // A widget placed before this build, or after the data was cleared, has no rows yet.
        void publishWidget(db);
      } catch (e) {
        if (!live) return;
        if (e instanceof ApiError && e.status === 401) {
          // Revoked (signed out on another device) or the account is gone.
          await forget();
        } else {
          // Offline, or the Worker is down. The session may well still be good,
          // and the library on this device is still worth showing.
          setStatus('signedIn');
        }
      }
    })();
    return () => { live = false; };
  }, [forget, pullRows, runTraktSync]);

  const cancelTraktSignIn = useCallback(() => {
    flow.current++;
    setTrakt({ phase: 'idle' });
  }, []);

  /** Trakt said yes: keep its tokens here, trade the access token for a Fandex session, pull the rows. */
  const finish = useCallback(async (tokens: TraktTokens, alive: () => boolean) => {
    setTrakt({ phase: 'finishing' });
    // The Worker first, the tokens second. Since an account can add Trakt while
    // signed in, the Worker can now say "that Trakt belongs to another account".
    // Tokens kept from a refused sign-in would sync that other person's Trakt
    // into this account on the next start.
    const result = await api.signInWithTrakt(tokens.accessToken);
    if (!alive()) return;
    await saveTraktTokens(tokens);
    await secretSet(SESSION_KEY, result.token);
    setSessionToken(result.token);
    setProfile(await api.me().catch(() => null));
    setStatus('signedIn');
    setTrakt({ phase: 'idle' });
    void pullRows(true).then(() => runTraktSync(false));
  }, [pullRows, runTraktSync]);

  const startTraktBrowserSignIn = useCallback(() => {
    if (!traktConfigured()) {
      setTrakt({ phase: 'error', message: 'Trakt sign-in is not set up in this build.' });
      return;
    }
    const mine = ++flow.current;
    const alive = () => flow.current === mine;
    setTrakt({ phase: 'starting' });

    (async () => {
      try {
        const asked = await startBrowserSignIn();
        const result = await WebBrowser.openAuthSessionAsync(asked.url, TRAKT_REDIRECT_URI);
        if (!alive()) return;
        // The person closed the tab. Not an error: they are back where they started.
        if (result.type !== 'success') { setTrakt({ phase: 'idle' }); return; }
        const code = codeFromRedirect(result.url, asked.state);
        if (!code) {
          setTrakt({ phase: 'error', message: 'Trakt did not confirm the sign-in. Try again, or use a code instead.' });
          return;
        }
        setTrakt({ phase: 'finishing' });
        await finish(await exchangeCode(code, asked.verifier), alive);
      } catch (e) {
        if (alive()) setTrakt({ phase: 'error', message: signInMessage(e) });
      }
    })();
  }, [finish]);

  const startTraktCodeSignIn = useCallback(() => {
    if (!traktConfigured()) {
      setTrakt({ phase: 'error', message: 'Trakt sign-in is not set up in this build.' });
      return;
    }
    const mine = ++flow.current;
    const alive = () => flow.current === mine;
    setTrakt({ phase: 'starting' });

    (async () => {
      try {
        const code = await requestDeviceCode();
        if (!alive()) return;
        const expiresAt = Date.now() + code.expiresIn * 1000;
        setTrakt({ phase: 'waiting', userCode: code.userCode, verificationUrl: code.verificationUrl, expiresAt });

        let interval = Math.max(1, code.interval) * 1000;
        while (alive() && Date.now() < expiresAt) {
          await new Promise((r) => setTimeout(r, interval));
          if (!alive()) return;
          const poll = await pollDeviceToken(code.deviceCode);
          if (!alive()) return;

          if (poll.state === 'pending') continue;
          if (poll.state === 'slow-down') { interval += 2000; continue; }
          if (poll.state === 'denied') { setTrakt({ phase: 'error', message: 'The sign-in was declined on Trakt.' }); return; }
          if (poll.state === 'expired') break;

          await finish(poll.tokens, alive);
          return;
        }
        if (alive()) setTrakt({ phase: 'error', message: 'The code expired before it was approved. Start again for a new one.' });
      } catch (e) {
        if (alive()) setTrakt({ phase: 'error', message: signInMessage(e) });
      }
    })();
  }, [finish]);

  // A browser tab has no app address for Trakt to send the person back to, so
  // the web build signs in with a code.
  const startTraktSignIn = Platform.OS === 'web' ? startTraktCodeSignIn : startTraktBrowserSignIn;

  // Google has no flow to track here: the page left for Google and this is a
  // fresh page that came back (app/auth/google.tsx), holding what Google sent.
  const finishGoogleSignIn = useCallback(async (idToken: string, secret: string) => {
    let result;
    try {
      result = await api.signInWithGoogle(idToken, secret);
    } catch (e) {
      throw new Error(signInMessage(e, 'Google'));
    }
    await secretSet(SESSION_KEY, result.token);
    setSessionToken(result.token);
    setProfile(await api.me().catch(() => null));
    setStatus('signedIn');
    // An account that also has Trakt on this device keeps syncing it; one that does not has nothing to sync.
    void pullRows(true).then(() => runTraktSync(true));
  }, [pullRows, runTraktSync]);

  /**
   * Sign in as a test account, on a developer's Worker (worker/src/devLogin.ts).
   * No Trakt tokens are kept, on purpose: with none, a rating has nowhere to go
   * but the local database, which is the point of the account.
   */
  const devSignIn = useCallback(async (account: string) => {
    setTrakt({ phase: 'finishing' });
    try {
      await clearTraktTokens();
      const result = await api.devSignIn(account);
      await secretSet(SESSION_KEY, result.token);
      setSessionToken(result.token);
      setProfile(await api.me().catch(() => null));
      setStatus('signedIn');
      setTrakt({ phase: 'idle' });
      // Its Trakt tokens were cleared above, so Settings can say so at once.
      setTraktSync((s) => ({ ...s, onDevice: false }));
      void pullRows(true);
    } catch (e) {
      setTrakt({ phase: 'error', message: e instanceof ApiError && e.status === 404 ? 'This Worker has no test accounts. Start it with DEV_LOGIN=1 in .dev.vars.' : 'The test sign-in did not work.' });
    }
  }, [pullRows]);

  const signOut = useCallback(async () => {
    flow.current++;
    // Tell the Worker first, while the token still works. If that fails (no
    // connection) the device still forgets everything: signing out must not be
    // something that can fail.
    await api.logout().catch(() => undefined);
    await forget();
    setTrakt({ phase: 'idle' });
  }, [forget]);

  const fallbackRegion = useMemo(deviceRegion, []);
  const region = profile?.user.country ?? fallbackRegion;

  const savePrefs = useCallback(async (patch: PrefsPatch) => {
    setProfile(await api.savePrefs(patch));
  }, []);

  const disconnect = useCallback(async (provider: string) => {
    const out = await api.disconnect(provider);
    // The old token died with the disconnect. The answer carries its replacement.
    await secretSet(SESSION_KEY, out.token);
    setSessionToken(out.token);
    if (provider === 'trakt') {
      await Promise.all([clearTraktTokens(), clearTraktSync(db), clearUpNext(db)]);
      setTraktSync({ running: false, error: null, needsSignIn: false, onDevice: false, last: null, syncedAt: null });
    }
    setProfile(await api.me().catch(() => null));
    await pullRows(true);
  }, [db, pullRows]);

  const deleteAccount = useCallback(async () => {
    flow.current++;
    await api.deleteAccount();
    await forget();
    setTrakt({ phase: 'idle' });
  }, [forget]);

  const syncRows = useCallback(() => void pullRows(true), [pullRows]);
  // The Sync button on an account with Trakt. On a device that has not signed in
  // to Trakt there is nothing to sync from here, and the button used to do
  // nothing at all, not even fetch what other devices had saved (SM77).
  const syncTraktNow = useCallback(() => {
    void runTraktSync(false).then((ran) => { if (!ran) void pullRows(true); });
  }, [runTraktSync, pullRows]);
  const rowsChanged = useCallback(() => setRowsRevision((r) => r + 1), []);

  // The widget's tick writes your rows with no screen mounted. When the app is
  // open behind it, this is how the lists find out.
  useEffect(() => onRowsChangedElsewhere(rowsChanged), [rowsChanged]);

  // Back on screen: ask whether another device changed your rows. The first
  // question is one small request and fetches nothing when the answer is no,
  // and it runs at most once a minute, because in a browser this fires on every
  // switch back to the tab. Before this, a running app saw another device's
  // ratings only after a restart (SM77).
  useEffect(() => {
    if (status !== 'signedIn') return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || Date.now() - lastPull.current < FOREGROUND_PULL_MS) return;
      void pullRows().then(() => runTraktSync(true));
    });
    return () => sub.remove();
  }, [status, pullRows, runTraktSync]);

  // Hand the widget its rows again once the app has left the screen.
  //
  // ⚠️ Not tidiness. Android DEFERS a widget update sent while the launcher is
  // hidden, which is whenever this app is in front, and on this launcher the
  // deferred frame did not replace the old one: the rows changed and the taps
  // did not. After the app had been force-stopped or updated (either cancels
  // every tap the widget had registered) the widget showed the right episodes
  // and every tap on it failed, with nothing in any log but the launcher's
  // generic "cannot send pending intent". A frame sent while the launcher is
  // showing is applied at once, so one is sent a moment after leaving.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sub = AppState.addEventListener('change', (next) => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (next === 'background') timer = setTimeout(() => void publishWidget(db), 1500);
    });
    return () => { sub.remove(); if (timer) clearTimeout(timer); };
  }, [db]);

  return (
    <Ctx.Provider value={{
      status, profile, trakt, startTraktSignIn, startTraktCodeSignIn, cancelTraktSignIn, finishGoogleSignIn, devSignIn, signOut,
      rowsSyncing, rowsError, rowsRevision, syncRows, rowsChanged, traktSync, syncTraktNow,
      region, savePrefs, disconnect, deleteAccount,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): Auth {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
