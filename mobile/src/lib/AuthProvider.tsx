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
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { api, ApiError, setSessionToken, type Profile } from '~/lib/api';
import { traktConfigured } from '~/lib/config';
import { clearState, syncState } from '~/lib/stateSync';
import { secretDelete, secretGet, secretSet } from '~/lib/storage';
import {
  clearTraktTokens, codeFromRedirect, exchangeCode, pollDeviceToken, requestDeviceCode, saveTraktTokens,
  startBrowserSignIn, TRAKT_REDIRECT_URI, type TraktTokens,
} from '~/lib/trakt';

const SESSION_KEY = 'fandex.session';

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
  signOut: () => Promise<void>;
  /** Pulling your rows from the Worker. */
  rowsSyncing: boolean;
  rowsError: string | null;
  /** Bumped whenever the device's copy of your rows changes, so a list can re-query. */
  rowsRevision: number;
  syncRows: () => void;
}

const Ctx = createContext<Auth | null>(null);

function signInMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'offline': return 'No connection. Try again when you are online.';
      case 'identity-rejected': return 'Trakt did not confirm the sign-in. Try again.';
      case 'provider-unavailable': return 'Trakt is not answering right now. Try again in a minute.';
      case 'rate-limited': return 'Too many attempts. Give it a minute.';
      // The Worker found that this Trakt account already belongs to a different
      // Fandex account. Joining two accounts is a decision the person has to
      // make, and the form for it is not in the app yet. Say so; never guess.
      case 'merge-required':
      case 'provider-taken':
        return 'This Trakt account already belongs to another Fandex account. Joining two accounts is not in the app yet.';
    }
  }
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

  const pullRows = useCallback(async (force = false) => {
    if (pulling.current) return;
    pulling.current = true;
    setRowsSyncing(true);
    setRowsError(null);
    try {
      const res = await syncState(db, force);
      if (res.changed) setRowsRevision((r) => r + 1);
    } catch (e) {
      // The old rows are still there: a failed pull writes nothing.
      setRowsError(e instanceof ApiError && e.code === 'offline'
        ? 'No connection. Showing what is already on this device.'
        : 'Could not refresh your library.');
    } finally {
      pulling.current = false;
      setRowsSyncing(false);
    }
  }, [db]);

  const forget = useCallback(async () => {
    setSessionToken(null);
    await Promise.all([secretDelete(SESSION_KEY), clearTraktTokens(), clearState(db)]);
    setProfile(null);
    setRowsRevision((r) => r + 1);
    setStatus('signedOut');
  }, [db]);

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
        void pullRows();
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
  }, [forget, pullRows]);

  const cancelTraktSignIn = useCallback(() => {
    flow.current++;
    setTrakt({ phase: 'idle' });
  }, []);

  /** Trakt said yes: keep its tokens here, trade the access token for a Fandex session, pull the rows. */
  const finish = useCallback(async (tokens: TraktTokens, alive: () => boolean) => {
    setTrakt({ phase: 'finishing' });
    await saveTraktTokens(tokens);
    const result = await api.signInWithTrakt(tokens.accessToken);
    if (!alive()) return;
    await secretSet(SESSION_KEY, result.token);
    setSessionToken(result.token);
    setProfile(await api.me().catch(() => null));
    setStatus('signedIn');
    setTrakt({ phase: 'idle' });
    void pullRows(true);
  }, [pullRows]);

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

  const signOut = useCallback(async () => {
    flow.current++;
    // Tell the Worker first, while the token still works. If that fails (no
    // connection) the device still forgets everything: signing out must not be
    // something that can fail.
    await api.logout().catch(() => undefined);
    await forget();
    setTrakt({ phase: 'idle' });
  }, [forget]);

  const syncRows = useCallback(() => void pullRows(true), [pullRows]);

  return (
    <Ctx.Provider value={{
      status, profile, trakt, startTraktSignIn, startTraktCodeSignIn, cancelTraktSignIn, signOut,
      rowsSyncing, rowsError, rowsRevision, syncRows,
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
