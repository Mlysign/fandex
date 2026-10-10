# The Fandex app

_Phase 2 of [app-plan.md](app-plan.md), started 2026-10-04. This is the reference for `mobile/`:
what is built, how it is put together, and what comes next. The Worker it talks to is
[worker.md](worker.md)._

## What is built

An Expo app (SDK 57, React Native 0.86, expo-router) that runs as an Android app and, from the same
code, in a browser.

| Screen | Does | Data from |
|---|---|---|
| Home (`/`) | The type filter, then rails: Up next, Recommended for you, Popular right now, Upcoming. A guest panel when signed out. | Worker `/v1/calendar` (four months) and `/v1/lookup`, on-device SQLite, Trakt for Up next |
| Search (`/discover`) | One field, one grid of poster cards, four sorts. Typing searches the device at once and the databases a moment later, merged. | On-device SQLite, TMDB direct, Worker `/v1/search/games` |
| Wishlist (`/wishlist`) | Three tabs: Wishlist, Progress, Library. A grid with search within, five sorts and month dividers by release date; Progress is the next episode per show with a tick. Asks for sign-in when signed out. | On-device SQLite; Trakt for Progress |
| Calendar (`/calendar`) | A month grid that fits the screen, a day's titles in a rail under it, three sources (wishlist, library, popular), a list view, swipe between months. | Worker `/v1/calendar`, on-device SQLite |
| Item page | Art, dates, ratings, description, people, platforms, where to watch, tags, links. Signed in: your Fandex Score with the facets that made it, rate it 1 to 10 (tap the rating again to clear it), wishlist it, remove it from the library. | Worker `/v1/items`, on-device SQLite, Trakt |
| You (`/profile`) | Who you are, three counts, rows to your pages, Sign out, recently added, coming up, a rail of recommendations. Signed out it is the sign-in card. | On-device SQLite, Worker `/v1/me` |
| Insights (`/insights`) | Your taste in numbers, from the rows on the device: overview, how you rate, the spread per medium, taste by era, you against the crowd, how you rate tags, people and studios, who turns up most. | On-device SQLite |
| Tag, person, studio (`/tag/{key}`, `/person/{key}`, `/studio/{key}`) | What it is, the crowd's average and yours, and every title in the catalog that carries it. Reached from the item page's tags, cast and facts. | On-device SQLite |
| Settings (`/settings`) | Connected accounts (sync Trakt, disconnect any of them), country, default types, your platforms, the account, download and delete, the home-screen widget, what the device holds, and for an admin the links to `/dev`. Not there: Import, joining accounts ([app-parity.md](app-parity.md)). | Worker `/v1/me`, `/v1/me/prefs`, `/v1/me/identities/{provider}`, `/v1/me/export`, Trakt, on-device SQLite |
| Admin (`/dev/users`, `/dev/scoring`) | Who is registered and what they hold. The scoring engine's weights with an on-device preview, and the taxonomy: categories, the tag table (category, spellings, shown name), franchises (members, bundles, suggestions). An admin only: anybody else sees "Nothing here". | Worker `/v1/admin/*`, `/v1/taxonomy`, on-device SQLite |
| Home-screen widget | Up next, on the home screen: the next episode per show. Tapping a show opens its page. The tick marks the episode watched in the background, without opening the app, and the row moves on. | Rows the app hands it |

Opening a calendar card or a search result goes through `/open/{source}/{type}/{id}`, which asks the
Worker to resolve the provider id (fetching the title if nobody holds it) and then replaces itself
with the item page, so Back returns to the list.

### What was verified, and what was not

⚠️ **The screens were rebuilt on 2026-10-10 to match the old site, and nothing below has been re-run since.** That pass was looked at signed out, in a browser. No APK was built from it, and no signed-in screen was seen: [app-parity.md](app-parity.md), "Not checked".

Everything below ran on Nils's Pixel 8 on 2026-10-04, from the release APK, against the live Worker
and his real Trakt account. The signed-out screens were also run in a browser.

| What | Result |
|---|---|
| First catalog sync, calendar, search, browse, item page, Back | Work. 4,559 titles on the device. |
| Sign in through Trakt's page in a browser tab | Works: back in the app, signed in, library present. |
| Trakt sync | First as a test run that writes nothing: 1,217 watched and 12,396 episodes matched the seeded rows exactly. The real run removed one watchlist row Trakt no longer had and updated 86 episodes with a later play. A second run found nothing to do. |
| Wishlist, rate, clear the rating, remove from the library | Run on one unreleased game (Fandex only) and one unreleased film (written to Trakt), then undone. A Trakt sync afterwards found the account exactly as before. |
| Up next | Lists the next episode per show, and agrees with Trakt's own home-screen widget. |
| The widget | Added from the You tab through the launcher's own sheet. It shows the same shows as the Up next tab, and tapping one opens that show's page, including after a reinstall and a force-stop. The background tick was run from a killed process with a made-up show id: the task started, opened the database, read the session and failed where it should (no such show), in about a second, with the launcher still in front. Nils then ticked real episodes on it: the first was marked, the next stuck at "Marking…" (the two faults under "How it is put together"), and after the fix two ticks in a row ran with the app open behind the launcher and the library untouched. |
| Fandex Score | The profile builds on the phone in 280 ms from 1,680 rated titles (15,243 facets with an opinion, the site's exact figure). Scores show on Browse, the wishlist and the item page with its breakdown. `scripts/probe-app-score.mjs` compared the app's maths with the site's over the same account: **4,559 of 4,559 titles identical**. |

**Real ticks were Nils's to run, and he ran them** (2026-10-04): in the app, and on the widget in the background, several in a row, with the row moving on and the ticked show moving to the top.
⚠️ **Not run:** the code sign-in
since it was reworked ("Use a code instead", the prefilled link, tap to copy), "Sign in to Trakt
again" after Trakt drops a token, and a Trakt token refresh (a token lasts a day; none had expired).

The Trakt app is "Release Calendar" at `developer.trakt.tv/apps` (not under trakt.tv Settings any
more), and editing it needs GitHub connected there, which Nils did. ⚠️ **Trakt saves a
custom-scheme redirect with an "Insecure redirect URIs" warning**: any app on the phone can claim
`fandex://`. PKCE is what makes that tolerable, since a stolen code is useless without the
verifier. The fix Trakt asks for is an `https://` redirect backed by verified App Links, which
needs an `assetlinks.json` on a domain and the release signing certificate. Do it before the app
is on the Play Store, not before.

### Driving the phone from a session

The helpers that did the above are not in the repo (they hold a session's paths), so this is what
they do. Every tap is found by its text in a `uiautomator dump` and is made only when
`dumpsys window` says `org.fandex.app` has focus: a blind coordinate tap once landed three taps on
the home screen and in the Google app. `adb install` hangs without output while Play Protect asks
"App zum Sicherheitsscan senden?"; the install script answers "Nicht senden", found the same way.
The bundle task does not see an environment variable as an input, so a build that changes one
re-runs it by name: `gradlew :app:createBundleReleaseJsAndAssets --rerun assembleRelease`.
`EXPO_PUBLIC_TRAKT_SYNC_DRY_RUN=1` at build time makes the Trakt sync log what it would change and
write nothing; that is how the sync was proven before it was allowed to delete.

## How it is put together

- **The screens are ports of the old site's components**, not designs of their own: `src/components/kit.tsx`, `cards.tsx`, `SubBar.tsx`, `AppNav.tsx` and `UpNext.tsx` each name the file they came from, and their numbers are that file's. What is and is not at parity is [app-parity.md](app-parity.md).
- **Every screen is a child of `src/app/(tabs)/_layout.tsx`**, the item page and Settings too. That layout draws the navigation around the navigator (a bar at the bottom under 768 px, across the top from there) and switches the navigator's own tab bar off. A screen outside that folder has no navigation. ⚠️ These screens stay mounted, so one that takes an address parameter has to reset itself when the parameter changes: the item screen clears its item at the start of each load.
- **A card's state is one query for the whole list** (`lib/cards.ts`, `useCardStates`), and its two buttons go through the item page's write path. A card for a title nobody holds yet (a calendar or search result) asks the Worker to find or fetch it first.
- **The type filter is one choice for the whole app**, kept in the `meta` table under the site's own key, `rr_type_filter` (`lib/typeFilter.tsx`).
- **A browser check proves nothing about the Android build.** The same component runs on both
  and a prop one accepts can crash the other: `accessibilityRole="navigation"` is fine on the web
  and killed the app at launch on the phone, with tsc, the tests and the site all green
  (`AppNav.tsx` sets it on the web only). A change to a shared component is not checked until an
  APK with it has opened on the device.
- **A data attribute is written `dataSet={{ item: 'grid' }}`, never `data-item="grid"`.**
  react-native-web keeps a bare `data-*` prop in the server render and drops it in the browser,
  so the static page gets its layout and the running app silently does not. `part()` in
  `components/itemLayout.ts` is the helper.
- **Every write transaction goes through `inTransaction` (`lib/db.ts`), never
  `db.withTransactionAsync` directly.** expo-sqlite's helper is a BEGIN and a COMMIT on the one
  shared connection, and nothing stops a second caller starting in between: its BEGIN fails, its
  ROLLBACK cancels the first caller's work, and that one then dies with "cannot rollback - no
  transaction is active". The catalog download and the pull of your rows overlap in any tab or
  install that is still downloading, and what the screen showed was "Could not refresh your
  library" over 0 titles. `inTransaction` queues them.
- **A screen that shows your rows must say when they are still arriving.** A fresh tab or a new
  sign-in has an empty copy for some seconds. Insights said "No rated items" and the episode
  tracker said "0 of 19 watched" in that window, and a tick made from the second one would have
  been a second play on Trakt. `auth.rowsSyncing` is the flag; the tracker disables its ticks on
  it. Its sibling: after a failed write, read the device again. Putting back a snapshot taken
  before the request paints over rows that arrived while it was out.
- **Where a title can be watched or played is its own table, filled per country** (`lib/platforms.ts`,
  `item_platform`). The Worker's `/v1/catalog/platforms?region=` answers for the whole pool at once;
  the device asks once a day and again when the account's country changes, because a streaming
  line-up belongs to a country. Names become the site's platform keys (`@/lib/platformKeys`) on the
  device. The filter sheet's "Available on" and the Settings picker both read `usePlatformIndex()`,
  which is null until the copy is read: treat null as "not known yet", never as "on nothing".
- **A show's episodes come from two places.** The Worker's `/v1/shows/{id}/episodes` holds the
  seasons, and episode lists only for seasons somebody opened on the old site. For the rest the
  item page asks TMDB from the device when a season is opened (`tmdbSeasonEpisodes`), which is
  when the site asked. How many you have watched is counted from your own rows, never from the
  episode list, so a season whose list is not loaded still reads right.
- **`mobile/` is its own package.** Excluded from the site's `tsconfig.json`, eslint and Docker
  context. CI runs `tsc` and the tests as the `app` job.
- **Two import prefixes.** `~/…` is the app's own `mobile/src`. `@/…` is the SITE's `src`, one
  directory up, so the app can import the site's pure modules unchanged (`metro.config.js` and
  `tsconfig.json` both map it). Today that is `normalize.ts` and `countries.ts`. A site module
  imported here must not reach `@/lib/db` or anything Node-only: the Worker's rule.
- **The item page is two files, and the split is the website's.** `src/components/ItemPage.tsx`
  is the title as everybody sees it and knows nothing about who is looking: no database, no
  session, no router. `src/app/item/[id].tsx` loads the item and passes what is yours (your state,
  your score, the rating row) in as `personal`. The website renders `ItemPage` alone to HTML, so
  anything device-only imported there breaks that build. `mobile/ssr-probe/` is the proof it
  renders on a server, and where its CPU cost was measured (docs/app-plan.md, "The website").
  The screen answers two addresses: `/item/{id}`, the app's own, and `/{type}/{slug}`, the public
  one (`src/app/[type]/[slug].tsx` re-exports it). On the website it may start under a static
  copy of the same page and removes that copy once the item is on screen (`src/lib/prerender.ts`).
- **The device holds a copy of the scoring pool** in SQLite (`expo-sqlite`, also on the web).
  `catalogSync.ts` pulls the Worker's delta a page at a time and advances its cursor in the same
  transaction that writes the page, so a sync that dies half way resumes from the last page that
  landed whole. A first sync is about thirty requests; a later one is one request that usually
  returns nothing. If the device ends up holding more titles than the Worker's pool, a title was
  removed upstream and the sync starts over.
- **The device holds a copy of your rows**, replaced wholesale when the Worker says they changed
  (`stateSync.ts`). The replace deletes, so every page is fetched into memory first and the delete
  and the inserts are one transaction: a pull that fails leaves the library as it was. That is the
  prune invariant, on the device.
- **Signing in has two flows, and neither needs the client secret.** On Android the default opens
  Trakt's consent page in a browser tab, which returns to the app at `fandex://auth/trakt` with a
  code the app exchanges itself (with PKCE and a `state` check). One tap for somebody already
  signed in to Trakt. `src/app/auth/trakt.tsx` exists only so the router has a screen for that
  address. The fallback, and the web build's only flow, is Trakt's device flow: a short code,
  confirmed at trakt.tv. "Open Trakt" opens the page with the code already filled in, and tapping
  the code copies it. **Anything a person would have to retype must be copyable by tapping it.**
  The Trakt tokens stay on the device (`expo-secure-store` on Android,
  `localStorage` in a browser). The Worker is handed the access token once, asks Trakt whose it is,
  and returns a Fandex session, which the app sends as a bearer header from then on.
- **Trakt syncs from the device** (`traktSync.ts`). It pulls the seven Trakt lists, matches each
  title to the catalog (`POST /v1/lookup` by Trakt id and TMDB id, then `resolve` by TMDB id for
  the few nobody holds, 25 a run), compares with the account's rows whose source is `trakt`, and
  sends the difference through `PUT /v1/me/state`. It runs on opening the app when the last sync
  is over six hours old, after signing in, and from the You tab. **The prune invariant is on the
  device now**, and has four guards: one failed page throws before anything is compared; the
  comparison is against the Worker's rows, pulled fresh first; a title still waiting to be matched
  blocks every delete for that run; and a run that would delete more than a tenth of what the
  account holds is refused. Only `trakt` rows are touched, and an episode ticked in Fandex
  (sources other than `trakt` alone) is never deleted.
- **A write goes to Trakt, then the Worker, then the device's copy** (`itemActions.ts`), and a
  step that fails stops the ones after it. The rules are the site's: a rating marks the title
  watched or played, is written to every row that already carries a score (the rating shown is
  the average across providers), and takes the title off the wishlist; clearing a rating keeps
  the title in the library. Films and shows live on Trakt when the device is signed in to it.
  Games have no provider that takes a rating, so theirs are source `local`. Steam's rows are
  never written or deleted from here. ⚠️ **TMDB gets no write-back**: the app has no TMDB user
  session, so a rating changed here is not changed on TMDB.
- **Up next asks Trakt, one show at a time** (`upNext.ts`). The Worker's episode catalog stopped
  being filled when the site did, so the device asks `/shows/{id}/progress/watched` and keeps the
  answer in `up_next`. A show is asked again when its ticked-episode count moves, or after a day
  (watched in the last four months) or a week (older). A run asks about twelve shows, most
  recently watched first; the screen runs up to six passes a visit. The order is the site's: an
  entry sits at the later of "you watched the one before" and "this one aired". ⚠️ "Watched" is
  the later of Trakt's `last_watched_at` and this device's own newest tick for the show: Trakt's
  value lagged a tick made seconds earlier, and a show ticked again and again stayed in second
  place. The tab and the widget share that one ORDER BY and it has to stay the same in both.
- **The widget is Kotlin in a local Expo module** (`mobile/modules/up-next-widget`), autolinked
  through `expo.autolinking.nativeModulesDir` in `package.json`. That is what keeps it out of the
  generated `android/` folder: the module carries its own manifest entries, layouts and classes,
  so `expo prebuild` cannot wipe it and no config plugin is needed. It is a classic `RemoteViews`
  list, not Glance, to add no dependency. **It holds no logic**, and four things about it are
  each the shape of something that went wrong:
  - **The tick runs the app's own JavaScript in the background, and opens nothing** (Nils,
    2026-10-04: "i dont want it to open anything"). The tap lands on `WidgetTapActivity`, which
    draws nothing and finishes inside `onCreate`; it hands the episode to `UpNextTickReceiver`,
    which starts the headless task `FandexUpNextTick` (`src/headless.ts`, registered in
    `index.js` before the router) and holds `goAsync()` until it finishes. The task calls the
    same `markEpisodeWatched` the Up next tab calls, so the Trakt token, its refresh and the
    write path exist once. A receiver, not a service: a backgrounded app may not start a
    service and a cached one is frozen within seconds, and a receiver in `goAsync()` is neither.
    From a killed process the task answered in about a second.
  - **A list in a widget has ONE tap template**, so one component takes both taps (open a show,
    tick an episode) and tells them apart by the address the row fills in
    (`widget://open/{id}`, `widget://tick/{id}/{season}/{episode}`). The template is mutable, and
    Android 14 only allows a mutable one that names its component.
  - **The widget does not read the app's SQLite file.** Android's SQLite and the one expo-sqlite
    ships are two copies of the library, and two copies on one file in one process do not see
    each other's locks. The app hands the widget its rows (`publishWidget` → `setRows` → a small
    JSON file), whenever it writes `up_next`.
  - ⚠️ **Android defers a widget update sent while the launcher is hidden**, which is whenever
    the app is in front, and on the Pixel launcher the deferred frame did not replace the old
    one: the rows changed and the taps did not. After an app update or a force-stop (either
    cancels every tap a widget has registered) the widget showed the right episodes and every
    tap on it failed, with nothing in any log but the launcher's "Cannot send pending intent …
    ActivityNotFoundException", which it throws for ANY failure. So the app publishes the rows
    again 1.5 s after it goes to the background (`AuthProvider`), when the launcher is showing.
    A widget whose taps are dead and whose rows are right is this, not the tap's target.
  - ⚠️ **The background task opens its OWN database connection** (`useNewConnection: true`).
    Without it expo-sqlite hands back the one connection the app's provider is using, and the
    task's `closeAsync()` closed the app's database: Nils's first tick worked and every call
    after it, in the app and in the next tick, was rejected. Both connections set
    `busy_timeout` (in `migrate`), so a tick that meets the app's own write waits for it.
  - ⚠️ **The receiver clears the "marking" flag itself when the task ends**, whatever the
    JavaScript did. The task used to be trusted to rewrite the rows, and when it died before
    it could, the row sat at "Marking S1 E8 watched…" with no tick and could never be tapped
    again. A flag set in Kotlin is cleared in Kotlin.
  ⚠️ The module needs `com.facebook.react:react-android` on its own classpath for the headless
  API; the Expo gradle plugin does not provide it. ⚠️ The build copies `mobile/modules/` and
  `mobile/index.js` to the short build path too.
- **The Fandex Score is computed on the device** (`fandexScore.ts`, `ScoreProvider.tsx`). It is a
  port of the site's `buildProfile` and `computeFandexScore` with the database taken out: pure
  functions of the titles you rated (with the catalog copy's raw facets), the taxonomy from
  `/v1/taxonomy` (kept in SQLite, re-asked twice a day with its ETag) and the facets of the title
  being scored. The profile is rebuilt when your rows, the catalog copy or the taxonomy change.
  ⚠️ **The port and the site must give the same number**, and nothing but
  `scripts/probe-app-score.mjs` checks that. Run it after touching either side's scoring:
  `BENCH_DB=<a COPY of a snapshot> node scripts/probe-app-score.mjs`. It loads `fandexScore.ts`
  under plain Node, so that file stays erasable TypeScript and imports through `@/` only.
  A title that is not a catalog row (a calendar card, a search result) has no facets on the
  device and so no score until it is opened.
- **The Trakt token is refreshed on the device**, without a secret. The redirect sent with the
  refresh has to be the one the token was issued under, which the device does not record, so it
  tries the app's address and then the out-of-band URN.
- **Two public values ship in the app**, as `EXPO_PUBLIC_*`: the TMDB key (TMDB's terms allow it)
  and the Trakt client id (public by construction). `node mobile/scripts/sync-env.mjs` writes them
  into `mobile/.env` from the repo's `.env` without printing them. Anything `EXPO_PUBLIC_*` is
  readable in the bundle; the Trakt client secret, the Twitch secret and the Steam key must never
  get that prefix.
- **The database schema is stepped**, and each step stamps its own version number. Never stamp
  the newest number at the end of `migrate()`: a build with the constant bumped and the step
  missing then marks the database current without creating a table.
- **The design tokens are the site's** (`docs/design/fandex-handoff/02-tokens.json`), as React
  Native values in `src/theme.ts`. Fonts are the same three families, loaded with `expo-font`.
- **The native Android project is generated**, not committed (`mobile/android` is in
  `mobile/.gitignore`). `npx expo prebuild --platform android` recreates it from `app.json`.

## Commands

From `mobile/`:

| Task | Command |
|---|---|
| Run in a browser | `npm run web` (or the `app-web` launch config, port 8081) |
| Build and publish the website | `node mobile/web/publish.mjs`, from the repo root → [website.md](website.md) |
| Typecheck | `npx tsc --noEmit` |
| Tests | `npm test` |
| Write `.env` from the repo's | `npm run env` |
| Generate the Android project | `npx expo prebuild --platform android` |
| Build an APK | see below |

### Building the APK

⚠️ **It cannot be built where the repo lives.** The repo's path is 91 characters, and the native
build's object files pass Windows' 260-character limit (`ninja: error: manifest 'build.ninja' still
dirty after 100 tries` is how that reads). Two things that look like fixes and are not: a `subst`
drive letter mapped to `mobile/` fails because Expo's autolinking does not look for `package.json`
at a drive root, and one mapped to the repo root fails because Node resolves the drive back to the
real path and Gradle then sees two different roots.

What works is a real short path. Copy `mobile/` and the site's `src/` side by side into one, and
build there. After the first copy only `mobile/src`, `mobile/modules`, `mobile/package.json` and
the site's `src` need copying again; a new native dependency also needs its whole folder under
`node_modules` (its `build/` is the JavaScript, do not leave it out).

```bash
robocopy mobile C:\fx\mobile /E /XD android\build android\app\build android\.gradle .expo
```

```bash
robocopy src C:\fx\src /E
```

Then, in `C:\fx\mobile\android`, with `JAVA_HOME` set to `C:/Program Files/Android/Android
Studio/jbr` (the JDK inside Android Studio) and `ANDROID_HOME` to `%LOCALAPPDATA%/Android/Sdk`:

```bash
./gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The first build downloads the NDK and compiles every native library: 13 minutes for all four
architectures on Nils's machine (2026-10-04, 119 MB APK). `-PreactNativeArchitectures=arm64-v8a`
builds for a phone only, which is faster and a quarter of the size. The APK lands in
`android/app/build/outputs/apk/release/`. A release build bundles the JavaScript, so it runs
without a dev server. It is signed with the debug keystore Expo generates, which is fine for
sideloading and is not a Play upload key.

## Not built yet, in the order it should be built

1. **Google sign-in.** On Android it needs an OAuth client in the Google Cloud console, keyed to
   the package name (`org.fandex.app`) and the signing certificate's SHA-1.
2. **Joining two accounts.** The Worker answers `merge-required` with what overlaps; the app says
   so and stops. The form that lets the person choose is not built.

## Known problems

- **The widget's look and feel is not right yet** (Nils, 2026-10-04: "the ux not feeling and
  looking great"). He deferred the pass and has not said which part. Ask before changing it.
  It is text only, the row swaps to "Marking … watched" for about a second, and it does not
  use the app's fonts.
- **The web build is live as fandex.org since 2026-10-10** ([website.md](website.md)) and was checked there signed out: the calendar, Browse after a full catalog sync, the item page, an unknown address, the You tab. Still not looked at in a browser: sign-in, the Library, the score, rating and saving.
- **Seen once, not explained:** during a look at the live site with saves blocked, the Trakt sync
  logged `Database not found - nativeDatabaseId[2]` once, after I had moved between pages by
  writing to `history` from the console. Not seen in normal use.

- **A second browser tab runs on a database in memory.** expo-sqlite's web build keeps its files behind exclusive handles on a whole storage folder, so only the first tab of a site can open the stored database; a second tab threw at start and never drew anything (seen on fandex.org, 2026-10-10). `mobile/patches/expo-sqlite+57.0.3.patch` makes the library try four times (a reloaded page's old worker lets go within a second) and then carry on in memory. That tab fetches the catalog and your rows again, about thirty requests, and forgets them when it closes. ⚠️ Tried first and thrown away: a file per tab (the lock is on the folder) and a hand-over between tabs with a Web Lock (it deadlocked behind a background tab). The better fix is one database worker shared by every tab.
- **A fast reload in a browser can fail to open the database.** The SQLite file is locked by the
  page that opened it, and a reload starts the new page before the old one has let go
  (`NoModificationAllowedError`, then `Invalid VFS state` on a retry inside the same page). The app
  reloads itself quietly up to four times, which got through every time it was provoked, and shows
  an error with a retry after that. A proper fix is to wait on the old page's release before
  opening. Android is not affected.
- **The web build's SQLite runs without cross-origin isolation, and the website sends no such headers on purpose.** Checked on the live build: `crossOriginIsolated` is false and the catalog synced. Safari has no `COEP: credentialless` at all, so the app has to work without it anyway. The dev server still sends the two headers (`metro.config.js`), which is why `Trailer.web.tsx` marks its frame `credentialless`.
