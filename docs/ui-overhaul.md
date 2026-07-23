# H1 — UI/UX Overhaul (mobile-first) — Working Doc

_Created 2026-07-20. Task list + status live in [TASKS.md](../TASKS.md) (H1.x); this doc is the design/requirements record, the way [fandex-score.md](fandex-score.md) is for H5._

## 1. Pipeline & sources of truth

The process was settled in the **Fandex — UI/UX Development Workflow** doc on the Miro board and runs in four steps:

1. **Requirements pass** (Claude Code) — per-page inventory from the live code (§4 below). ✅ done 2026-07-20.
2. **Visual direction** (Claude Design) — 2–3 distinct directions applied to ONE representative page (Home or Media detail), user picks one.
3. **Lock the design system** — tokens, component set, one icon library, typography + logo direction.
4. **Apply + implement** — roll the system across all Page Mockups in Claude Design, then build it in code.

Sources of truth: **live codebase** for features/content/states; **Miro frames** for target structure (priority: Page Mockups > Modular UI Elements > App Structure). Still open by design: visual language, logo, iconography, fonts.

Miro links (board `uXjVHIanl4w=`):
- [Workflow doc](https://miro.com/app/board/uXjVHIanl4w=/?moveToWidget=3458764678553227274)
- [App Structure](https://miro.com/app/board/uXjVHIanl4w=/?moveToWidget=3458764678407330625)
- [Sitemap](https://miro.com/app/board/uXjVHIanl4w=/?moveToWidget=3458764678567702238)
- [Page Mockups](https://miro.com/app/board/uXjVHIanl4w=/?moveToWidget=3458764678510157211)
- [Modular UI Elements](https://miro.com/app/board/uXjVHIanl4w=/?moveToWidget=3458764678448900235)

## 2. Target IA — **LOCKED 2026-07-20 (H1.1)**

From the Sitemap/Page Mockups frames. **This is an IA restructure, not a re-skin**:

| Board target | Today in code | Change |
|---|---|---|
| `/` Home — public browse (Popular / Upcoming / Fandex Recommendation carousels) | `/` is a login landing that redirects logged-in users to `/dashboard` | New public Home page; landing/auth content moves elsewhere (sign-in dialog already exists) |
| `/calendar` — top-level page | Calendar is a *view mode* inside Wishlist/Library (`CalendarView`), no route | New route wrapping the existing view |
| `/wishlist` — top-level page | Wishlist page lives at **`/dashboard`** (nav label + tab title already say "Wishlist") | Rename/move route + redirect |
| `/profile` — top-level hub (account + stats + recent adds + upcoming + recommendations) with sub-pages Library / Insights / Settings / ToS-Imprint | `/settings` doubles as Profile (tab title "Profile"); no hub page; Library/Insights are top-level nav links | New Profile hub; Settings becomes a sub-page; **H4.1's legal footer lands here** |
| Bottom mobile nav, 5 icons: Home · Search · Calendar · Wishlist · Profile | Top `NavBar` (desktop links + mobile hamburger); search is per-page inside `SubBar`, no global search surface | New bottom nav (mobile) + decide desktop treatment; satisfies H4's "profile in ≤1 click from everywhere" |
| Media detail + Facet as convergence pages | Exist: `/{type}/{uuid}/{slug}` (P13) and `/person` `/tag` `/studio/{slug}` (P17) | Styling only, no structure change |

**H1.1 decisions (locked with Nils, 2026-07-20):**

1. **Full route adoption**: `/` becomes the public browse Home (anon: Popular + sign-in CTA; logged-in: personalized rows); `/dashboard` → `/wishlist` with a 308 redirect; new `/calendar` route wrapping the existing calendar view; new `/profile` hub with `/settings` demoted to a sub-page (URL stays `/settings` — the hierarchy is navigational, no redirect needed, matching the sitemap's own paths).
2. **Adaptive nav**: one nav component — 5-icon bottom bar on mobile, the same 5 items as a top bar on desktop (≥md). Desktop keeps its multi-column layouts.
3. **Search = Discover**: the Search nav slot navigates to `/discover` (search bar focused). No new search surface; `SearchModal.tsx` stays dead → delete in H1.6.
4. **New bundles**: build the Home carousel bundles (Popular / Upcoming / Fandex Recommendation — largely derivable from the Discover feed + Fandex scores) in H1; **defer Similar Items** (real similarity logic, separable) to its own post-H1 task.
5. **Discover default = Popularity for everyone** (anon + logged-in) — decided by industry convention (Letterboxd/Trakt/TMDB/AniList/IMDb all default their browse surface to popularity/trending, identical anon vs logged-in; personalization lives on Home, upcoming lives on Calendar). Supersedes both the board sticky note (Fandex-prefill for logged-in) and H5.7's releaseDate default. ⚠️ H1.6 must verify the anon popularity view is non-empty (post-Q16 sorts re-sort the same browse set client-side, so it should hold — this exact worry is why H5.7 chose releaseDate).

## 3. Component inventory — board spec ↔ code

| Board (Modular UI Elements) | Code today | Notes |
|---|---|---|
| Card Carousel View | **does not exist** | New component; needed by Home / Profile / Calendar-day / detail-similar mockups |
| Calendar View (+ skip next/prev month) | `CalendarView.tsx` | Skip-to-**previous**-month missing (board flags it) |
| Card Grid View | `GroupedView` + `PosterCard` (unified in Q14) | Month/rating dividers + scrubber included |
| List View | `GroupedView` + `ListCard` | Day dividers optional per board |
| Card/List/Calendar Item Views | `PosterCard`, `ListCard`, `CalendarView` day cells | Calendar day cells still `onClick`-based (N3 leftover) |
| Quick actions (score / wishlist / library) | `ActionCells`, `QuickActions`, `useQuickActions` | Shared via `cardItem.ts` (see [[card-list-components]]) |
| Media Type Filter (5 types, persists globally) | `SubBar` type toggles + `rr_type_filter` (SM2) | Board wants Books + Boardgames icons too — only games/movies/shows exist as types today |
| Simple + Advanced Search | `SubBar` search + `FacetAutocomplete` pills + `FilterPanel` | `SearchModal.tsx` is **orphaned** (defined, never imported) — delete or revive in H1.6 |
| Sort (persists per view) | `usePersistedState` per page + unified 4-sort model (H5.7) | Matches board |
| Insight Stats | `insights/*` (OverviewCards, Histogram, StatBar, FacetSection) | Board reuses these on Home/Profile mockups |
| Fandex Score + breakdown modal | `FandexScoreBadge`, `FandexScoreSection` (overlay, Q20) | Live |
| Mobile Nav Bar (bottom, 5 icons) | **does not exist** (top `NavBar` + hamburger) | New component |
| Facet Data view | `PublicFacetView` + facet stats | Fandex badges on facet items added Q24 (board's "score absent" flag is stale) |

## 4. Requirements inventory (H1.0 output, verified against code 2026-07-20)

Template per page: **Access · Data · Views · States · Auth variants · Components · Open questions.**

### `/` — Landing (public)
- Data: none. Views: logo + pitch + `AuthOptions` + "Browse without an account →" (`/discover`).
- States: default only (client probe redirects logged-in → `/dashboard`; brief unstyled flash possible).
- Open: entire page is replaced if `/` becomes public Home (§2) — where does first-visit auth pitch go?

### `/dashboard` — Wishlist (user-only; target: `/wishlist`)
- Data: `GET /api/calendar` (wishlist + upcoming); auto-sync on >24 h staleness; live row removal on quick-action un-wishlist (SM1).
- Views: list / card / calendar (`useViewMode`, calendar only for date sorts); month or rating grouping; scrubber.
- States: loading (skeleton/spinner per view) · **onboarding empty** (3-step checklist w/ provider status) · filtered-empty (clear-search CTA) · default. No explicit error state (fetch failure → stuck; harden in H1.6).
- Auth: anon redirected to `/`.
- Components: `NavBar`, `SubBar` (global type filter, search+facet pills, 4 sorts, `FilterPanel` year/membership, sync button), `GroupedView`/`CalendarView`, scroll-restore + auto-scroll-to-today (**Q3 open**: default sort/scroll lands mid-list).

### `/library` — Library (user-only)
- Data: `GET /api/library` (includes wishlist membership + community ratings + Fandex scores).
- Views/States/Components: same stack as Wishlist plus `hideRated` toggle; wishlist filtering happens here via membership filter. Same missing-error-state note; **Q3** applies here too.

### `/discover` — Discover (public + user)
- Data: browse timeline `GET /api/discover` (45-min TTL feed, bidirectional load-more sentinels); catalog search `POST /api/discover/find` when query/facets/year active; external supplement `/api/discover/facet-fetch` (membership-filtered, Q17); every shown item persisted (thin-write pool rule).
- Views: list / card; timeline (date grouping) vs flat results; 4 sorts client-re-sorted over the same browse set (Q16), scroll anchoring for non-date sorts (Q26).
- States: skeleton loading · sentinel loading/end bars · no-results empty · default.
- Auth variants: anon = timeline + popularity data, sign-in dialog on gated actions; logged-in = Fandex-decorated feed (Q15), hide-owned membership filters.
- Components: `NavBar`, `SubBar` + `FilterPanel`, `GroupedView`, `SentinelBar`.
- ~~Open: board mockup prefills Discover with Fandex-sorted items for logged-in~~ **Resolved (H1.1):** default sort becomes **Popularity for everyone** (industry convention; Home owns personalization, Calendar owns upcoming). Implement + verify anon non-emptiness in H1.6.

### `/insights` — Insights (user-only)
- Data: `GET /api/insights` (overview, histogram, per-category facet stats w/ Bayesian averages, category overrides).
- Views: stat cards, histogram, ranked stat bars per tag-category/people/studios, item-card rows.
- States: loading · empty (no rated items, CTA → library) · error (retry) · ready. **The only page with all four states today.**
- Auth: anon redirected. Admin extra: `TagCategoryHoverPanel` (gated).
- Components: `insights/*`, `NavBar` (no `SubBar` — no type filter here; board keeps it that way).

### `/settings` — Settings/Profile (user-only; target: split into `/profile` hub + `/settings` sub-page)
- Data: `GET /api/auth/me` (identities, sync logs, item count); `POST /api/settings` (country); provider connect/disconnect; RAWG credential form; OAuth result notices via query params.
- States: default · per-action busy states (syncing/disconnecting/saving) · notice banners. No skeleton.
- Components: `NavBar`, `ConfirmDialog`, country select (T22 region).
- Open: which blocks move to the Profile hub (board mockup: stats + recent library adds + upcoming wishlist + recommendations) vs stay in Settings (providers, region, RAWG form, account deletion H4.6). H4.1 legal footer lands on the hub.

### `/{type}/{uuid}/{slug}` — Media detail (public SSR + client island)
- Data: `resolvePublicDetail` (cached 30 min, PR6) — catalog half server-rendered (crawler-safe, viewer-independent except region T22); per-user half (`PersonalSection`) client-fetched from `/api/detail`.
- Views: `MediaGallery` (poster/images pager), type badge, per-source release dates, tagline, `RatingsSection` (crowd), `FactsSection`, description, `LowerSections` (cast strip Q21, tags/details facet chips, where-to-watch badges — non-clickable until P18, More-links Trakt/IMDB/TMDB/Steam), `PersonalSection` (stars, wishlist/library, `WishlistPanel`, `FandexScoreSection` breakdown overlay w/ capped rows Q29).
- States: default · branded not-found · slug-drift 308 · anon (no personal section fetch; star click → `SignInDialog`) · cold-start score nudge. No skeleton for the client island.
- Open (board): layout when metadata is missing (no trailer/credits); **"Fandex Similar Items" carousel is in the mockup but the feature does not exist in code at all** — new backend work, flag for H1.1 scoping.

### `/person` `/tag` `/studio/{slug}` — Facet pages (public SSR, force-dynamic)
- Data: `buildPublicFacetDetail` (cached 1 h, PR7; provider name-search resolution, persist-at-fetch, rank-normalized popularity Q23); logged-in overlay `POST /api/facet/mine` (personal stats, Fandex scores incl. non-catalog ids Q24, tag impact pill Q28).
- Views: header (photo/bio/roles, collision note Q12), stats, tag extras (category badge, bundle members, impact pill, Bayesian crowd avg), `GroupedView` grid with 3 crowd sorts + logged-in Fandex sort, admin `TagAdminControls` (gated).
- States: default · unknown-slug branded 404 · provider-failure (uncached) · anon vs logged-in vs admin.
- Open: no `FilterPanel`/type filter here (board wants the media-type filter persistent on every page); P17's deferred UX/taste pass folds into H1.6.

### Legacy / utility routes
- `/item` + `/item/debug` (debug), `/insights/facet` (308 → facet pages), `/dev/scoring` (admin, out of H1 visual scope — functional styling only).

### Pages that exist only on the board (net-new)
- **Home** (public browse: Popular / Upcoming / Fandex Recommendation carousels + insight stats + search) — needs the new Card Carousel component + a Popular/Recommendation bundle API shape (Discover's feed + `/api/insights` cover parts; no carousel-shaped endpoint exists).
- **Calendar** (dedicated page: calendar + selected-day item carousel).
- **Profile hub** (see `/settings` above).

## 5. App Structure frame — corrections list (for Nils to apply on the board)

Code-vs-frame divergences found in H1.0. Per the workflow doc, code wins on features/states; the board wins on target structure — items below are *factual* corrections, not design pushback:

1. **"Fandex Similar Items" bundle**: shown as an existing data bundle — it does not exist anywhere in code (no API, no component). Mark it dashed/proposed.
2. **"Popular" bundle**: no dedicated Popular endpoint/bundle exists; popularity is a *sort* over the Discover feed and community-vote data on items. Mark as proposed (derivable, but new API shape).
3. **"Fandex Recommendation" bundle**: exists only as the Fandex-decorated Discover feed + score sort — there is no standalone recommendation list/carousel. Mark as proposed.
4. **Facet Data missing Fandex score**: stale — facet items got Fandex badges + the tag impact pill on 2026-07-19 (Q24/Q28). Remove the gap flag.
5. **Wishlist page**: exists today at `/dashboard` (not `/wishlist`); Calendar and Profile pages don't exist as routes yet (calendar is a view mode; profile is `/settings`). Match the dashed-border convention accordingly.
6. **Media type filter**: currently only on Discover/Wishlist/Library (via `SubBar`) — not on facet pages, Insights, or detail. Board shows it persistent everywhere; that's target, not current state.
7. **Discover-prefill sticky note** (Page Mockups frame): superseded by the H1.1 decision — Discover defaults to Popularity for *everyone*; the Fandex-sorted "for you" surface is Home's Recommendation row, not Discover.

## 6. Flagged Modular-UI gaps — disposition

| Board flag | Disposition |
|---|---|
| Missing filter-settings UI in some views | Confirmed: facet pages have sorts but no filter panel / type filter; Insights has neither. → H1.6 scope |
| No skip-to-previous-month in calendar | Confirmed in `CalendarView`. → H1.6 scope |
| Fandex score absent in Facet Data | **Stale** — resolved by Q24/Q28 (2026-07-19). Board correction only |
| Search prompt bar positioning | Open design decision → resolve in H1.3/H1.4 with the visual direction |

## 7. Guardrails (carry through every H1 step)

- Design against **real content and every state** (default/empty/loading/error) — states inventoried in §4; several pages are missing error states today, fix during implementation rather than mocking around it.
- **Persistent settings**: media-type filter is global (one storage key, SM2) and must appear/persist on every page per the board; sort persists per view.
- The five media types must read as **one consistent icon set** everywhere (note: only games/movies/shows exist as data types — Books/Boardgames are future).
- **H4 hooks**: profile reachable in ≤1 click from every page (bottom nav satisfies the BGH two-click rule for H4.1); **no analytics/tracking scripts** without the H4.4 cookie-banner work.
- **Infra**: any new/changed public SSR surface must be `BoundedCache`'d and must not add write-on-GET paths (see the 2026-07-20 incident, [[litestream-busy-and-crawler-costs]]) — the new public Home is exactly such a surface.
- AI logo output = directional exploration, not the final asset.
- User keeps all visual taste calls ([[no-self-ux-review]]); Claude Design steps are user-driven.

## 8. Decisions ledger

**Decided in H1.1 (2026-07-20)** — full detail in §2: route map + redirects ✅ (full adoption) · desktop strategy ✅ (adaptive nav) · Search slot ✅ (= Discover) · new bundles ✅ (Home carousels in H1, Similar Items deferred) · Discover default ✅ (Popularity for everyone).

**Still open:**

| Decision | Owner | When |
|---|---|---|
| Visual direction (from 2–3 candidates on one page) | Nils | H1.3 |
| Icon library (Lucide / Phosphor / Heroicons) + 5 media-type marks | Nils | H1.4 |
| Typography + logo direction | Nils | H1.4 |
| Home recommendation row order/count; detail layout with missing metadata | Nils | H1.4/H1.5 |
| Q3: Wishlist/Library default sort + initial scroll | Nils | folds into H1.6 |
