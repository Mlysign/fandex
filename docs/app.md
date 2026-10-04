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

**Signed in, verified on the Pixel 8 on 2026-10-04.** Nils approved a code and the rest ran first
time: the Worker handshake, the pull of his rows (1,952 library, 99 wishlist, his name and three
providers on the You tab), the Library list with his ratings, and "In your library · played" on an
item page opened from it.

**The browser sign-in is verified too, the same day.** It was written after that first sign-in, in
answer to it (the code flow was "terrible", his word). Nils signed out and back in through the
main button: Trakt's page in a browser tab, back into the app, signed in with his library, nothing
in the log. `fandex://auth/trakt` is a redirect URI on the Trakt app. ⚠️ The reworked code flow
("Use a code instead", the prefilled link, tap to copy) has not been run since it changed.

The Trakt app is "Release Calendar" at `developer.trakt.tv/apps` (not under trakt.tv Settings any
more), and editing it needs GitHub connected there, which Nils did. ⚠️ **Trakt saves a
custom-scheme redirect with an "Insecure redirect URIs" warning**: any app on the phone can claim
`fandex://`. PKCE is what makes that tolerable, since a stolen code is useless without the
verifier. The fix Trakt asks for is an `https://` redirect backed by verified App Links, which
needs an `assetlinks.json` on a domain and the release signing certificate. Do it before the app
is on the Play Store, not before.

**Verified on a Pixel 8 on 2026-10-04**, signed OUT, from the release APK installed over adb: the
first sync landed all 4,559 titles, and the calendar, search (all three sections for "blade
runner"), browse, the item page through the doorway, Back, and the Library sign-in prompt all
worked with nothing in the crash log. Three faults showed up that the browser had hidden, all
fixed the same day: a re-released 2014 film listed first in October 2026 (TMDB's regional discover
matches a re-release and answers with the original date; the Worker now drops any card dated
outside its month, and the calendar screen does too for months stored earlier), an empty band
under the item page's header (the safe-area inset applied twice; `Screen` takes `headed` for a
screen under the stack header), and the item page's last line sitting under Android's buttons.

To drive the phone from a session: `adb shell input tap` works, but **check
`dumpsys window` says `org.fandex.app` has focus before every tap**. The app left the foreground
once mid-run and three taps landed on the home screen and in the Google app.

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

1. **Trakt sync on the device.** Pull the library, `POST /v1/lookup` to map ids, `resolve` the
   misses, write the result through `PUT /v1/me/state` as explicit upserts and deletes. A pull that
   fails must send nothing. Until this exists the app shows what the Railway site last synced.
2. **Rate and wishlist from the app.** The write path on the item page, to the Worker and to Trakt
   and TMDB.
3. **Google sign-in.** On Android it needs an OAuth client in the Google Cloud console, keyed to
   the package name (`org.fandex.app`) and the signing certificate's SHA-1.
4. **Joining two accounts.** The Worker answers `merge-required` with what overlaps; the app says
   so and stops. The form that lets the person choose is not built.
5. **Up Next**, from Trakt progress, and then the **Kotlin widget** that reads the same SQLite file.
6. **The Fandex Score on the device.** The catalog copy already carries every item's raw facets;
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
