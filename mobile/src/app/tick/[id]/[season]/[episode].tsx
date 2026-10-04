// Where the home-screen widget's tick lands: fandex://tick/{show}/{season}/{episode}.
//
// The widget cannot mark an episode watched itself (the Trakt token and the
// write path live in the app), so its tick opens this screen, which does it and
// says what happened. One screen, one outcome: it never marks anything but the
// episode named in its own address.

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Screen, StateBlock } from '~/components/ui';
import { useAuth } from '~/lib/AuthProvider';
import { TraktAuthError } from '~/lib/trakt';
import { markEpisodeWatched } from '~/lib/upNext';

type State = { phase: 'working' } | { phase: 'done' } | { phase: 'failed'; detail: string };

export default function TickScreen() {
  const { id, season, episode } = useLocalSearchParams<{ id: string; season: string; episode: string }>();
  const router = useRouter();
  const db = useSQLiteContext();
  const auth = useAuth();
  const [state, setState] = useState<State>({ phase: 'working' });
  /** The effect can run twice; the episode must be logged once. */
  const started = useRef(false);

  const s = Number(season);
  const e = Number(episode);
  const valid = /^[0-9a-f-]{36}$/i.test(id ?? '') && Number.isInteger(s) && s > 0 && Number.isInteger(e) && e > 0;

  useEffect(() => {
    if (auth.status === 'loading' || started.current) return;
    started.current = true;
    if (!valid) { setState({ phase: 'failed', detail: 'That is not an episode.' }); return; }
    if (auth.status !== 'signedIn') { setState({ phase: 'failed', detail: 'Sign in first, on the You tab.' }); return; }
    markEpisodeWatched(db, { mediaItemId: id, season: s, episode: e })
      .then(() => { auth.rowsChanged(); setState({ phase: 'done' }); })
      .catch((err: unknown) => setState({
        phase: 'failed',
        detail: err instanceof TraktAuthError ? 'Trakt needs you to sign in again, on the You tab.'
          : err instanceof Error && /Network request failed/i.test(err.message) ? 'No connection. Nothing was marked.'
          : 'The episode was not marked. Nothing was changed.',
      }));
  }, [auth, db, id, s, e, valid]);

  const toUpNext = () => router.replace('/library');

  return (
    <Screen headed>
      <Stack.Screen options={{ title: 'Up next' }} />
      {state.phase === 'working' ? (
        <StateBlock loading title={`Marking S${s} E${e} watched`} />
      ) : state.phase === 'done' ? (
        <StateBlock title={`S${s} E${e} marked watched`} detail="It is on Trakt and in your library." action={{ label: 'Open Fandex', onPress: toUpNext }} />
      ) : (
        <StateBlock title="Could not mark that episode" detail={state.detail} action={{ label: 'Open Fandex', onPress: toUpNext }} />
      )}
    </Screen>
  );
}
