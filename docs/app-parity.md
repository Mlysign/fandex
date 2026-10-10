# Parity with the old site: what the app still owes

_Written 2026-10-05, after Nils said the app "looks vastly different and is missing features".
Rewritten 2026-10-10, after he said it again about the live website and the kit and five screens
were ported in one pass. This is the list the parity work is done from._

**The rule: a screen is at parity when somebody who used the site would not miss anything on it,
and it looks like the same product.** Not pixel for pixel. The site's mobile layout is the target
for the phone; its desktop layout is the target for a wide browser window.

## How to look at the old site

`src/app` and `src/components` still hold it. It needs TWO local servers for a signed-in look:

1. `prod` (launch config, port 3100) is the one to look at. `/library`, `/wishlist`, `/settings`
   and the facet pages never hydrate under `next dev`.
2. `/api/dev/login` answers 404 on `prod` (it refuses a production build). Start `dev` (port 3000)
   too, open `http://localhost:3000/api/dev/login` once, and the session cookie works on 3100 as
   well: a cookie belongs to the host, not the port.

⚠️ Opening the old site signed in runs its Trakt sync against `data/rr.db`. That is a pull into a
local file, nothing more, but it is a call on Nils's Trakt account.

**Port a component by reading it, not by looking at it.** The first rebuild was made from the
token file and a memory of the screens, and it came out as a different product on the right
colours. `node` a comment-stripper over the old file and copy its sizes: every number in
`mobile/src/components/{kit,cards,SubBar,AppNav,UpNext}.tsx` is the old component's.

## Where it stands (2026-10-10)

Legend: **yes** at parity · **partial** exists, differs as noted · **no** not built.

| Screen | State | What is still owed |
|---|---|---|
| Navigation | **yes** | The desktop bar's search box (`NavSearch.tsx`: suggestions for titles, people, tags). It is a link to Search for now. |
| The kit | **yes** | See the kit table below. |
| Home | partial | Popular people. "Popular right now" is recent releases by popularity until the Worker serves trending. Recommendations are ranked by genre only (a calendar card carries nothing finer). |
| Wishlist / Library | partial | "Available on" in the Filters sheet. Grouping by your rating. |
| Progress (Up next) | **yes** | A hidden show is left out and cannot be found by name. |
| Search (Discover) | partial | The provider-fed feed when nothing is typed (it shows the catalog on the device). "Available on" in the Filters sheet. People and tag results. Scroll and query restored on Back. |
| Calendar | partial | The slide between months. The region comes from the device, not a setting. |
| Item page | partial | On a wide window the artwork has no thumbnails or arrows. Score panel's band sentence, baseline and sum rows. Hide from suggestions. Episode tracker. The two related rails. |
| Profile | partial | The Support Fandex row. |
| Settings | **no** | It is the old device panel under a new address. Connected accounts as panels, country, default types, your platforms, download and delete. |
| Facet pages (tag, person, studio) | partial | A person's photo and biography, "also known as", "you score X higher than the crowd", titles the catalog does not hold. No static page yet, so a crawler gets the app's shell. |
| Insights | partial | Search and the minimum-count control in the three rating sections, and the per-category tag panels. |
| Import, admin pages | **no** | All of it. |
| Sign-in | partial | Trakt only. A dialog from any gated control, returning to where you were (it sends you to You). Google, joining accounts, Steam. |

### What changed on 2026-10-10

- **Addresses are the site's**: `/` Home, `/discover`, `/calendar`, `/wishlist` (`?tab=progress`,
  `?tab=library`), `/library` (redirects), `/profile`, `/settings`. Browse and Search became one.
- **The type scale is the site's**, size for size. It had been one step larger "for a phone".
- **Every screen is inside the navigation**, the item page too, as it was on the site.
- **A weak Fandex Score is orange**, and the score is a bare serif number. It was a red box.
- **"Movie", not "Film"**, on every chip and card.

## The order from here

| # | Stage | Why here |
|--:|---|---|
| 1 | **Settings**, with export and delete. | The privacy policy points at an email address until these two buttons exist. |
| 2 | **"Available on"** in the Filters sheet. | The catalog copy on the device does not carry platforms or streaming services; the Worker's delta has to send them first. |
| 3 | **The item page's rest**: score panel, episode tracker, "More like this", artwork thumbnails on a wide window. | The page every other screen leads to. |
| 4 | **Static facet pages**, a person's photo and biography, and Popular people on Home. | The screens and the links to them exist; a crawler still gets the app's shell. New Worker routes. Also what Google already holds addresses for. |
| 5 | **The Worker's home and browse routes**: trending, and the provider-fed Discover feed. | Makes two "partial" rows honest. Price each in row writes and CPU first (docs/worker.md). |
| 6 | **Import, sign-in beyond Trakt, admin, and the rest of Insights.** | Insights is computed on the device and needs no route. |

## The kit

Same as the site now: colours, radii, spacing, fonts, the type scale, and these components.

| Thing | Site | App |
|---|---|---|
| Poster card | `PosterCard.tsx`, `ActionCells.tsx` | **yes** (`cards.tsx`). Not carried: the hover and long-press score explainer, "View details" on hover. |
| Star picker | `ActionCells.tsx` | **yes**. Opens under the card's bar; the star that is your rating clears it. |
| Rail, grid, month dividers | `Rail.tsx`, `GroupedView.tsx` | **yes**. Not carried: the rail's hover arrows, the month scrubber on a wide window, list view. |
| Type filter | `ui/TypeFilter.tsx`, `ui/CollapsibleChips.tsx` | **yes**. Once opened on a phone it stays open; the site closed it on a tap outside. |
| List header | `SubBar.tsx`, `LibraryWishlistTabs.tsx`, `SearchBar.tsx`, `ui/Menu.tsx` | partial. No hide while scrolling. |
| Filters sheet | `discovery/FilterPanel.tsx`, `FacetAutocomplete.tsx`, `ui/TriToggle.tsx` | partial (`Filters.tsx`): must include and exclude, your lists, release year. No "Available on"; the year is two fields where the site had a slider. |
| Episode row, Up next rail | `EpisodeRow.tsx`, `ProgressRail.tsx` | **yes** (`UpNext.tsx`), with the tick's fill, hold and fade. |
| Nav bars | `AppNav.tsx` | **yes** (`AppNav.tsx`). |
| Button, Panel, Eyebrow, EmptyState, Avatar, StatStrip, Skeleton, Sheet, Toast | `ui/*` | **yes** (`kit.tsx`, `Toast.tsx`). The skeleton breathes where the site's shimmers. |
| Score badges | `FandexScoreBadge.tsx`, `CommunityScoreBadge.tsx` | **yes**. |
| Logo, type glyphs | `Logo.tsx`, `LogoOutline.tsx`, `Badges.tsx` | **yes** (`Logo.tsx`). |
| Not in the app at all | `Tooltip.tsx`, `ui/ConfirmDialog.tsx`, `DualRangeSlider.tsx`, `ListCard.tsx`, `auth/SignInDialog.tsx` | |

## What the Worker does not serve yet

Checked against `worker/src/index.ts`.

- Trending (Home's "Popular right now") and popular people.
- The Discover feed: paged provider browse, and catalog find with filters.
- Autocomplete over people, tags and studios.
- Facet pages: the grid for a person, tag or studio, a person's bio, the crowd averages.
- Franchise members (`franchise_members` is built and not applied, docs/worker.md).
- The platform survey behind "Your platforms" and the "available on" counts.
- Steam (sign-in and owned games), the import, telemetry, and every admin write.
- Episodes for a show resolved after the seed.

Routes that exist and the app does not call: `PUT /v1/me/prefs`, `GET /v1/me/export`,
`DELETE /v1/me`, `POST /v1/auth/google`, `POST /v1/auth/merge`, `GET /v1/shows/{id}/episodes`,
and the `hidden` half of `PUT /v1/me/state`.

⚠️ Every new route is priced in D1 row writes and Worker CPU before it is built (docs/worker.md).

## What the app has that the site did not

Parity must not cost any of these.

- The catalog, library and wishlist on the device: Search, Wishlist, Library and Progress work
  offline, and a search or a sort never waits on a server.
- The Up next home-screen widget, with a tick that works in the background.
- Trakt sign-in with no secret on the device, and Trakt sync from the device with its four guards.
- The Fandex Score computed on the device, identical to the site's on 4,559 titles.
- The device panel (now under Settings): catalog counts, sync status, "Check for changes".

## Not checked

- **Writes, signed in.** Seen on Nils's account in his Chrome on 2026-10-10, looking only: Home
  with Up next and the recommendations, Search with his ratings on the cards, the item page in
  two columns, a person page, Insights, the Filters sheet narrowing 4,561 titles to 496. A
  rating was clicked with every save blocked in that tab, to see the request it would send
  (the right one). Nothing was actually rated, saved or ticked.
- **The phone, beyond its first screen.** An APK of this pass is on the Pixel 8 and opens on Home
  with Up next and the recommendations. The first build crashed at launch on a web-only
  accessibility role, which no browser check could have shown. No other screen was opened there.
- The mockups in `docs/design/fandex-handoff/04-pages/`. The live site was the reference.
