// What's new: the public list on fandex.org/whats-new, newest first.
//
// One entry per app version that changed something a person would notice.
// 1 to 3 lines each, in plain words: what you can do now, not how it was built.
// Versions that only changed things behind the scenes are left out.
// Add the new entry at the top when a version ships (mobile/app.json `version`).

export interface WhatsNewEntry {
  /** The app's version, as in mobile/app.json. */
  version: string;
  /** The day it shipped, YYYY-MM-DD. */
  date: string;
  /** 1 to 3 short lines. */
  lines: string[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '0.3.66',
    date: '2026-11-27',
    lines: [
      'A Recommendations page. It shows the titles that fit your taste most, then rows of titles chosen for the things you pick most often. Open it with See all on Home.',
      'Insights has a new section, "What you seek out". It lists the tags, people, studios and franchises you pick far more often than most people do.',
      'A title\'s page lists more of its tags.',
    ],
  },
  {
    version: '0.3.64',
    date: '2026-11-22',
    lines: [
      'You can connect your Steam account in Settings. Fandex then shows the games you own and your Steam wishlist.',
      'Your Steam profile\'s game details have to be public for that.',
    ],
  },
  {
    version: '0.3.62',
    date: '2026-11-21',
    lines: [
      'A reminder on the day the next episode of a show comes out, if you are up to date with it.',
      'You can turn it off in Settings. Reminders are in the Android app only.',
    ],
  },
  {
    version: '0.3.61',
    date: '2026-11-21',
    lines: [
      'Release reminders. The Android app tells you at 9:00 on the day something on your wishlist comes out.',
      'You also get one on the day a new season of a show starts.',
      'Each kind of reminder has its own switch in Settings.',
    ],
  },
  {
    version: '0.3.60',
    date: '2026-11-21',
    lines: [
      'One entry for each title, whatever language you search in.',
      'Titles are shown in the language of the country you picked.',
    ],
  },
  {
    version: '0.3.59',
    date: '2026-11-21',
    lines: [
      'One card for each book, not one for each edition.',
      'Rating a show no longer adds it to your Trakt watch history.',
    ],
  },
  {
    version: '0.3.58',
    date: '2026-11-15',
    lines: ['Your Fandex Scores are right from the start when you sign back in.'],
  },
  {
    version: '0.3.56',
    date: '2026-11-13',
    lines: ['An episode you tick in Up next shows as watched on the show\'s page straight away.'],
  },
  {
    version: '0.3.55',
    date: '2026-11-11',
    lines: ['Up next and the home screen widget move on to the next episode as soon as you tick one, even when Trakt is slow.'],
  },
  {
    version: '0.3.54',
    date: '2026-11-07',
    lines: ['Press and hold a card to see why it got its Fandex Score.'],
  },
];
