// Sends the app's usage counts (lib/usageCounts.ts) when the app goes to the
// background, and starts a visit when it comes back. Renders nothing. Mounted
// once, in the root layout, inside the database provider. Does nothing at all
// while the master switch is off, and nothing on the website.

import * as Notifications from 'expo-notifications';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { KIND_PREFIX } from '~/lib/releaseReminders';
import { remindersAvailable } from '~/lib/reminderScheduler';
import { attachUsage, flushUsage, usageActive, usageCountsOn } from '~/lib/usageCounts';

const PREFIXES = Object.values(KIND_PREFIX);

/** Whether one of the release reminders is set on the phone right now. Read only. */
async function hasReminder(): Promise<boolean> {
  if (!remindersAvailable) return false;
  const set = await Notifications.getAllScheduledNotificationsAsync();
  return set.some((n) => PREFIXES.some((p) => n.identifier.startsWith(p)));
}

export function UsageCounts() {
  if (!usageCountsOn) return null;
  return <Runner />;
}

function Runner() {
  const db = useSQLiteContext();
  useEffect(() => {
    attachUsage(db, hasReminder);
    if (AppState.currentState === 'active') usageActive();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') usageActive();
      else if (next === 'background') void flushUsage();
    });
    return () => sub.remove();
  }, [db]);
  return null;
}
