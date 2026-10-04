// Work the app does with no screen. Registered before the router starts
// (index.js), because Android can start this JavaScript with no activity at all.
//
// One task: the tick on the home-screen widget. The widget's Kotlin runs it
// (modules/up-next-widget → UpNextTickReceiver) and waits for it to finish, so
// the app is never opened. It calls the SAME markEpisodeWatched the Up next tab
// calls: Trakt, then the Worker, then this device, then what is next.
//
// There is no React here, so no provider has opened the database or loaded the
// session. This file does both for itself.

import { openDatabaseAsync } from 'expo-sqlite';
import { AppRegistry, Platform } from 'react-native';
import { setSessionToken } from '~/lib/api';
import { DATABASE_NAME, migrate } from '~/lib/db';
import { announceRowsChanged } from '~/lib/rowsBus';
import { secretGet, SESSION_KEY } from '~/lib/storage';
import { markEpisodeWatched } from '~/lib/upNext';
import { publishWidget } from '~/lib/widget';

interface TickData { id?: string; season?: number; episode?: number }

async function tick(data: TickData): Promise<void> {
  const { id, season, episode } = data;
  const db = await openDatabaseAsync(DATABASE_NAME);
  try {
    await migrate(db);
    try {
      if (typeof id !== 'string' || !Number.isInteger(season) || !Number.isInteger(episode)) throw new Error('not an episode');
      const session = await secretGet(SESSION_KEY);
      if (!session) throw new Error('signed out');
      setSessionToken(session);
      await markEpisodeWatched(db, { mediaItemId: id, season: season as number, episode: episode as number });
      announceRowsChanged();
      console.log('widget_tick', 'done');
    } catch (e) {
      // Whatever failed, a failed step wrote nothing after it (upNext.ts). The
      // row goes back to how it was, with its tick, so it can be tapped again.
      console.warn('widget_tick_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      await publishWidget(db);
    }
  } finally {
    await db.closeAsync().catch(() => undefined);
  }
}

if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask('FandexUpNextTick', () => tick);
}
