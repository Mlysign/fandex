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
  caughtUpShows, EPISODE_PREFIX, episodeStarts, KIND_PREFIX, localDay, planReminders, readReminderPrefs, RELEASE_PREFIX, SEASON_PREFIX,
  seasonStarts, wishlistReleases, type EpisodeStart, type Reminder, type ReminderKind, type ReminderPrefs, type SeasonStart, type WishlistRelease,
} from '~/lib/releaseReminders';
import { tmdbShowStatus } from '~/lib/tmdb';

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

export interface ReminderRun {
  scheduled: number; cancelled: number; permission: ReminderPermission; seasonsFailed: boolean; episodesFailed: boolean;
}

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
  const run: ReminderRun = { scheduled: 0, cancelled: 0, permission: 'denied', seasonsFailed: false, episodesFailed: false };
  if (!remindersAvailable) return run;
  setHandler();
  const prefs: ReminderPrefs = signedIn ? await readReminderPrefs(db) : { releases: false, seasons: false, episodes: false };
  const kinds = Object.keys(KIND_PREFIX) as ReminderKind[];
  const off = kinds.filter((k) => !prefs[k]).map((k) => KIND_PREFIX[k]);
  if (off.length) run.cancelled += await cancelOwn(off);
  if (kinds.every((k) => !prefs[k])) { run.permission = await reminderPermission(); return run; }

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
  let episodes: EpisodeStart[] | undefined = [];
  let episodesFailedFor = new Set<string>();
  if (prefs.episodes) {
    try {
      const got = await episodeStarts(db, now, async (id) => (await tmdbShowStatus(id)).nextToAir);
      episodes = got.starts;
      episodesFailedFor = got.failed;
    } catch (e) {
      episodes = undefined;
      run.episodesFailed = true;
      console.warn('reminder_episodes_failed', e instanceof Error ? e.message : String(e));
    }
  }
  // Without the season dates a first episode can't be told from its season's reminder: left for the next run.
  const episodesToPlan = (episodes ?? []).filter((e) => seasons || e.episode !== 1);
  const plan = planReminders({ releases, seasons: seasons ?? [], episodes: episodesToPlan, now });
  // The kinds this run read in full; a kind that failed keeps what it has, and
  // so does a show TMDB could not be asked about this time.
  const owned = [
    ...(prefs.releases ? [RELEASE_PREFIX] : []),
    ...(prefs.seasons && seasons ? [SEASON_PREFIX] : []),
    ...(prefs.episodes && episodes ? [EPISODE_PREFIX] : []),
  ];
  const keptShow = (id: string) => id.startsWith(EPISODE_PREFIX) && episodesFailedFor.has(id.slice(EPISODE_PREFIX.length).split(':')[0]);
  const isOwned = (id: string) => owned.some((p) => id.startsWith(p)) && !keptShow(id);
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

/**
 * Admin only (Settings → Admin): shows one reminder of each kind NOW, worded by
 * `planReminders` exactly as the real ones are, about titles from your own rows
 * (a wishlisted title, shows you watch, the next episode TMDB names). Their
 * identifiers carry no reminder prefix, so `syncReminders` never touches them.
 * Returns how many were shown.
 */
export async function sendTestReminders(db: SQLiteDatabase): Promise<number> {
  if (!remindersAvailable) return 0;
  setHandler();
  if ((await reminderPermission()) !== 'granted') throw new Error('Notifications are not allowed for Fandex.');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Releases', importance: Notifications.AndroidImportance.DEFAULT });
  }
  const now = new Date();
  const day = (n: number) => localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  const wish = await db.getFirstAsync<WishlistRelease>(
    `SELECT c.id, c.type, c.title, c.slug, c.release_date
       FROM item_state s JOIN catalog c ON c.id = s.media_item_id
      WHERE s.relation = 'wishlist' ORDER BY (c.release_date >= ?) DESC, c.release_date LIMIT 1`,
    [localDay(now)],
  );
  const shows = await caughtUpShows(db);
  const releases: WishlistRelease[] = wish ? [{ ...wish, release_date: day(1) }] : [];
  const seasons: SeasonStart[] = [];
  const episodes: EpisodeStart[] = [];
  const [epShow, seasonShow] = [shows[0], shows[1] ?? shows[0]];
  if (epShow) {
    const st = await tmdbShowStatus(epShow.tmdbId).catch(() => null);
    const next = st?.nextToAir ?? (st?.lastAired ? { season: st.lastAired.season, episode: st.lastAired.episode + 1 } : { season: 1, episode: 2 });
    episodes.push({ id: epShow.id, title: epShow.title, slug: epShow.slug, season: next.season, episode: next.episode, release_date: day(2) });
  }
  if (seasonShow) {
    const st = await tmdbShowStatus(seasonShow.tmdbId).catch(() => null);
    const last = st?.seasons.at(-1)?.season ?? 1;
    seasons.push({ id: seasonShow.id, title: seasonShow.title, slug: seasonShow.slug, season: last + 1, release_date: day(1) });
  }
  const plan = planReminders({ releases, seasons, episodes, now });
  for (const r of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: `test:${r.identifier}`,
      content: { title: r.title, body: r.body, data: { url: r.url } },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
    });
  }
  return plan.length;
}

/** One reminder. The same identifier replaces the one set before. */
function schedule(r: Reminder): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    identifier: r.identifier,
    content: { title: r.title, body: r.body, data: { url: r.url } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at, channelId: CHANNEL },
  });
}
