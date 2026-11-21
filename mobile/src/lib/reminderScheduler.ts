// Setting the reminders lib/releaseReminders.ts plans, on the phone itself
// (expo-notifications, scheduled alarms). Android only: the website has no
// notifications, and nothing here runs in a browser.
//
// Every run diffs what is planned against what is set, by identifier, and
// touches only this feature's own (RELEASE_PREFIX, SEASON_PREFIX). A kind whose
// list could not be read this time (the Worker's season dates failed to load)
// keeps the reminders it has: a failed request never cancels a reminder.

import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
import { getMeta, setMeta } from '~/lib/db';
import {
  localDay, planReminders, readReminderPrefs, RELEASE_PREFIX, SEASON_PREFIX, seasonStarts, wishlistReleases,
  type Reminder, type SeasonStart,
} from '~/lib/releaseReminders';

const CHANNEL = 'releases';
export const remindersAvailable = Platform.OS === 'android' || Platform.OS === 'ios';

/** What Android lets this app do: shown in Settings when it says no. */
export type ReminderPermission = 'granted' | 'denied' | 'undetermined';

export async function reminderPermission(): Promise<ReminderPermission> {
  if (!remindersAvailable) return 'denied';
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

let handlerSet = false;
/** A reminder that arrives with the app open shows as it would with the app closed. */
function setHandler(): void {
  if (handlerSet || !remindersAvailable) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

/** Cancel every reminder this feature set whose identifier starts with one of `prefixes`. */
async function cancelOwn(prefixes: string[]): Promise<number> {
  const set = await Notifications.getAllScheduledNotificationsAsync();
  const mine = set.filter((n) => prefixes.some((p) => n.identifier.startsWith(p)));
  await Promise.all(mine.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  return mine.length;
}

export interface ReminderRun { scheduled: number; cancelled: number; permission: ReminderPermission; seasonsFailed: boolean }

/** Set once Android has been asked on the app's own initiative: after that, only a switch in Settings asks again. */
const ASKED_KEY = 'notify_asked';

/**
 * Bring the phone's reminders in line with the plan. `signedIn` false cancels
 * them all: a signed-out phone has no wishlist. Asks Android for permission
 * the first time a reminder is wanted, and again when `ask` (a switch turned
 * on in Settings), never on every sync.
 */
export async function syncReminders(db: SQLiteDatabase, signedIn: boolean, opts: { ask?: boolean; now?: Date } = {}): Promise<ReminderRun> {
  const now = opts.now ?? new Date();
  const run: ReminderRun = { scheduled: 0, cancelled: 0, permission: 'denied', seasonsFailed: false };
  if (!remindersAvailable) return run;
  setHandler();
  const prefs = signedIn ? await readReminderPrefs(db) : { releases: false, seasons: false };
  const off = [...(prefs.releases ? [] : [RELEASE_PREFIX]), ...(prefs.seasons ? [] : [SEASON_PREFIX])];
  if (off.length) run.cancelled += await cancelOwn(off);
  if (!prefs.releases && !prefs.seasons) { run.permission = await reminderPermission(); return run; }

  run.permission = await reminderPermission();
  if (run.permission === 'undetermined' && (opts.ask || !(await getMeta(db, ASKED_KEY)))) {
    await setMeta(db, ASKED_KEY, '1');
    const asked = await Notifications.requestPermissionsAsync();
    run.permission = asked.granted ? 'granted' : asked.canAskAgain ? 'undetermined' : 'denied';
  }
  if (run.permission !== 'granted') return run;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Releases', importance: Notifications.AndroidImportance.DEFAULT });
  }

  const releases = prefs.releases ? await wishlistReleases(db, localDay(now)) : [];
  let seasons: SeasonStart[] | undefined = [];
  if (prefs.seasons) {
    try {
      seasons = await seasonStarts(db, now);
    } catch (e) {
      seasons = undefined;
      run.seasonsFailed = true;
      console.warn('reminder_seasons_failed', e instanceof Error ? e.message : String(e));
    }
  }
  const plan = planReminders({ releases, seasons: seasons ?? [], now });
  // The kinds this run read in full; a kind that failed keeps what it has.
  const owned = [...(prefs.releases ? [RELEASE_PREFIX] : []), ...(prefs.seasons && seasons ? [SEASON_PREFIX] : [])];
  const isOwned = (id: string) => owned.some((p) => id.startsWith(p));
  const wanted = new Map(plan.filter((r) => isOwned(r.identifier)).map((r) => [r.identifier, r]));

  const set = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of set) {
    if (!isOwned(n.identifier)) continue;
    const want = wanted.get(n.identifier);
    // Kept as it is when the same reminder says the same thing (a title may have changed language).
    if (want && n.content.title === want.title && n.content.body === want.body) { wanted.delete(n.identifier); continue; }
    if (!want) { await Notifications.cancelScheduledNotificationAsync(n.identifier); run.cancelled++; }
  }
  for (const r of wanted.values()) {
    await schedule(r);
    run.scheduled++;
  }
  return run;
}

/** One reminder. The same identifier replaces the one set before. */
function schedule(r: Reminder): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    identifier: r.identifier,
    content: { title: r.title, body: r.body, data: { url: r.url } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at, channelId: CHANNEL },
  });
}
