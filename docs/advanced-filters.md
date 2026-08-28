# The advanced filter panel: what it is, what is wrong with it, and what a platform filter costs

**Read this before touching `FilterPanel.tsx`, `SubBar.tsx`'s Filters sheet, or `Sheet.tsx`.**
Written 2026-08-27 from Nils's post-smoketest feedback. Everything here is measured; three of his
nine points turned out to have a different cause than the symptom suggested, and one of them is a
CSS trap worth knowing about far beyond this panel.

Open work lives in [TASKS.md](../TASKS.md); this is the reference behind it.

---

## 1. What the panel is today

`FilterPanel` is **not** a panel. It is a bare flex row (`FilterPanel.tsx:32`) handed to `SubBar` as
the `advancedFilters` prop, which renders it inside a shared `<Sheet>` modal. Two consumers:
`DiscoverPageClient.tsx:667` and `MyStuffView.tsx:421`.

Six controls, in render order:

| # | Label | Control |
|---|---|---|
| 1 | Must include | `FacetAutocomplete` (`tag, person, studio…`), accent `#C8A24B`, + removable chips |
| 2 | Must exclude | same, accent `#E5674C` |
| 3 | In library | 3-way segmented `Any` / `Only` / `Hide` |
| 4 | On wishlist | same |
| 5 | Rated | same |
| 6 | Year | readout `1950–2027+` + `DualRangeSlider` in a fixed `w-40` box |

The `Tri` control is deliberately **not** `ui/TriToggle`: it shows "Any" as its own pressed segment
rather than as "nothing pressed" (`FilterPanel.tsx:10-14`).

⚠️ **Rows 1 and 2 match against `facetIds`, which the SERVER computes** (`matchesFacetIds`, the only
matcher). Never re-derive facets on the client from `item.sources[].data`: the list routes ship that
as `{}`, so the derivation sees tag facets and nothing else, and a person, studio or franchise pill
matches zero items while looking exactly like a genuine zero result. That shipped and survived a
month. ⚠️ The pill's own count comes from the CATALOG vocab (`searchFacets`), not from the visible
tab, so a count above the tab's hit count is correct, not a bug.
→ [the archive](archive/history.md), "The facet pills that matched nothing"

**State** (`discovery/types.ts:102-111`): `UiFilters` carries `types, sources, yearRange, commRange,
runtimeRange, membership, includeFacets, excludeFacets`. ⚠️ **`sources`, `commRange` and
`runtimeRange` are dead in the UI** — removed by T24, still in the type and still fully supported
server-side (`discovery.ts:79-88`, predicate at `:1033-1047`). That is the working precedent for
"add a field, wire the request builder": a new filter does not need new server plumbing invented
from scratch.

`countActiveAdvanced()` (`:131`) counts a narrowed year + memberships + both facet lists, and
deliberately excludes `types` (those have their own visible chip row).

---

## 2. The five defects

### 2.1 It renders too high and is cut off — and the cause is `translate: 0px`

Measured at 375×812, transitions disabled: the `[role="dialog"]` is **288px tall at `top: −118`**,
so 118px including the "Filters" heading sits above the viewport. `max-height: none`,
`overflow-y: visible`, so nothing scrolls it back.

The tell: the backdrop is `fixed inset-0` and computes to **170px tall**. An identical
`position:fixed; inset:0` control element appended to `<body>` in the same page computes to **812**.
So the pane is not lying and the sizing is not the problem — the backdrop's *containing block* is
wrong.

⚠️ **`useHideOnScroll` toggles Tailwind's `translate-y-0` / `-translate-y-full` on the SubBar, and
in Tailwind v4 those set the standalone CSS `translate` property. A non-`none` `translate`
establishes a containing block for fixed-position descendants EVEN WHEN ITS VALUE IS ZERO.** The
SubBar therefore always traps them, retracted or not. The Sheet renders inside the SubBar's DOM, so
`inset: 0` resolves against a 171px bar; `items-end` puts the sheet at the bottom of *that* box,
which is near the top of the screen.

**The fix is a portal to `document.body`.** A `max-height` would only make the clipped panel
scrollable inside a 170px box, which is worse: it looks deliberate.

⚠️ **This generalises.** Any `position: fixed` overlay rendered inside a component that uses a
Tailwind translate utility is subject to it, and a walk of `getComputedStyle(...).transform` will
NOT find it — `transform` reads `none` while `translate` reads `0px`. Check `translate`, `rotate`
and `scale` as separate properties.

### 2.2 The year slider is unusable on touch

`DualRangeSlider` in a fixed `w-40` box. Two thumbs at ~4px apart at the extremes of a 160px track.
Nils wants two date entries instead.

### 2.3 There is no reset

The only reset in the app is a `Clear search & filters` ghost button that appears **solely inside
Discover's zero-results empty state** (`DiscoverPageClient.tsx:707` → `resetFilters()` at `:610`).
MyStuffView has none at all (`patchAdvanced` only handles `yearRange` and `membership`). Individual
facet chips have per-chip removers; the Tri toggles reset by clicking "Any".

`countActiveAdvanced()` already produces the badge count, so a "Reset (N)" affordance has its number
for free.

### 2.4 The layout wraps ugly

Six controls in a bare flex row. The three membership tri-toggles break the line, and the
include/exclude autocompletes break it again once they hold chips.

### 2.5 "On mobile it should come from the bottom" — it already does

⚠️ `Sheet.tsx:88` is `items-end` + `translate-y-full → 0` with a drag handle below `sm`, and a
centred scale-in modal at `sm`+. What makes it read as a top panel is §2.1. **Fix the portal and
re-check this point before designing around it.**

⚠️ **Do NOT reintroduce a `useMediaQuery` branch that mounts two different panels.** That existed
and was removed 2026-07-28 (`SubBar.tsx:113-120`): crossing 768px remounted the panel and dropped
in-flight facet queries. One component, two layouts, switched with CSS.

---

## 3. A platform filter: feasible, moderate, four caveats

Nils wants to filter to platforms he owns — Netflix / HBO / Apple TV+ for movies and shows, Switch /
Steam / Xbox for games.

**The data is already derived and in memory; it is simply not copied onto the vector.**
`getDerivedForItem()` returns a `MergedItem` (`facetCache.ts:53`) holding `platforms`, `storeLinks`
and `streamingProviders`. `discovery.ts:352` destructures it and `:356-370` copies six fields —
title, posters, release date, community ratings, runtime — and not those three. **No provider
re-fetch, no migration, no new column.**

Cheapest correct path: add the field to `DiscoveryVector` (`discovery.ts:39`), copy it at `:356`,
add it to `DiscoverFilters` (`:79`) and to the predicate beside `filters.sources` (`:1047`).

The alternative — a new `FacetKind` (`facets.ts:14`) — buys the existing include/exclude
autocomplete, vocab counts and IDF machinery for free, but **platform is a poor IDF citizen**
(nearly every game is on PC), so it would pollute scoring unless excluded from `ROLE_WEIGHT`. Facets
live in no database table, so adding a kind is a code change plus a `derivedSignature` bump, not a
migration.

⚠️ **`platformSources` is a false friend.** `types/index.ts:99` — that is *which of the user's
connected accounts* holds the item (trakt/steam/…), not a console or a store. It is already on every
card and it is not what this filter is about.

### The four caveats, each of which changes the design

1. **Region.** `streamingProviders` is region-resolved by `pickRegion(...)` (`merge.ts:131`), and
   `buildEntries` calls `getDerivedForItem` with `region: undefined` → `DEFAULT_COUNTRY`
   (`discovery.ts:333`). **The pool's streaming data is for the default country, not the viewer's.**
   A naive filter is wrong for every user outside it. The facet cache key already has a region slot
   so a second dimension is tractable, but it multiplies pool memory — and the pool is the one thing
   AGENTS.md forbids capping.
2. **Type asymmetry.** `platforms` comes from steam/rawg/igdb and is games-only; `streamingProviders`
   comes from TMDB and is movies/shows-only. **One "Available on" control has to swap its option set
   off the active type chips, or render as two sections. This is the main thing a mockup has to
   solve.**
3. **`storeLinks` is not a store filter.** It is a mixed bag deduped by free-text `name` — "Steam",
   "GOG", "Epic Games", but also "IMDb", "Reddit", "Metacritic", "Official site". It needs an
   allowlist before it can be a dimension. `platforms` and `streamingProviders[].providerId` (stable
   ids) are the clean fields.
4. **Coverage is partial on the browsed half.** Discover writes thin list-payload rows at
   `projection_version 0`, healed only on a first detail read (`enrich.ts:369-374`). Pool membership
   is `browsed = 0 OR acted-on`, so the curated pool is mostly fine, but promoted `browsed = 1` items
   may hold no watch-provider data at all. **A filter that silently drops them reads as broken.**
   Decide up front whether "unknown availability" is excluded or shown.

---

## 4. Related: Discover's pagination (same feedback round)

Not this panel, but reported together and fixed together.

- **The header disappears on load.** The TOP sentinel renders at scroll 0 and its
  `IntersectionObserver` has `rootMargin: "200px"`, so it fires immediately
  (`DiscoverPageClient.tsx:556-563`); `loadPrevious()` prepends and the `useLayoutEffect` at `:565`
  does `window.scrollBy(0, delta)` to hold position, which pushes the page down unasked. ⚠️
  **Reproduces only on a COLD browse cache** — measured `scrollY: 21` on a first load and 0 on every
  warm reload, because `loadPrevious` then returns nothing. Do not "verify" it on a second reload
  and conclude it is gone. The `scrollBy` is correct for a *user-initiated* prepend.
- **"Load earlier releases" under a popularity sort.** Confirmed on the prod build: sorting by
  Popularity renders both "Load earlier releases" (top) and "Load newer releases" (bottom).
  `topSentinel`/`bottomSentinel` (`:651-652`) are picked by `descending` alone and never consult
  `isDateSort` (`:633`), which is computed one line above and already gates `autoScrollToToday`.
- **The fix for both** is one change: no top sentinel unless the sort is a date sort; non-date sorts
  get a single generic "Load more" at the bottom, on scroll.

---

## 5. Settings → Your platforms (2026-08-27) — SHIPPED

Nils: *"if I only have netflix and prime, the 'available on' filter should only show those."*
Stored on `users.platforms` (migration 24, a JSON array of platformKeys); the filter reads it
through `narrowToOwned`. On the live library it takes the chip list from **185 to 2**.

**The option list is surveyed from the user's own catalog, not a curated list**, and that is not a
shortcut: this account's library carries MagentaTV, WOW, Videoload, maxdome, RTL+, Joyn and Freenet
meinVOD, and a global list written from memory contains none of them. `userPlatformSurvey.ts` reads
the four provider shapes straight out of the stored JSON with `json_each` — **143 ms and ~1 MB**,
against ~160 ms + 41 MB for the merge path warm, and 0.5 to 1.5 s cold.

⚠️ Three things measured during the build that are easy to get wrong again:

- **Steam's `platforms` is not only platforms.** It also carries `vr_support`, `steamos_linux` and
  four `*_compat_category` keys, 730 rows each. A truthiness test offers "vr_support" as something
  you own. `normalize.ts` allowlists windows/mac/linux; the SQL has to say the same thing.
- **An empty owned list means NOT CONFIGURED**, never "owns nothing". The two are indistinguishable
  in the column, and the wrong reading empties the filter for everyone who never opens settings.
- **A SELECTED platform survives the narrowing even when it is not owned.** Without that, selecting
  Nintendo Switch and then narrowing to Netflix left the list filtered to 209 titles with no chip to
  un-press and only Reset all as an escape.

**Not done:** the streaming half is still empty on Discover, because the browse feed carries games
platforms but not watch providers. → §3 above.


---

## 6. The chips come from the ACCOUNT, not from the screen (2026-08-27) — SHIPPED

Nils, on the Discover filter sheet: *"the streaming platforms are not shown anymore. and it should
also show streaming and game platforms if they have 0 results, just to give users that info,
secretly hiding them is bad UX."*

**Streaming was never "removed" from Discover; it had never had a row to count.** §5 recorded that
as a known gap and the panel expressed it by rendering nothing, which is the part that was wrong.
`platformOptions()` built the whole list from the items on screen, `PlatformGroupRow` returned
`null` on an empty list, and Discover's feed is UPCOMING releases — which TMDB holds no watch
providers for, and never will, because an unreleased film is not streaming anywhere. So the
Movies & shows heading disappeared and the sheet looked like it had lost half its function.

**What changed:**

- `withKnownPlatforms(loaded, known)` (`platformKeys.ts`) merges the loaded counts with the
  account's own survey and gives everything else a **0**. Sorted: what is actually here first, then
  the rest by how much of the account's catalog sits on them, so the tail behind "+N more" is the
  tail nobody uses. This deliberately reverses `platformOptions()`'s old rule ("never offer a
  control that returns nothing") — the note is on both functions.
- A 0 chip is muted but **pressable, not disabled**. Pressing it says what happened; a disabled
  control explains even less than a missing one.
- `useKnownPlatforms()` reads `/api/settings/platforms` — the same per-user survey Settings uses,
  cached server-side per (user, region, signature) and module-cached client-side. **Behind
  `probeSession()`**, so an anonymous sheet does not fire a call doomed to 401. The sheet mounts
  only when it opens, so this costs one request per browser, and it also supplies `region` (the
  `· DE` hint, whose prop had never been passed by either consumer) and a fresher `selected`.
- **A group is never dropped, it explains itself**: three causes, three messages, because the fixes
  are opposite — you own nothing of that kind (links to Settings), or nothing loaded carries the
  data.
- The two group headings are gated on the **visible media types** (`visibleTypes`), so "Movies only"
  in the chip row, or Games off in Settings, hides the section that mirrors it rather than showing
  an empty one.
- Saving in Settings now calls `resetKnownPlatforms()` + `resetSessionProbe()`. Both client caches
  held the old list, so changing your platforms did nothing to the filter until a full reload.

⚠️ **Measured after, signed in, region DE:** the survey holds **185 options, 122 of them streaming**.
With platforms configured (this account owns 2) the sheet shows `Movies & shows: Netflix 0` and
`Games: PlayStation 5 6`. Unconfigured accounts get 8 chips per group with the rest behind "+N
more", ordered by their own library's usage — the `PLATFORM_PREVIEW` cap is what keeps 185 rows
from becoming the wall §2.4 was about.

### 6b. Settings → Your platforms is collapsed to two rows

Same session, same complaint one screen over: 195 chips, 122 of them streaming, is a wall you
scroll past to reach the rest of Settings. Each group now shows **two rows** — your picks first,
then the services the most of your library sits on (`options` arrives count-descending, so the
"backfill with popular ones" order is free) — with `Show all N` per group.

⚠️ Three things measured during the build, each of which the obvious implementation gets wrong:

- **Two rows is a MEASUREMENT, not a chip count.** A row holds 3 chips at 375px and 6–8 at desktop.
  The group renders the full list once, reads which chips landed in the first two rows by
  `offsetTop`, and re-renders that many; `useLayoutEffect` keeps the long version off the screen.
- **It SLICES, it does not `overflow: hidden`.** A clipped chip is still tabbable and still read
  out, so keyboard focus walks into an invisible row and the browser scrolls the hidden box to
  chase it. This was the first implementation, and it is why the second one exists.
- **Measure again after `document.fonts.ready`.** Measured under the fallback font, the streaming
  group fit 7 chips where the real font fits 6 and the games group fit 7 where it fits 8 — the
  count then freezes, leaving row two ending 177px short. The other direction is worse: a narrower
  fallback pushes a chip into a third row that nothing is clipping any more.
- **The selected-first order is FROZEN while you work** (re-snapshotted on expand/collapse, on a
  new option list, and when the selection first arrives). Re-sorting per toggle makes the chip you
  just tapped jump to the front and pushes the next one you wanted out of the two visible rows.

⚠️ Found while testing, and unrelated to the collapse: `toggle` computed the next list from
`selected` state, so two toggles inside one render tick lost one of them. It reads a ref now.

⚠️ **Verifying this needs a real build** (`/settings` is dead under `next dev`) **and the pane's
viewport emulation does not fire `resize`** — `window.__rs` stayed 0 across two preset changes. Load
the page at the width you want to test instead. `NEXT_DIST_DIR=.next-prod npx next build` +
`npm run start:alt` (:3110, `prod-alt`) builds and serves without touching a `.next` that another
session's `next dev` is holding.

### 6c. "Why does the filter find nothing?" — measured on prod, 2026-08-27

Every chip read 0, games included, which §6 does not by itself explain. `/api/health` on prod did:

| host | requests | outcome | blocked by the breaker |
|---|---|---|---|
| `api.rawg.io` | 5 | 5 × 401, `latchedOnAuth: true` | 21 |
| `api.igdb.com` | 9 | 9 × networkError | 156 |
| `id.twitch.tv` | 6 | 6 × 200 | 0 |

Both games providers open at once, so `GET /api/discover` returned **20 movies + 20 shows and no
games**, and `?section=games` returned `{"items":[]}`. With no games in the loaded set there is no
`platforms` data either, and movies and shows never carry watch providers on this feed — hence
twelve zeroes. The filter was reporting the outage accurately; it just had no way to say so.

**It says so now:** when every chip in the sheet is at 0, the section prints one line rather than
leaving the reader to interpret a wall of zeroes. → `FilterPanel.tsx`.

⚠️ The RAWG 401 is the known quota exhaustion (TASKS.md, "Needs Nils" #2). The IGDB failures are
NEW and are the reason games vanished entirely; `id.twitch.tv` answering 200 rules out the token.
A timeout or a `BROWSE_BUDGET_MS` abort is counted as a network error (`http.ts:572`) and opens the
breaker, so a merely SLOW provider can latch itself out for 15 minutes at a time.
