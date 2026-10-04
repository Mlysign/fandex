# The Fandex app

_Phase 2 of [app-plan.md](app-plan.md), started 2026-10-04. This is the reference for `mobile/`:
what is built, how it is put together, and what comes next. The Worker it talks to is
[worker.md](worker.md)._

## What is built

An Expo app (SDK 57, React Native 0.86, expo-router) that runs as an Android app and, from the same
code, in a browser.

| Screen | Does | Data from |
|---|---|---|
| Calendar | One month of popular releases, grouped by day, with a type filter and month arrows. | Worker `/v1/calendar` |
| Search | Three sections that answer independently: titles on the device, films and shows, games. | On-device SQLite, TMDB direct, Worker `/v1/search/games` |
| Library | Your library and wishlist, by type, sorted by recency, your rating or title. Asks for sign-in when signed out. | On-device SQLite |
| Browse | The catalog on the device, most-voted first, by type. Works with no network. | On-device SQLite |
| Item page | Art, dates, ratings, description, people, platforms, where to watch, tags, links. Shows whether it is in your library or wishlist and what you rated it. | Worker `/v1/items`, on-device SQLite |
| You | Sign in with Trakt, sign out, what the device holds, when it last synced. | Trakt, Worker `/v1/auth`, `/v1/me` |

Opening a calendar card or a search result goes through `/open/{source}/{type}/{id}`, which asks the
Worker to resolve the provider id (fetching the title if nobody holds it) and then replaces itself
with the item page, so Back returns to the list.

### What was verified, and what was not

**Verified in a browser on 2026-10-04**, against the live Worker, signed OUT: the first sync put all
4,559 pool titles into on-device SQLite; the calendar rendered real months for a region the Worker
had never built; search returned all three sections for "blade runner" with the two held films
listed once; a show the catalog did not hold opened through the doorway and came back to the search
on Back; the Library tab asked for sign-in; "Sign in with Trakt" showed a real code from Trakt and
polled. No console errors in normal use, no horizontal overflow at 375 px.

⚠️ **NOT verified: anything after sign-in.** Finishing a Trakt sign-in means approving the code on
Nils's Trakt account, which is his to do. So the Worker handshake that follows, the pull of his
rows, the Library and Wishlist lists and the "in your library" line on an item page have run only
in unit tests (the sync logic) and against the Worker's own tests (the routes). The first real
sign-in is the test.

⚠️ **The Android build compiles but has not run on a device.** No phone was attached and there is
no emulator image on the machine. Every screen above was exercised in the browser build only.

## How it is put together

- **`mobile/` is its own package.** Excluded from the site's `tsconfig.json`, eslint and Docker
  context. CI runs `tsc` and the tests as the `app` job.
- **Two import prefixes.** `~/…` is the app's own `mobile/src`. `@/…` is the SITE's `src`, one
  directory up, so the app can import the site's pure modules unchanged (`metro.config.js` and
  `tsconfig.json` both map it). Today that is `normalize.ts` and `countries.ts`. A site module
  imported here must not reach `@/lib/db` or anything Node-only: the Worker's rule.
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
- **Signing in is Trakt's device flow**: a code the person types at trakt.tv, no redirect, no
  client secret. The Trakt tokens stay on the device (`expo-secure-store` on Android,
  `localStorage` in a browser). The Worker is handed the access token once, asks Trakt whose it is,
  and returns a Fandex session, which the app sends as a bearer header from then on.
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
build there:

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

1. **The first real sign-in**, and whatever it shakes out. See "what was not verified" above.
2. **Trakt sync on the device.** Pull the library, `POST /v1/lookup` to map ids, `resolve` the
   misses, write the result through `PUT /v1/me/state` as explicit upserts and deletes. A pull that
   fails must send nothing. Until this exists the app shows what the Railway site last synced.
3. **Rate and wishlist from the app.** The write path on the item page, to the Worker and to Trakt
   and TMDB.
4. **Google sign-in.** On Android it needs an OAuth client in the Google Cloud console, keyed to
   the package name (`org.fandex.app`) and the signing certificate's SHA-1.
5. **Joining two accounts.** The Worker answers `merge-required` with what overlaps; the app says
   so and stops. The form that lets the person choose is not built.
6. **Up Next**, from Trakt progress, and then the **Kotlin widget** that reads the same SQLite file.
7. **The Fandex Score on the device.** The catalog copy already carries every item's raw facets;
   what is missing is the taxonomy (`/v1/taxonomy`) and a port of the scoring maths out of
   `discovery.ts`, which is tied to the site's database today.

## Known problems

- **A fast reload in a browser can fail to open the database.** The SQLite file is locked by the
  page that opened it, and a reload starts the new page before the old one has let go
  (`NoModificationAllowedError`, then `Invalid VFS state` on a retry inside the same page). The app
  reloads itself quietly up to four times, which got through every time it was provoked, and shows
  an error with a retry after that. A proper fix is to wait on the old page's release before
  opening. Android is not affected.
- **The web build's SQLite runs without cross-origin isolation**, and works. The two headers
  `metro.config.js` sets reach the JavaScript bundle but not the HTML page, so
  `crossOriginIsolated` is false. Expo's docs say the web build needs them. Check before the web
  build is deployed anywhere, because the host has to send them on the page.
- **The Library screen has three rows of filter chips.** On the site the same filters collapse
  into one chip each (the 2026-09-02 decision). Not carried over yet.
