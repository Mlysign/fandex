# Parity with the old site: what the app still owes

_Written 2026-10-05, after Nils said the app "looks vastly different and is missing features" and
asked for UI parity to be part of the plan. This is the list the parity work is done from. The old
site is the reference: `src/app` and `src/components` still hold it, and `npm run dev` still runs
it locally against `data/rr.db` (sign in with `/api/dev/login`), which is the way to look at a
screen before porting it._

**The rule: a screen is at parity when somebody who used the site would not miss anything on it,
and it looks like the same product.** Not pixel for pixel. The site's mobile layout is the target
for the phone; its desktop layout is the target for a wide browser window.

**Where it stands:** the app covers about a third of the site. Colours, radii, spacing and fonts
already match (`mobile/src/theme.ts` holds the handoff's values). The visible difference is in
components: the site is built from poster cards in grids and rails, the app from one list row.

Legend for the tables: **yes** at parity · **partial** exists, differs as noted · **no** not built.

## The order

Each stage ends with something Nils can open on his phone. The website's public pages follow the
same order, because they render the app's components (docs/app-plan.md, "The website"): a page type
goes to the daily build when its screen reaches parity.

| # | Stage | Why here |
|--:|---|---|
| 1 | **The item page.** Public half ✅ 2026-10-05. Left: the personal half, the episode tracker, the two related rails. | It is the first public page type, and every other screen leads to it. |
| 2 | **The kit.** Poster card with its action bar, rail, poster grid, type filter circles, the shared list header, sheet, sort menu, toast, skeletons, the score badges, the nav bar and its five tabs. | Every list screen is assembled from these. Building them once is what makes the rest fast. |
| 3 | **Library, Wishlist, Up next.** Grid, sorts, search within, filter sheet, rate and save from the card. | The screens used daily, and all their data is already on the device. |
| 4 | **Home.** The rails. | Needs the kit, and two Worker routes (trending and upcoming; popular people). Recommendations come from the scores already on the device. |
| 5 | **Discover and Search.** The provider-fed feed, sorts, filters, one merged search. | Needs the Worker's browse route, which is the largest backend piece left. |
| 6 | **Calendar.** Month grid, day rail, scopes, swipe. | The list works today, so it can wait for the kit. |
| 7 | **Facet pages** (tag, person, studio) and the links to them from the item page. | New Worker routes. Also the second public page type. |
| 8 | **Insights, Profile, Settings, Import, Legal.** | Insights can be computed on the device. Settings needs `PUT /v1/me/prefs`, export and delete, which the Worker already has. |
| 9 | **Sign-in beyond Trakt** (Google, joining accounts, Steam) and **the admin pages** (taxonomy, analytics). | Google and merge have Worker routes. Steam and every admin write do not. |

The plan's own estimate for all of this was 40 to 125 working days (docs/app-plan.md, "Effort").
Stage 1's public half took part of one session, which says nothing yet about the screens that need
new backend routes.

## The screens

### Item detail

Old: `src/components/item/*`. App: `mobile/src/components/ItemPage.tsx` (everybody's half),
`mobile/src/app/item/[id].tsx` (yours).

| Feature | Old site | App |
|---|---|---|
| Swipeable 3:4 image hero with dots, title in the scrim | `DetailHero.tsx` | **yes** |
| Back and share buttons on the hero | `DetailHero.tsx` | **yes**. Share hands out the fandex.org address, which serves nothing until phase 3 |
| Meta line: year · runtime · director | `ItemView.tsx` | **yes** |
| Release dates per source with provider logos, when sources disagree | `ItemView.tsx` | **yes** |
| Community score pills, with the Steam review label, linking out | `RatingsSection.tsx` | **yes** |
| Tagline, description | `ItemView.tsx` | **yes** |
| Facts: sixteen rows from Director to Box office | `FactsSection.tsx` | **yes**, as text. The credits do not link anywhere yet (stage 7) |
| Trailer: YouTube player, or a Steam link | `LowerSections.tsx` | **yes** in a browser. On a phone it is the still with a play button that opens YouTube: an inline player needs a web view the app does not ship |
| Cast: photo circles with character | `LowerSections.tsx` | **yes**, not yet linking to the person (stage 7) |
| Where to watch: logos, offer type, link out, JustWatch credit, and a sentence when there is nowhere | `LowerSections.tsx` | **yes** |
| DLC and expansions | `LowerSections.tsx` | **yes** |
| Tags grouped by category in the facet colours; Platforms and Modes groups | `LowerSections.tsx` | **yes**, not yet linking to the tag (stage 7) |
| Links with brand marks | `item/StoreLink.tsx` | **yes** |
| Desktop: two columns, sticky gallery with thumbnails, prose capped at 68ch | `ItemView.tsx`, `MediaGallery.tsx` | **no**. A wide window gets the phone layout in a 720 px column |
| Fandex Score panel: number, band sentence, "Why?" | `FandexScoreSection.tsx` | partial. Badge, top four reasons, "Show all". No band sentence |
| Breakdown: baseline row, every reason, uncounted ones greyed, sum row, reasons link to facet pages | `FandexScoreSection.tsx` | partial. No baseline or sum row, no links |
| Score panel signed out and at cold start | `FandexScoreSection.tsx` | **no**. Nothing renders when there is no score |
| Rate: ten-star picker, re-tap clears | `PersonalSection.tsx` | partial. Ten number buttons |
| Save to wishlist, Remove from library | `PersonalSection.tsx` | **yes**, styled differently |
| Rate and Save shown signed out, opening sign-in and resuming | `PersonalSection.tsx` | **no**. The block is hidden signed out |
| Hide from suggestions | `PersonalSection.tsx` | **no**. Hidden rows sync to the device; no control writes one |
| Your status: "✓ watched on Trakt · date", review quote, per-platform ratings | `RatingsSection.tsx` | partial. "In your library · status", "You rated it N" |
| Episode tracker: seasons, n of total, tick an episode or a season | `EpisodeTracker.tsx` | **no**. `GET /v1/shows/{id}/episodes` exists and the app does not call it |
| "More from {franchise}" rail | `RelatedRails.tsx` | **no**. `franchise_members` is not in D1 |
| "More like this" rail | `RelatedRails.tsx` | **no**. The device holds what the ranking needs |
| Where to buy (affiliate rows) | `LowerSections.tsx` | **no**, and dark on the site too (`MONETIZATION_ENABLED`) |

### Home

Old: `src/app/page.tsx`, `src/app/HomePageClient.tsx`. App: none. The app opens on Calendar.

| Feature | Old site | App |
|---|---|---|
| Home as the landing tab | `AppNav.tsx` | no |
| One type filter driving every rail, remembered across screens | `SubBar.tsx`, `ui/TypeFilter.tsx` | no. Each screen has its own chips, not remembered |
| Guest panel: sign in to unlock your Fandex Score, or browse without | `HomePageClient.tsx` | no |
| "Up next" rail with tick and See all | `ProgressRail.tsx` | partial. Lives in Library and the widget |
| "Recommended for you" rail with the FOR YOU pill | `/api/home` | no. The scores exist on the device; nothing ranks by them |
| "Popular right now", "Upcoming" rails | `home_snapshot` | no |
| "Popular people" rail | `PersonCard.tsx` | no |
| Rail anatomy: serif title, See all arrow, 150 px columns | `Rail.tsx` | no rail component |
| Skeletons sized to the real card; an empty rail says why | `HomePageClient.tsx` | no skeletons anywhere |
| Genre and calendar-month link hub (for crawlers) | `CatalogHub.tsx` | no |

### Discover

Old: `src/app/discover/DiscoverPageClient.tsx`, `src/components/GroupedView.tsx`. App:
`mobile/src/app/(tabs)/browse.tsx`.

| Feature | Old site | App |
|---|---|---|
| Provider-fed feed: games, films, shows, upcoming and past | `/api/discover` | no. Browse lists only the pool on the device |
| Poster grid, 2 to 6 columns | `GroupedView.tsx` | no. List rows |
| Sort: Release date, Popularity, Rating, Fandex Score | `discovery/types.ts` | no. Fixed order, most voted first |
| Release-date sort: month dividers, scroll to today, load both ways | `GroupedView.tsx` | no |
| Type chips: icon circles, multi-select, remembered | `ui/TypeFilter.tsx` | partial. Text pills, one at a time |
| Search in the page, merged with provider results under the chosen sort | `/api/discover/find` | partial. A separate tab, three unmerged sections |
| People and Tags result groups | `/api/discover/facets` | no |
| Filters: must include / must exclude, with autocomplete | `discovery/FacetAutocomplete.tsx` | no |
| Filters: available on (streaming and platforms, counts, logos) | `discovery/FilterPanel.tsx` | no |
| Filters: your lists (any / only / hide), release year range | `FilterPanel.tsx` | no |
| Filter count, Reset all, "Show N titles" | `SubBar.tsx` | no |
| Score on each card | `PosterCard.tsx` | yes, styled differently |
| Rate and save from the card | `ActionCells.tsx` | no |
| Long-press score explainer | `Tooltip.tsx` | no |
| Query, filters, sort and scroll restored on Back | `usePersistedState` | no |
| Header hides scrolling down, returns scrolling up | `lib/useHideOnScroll.ts` | no |

### Calendar

Old: `src/components/CalendarView.tsx`. App: `mobile/src/app/(tabs)/index.tsx`.

| Feature | Old site | App |
|---|---|---|
| Month grid, day-first cells, today ring | `CalendarCell` | no. A day-grouped list |
| Tap a day: rail of cards below, month collapses to the week | `CalendarView.tsx` | no |
| List view grouped This week / Next week / month, with a toggle | `AgendaView` | partial. Whole month by day, no toggle |
| List row with your state marks, Rate and Bookmark | `AgendaRow` | partial. No actions, no marks |
| Scope chips: Wishlist, Library, Popular | `ui/ScopeFilter.tsx` | no. Popular only |
| Previous, next, Today | `CalendarView.tsx` | yes |
| Swipe to change month | `CalendarView.tsx` | no |
| "N releases" line | `CalendarView.tsx` | no |
| Opening a title nobody holds | `/r/…` | yes, `open/[source]/[type]/[id].tsx` |
| Region from your account's country | `users.country` | partial. The device's locale, not settable |

### Library and Wishlist

Old: `src/components/MyStuffView.tsx`. App: `mobile/src/app/(tabs)/library.tsx`.

| Feature | Old site | App |
|---|---|---|
| Tabs Wishlist / Progress / Library | `LibraryWishlistTabs.tsx` | yes, as chips. Opens on Library; the site opened on Wishlist |
| Poster grid | `GroupedView.tsx` | no. List rows |
| Search within the list | `SearchBar.tsx` | no |
| Sort: Recently added, Release date, Popularity, Rating, Fandex Score | `LIBRARY_SORTS` | partial. Recent, Your rating, A to Z |
| Wishlist by release date: month groups, scroll to today | `GroupedView.tsx` | no |
| Filters sheet | `FilterPanel.tsx` | no |
| Filtered count in the header | `SubBar.tsx` | partial. The tab's total |
| Rate and save from the card | `ActionCells.tsx` | no |
| Empty state with links to connect or discover | `OnboardingState` | partial. Text and "Check again" |
| One collapsed header in place of three chip rows | `SubBar.tsx` | no. Known problem in docs/app.md |

### Up next

Old: `ProgressTabPanel.tsx`, `EpisodeRow.tsx`. App: `library.tsx`, `mobile/src/lib/upNext.ts`.

| Feature | Old site | App |
|---|---|---|
| Next unwatched episode per show; a tick marks it | `EpisodeRow.tsx` | yes |
| Row: flush poster, "S.02 E.04" accent chip, serif show title | `EpisodeRow.tsx` | partial. The generic row |
| Tick animation: fill, hold, fade, show moves to the front | `ProgressTabPanel.tsx` | partial. Spinner, then reload |
| Six sorts; search and filters apply | `PROGRESS_SORTS` | no |
| The whole list | `/api/progress?full=1` | partial. Capped at 30 |
| Hidden shows left out, findable by name with a "Hidden" pill | `EpisodeRow.tsx` | partial. Left out, not findable |

### Search

Old: `src/components/NavSearch.tsx` and Discover's search. App: `mobile/src/app/(tabs)/search.tsx`.

| Feature | Old site | App |
|---|---|---|
| Title search over the catalog and the providers | `/api/discover/find` | yes |
| One merged, sorted grid | `DiscoverPageClient.tsx` | no. Three sections |
| People and Tags suggestions | `NavSearch.tsx` | no |
| Filters and sort apply to a search | Discover | no |
| Score, rate and save on a result | `PosterCard.tsx` | no |

### Facet pages (tag, person, studio)

Old: `src/components/facet/PublicFacetView.tsx`. App: none.

| Feature | Old site | App |
|---|---|---|
| Header: role, name, photo, bio, born / age / place | `PublicFacetView.tsx` | no |
| Tag category chip, "Also known as" | same | no |
| Tiles: crowd average, your average over n rated, titles | same | no |
| "You score X higher than the crowd" | `/api/facet/mine` | no |
| Grid with four sorts, grouping, Load more | `/api/facet` | no |

### Insights

Old: `src/components/insights/*`. App: none.

Overview tiles · "How you rate" histogram with tappable bars · distribution by type · taste by
era · you against the crowd · tag, people and studio ratings (search, minimum count, highest and
lowest, per-category panels) · most watched. All **no**.

### Profile and Settings

Old: `src/app/profile/ProfilePageClient.tsx`, `src/app/settings/SettingsPageClient.tsx`. App:
`mobile/src/app/(tabs)/you.tsx`.

| Feature | Old site | App |
|---|---|---|
| Avatar, name, handle, joined year | `ui/Avatar.tsx` | partial. Name only; the avatar and the date arrive and are unused |
| Stats strip: tracked, rated, wishlist | profile | partial. Two counts as lines |
| Rows to Insights, Wishlist, Your ratings, Settings | profile | no |
| Recently added, Coming up, Recommended | profile | no |
| Log out | profile | yes |
| Connected accounts: connect, sync, disconnect, last sync | settings | partial. Trakt only |
| Join two accounts, choosing which side wins | `settings/MergePanel.tsx` | no. The app stops at `merge-required` |
| Country | settings | no |
| Default types, Your platforms | `settings/MediaTypePicker.tsx`, `PlatformPicker.tsx` | no |
| Download your data, Delete account | settings | no. The Worker has both routes |
| Import from Letterboxd or IMDb | `src/app/import/ImportPageClient.tsx` | no |
| Legal pages in English and German, footer | `src/components/legal/*` | no |

### Navigation, sign-in, admin

| Feature | Old site | App |
|---|---|---|
| Bottom bar: Home, Search, Calendar, Wishlist, You | `AppNav.tsx` | different: Calendar, Search, Library, Browse, You |
| Desktop top bar: logo, links, search, avatar | `AppNav.tsx` | no |
| Shared list header: type chips, tabs, search, sort | `SubBar.tsx` | no. Each screen builds its own |
| Bottom sheet, sort menu, toast, confirm dialog, skeletons | `src/components/ui/*` | no |
| Sign in with Google, Discord, Trakt, Steam | `auth/AuthOptions.tsx` | Trakt only. Discord is dropped by decision |
| Sign-in dialog from any gated control, returning to where you were | `auth/SignInDialog.tsx` | no. A card on You |
| Scoring admin: weights and taxonomy | `src/app/dev/scoring/*` | no |
| Analytics and users dashboards | `src/app/dev/analytics`, `src/app/dev/users` | no |

## The kit: what differs in the design system

Same: every colour, radius and spacing value, and the three font families.

| Thing | Site | App |
|---|---|---|
| Type scale | 9 / 10 / 11 / 13 px | One step up on purpose (`theme.ts`). Still missing: serif 30, micro 8 |
| Fandex Score colours | high `#5FE39A`, baseline `#CFC9BE`, low `#F0A04B` | A weak match is red (`#E5674C`), on the site it is orange |
| Fandex Score badge | a bare serif number | a bordered box |
| Community score | serif "7.4" with mono "/10" | a 0 to 100 integer |
| Screen gutter | 20 px | 16 px. The item page uses 20 since 2026-10-05 |
| Card | bordered 10 px card, 2:3 poster, type chip on the poster, serif title, mono date, serif score, Rate and Bookmark bar | none. A 56 px row |
| Grids and rails | 2 to 6 columns; 150 px rails | neither |
| Type chips | 40 px icon circles, multi-select, filled in the type's colour | text pills, one at a time, always gold. "Films" where the site says "Movies" |
| Buttons | five variants, pill radius for the primary | two variants, 10 px radius |
| Nav bar | surface background, mono uppercase 8 px labels | elevated background, sans 11 px |
| Search field | elevated fill, 12 px radius, clear button | inset fill, 10 px, no clear |
| Not in the app at all | sheet, menu, toast, skeleton, avatar, the FOR YOU pill, panel, stat tile | |

In the app since 2026-10-05: the facet colours (`color.facet`), brand marks (`BrandGlyph.tsx`),
real anchors (`ExtLink.tsx`) and real images (`Img.tsx`, `Img.web.tsx`).

## What the Worker does not serve yet

Checked against `worker/src/index.ts`.

- The Home feed: trending, upcoming, popular people.
- The Discover feed: paged provider browse, and catalog find with filters and sort.
- Autocomplete over people, tags and studios.
- Facet pages: the grid for a person, tag or studio, a person's bio, the crowd averages.
- Franchise members (`franchise_members` is built and not applied, docs/worker.md).
- The platform survey behind "Your platforms" and the "available on" counts.
- Steam (sign-in and owned games), the import, telemetry, and every admin write.
- The calendar's personal scopes. `/v1/calendar` is popular only, 40 cards a month.
- Episodes for a show resolved after the seed.

Routes that exist and the app does not call: `PUT /v1/me/prefs`, `GET /v1/me/export`,
`DELETE /v1/me`, `POST /v1/auth/google`, `POST /v1/auth/merge`, `GET /v1/shows/{id}/episodes`,
`GET /v1/items/{type}/{slug}`, and the `hidden` half of `PUT /v1/me/state`.

⚠️ Every new route is priced in D1 row writes and Worker CPU before it is built (docs/worker.md).
Recommendations, "More like this" and Insights should be computed on the device, which holds the
pool with its facets; whether that covers facet pages and Discover, which reach outside the pool,
is not settled.

## What the app has that the site did not

Parity must not cost any of these.

- The catalog, library and wishlist on the device: Browse, Library and local search work offline.
- The Up next home-screen widget, with a tick that works in the background.
- Trakt sign-in with no secret on the device, and Trakt sync from the device with its four guards.
- The Fandex Score computed on the device, identical to the site's on 4,559 titles.
- The You tab's device panel: catalog counts, sync status, "Check for changes", "Download again".
- Calendar: pull to refresh, sticky day headers, the "may be missing titles" note.
- Search answering per source, each with its own error line.

## Not checked

- How any of this looks on the phone itself. The comparison was read from code and a browser.
- The mockups in `docs/design/fandex-handoff/04-pages/`. The live site was the reference.
- What expo-router shows for an unknown address. No not-found screen exists.
