// The launch switch and the launch pages' words, in one place.
//
// The website's build (mobile/web/build.mjs) reads these through render.tsx,
// and the app reads them directly, so one edit changes both.
//
//   LAUNCHED        false: /app, /press, /whats-new and /delete-account are
//                   written and load by address, but they are `noindex`, out of
//                   the sitemap and linked from nowhere. true: indexed, in the
//                   sitemap, and linked from every page's footer.
//   PLAY_STORE_URL  empty: no Google Play badge and no "Get the app" link
//                   anywhere. Set it to the listing's address to show both.
//
// The Impressum's robots rules are not here and never follow this switch.

export const LAUNCHED: boolean = false;

export const PLAY_STORE_URL: string = '';

/** The three messages, one constant each so each can be swapped alone (wording is provisional). */
export const MESSAGE_TASTE = 'Rate your shows. Find your next book.';
export const MESSAGE_CALENDAR = "Everything you're waiting for, on one calendar.";
export const MESSAGE_NUMBERS = 'Your taste, in numbers.';

export const CONTACT_EMAIL = 'hello@fandex.org';

/** The launch pages, in footer order. The paths are the website's own addresses. */
export const LAUNCH_PAGES: { path: string; label: string }[] = [
  { path: '/app', label: 'The app' },
  { path: '/whats-new', label: "What's new" },
  { path: '/press', label: 'Press' },
  { path: '/delete-account', label: 'Delete account' },
];

/** The footer links: the launch pages once launched, nothing before. */
export function launchLinks(launched: boolean = LAUNCHED): { path: string; label: string }[] {
  return launched ? LAUNCH_PAGES : [];
}

/** Is there a Play listing to point at? */
export function hasPlayStore(url: string = PLAY_STORE_URL): boolean {
  return url.trim().length > 0;
}
