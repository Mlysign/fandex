# The Fandex app

_Phase 2 of [app-plan.md](app-plan.md), started 2026-10-04. This is the reference for `mobile/`:
what is built, how it is put together, and what comes next. The Worker it talks to is
[worker.md](worker.md)._

## What is built

An Expo app (SDK 57, React Native 0.86, expo-router) that runs as an Android app and, from the same
code, in a browser.

| Screen | Does | Data from |
|---|---|---|
| Home (`/`) | The type filter, then rails: Up next, Recommended for you, Popular right now, Upcoming, Popular people. A guest panel when signed out. Recommended (2026-10-17) is the green band and nothing under it, chosen from the whole catalog copy on the device (every title not in your library, scored with its full facets) and the calendar's upcoming titles, filling in three tiers: still to come, out in the last year, the rest (`lib/useHomeRails.ts`, `recommend` and `tierOf` in `lib/homeFeed.ts`). No rail at all when nothing is a strong match, which is the case for an account whose own average sits near the top. **Since 2026-10-18 Recommended and Upcoming give each media type on screen an even share** (`balanceByType`: the types are dealt in turn, each out of its own ranking, a short type's slots going to the others), because a catalog that is a third games made a rail that was all games. Popular people rotates a fresh hand every six hours out of a pool of 150 (`rotateRailFresh`), ranked by role and by how well known the titles are, book authors included. | Worker `/v1/calendar` (four months) and `/v1/lookup`, on-device SQLite, Trakt for Up next, `/catalog/people.json` and `/catalog/reference.json` from the site build (the second is the match's reference population, asked for daily, `lib/ScoreProvider.tsx`) |
| Search (`/discover`) | One field, one grid of poster cards, four sorts. Typing searches the device at once and the databases a moment later, merged. | On-device SQLite, TMDB direct, Worker `/v1/search/games` |
| Wishlist (`/wishlist`) | Three tabs: Wishlist, Progress, Library. A grid with search within, five sorts and month dividers by release date; Progress is the next episode per show with a tick. Asks for sign-in when signed out. | On-device SQLite; Trakt for Progress |
| Calendar (`/calendar`) | A month grid that fits the screen, a day's titles in a rail under it, three sources (wishlist, library, popular), a list view, swipe between months. Your own films are placed by the day they open in your country (`lib/regionalDates.ts`), the day the popular cards already carry. | Worker `/v1/calendar` and `/v1/catalog/release-dates`, on-device SQLite |
| Item page | Art, dates, ratings, description, people, platforms, where to watch, tags, links. Your match (since 2026-10-25 a label, a sentence, the odds line and two bars, no number) with "Why?" opening the whole sum in two groups, Follow on the pull rows (a sign-in prompt when signed out). Signed in: rate it 1 to 10 (tap the rating again to clear it), wishlist it, remove it from the library, hide it from suggestions. Last: the series rail ("Harry Potter books", "The Dark Knight series": the provider's own set of this medium, oldest first, since 2026-10-18), "More from {franchise}" and "More like this", picked on the device from its catalog copy (`lib/related.ts`). The Collection, Franchise or Series fact links to the franchise's page. On a wide browser window the artwork has thumbnails and arrows. | Worker `/v1/items`, on-device SQLite, Trakt |
| You (`/profile`) | Who you are, three counts, rows to Insights, Import, Settings and Support, Sign out, a rail of recommendations. Lighter than the site's page since 2026-10-17 (Nils): no "Recently added" and "Coming up", no Wishlist or Your ratings rows, which the tabs already are. Signed out it is the sign-in card. | On-device SQLite, Worker `/v1/me` |
| Insights (`/insights`) | Your taste in numbers, from the rows on the device: overview, how you rate, the spread per medium, taste by era, you against the crowd, how you rate tags, people and studios, who turns up most. | On-device SQLite |
| Tag, person, studio, franchise (`/tag/{key}`, `/person/{key}`, `/studio/{key}`, `/franchise/{key}`) | What it is, the crowd's average and yours, what it does to your match (since 2026-10-25 two pills, "Taste +4.2" and "Pull +3.1", each with its sentence; one pair per role for a person or a studio, `lib/facetImpact.ts`; when there is none, a sentence says why: not rated three titles yet, or none you rated carries it), the Follow and Not interested controls (the pull axis only, `lib/itemActions.ts` `setFollow`), and every title in the catalog that carries it. A franchise page (2026-10-18) is the franchise after the taxonomy: bundled names folded, hand-made attaches in, detaches out, reached from the score panel's chips, the item page's Collection fact and See all on its "More from" rail. It opens with a carousel per series (the books, the films, the games; `lib/franchiseSeries.ts`, read the same way as the series rail below) and everything else in the grid under "Everything else". Since 2026-10-18 the list can be narrowed by media type (a row of circles under the numbers) and by the same Filters sheet Search has, and sorted four ways; a page opens unnarrowed. A title the device does not hold shows a Fandex Score estimated from the page's own facet (an author, a franchise, a tag) where it used to show the crowd's rating. On a person's or a studio's page each card says what they did on that title under its name ("Director · Writer", "as Tony Stark", "Author", "Publisher"; `lib/creditLine.ts`, since 2026-10-17): the roles the catalog files them under, and the part played where TMDB names it. | On-device SQLite, TMDB direct, Worker `/v1/facet/books` and `/v1/facet/games` |
| Settings (`/settings`) | Connected accounts (sync Trakt, disconnect any of them), country, default types, your platforms, the account, download and delete, the home-screen widget, what the device holds, and for an admin the links to `/dev`. Import is a row on the You tab ([app-parity.md](app-parity.md)). | Worker `/v1/me`, `/v1/me/prefs`, `/v1/me/identities/{provider}`, `/v1/me/export`, Trakt, on-device SQLite |
| Admin (`/dev/users`, `/dev/scoring`, `/dev/analytics`, `/dev/score`) | Who is registered and what they hold. Pageviews, where they came from and the two thresholds they are counted for. The scoring engine's weights with an on-device preview, and the taxonomy: categories, the tag table (category, spellings, shown name), franchises (members, bundles, suggestions), and Review, which proposes tag categories, franchise merges and missing members and remembers a no. The score's goalpost chart summed over every device, per medium, with the how-it-works picture under it. An admin only: anybody else sees "Nothing here". A new admin page also goes on `mobile/web/worker.ts`'s list, or the website answers its address with the 404 page. | Worker `/v1/admin/*`, `/v1/taxonomy`, on-device SQLite |
| Home-screen widget | Up next, on the home screen: the next episode per show. Tapping a show opens its page. The tick marks the episode watched in the background, without opening the app, and the row moves on. | Rows the app hands it |

**Books and board games (2026-10-17)** run through every screen above. Their search, popular
rows, calendar entries and facet halves come from the Worker (`/v1/search/books`,
`/v1/browse/books`, `/v1/facet/books`, `api.ts`), never from the provider directly. Board games
are OFF until the Worker has a BGG token: `lib/features.ts` asks `/v1/features` and
`useOfferedTypes()` drops the type from the filters and Settings, and `boardgamesOn()` keeps Search
and Home from asking. A rating of either is stored as source `local` with status `read` or
`played` (`itemActions.ts`, `onTrakt`, `statusFor`): neither provider has a write-back. Every
book page credits Open Library and every board-game page BoardGameGeek, which their terms ask
for. **Hardcover is a second book source since 2026-10-17** (`src/lib/sources/hardcover.ts`,
`docs/worker.md`), on the Worker only, live the same evening (`HARDCOVER_TOKEN`, a key that expires 2027-10-24): its cards come
behind Open Library's in Search and in a book page's "More from" rail, and in the calendar's
months, with a cover the Worker serves (`/v1/cover/hardcover/…`), no votes and no rating. A
card's `source` is `hardcover` then, and the app opens it through `/open/hardcover/book/{id}`
like any other provider card; the Worker turns it into an Open Library work where one exists.
A book page says "Book data from Open Library and Hardcover" when the item carries a Hardcover
link. The app needs no switch of its own: `/v1/features` reports `hardcover`, but nothing reads it. ⚠️ **A new media type is a string-union member, so `tsc` flags almost nothing**: the type
lists are `MEDIA_TYPES` (site), `TYPE_LABEL`/`TYPE_PLURAL`/`color.media` (`theme.ts`),
`TYPE_ICONS` (`typeIcons.ts`, typed as a full `Record`, so it does fail), `TYPES` in
`mobile/web/build.mjs` and `worker.ts`, and the Worker's `TYPES`, `SOURCES` and `MEDIA_TYPES`.
**One book per language** (Nils, 2026-10-17): Open Library files a translation as a work of its
own, so an author's page listed the Stormlight Archive once per language. Every shelf answer now
keeps the works with an English edition or no language given, and drops split editions and box
sets (`isWholeBook`, `src/lib/sources/bookPure.ts`). **A book's series comes off its editions**
when the search row names none (`seriesFromEditions`, one more Open Library request when a book is
first fetched): that is what puts "The Way of Kings" in "The Stormlight Archive", gives the page
its Series fact and "More from" rail, and the score its franchise facet. The rail asks Open
Library by both series fields and joins the answers; coverage is Open Library's (three of the
five Stormlight novels, 2026-10-17), and a book the catalog holds joins the rail through its
facet whatever Open Library's index says.

A person's picture opens a full-screen gallery of every photo TMDB holds of them
(`PhotoGallery.tsx`).

Opening a calendar card or a search result goes through `/open/{source}/{type}/{id}`, which asks the
Worker to resolve the provider id (fetching the title if nobody holds it) and then replaces itself
with the item page, so Back returns to the list.

### Not run yet

The first full run on the Pixel 8 (2026-10-04: catalog sync, Trakt sign-in and sync, rating,
Up next, the widget and its background tick, the score) is in `docs/archive/history.md` (grep
"verified on the Pixel 8"); the product review of 2026-10-23 covered the rest of the screens.
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
⚠️ With the phone LOCKED the same hang has no dialog to answer: it times out and nothing is installed
(2026-10-11). Check `dumpsys window` for the launcher or an app in front before starting an install.
The bundle task does not see an environment variable as an input, so a build that changes one
re-runs it by name: `gradlew :app:createBundleReleaseJsAndAssets --rerun assembleRelease`.
`EXPO_PUBLIC_TRAKT_SYNC_DRY_RUN=1` at build time makes the Trakt sync log what it would change and
write nothing; that is how the sync was proven before it was allowed to delete.

## How it is put together

- **Sync guards, since 2026-10-23 (0.3.11).** Every change of session token (sign-in, sign-out,
  join, disconnect) bumps a counter in `AuthProvider.tsx`; a row pull or Trakt sync captures it
  and writes nothing, and signs nobody out, once it has moved. A Trakt sync reads the device's
  rows before the slow Trakt download and leaves out any row that changed during it
  (`withoutRowsChangedDuringRun`), and an automatic run skips the full download when
  `/sync/last_activities` has not moved. Rows are pulled per kind (`stateSync.ts`): a rating no
  longer re-downloads the episode rows. One Trakt token refresh at a time (a Web Lock across
  browser tabs). A Trakt write's `not_found` makes the row `local`. A row pull or catalog sync
  asked for while one runs runs again after it, and the catalog's progress bumps `revision` at
  most every 2.5 s.
- **Steam syncs from the device too, since 2026-10-23** (`steamSync.ts`), for an account that has
  Steam connected (today only accounts carried over from the old site: there is no Steam sign-in in
  the app). The Worker reads the library and wishlist with its key (`GET /v1/me/steam`); the device
  maps each app id to a catalog title through `/v1/lookup` and `/v1/resolve/steam/game/{appid}`
  (25 resolves a run, the rest wait and block deletes), and writes `source = 'steam'` rows: `owned`,
  or `played` with the last-played time, and the wishlist. The Trakt sync's guards apply: the
  session counter, rows edited during the run are left alone, and a run deleting more than a tenth
  of the Steam rows is refused. It runs with the Trakt sync (start, return to the app when six hours
  old) and from Settings' Steam Sync button; a private Steam profile shows how to make it public.
- **Memory is pictures, not data** (measured 2026-10-23, RV31, 0.3.16 on the Pixel 8). The
  Hermes heap is 38 MB with the catalog copy, the profile and Home's rail pool loaded
  (`fandex_pool` and `fandex_index` in `adb logcat -s ReactNativeJS` carry it). `dumpsys meminfo`
  reads about 310 MB on a cold Home and 600 MB after Search and ten titles, and about 190 MB of
  that is the GPU's cache (`Graphics`), which falls to 93 MB once the app is hidden and to 0 under
  `adb shell am send-trim-memory org.fandex.app COMPLETE`. So quote PSS with the app in front
  and say so. What is held for real is the decoded posters of every mounted screen (about 80 MB:
  the tabs stay mounted) and the native views. A rail on a device is a windowed `FlatList`
  (`RailFrame`), the title page's hero holds three slides, and `Img` uses Glide's memory cache
  (`cachePolicy="memory-disk"`).
- **The score profile waits only for a FILL of the catalog copy** (`CatalogSync.filling`), not for
  the delta every start asks for: waiting on that kept Home's Recommended rail on its skeleton
  for a network round trip, 17 s on the start that hit a start-over.
- **The API address** is `https://api.fandex.org` (`lib/config.ts`) unless a build sets
  `EXPO_PUBLIC_API_URL`; the website's build sets `/`.

- **The screens are ports of the old site's components**, not designs of their own: `src/components/kit.tsx`, `cards.tsx`, `SubBar.tsx`, `AppNav.tsx` and `UpNext.tsx` each name the file they came from, and their numbers are that file's. What is and is not at parity is [app-parity.md](app-parity.md).
- **Every screen is a child of `src/app/(tabs)/_layout.tsx`**, the item page and Settings too. That layout draws the navigation around the navigator (a bar at the bottom under 768 px, across the top from there) and switches the navigator's own tab bar off. A screen outside that folder has no navigation. ⚠️ These screens stay mounted, so one that takes an address parameter has to reset itself when the parameter changes: the item screen clears its item at the start of each load.
- **A card's state is one query for the whole list** (`lib/cards.ts`, `useCardStates`), and its two buttons go through the item page's write path. A card for a title nobody holds yet (a calendar or search result) asks the Worker to find or fetch it first.
- **The type filter is one choice for the whole app**, kept in the `meta` table under the site's own key, `rr_type_filter` (`lib/typeFilter.tsx`). **One tap on a type's circle narrows a full row to that type** (2026-10-18, Nils's three stories: "only this type", "hide this type", "these two only"); from a narrowed row a tap adds or drops a type, dropping the last one shows everything again, a long press hides one type from a full row, and the logo circle shows every type and, on a phone, closes the row (a chevron closes it without changing anything).
- **The calendar's weeks start on Monday** (2026-10-18), in the grid and in the list view's "This week".
- **The widget's heading is an eyebrow**, small and mono (2026-10-18), so the rows get the room.
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
- **A re-read keeps the screen; only another page blanks it** (2026-10-18). Rating a title can bring it
  into the catalog copy, which bumps `catalog.revision` a few seconds later; a screen that set its list
  to null on that bump redrew the grid at the top. `FacetScreen` and the item page's rails remember which
  page they were showing (a ref) and reset only when that changes.
- **A provider card carries its genres** (`CardItem.genres`: Open Library subjects, TMDB genre ids by
  name through `@/lib/tmdbGenres`, IGDB genres and themes from the Worker), so a facet page estimates a
  Fandex Score for a title nobody holds from them and the page's own facet (`estimateFacets`,
  `lib/facetImpact.ts`). The Worker's game routes key their edge cache on `GAME_CARD_VERSION`; bump it
  when `gameCard` changes, or the old shape is served for up to a week.
- **A screen that shows your rows must say when they are still arriving.** A fresh tab or a new
  sign-in has an empty copy for some seconds. Insights said "No rated items" and the episode
  tracker said "0 of 19 watched" in that window, and a tick made from the second one would have
  been a second play on Trakt. `auth.rowsSyncing` is the flag; the tracker disables its ticks on
  it. Its sibling: after a failed write, read the device again. Putting back a snapshot taken
  before the request paints over rows that arrived while it was out.
- **The website counts pageviews, the app does not** (`lib/pageview.ts`). One POST to `/v1/t/pv` per page opened, sent
  only by the web build on fandex.org. ⚠️ Never send it from Android: the request has no Origin, the Worker files it
  under "crawler", and the privacy policy says the app is not counted. A static title page counts itself with an
  inline script and leaves the path in `window.__fxpv`, so the app does not count the same visit when it starts there.
- **The widget's text is a picture** (`modules/up-next-widget`, `WidgetText.kt`). A launcher does not load another
  app's font files: `android:fontFamily="@font/…"` on a widget's TextView compiles, installs and is drawn in Roboto.
  The text is drawn in the app's process with its own fonts and handed over as a bitmap, cut to the widget's width,
  with the words set as the content description. Each row is the app's Up next row; change the two together.
- **A sheet pads its foot by the system bar's inset** (`kit.tsx`, `Sheet`). Android draws a modal edge to edge, and
  without it the last row sits under the navigation bar.
- **Where a title can be watched or played is its own table, filled per country** (`lib/platforms.ts`,
  `item_platform`). The Worker's `/v1/catalog/platforms?region=` answers for the whole pool at once;
  the device asks once a day and again when the account's country changes, because a streaming
  line-up belongs to a country. Names become the site's platform keys (`@/lib/platformKeys`) on the
  device. The filter sheet's "Available on" and the Settings picker both read `usePlatformIndex()`,
  which is null until the copy is read: treat null as "not known yet", never as "on nothing".
- **No air date means not aired** (`lib/upNext.ts`, `readProgress`, and the two list queries). Trakt lists the first
  episode of an announced season with a placeholder title and `first_aired: null`; reading that as "out" put shows in
  Up next that nobody can watch. The site had the same rule and the same fault.
- **The series rail reads the PROVIDER'S franchise key, before bundles and hand-made attaches** (`lib/related.ts`, `seriesForItem`, `FacetIndex.byRawIp`): TMDB's collection is the eight Harry Potter films, Open Library's series the seven books, and the mixing into one 40-title franchise is Fandex's. So a title attached by hand never joins a series rail, by design; it is in "More from". The rail needs three titles of one medium, is cut to 20 by crowd attention, reads oldest first, and is left out when it would repeat the franchise rail. Its title names the medium when the provider's key is the franchise's ("Harry Potter books") and the series when it sits inside a bigger one ("The Dark Knight series").
  - **The franchise page's carousels are the same split** (`lib/franchiseSeries.ts`, 2026-10-18): a provider key of this page cut to one medium, three titles or more, oldest first; a page that would be one carousel and an empty grid stays a grid. A title the device does not hold joins its franchise's own series when it came from TMDB's collection, and from Open Library only when the Worker holds it (that search returns box sets and books about Harry Potter); a game it does not hold goes in the grid. ⚠️ **A game's series is its IGDB collection, not its franchise** (`seriesOfFacet`, since 2026-10-18): IGDB files every Harry Potter game under one franchise, and its collections split the 2001 to 2011 tie-ins ("Harry Potter") from the LEGO games ("Lego Harry Potter"), with Hogwarts Legacy in none. They ride on the franchise facet as `series`: `[]` is in none, absent is not known (stored before collections were asked for), which falls back to the franchise. The same reading feeds the item page's series rail.
- **A facet page is the device's rows first, then TMDB's** (`lib/facetProviders.ts`, `FacetScreen.tsx`). The catalog
  copy holds what somebody acted on, so a director's page built from it alone showed one film. The page asks TMDB from
  the device for the rest (a filmography, or discover by company, genre or keyword) and gives each title the Worker
  already knows its Fandex id through `/v1/lookup`. A title without one opens through `/open/tmdb/…`, which is what
  creates it. Films and shows only.
- **A show's episodes come from two places.** The Worker's `/v1/shows/{id}/episodes` holds the
  seasons, and episode lists only for seasons somebody opened on the old site. For the rest the
  item page asks TMDB from the device when a season is opened (`tmdbSeasonEpisodes`), which is
  when the site asked. How many you have watched is counted from your own rows, never from the
  episode list, so a season whose list is not loaded still reads right.
- **`mobile/` is its own package.** Excluded from the root's `tsconfig.json`; the root's
  `npm run lint` covers it (its generated folders are ignored in `eslint.config.mjs`). CI runs
  `tsc` and the tests as the `app` job.
- **Two import prefixes.** `~/…` is the app's own `mobile/src`. `@/…` is the SITE's `src`, one
  directory up, so the app can import the site's pure modules unchanged (`metro.config.js` and
  `tsconfig.json` both map it). Today that is `normalize.ts` and `countries.ts`. A site module
  imported here must not reach `@/lib/db` or anything Node-only: the Worker's rule.
- **The item page is two files, and the split is the website's.** `src/components/ItemPage.tsx`
  is the title as everybody sees it and knows nothing about who is looking: no database, no
  session, no router. `src/app/(tabs)/item/[id].tsx` loads the item and passes what is yours (your state,
  your score, the rating row) in as `personal`. The website renders `ItemPage` alone to HTML, so
  anything device-only imported there breaks that build. `mobile/ssr-probe/` is the proof it
  renders on a server, and where its CPU cost was measured (docs/app-plan.md, "The website").
  The screen answers two addresses: `/item/{id}`, the app's own, and `/{type}/{slug}`, the public
  one (`src/app/(tabs)/[type]/[slug].tsx` re-exports it). On the website it may start under a static
  copy of the same page and removes that copy once the item is on screen (`src/lib/prerender.ts`).
- **The device holds a copy of the scoring pool** in SQLite (`expo-sqlite`, also on the web).
  `catalogSync.ts` pulls the Worker's delta a page at a time and advances its cursor in the same
  transaction that writes the page, so a sync that dies half way resumes from the last page that
  landed whole. **A device with nothing starts from files on fandex.org** (`startFromFiles`, since
  2026-10-11; [website.md](website.md), "The catalog as files") and then asks the Worker once for
  what changed since the site was built. A later sync is one request that usually returns nothing.
  ⚠️ An app built with `EXPO_PUBLIC_API_URL` set (the local test stack) never reads those files:
  they are the production catalog. If the device ends up holding more titles than the Worker's
  pool, a title was removed upstream and the sync starts over, once; a start-over that did not
  help is not tried again for a day.
- **Two sorts are the old site's, in `lib/sortCards.ts`.** "Rating" is the vote-damped average
  (`bayesRating`), so a single 10.0 does not lead. "Popularity" across types ranks each title
  WITHIN its own type and interleaves, because a game's count includes Steam reviews and is not on
  a film's scale: unsorted, 35 of the first 48 were games. With one type chosen it is the plain count.
- **A title's address is `/{type}/{slug}`** (`itemHref` in `lib/cards.ts`, which `cardHref` uses),
  the public one, so the address bar is the one to share. `/item/{id}` is the fallback for a title
  with no slug, and for one `/open/…` just had the Worker fetch. A new link to a title goes
  through `itemHref`; four places did not and stayed on the old address after the cards moved.
- **What you hid is left out of every list that chooses for you, and a name still finds it**
  (`lib/hidden.ts`): Home's rails, Up next, the widget, and Search while nothing is typed. A new
  list that picks titles for the viewer owes the same filter.
- **A button that stays on or off spreads `toggled(on)`, a checkbox `checked(on)`** (`lib/a11y.ts`).
  react-native-web writes nothing for `accessibilityState.selected` on a button, so in a browser
  the state was not in the page at all.
- **Episodes are tracked through Trakt.** A tick goes to Trakt before anything is saved, so the
  tracker gives an account with no Trakt the episode list without boxes and says why.
- **The Scoring admin reads the taxonomy past the browser's cache** (`api.taxonomy`, `no-store`).
  The route is `max-age=300`, and a reload inside those five minutes showed the page from before
  its own save.
- **Every screen names its browser tab** with `usePageTitle` (`lib/pageTitle.ts`). On focus and
  not on mount: the tab screens all stay mounted, so on mount the last one to render would win.
- **Trakt being busy is not "No connection".** A rate-limited preflight is a 429 that the browser
  reports as a failed fetch. `traktGet` throws `TraktBusyError` for a 429, and for a failed fetch
  while the browser says it is online; Up next stops asking for that run and says so.
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
  never written or deleted by a rating; only the Steam sync writes them. ⚠️ **TMDB gets no write-back**: the app has no TMDB user
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
  `/v1/taxonomy` (kept in SQLite, re-asked with its ETag on every start and every return to the app, at most once a minute; the Worker answers an unchanged one with a 304 off one kept row) and the facets of the title
  being scored. The profile is rebuilt when your rows, the catalog copy or the taxonomy change.
  The port was proven to give the old site's exact numbers by `scripts/probe-app-score.mjs`,
  which went with the site on 2026-10-23 (tag `old-site-final`); since the same day the app
  departs from them on purpose (a rated title scored without its rating, `softRange`).
  `fandexScore.test.ts` is what guards it now. Keep `fandexScore.ts` erasable TypeScript
  importing through `@/` only, so a script can load it under plain Node to backtest it.
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
| Run in a browser | `npm run web` (or the `app-web` launch config, port 8081). ⚠️ It talks to the LIVE API. |
| Run in a browser against a Worker on this machine, with test accounts | `npm run web:local` (or `app-web-local`), after `node worker/scripts/dev-stack.mjs` and with `worker-local` running → [worker.md](worker.md), "The test accounts" |
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

**The version lives in `mobile/app.json`** since 2026-10-23: `version` (`0.3.17`) and
`android.versionCode` (`317`, minor times 100 plus patch). Gradle reads it from
`android/app/build.gradle`, which only `npx expo prebuild --platform android --no-install` rewrites
(a cold build after it: 4 min for arm64 on 2026-10-23). Raise both for every APK and name the
file after `version`; before that, the APK's file name was the only version. A Play build is the
same build with `bundleRelease -PfandexPlay` and the upload key → [play-store.md](play-store.md).

## Not built yet, in the order it should be built

1. **Google sign-in on ANDROID.** It is built for a browser since 2026-10-11 (below). The phone
   needs an OAuth client of type Android in the Google Cloud console, keyed to the package name
   (`org.fandex.app`) and the signing certificate's SHA-1, and a native module to ask it. Google
   does not send a "Web" client back to an app's own address, so the browser's flow cannot be
   reused. Until then a person who made their account with Google cannot sign in to it on the
   phone, and Settings there says so on the Google row. The Worker side is ready for it: the
   native call takes a nonce, and `GOOGLE_CLIENT_ID` takes a comma-separated list.

## Joining two accounts (2026-10-17)

A way in added in Settings (Trakt, Google, Discord) can belong to ANOTHER Fandex account. With no
titles in common the Worker joins them at once and answers with a session for the survivor. With
some in common it answers 409 `merge-required` with a short-lived proof, the overlap and both
accounts' summaries, and nothing changes until the person chooses.

`AuthProvider` keeps that answer in memory (`pendingMerge`, with the Trakt tokens when Trakt was
the way being added, so the joined account keeps syncing Trakt here) and Settings shows
`MergePanel` above the account list: a port of the old site's, both accounts side by side, what
moves with nothing to decide, what overlaps with a few titles, and two buttons with **nothing
preselected**. `completeMerge` posts `/v1/auth/merge`, takes the survivor's session, and replaces
the device's rows with a forced pull. "Not now" drops the proof; so does a reload. The survivor is
the account the added way in belongs to, and its own settings (country, types, platforms) win.

**Trying it locally:** signed in to a local Worker as either test account, Settings offers
"Connect the third test account". The third account signs in "with Discord", so it can be joined to
either of the others, and the connect goes through the real `signIn()`
([worker.md](worker.md), "The test accounts"). Walked through on 2026-10-17: the form, "keep the
other account's copies", the survivor holding the 9 over the 6, and the device showing it.

## Google sign-in, in a browser (2026-10-11)

`src/lib/google.ts`, `src/app/auth/google.tsx`, the button in `components/SignIn.tsx`.

The whole page goes to Google and comes back to `/auth/google` with an ID token after the `#`.
No script of Google's runs on fandex.org and nothing reaches Google before the button is pressed,
which is why the privacy policy needs no consent step for it. Before leaving, the tab makes a
secret and gives Google its SHA-256 as the `nonce`; on return it sends the token and the secret to
`POST /v1/auth/google`, and the Worker refuses a token whose nonce is not that secret's hash.

- **The button shows only in a browser, and only in a build given `EXPO_PUBLIC_GOOGLE_CLIENT_ID`**
  (`npm run env` in `mobile/` copies it from the repo's `.env`).
- **The address Google returns to must be on the OAuth client**, per origin:
  `https://fandex.org/auth/google`, and `http://localhost:8081/auth/google` for this machine.
  Without it the button leads to Google's "redirect_uri_mismatch" page. `publish.mjs` asks Google
  and refuses to publish a build with the button while the live address is missing.
- **Scope is `openid profile`, never `email`** (docs/decisions.md). The name and picture are kept
  as the display name and avatar; the privacy policy says so.
- **Settings has a Connect row for each way in the account lacks.** Signing in with a provider
  while signed in adds it to the account. This is how an account made with Google gets its Trakt
  library; signing out and in with Trakt would make a second account, and joining two is not built.
- **`finish()` asks the Worker before it keeps Trakt's tokens.** A Trakt account the Worker
  refuses (it belongs to another Fandex account) must leave no tokens behind, or the next start
  syncs that person's Trakt into this account.

Checked on this machine: the button leaves for Google with the right address; a return with a
made-up token is refused by the local Worker and the screen says so; a return this tab did not
start is refused without asking the Worker; the token is gone from the address bar either way.

**Live on fandex.org since 2026-10-11.** Both return addresses are on the OAuth client. Checked
there the same day, in Nils's Chrome with his account: Google's account chooser named fandex.org,
the token it sent back carried the nonce, the live API answered 200, the tab returned to Settings
still signed in, and nothing was left in the address or the tab's storage. That run was started
from the console, because his browser was signed in and an account with Google already connected
is shown no button. **Not checked: the button pressed by a signed-out visitor on the live site,
and a first-time Google account** (it would create a new Fandex account).

**Google signs you in to Fandex, never to Trakt.** Trakt's tokens stay on the device that got
them (docs/decisions.md, 2026-10-04), and signing out deletes them there (Sign out ends that
device's session; "Sign out everywhere" ends every device's, since 2026-10-23). So a browser signed in with Google holds no Trakt sign-in until one is made in it, and
Up next, ratings and episode ticks, which go to Trakt from the device, answer `TraktAuthError`.
Until 2026-10-15 that read "Trakt needs you to sign in again. You can do that under You", while
Settings showed Trakt as Connected with a Sync button that did nothing: no way to act on it. Now
`TraktAuthError.hadSignIn` separates "never signed in here" from "Trakt dropped it", the message
says "This browser is not signed in to Trakt yet", and Settings shows **Sign in to Trakt** with
a line saying why (`traktSync.onDevice`). Seen on the local stack with a test account given a
Trakt identity row; published to fandex.org the same day. Not in an APK yet.

## Discord sign-in (2026-10-17, switched on the same day)

`src/lib/discord.ts`, `src/app/auth/discord.tsx`, `AuthProvider.startDiscordSignIn`, the button in
`components/SignIn.tsx` and Settings' Connect row. The Worker's half is `POST /v1/auth/discord`
(`worker/src/auth/verify.ts`, `verifyDiscordToken`).

Discord's implicit grant, scope `identify`: the browser goes to Discord and comes back to
`/auth/discord` with an access token after the `#`. **On the phone the browser sheet comes back
to `https://fandex.org/auth/discord` too**, with a `state` starting `app.`, and that page hands
the fragment on to `fandex://auth/discord` at once (`APP_RETURN` in `lib/discord.ts`, an "Open
the app" button if the browser wants a tap). Discord gives an implicit-grant token only to an
https address: sent to `fandex://auth/discord` directly it answered "Redirect URI is not
supported by client" after the person said yes (Nils, 2026-10-24), though that address is listed. The Worker asks Discord's `/oauth2/@me` whose token it
is and which application it was issued to, and refuses one issued to any other app. **No client
secret is used anywhere**, which is why the leaked `DISCORD_CLIENT_SECRET` can be reset without
touching the Worker. A `state` made before leaving and checked on return stops a planted token.
The privacy policy says so in both languages since 2026-10-17.

**Switched on 2026-10-17.** The application Fandex lists the three return addresses
(`https://fandex.org/auth/discord`, `http://localhost:8081/auth/discord`,
`fandex://auth/discord`), beside the old site's two. The button shows only in a build with
`EXPO_PUBLIC_DISCORD_CLIENT_ID` in `mobile/.env`, which `npm run env` (`scripts/sync-env.mjs`)
copies from `DISCORD_CLIENT_ID`. Discord answers an unlisted address with an error page only after
the person has logged in, so no publish check can catch a missing one (Google's can).
⚠️ **A new `EXPO_PUBLIC_*` value needs a cleared bundler cache to reach a build.** Metro inlines it
when it transforms a file and keeps the result: the first publish after adding this one went out
with no button. `build.mjs` passes `--clear` since; for an APK run
`gradlew :app:createBundleReleaseJsAndAssets --rerun assembleRelease`. Check the value is in the
bundle, not that the build passed.

## Known problems

- **The widget's look and feel is not right yet** (Nils, 2026-10-04: "the ux not feeling and
  looking great"). He deferred the pass and has not said which part. Ask before changing it.
  It is text only, the row swaps to "Marking … watched" for about a second, and it does not
  use the app's fonts.
- **The web build is live as fandex.org since 2026-10-10** ([website.md](website.md)) and was checked there signed out: the calendar, Browse after a full catalog sync, the item page, an unknown address, the You tab. Still not looked at in a browser: sign-in, the Library, the score, rating and saving.
- **Seen twice on the phone, fixed on a diagnosis that could not be reproduced on demand:** Search listed nothing and
  every prepared statement failed with a NullPointerException, half a minute after an update landed while the app was
  in the background. The log showed the app's root started twice in one process. expo-sqlite gives every opener of
  one file the same native connection, so the first root's provider closing it takes it from the second. The Android
  screen now opens a connection of its own (`OWN_CONNECTION` in `src/app/_layout.tsx`). Two installs over a
  backgrounded app were clean afterwards, one of them with two roots; the failure was intermittent before, so that is
  evidence and not proof. A force-stop and reopen cleared it each time.
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
