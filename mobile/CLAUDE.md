# The Expo app

Screens, data sources and the APK build are in `docs/app.md`; what the app still owes the old site is in `docs/app-parity.md`. The incidents behind these rules are in memory [[expo-app-phase2]].

## Building a screen

- **A screen is a PORT of the old site's component, not a design.** Read the old file first (`git show old-site-final:src/components/kit.tsx`, likewise `cards`, `SubBar`, `AppNav`, `UpNext`) and copy its sizes. Every screen lives under `src/app/(tabs)/`, which is what puts the navigation on it. → [[app-parity-with-old-site]]
- **Two import prefixes: `~/` is `mobile/src`, `@/` is the ROOT's `src`.** A shared module must not import a package the app does not own, not even for a type, and the app's own `tsc` won't tell you: locally the root's `node_modules` resolve it, CI installs only the app's and fails. `src/lib/appSiteImports.test.ts` catches it locally.
- **`EXPO_PUBLIC_*` values are public by construction.** Only the TMDB key may be one. → `docs/app-plan.md`
- **An auth gate ASKS, it never disappears.** A screen that redirects, renders nothing or shows inert "sign in to…" text reads as broken. Gate the per-user part, not the wrapper, and offer the sign-in (`components/SignIn.tsx`). → [[anon-gates-must-ask-not-bounce]]
- **A component that renders nothing when empty must know WHY it is empty.** "No data yet", "the pull is failing", "still filling" and "caught up" all look like a broken feature; show which one.
- **One outcome per tap target.** Two pressable layers in one cell means thumb placement decides what happens, and a hover affordance only a thumb can reach is a defect.
- **A provider is identified by its logo (`BrandGlyph`), never its colour.** No brand hue in any state. The one exception is the Google "G", which Google's guidelines require in colour: drawn by `components/GoogleMark.tsx` with four literal fills, never through `src/lib/brandMarks.ts` (`brandMarksNoGoogle.test.ts` guards it). Read Google's guidelines in English; the German translation inverts the background rule. → [[platform-brand-marks-not-colours]]
- **A `//` comment in JSX children renders on the page.** Wrapping a `return ( … )` in a fragment moves comments into that position and every check stays green. → [[jsx-comment-in-children-renders]]

## Data on the device

- **A write transaction goes through `inTransaction` (`lib/db.ts`), never `db.withTransactionAsync`.** Two overlapping ones on expo-sqlite's single connection cancel each other. A screen showing your rows says when they are still arriving (`auth.rowsSyncing`), or a fresh tab reads as an empty account and a tick made from it duplicates on Trakt.
- **A title missing from the catalog copy is UNKNOWN, never an answer.** Any pool shrink makes every device refill its copy page by page, so a half-empty copy is normal. Up next once stored "caught up" for every show not refilled yet.
- **`catalog.release_date` is the date in the device's country; the worldwide one is `world_date`** (`lib/localDates.ts`). A statement that writes the catalog writes both, through `regional_date` as `storePage` does.
- **A device learns of another device's changes only by asking**: at start, on Sync, and on returning to the app (at most once a minute). A new way to sync still ends in `pullRows`, and a 401 on any pull signs the device out (`lib/AuthProvider.tsx`).
- **A search compares `searchKey`, never `normalizeName`, on both sides.** `normalizeName` is the matcher's stored identity key and drops every letter outside a to z ("Pokémon" is "pok mon").
- **The series rail reads a title's RAW `ip` facets (`FacetIndex.byRawIp`).** The provider's set is the clean one; a hand attach belongs in "More from", never in a series rail.
- **The Fandex Score ranks rows by what they contribute** (`dev · classWeight · gain`), not by raw `dev`, and labels a category from the live taxonomy, falling back to its id. Diff `docs/fandex-score.md` against `lib/fandexScore.ts` when touching either. → [[fandex-score-h5]]
- **A title you rated is scored without its own rating, and 0 to 100 comes from `softRange`, never a clamp.** Any new score path goes through `computeFandexScore` with the title's id, or it quotes your rating back to you. → `docs/fandex-score.md` §1

## Navigation and scrolling

- **`router.replace` does not take a screen out of Back history.** Every screen is a tab of one navigator with `backBehavior="history"`. One that must vanish removes itself on `blur`, as `open/[source]/[type]/[id].tsx` does.
- **A screen that re-reads on `catalog.revision` or `rowsRevision` keeps what is on screen until the new answer lands.** Setting the list to null redraws the grid at the top: rating a card threw the reader back up the page.
- **A header that hides on scroll FLOATS over its list and slides; it never changes the list's layout.** Moving a list under a held thumb reads as a drag and the bar flickers. A list under `SubBar` takes `useBarList()` (`lib/barScroll.tsx`) for its scroll handler and top inset together.

## Builds

- **`mobile/android` is generated by `expo prebuild` and gitignored.** Never edit it by hand; a native change goes in a config plugin under `plugins/`. Build from the short-path copy described in `docs/app.md`. `expo prebuild` clears the folder, so the build after it is a cold one.
- **Raise `version` and `android.versionCode` in `app.json` for every APK and every Play upload** (`0.3.14` is `314`). Play refuses a number it has seen, and the APK's file name follows `version`.
- **A sideloaded APK stays on the debug key; only `-PfandexPlay` signs with the upload key** (`plugins/withPlayUploadSigning.js`). Android refuses an update signed with another key, so moving the phone's build to the upload key would force an uninstall. The upload key's settings live in `~/.gradle/gradle.properties`: never read or print that file. → `docs/play-store.md`
- **"Test on mobile" means the native app**, not Chrome on the phone. → [[mobile-means-native-app]]
