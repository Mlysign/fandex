// Keeps the release reminders in step (lib/reminderScheduler.ts) and opens the
// title a tapped reminder names. Renders nothing. Mounted once, in the root
// layout, inside the providers it reads.
//
// It runs after the catalog syncs (new dates, a moved date), after your rows
// sync (a title wishlisted on another device), on a change of country (another
// release date) and on sign-in or sign-out. Never while your rows are still
// arriving: a half-synced wishlist would cancel reminders it is about to set.

import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef } from 'react';
import { useAuth } from '~/lib/AuthProvider';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { remindersAvailable, syncReminders } from '~/lib/reminderScheduler';

/** The response already acted on: the hook hands the last one back on every mount. */
let opened: string | null = null;

export function ReleaseReminders() {
  if (!remindersAvailable) return null;
  return <Runner />;
}

function Runner() {
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();
  const running = useRef<Promise<void>>(Promise.resolve());

  const signedIn = auth.status === 'signedIn';
  const settled = auth.status !== 'loading' && !auth.rowsSyncing;
  useEffect(() => {
    if (!settled) return;
    // One run at a time, each after the last: two at once would both schedule the same reminder.
    running.current = running.current.then(async () => {
      try {
        const run = await syncReminders(db, signedIn);
        if (run.scheduled || run.cancelled || run.seasonsFailed) console.log('reminders', run);
      } catch (e) {
        console.warn('reminders_failed', e instanceof Error ? e.message : String(e));
      }
    });
  }, [db, signedIn, settled, auth.rowsRevision, auth.region, catalog.revision, catalog.syncedAt]);

  const response = Notifications.useLastNotificationResponse();
  const nav = useRootNavigationState();
  useEffect(() => {
    if (!response || !nav?.key) return;
    const key = `${response.notification.request.identifier}@${response.notification.date}`;
    if (opened === key || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    opened = key;
    const url = response.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) router.push(url as never);
  }, [response, nav?.key]);

  return null;
}
