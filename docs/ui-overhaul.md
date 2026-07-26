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

**Decided by the design handoff (2026-07-23)** — see §9: visual direction ✅ (2a "Ticket · Calm") · icon library ✅ (**lucide-react**, already a dependency and currently unused — today's icons are hand-rolled inline SVG) · typography ✅ (DM Serif Display / Space Grotesk / Space Mono via `next/font`) · tokens ✅ (`01-tokens.css`) · component set ✅ (`03-components.md`) · a11y targets ✅ (`06-accessibility.md`, WCAG 2.1 AA).

**Decided by Nils (2026-07-23), gating H1.6:**

- **D-A — the design wins on the nav.** `/wishlist` stays its own route (H1.1's redirect from `/dashboard` is unchanged), but it is **reached from Library via a tab/segmented control**, not from a nav slot. The bar is the designed five: Home · Search · Calendar · Library · You. Wishlist and Library are one "my stuff" surface, which is what `wishlist.html` already commits to by highlighting LIBRARY. **This supersedes H1.1's decision 1 on the nav item only** — the route map itself is untouched.
- **D-B — keep the code's score model, restyle only.** Adopt the design's colours and badge shape; **keep `FandexScoreBadge`'s existing thresholds relative to the user's baseline**. Q19's baseline-relative center was deliberate and is pinned by tests; the design's fixed 65–79 neutral band would reintroduce the fixed center Q19 removed. `03-components.md §9a`'s band values are therefore **not** authoritative — the only part of the handoff overridden by code.
- **D-C — cut what doesn't exist, and repurpose the bell.** Release reminders are dropped and the mockup copy that promises them gets rewritten. **The `BellPlus` on Agenda rows becomes an add-to-wishlist action instead** — the trailing slot keeps its affordance using the quick-action machinery that already exists (`/api/watchlist`), so the row stays useful rather than losing its verb. Watch prices are dropped (badges stay non-clickable until P18).
- **D-D — derive desktop in code.** No desktop mockups; build from `03-components.md`'s rules (nav flips at 768px, `--container-max` 1200px) plus the multi-column layouts the app already has. Review happens in the browser, not in a mockup.

**Decided by Nils (2026-07-24) — card anatomy is ONE state everywhere:**

- **D-E — collapse the poster card's three states into one.** `03-components.md §2` defines the poster card in multiple variants — `with-actions`, `no-actions` (dense grids), `unscored` (shows a personal `★ rating` in place of the score), and `compact`. **Nils wants a single card everywhere instead:**
  1. **The action bar (Rate + Wishlist) shows on every card**, logged in or not. For an anonymous viewer, tapping Rate or Wishlist opens the **login modal** (the app already does this — anon quick-actions open the sign-in dialog, they don't redirect). So there is no `no-actions` variant.
  2. **A score is always shown.** Logged in → the **Fandex Score**; anonymous → the **critic/community rating** in its place. So there is no `unscored`/personal-star-only variant — the score slot is never empty and never falls back to just a personal star.
  - **Why:** consistency — the same title looks and behaves the same on every surface, and every card is actionable, which is the whole point of "your index of everything." Matches the first of the three mockup cards (`with-actions` + Fandex score) and drops the other two.
  - **Scope note / the one real exception:** a non-persisted anonymous facet item (`linkable: false`, PR15 — a title that was never written to a real row and so has **no identity** for Rate/Wishlist to act on and no page to link to) still renders inert. That is a data constraint, not a card state — it has nothing to act on. Every card backed by a real item follows D-E.
  - **Implementation status:** `PosterCard`/`ListCard` already always render the action bar (when `linkable`) and already render both a Fandex and a community badge when present — so the primary gap D-E closes is guaranteeing the score slot is *never empty* (anon → community rating as the shown score) and confirming no surface is passing a "no-actions"/"compact" flag that suppresses the bar. Verify per-surface in **H1.6e** (this is a page-pass concern — each consumer must pass the full item shape, not a stripped one). `compact` (used only in "Known for" / people-adjacent rails per §2) is out of the three-state scope Nils flagged and can stay as a rail-only density tweak **if** it still carries actions + score; revisit in H1.6e when those rails are actually built.

**Still open:**

| Decision | Owner | When |
|---|---|---|
| Insights "hours" stat — **assumed omitted** (the relabel-to-"titles" option wasn't taken, and inventing a number that silently excludes every game matches neither D-C's spirit nor the data). Say so if you'd rather have a title count there | Nils | during H1.6e |
| Home recommendation row order/count; detail layout with missing metadata | Nils | during H1.6e |
| Q3: Wishlist/Library default sort + initial scroll | Nils | folds into H1.6f |

## 9. Handoff received — H1.3 / H1.4 / H1.5 closed (2026-07-23)

The Claude Design bundle landed at **`docs/design/fandex-handoff/`** (348 KB, 16 files) and closes three tasks at once: the visual direction was picked (H1.3), the system it defines *is* the locked design system (H1.4), and every page mockup is styled with it (H1.5).

| File | What it is | Authority |
|---|---|---|
| `00-DECISIONS.md` | Direction **2a "Ticket · Calm"** + why 1a/1b were rejected + the one rule to preserve (restraint) | The brief's intent |
| `01-tokens.css` | Tailwind v4 `@theme` block — the full token set, dark default + an additive `[data-theme="light"]` | **Source of truth for values** |
| `02-tokens.json` | 1:1 mirror of `01` | Keep in sync |
| `03-components.md` | 15 components with anatomy, dimensions, variants, every state, lucide icon names | **Source of truth for structure** |
| `04-pages/*.html` | 10 self-contained **mobile** mockups (360px frames), each showing default/loading/empty/error/anon | Illustrative — fonts fall back, so they under-sell the serif |
| `05-DELTA.md` | Everything that differs from the brief: what was invented, dropped, and 8 unverified data assumptions | **Read before building anything** |
| `06-accessibility.md` | Measured contrast ratios, focus treatment, touch targets, reduced motion, nav SR behaviour | Acceptance criteria |

**Stack fit is exact** — the handoff targets Next 16 / React 19 / Tailwind v4 `@theme` / lucide-react, which is what `package.json` already has (`next 16.2.7`, `react 19.2.4`, `tailwindcss ^4`, `lucide-react ^1.17.0`). No CSS-in-JS, no CDN fonts (`next/font/google` self-hosts at build time — Inter already proves that path works on Railway).

**Mockup nav is HOME · SEARCH · CAL · LIBRARY · YOU** — five slots, and `wishlist.html` renders with **LIBRARY** active. That is the design's answer to D-A.

### 9.1 Reconciliation — handoff assumptions vs. the live code

`05-DELTA.md §(d)` lists 8 data assumptions it could not verify. Checked against source on 2026-07-23:

| # | Assumption | Reality | Verdict |
|---|---|---|---|
| 1 | Per-user `userRating` / `isWishlisted` / Fandex Score cheap at list scale | `MediaCardItem` already carries all three; `/api/library`, `/api/calendar` and `discovery.ts`'s `find()` compute them server-side | ✅ exists |
| 2 | Fandex Score = 0–100 personal taste match, **neutral band 65–79**, with per-facet "score impact" attribution | Score exists and is additive (Q20), impact attribution exists (Q28's pill). **But Q19 recentered it on `profile.baseline × 10`, not a fixed 50** — so there is no fixed neutral band, and `FandexScoreBadge` bands at ≥70 / ≥50 / <50, not the design's ≥80 / 65–79 / <65 | ⚠️ **conflict → D-B** |
| 3 | Facet aggregates (user avg vs catalogue avg, per tag and per person) | `analyzeLibraryFacets` + `/api/facet/mine` provide exactly this, Bayesian-damped | ✅ exists |
| 4 | Insights "hours" headline stat | `runtimeMinutes` is normalized for movies/shows (TMDB) but **never aggregated**, and games have no hours at all. `InsightsPayload.overview` has no duration field | ❌ **missing → D-C** |
| 5 | Rating scale is 1–10 with per-bucket counts | Confirmed 1–10 (`ActionCells`: `aria-label="Rate {n} out of 10"`); `histogram`/`byTypeHistogram` already bucket it | ✅ exists |
| 6 | Where-to-watch with stream/rent/buy **+ price** | Providers render as non-clickable badges (`LowerSections.tsx`); no price data, and links are deliberately dropped (`project.ts:68`, unwinds only in P18) | ❌ **missing → D-C** |
| 7 | `reminderSet` on calendar rows (the `BellPlus` action) | **No notification system exists anywhere** — the only hit for "notification" in `src/` is `ui/Toast.tsx`. Note the mockup empty-states also promise "release reminders" in copy | ❌ **missing → D-C** |
| 8 | Facet routes `/tag/[slug]` and `/person/[id]` | Code ships `/tag/[slug]`, `/person/[slug]`, **and `/studio/[slug]`** (P17). Person is slug-based, and studio has no mockup | ⚠️ code wins; studio needs a derived layout |

Two more conflicts not in §(d):

- **A5 "search returns typed groups (Titles / People / Tags)"** — today `/api/discover/find` returns titles only; people/tags are reachable via `FacetAutocomplete` pills, not as result groups. Real backend work.
- **A2 "Discover advanced filters"** — tri-state include/exclude for wishlisted/rated + include/exclude tags. Partially there (`FilterPanel` membership filters + facet pills); the tri-state model and exclude-tags are new.

### 9.2 The token layer is higher-leverage than it looks

`01-tokens.css` defines `--color-neutral-50 … --color-neutral-950` inside `@theme`. In Tailwind v4 that **overrides Tailwind's built-in `neutral-*` palette**, so the moment it lands, all 52 files currently using `bg-neutral-900` / `text-neutral-400` re-map to the warm ramp automatically. That is most of the restyle for free — but it also means:

- The app shifts warm **all at once**, so expect a scruffy intermediate state until H1.6e finishes.
- `--color-neutral-500` (`#6F665A`) is now a **contrast failure for small text** (3.42:1) — every existing `text-neutral-500` on body-size copy has to move to `neutral-400` or lighter. This is an audit item, not a find-and-replace.
- The legacy `:root` block in `globals.css` also holds provider brand colors (`--color-steam`, `--color-rawg`, `--color-trakt`, `--color-tmdb`) that the new token set does **not** cover. Keep them; they're brand marks, not theme.
- **The named spacing scale is the opposite case — it's dangerous to drop in verbatim.** `--spacing-xs/-sm/-md/-lg/-xl/-2xl/-3xl` reuses the exact suffixes (`sm`, `md`, `lg`, `xl`, `2xl`) that Tailwind v4's `max-w-*`/`w-*`/`h-*`/`gap-*`/`p-*`/`m-*` utilities read their *named* sizes from — putting them in `@theme` silently overwrote `max-w-sm`'s `24rem` with `8px` app-wide (found + fixed in H1.6a, §10). The step scale now lives as `--space-*` in a plain `:root` block instead. Radius and color namespaces don't have this problem (Tailwind's `rounded-*`/color utilities are meant to pick up the new scale) — spacing is the one namespace where the design's naming and Tailwind's reserved naming collide.

## 10. H1.6 — implementation plan

Six sub-tasks, ordered by dependency. Tiering follows AGENTS.md: nav/auth/routing stays in the main loop at full effort; token and page restyling is mechanical and delegable.

All four gating decisions (D-A…D-D) are answered — see §8. H1.6 is unblocked.

| | Sub-task | Tier | Est. | Depends on |
|---|---|---|---|---|
| **H1.6a** | Token foundation + fonts + icon library | Sonnet | ~15k | — |
| **H1.6b** | Primitive kit (the 15 components' shared parts) | Sonnet | ~25k | a |
| **H1.6c** | Adaptive nav + IA restructure (routes/redirects) **+ A2's Already-rated filter** (moved from H1.6d 2026-07-24) | **Opus, main loop** | ~30k+ | a, b |
| **H1.6d** | Content components (cards, rail, calendar, filters) | mixed | ~40k | b |
| **H1.6e** | Page-by-page, all four states | Sonnet-delegable | ~60k | c, d |
| **H1.6f** | Cross-cutting QA + a11y + cleanup | Opus, main loop | ~20k | e |

**~190k total.** Backend additions (A5 search grouping, A2 tri-state filters, Home bundles) are called out per sub-task and are the main estimate risk.

### H1.6a — Token foundation ✅ done 2026-07-23
- `01-tokens.css`'s `@theme` block into `src/app/globals.css`; kept the provider brand colors from the legacy `:root`.
- `next/font/google` for DM Serif Display / Space Grotesk / Space Mono → CSS variables (`--font-dm-serif`/`--font-space-grotesk`/`--font-space-mono` on `<html>`, referenced by the token file's `--font-serif`/`--font-sans`/`--font-mono`); dropped Inter.
- Replaced the white `:focus-visible` outline with `--shadow-focus` (box-shadow follows each element's own radius, no forced override needed).
- Added the `prefers-reduced-motion` global default (durations collapse to instant) per `06`.
- `viewport.themeColor` `#0a0a0a` → `#100E0C`; `<body>` → `font-sans antialiased bg-surface text-text-primary`.
- Shipped `[data-theme="light"]` inert (no toggle — it is explicitly a later add).
- **lucide-react** confirmed installed (`^1.17.0`) and available; the sweep to replace hand-rolled SVGs happens per-component in H1.6d/e, not here.

**⚠️ Real bug found and fixed here, not just a restyle:** dropping `01-tokens.css`'s named spacing scale (`--spacing-xs/-sm/-md/-lg/-xl/-2xl/-3xl`) straight into `@theme` silently broke `max-w-sm`/`max-w-md`/`max-w-lg`/`max-w-2xl`/`max-w-3xl` **app-wide** — Tailwind v4 resolves `max-w-*`'s (and `w-*`/`h-*`/`gap-*`/`p-*`/`m-*`'s) *named* suffixes from that exact same reserved namespace, so `--spacing-sm: 8px` overwrote Tailwind's own `sm = 24rem` and collapsed every `max-w-sm` container to 8px. Caught immediately by opening the login page in the browser (text wrapped one word per line). The design's step scale now lives as **`--space-*`** (`--space-xs`/`--space-md`/etc.) in a **plain `:root` block outside `@theme`**, not inside it — `@theme` silently *drops* any variable under a namespace Tailwind doesn't recognize (a second, non-obvious behavior discovered while fixing the first), so a merely-differently-prefixed name inside `@theme` would have vanished rather than stayed inert. Consume the step scale via `var(--space-md)`, never as a `*-md` Tailwind class. Full comment trail is in `globals.css` itself. **This is the kind of collision every future token addition needs to be checked against** — verify any new `@theme` key doesn't reuse `xs/sm/md/lg/xl/2xl/3xl/4xl.../full` unless the intent is genuinely to override that Tailwind-reserved scale (radius and color namespaces are fine — see §9.2 — spacing is the trap).

**Verification:** browser-checked (login page layout, `/discover` page, both clean, no console/build errors after a server restart to rule out stale HMR error-log replay); `npm test` 307 passing, typecheck clean, lint 0 errors (pre-existing `any` warnings only).

### H1.6b — Primitive kit ✅ done 2026-07-23
Button (4 variants × 4 sizes + loading), Chip / TagChip / TriToggle, Panel, Eyebrow, SearchField, Menu/Popover, Sheet (mobile) + Modal (desktop) with focus trap, Skeleton, EmptyState, **ErrorState (new — several pages have no error state today)**, Avatar, ScoreBadge, CommunityScoreBadge. Existing `ui/Button`, `ui/Chip`, `ui/ConfirmDialog`, `ui/Spinner`, `ui/Toast`, `ui/EmptyState` reworked rather than replaced.

**Per D-B:** `ScoreBadge` (`FandexScoreBadge.tsx`) takes the design's shape, colour ramp and `aria-label`, but **keeps `fandexScoreColor`'s existing thresholds** (`>=70`/`>=50`/below) — `03-components.md §9a`'s 80/65 cutoffs were not ported.

**What actually shipped:**
- `Button` — variant names unchanged (`primary/secondary/outline/danger/ghost` — `outline` isn't one of the design's four but existing call sites use it); added `lg`/`icon` sizes, a `pill` prop (radius is contextual per the design spec, not baked into variant), and a `loading` prop (centered `Loader2`, `aria-busy`; spin collapses under the global reduced-motion rule from H1.6a).
- `Chip`, `SearchBar.tsx` (the actual `<SearchField>` — kept its existing name/API, reworked in place rather than adding a parallel component), `Menu` (self-contained trigger + popover, outside-click + Escape dismiss, `Check`-marked selected item), `Sheet` (bottom sheet mobile / centered modal desktop, ONE component per breakpoint like `AppNav` will be, focus trap + Escape + return-focus-to-invoker; swipe-to-dismiss NOT implemented — no gesture library in the dependency set, flagged for H1.6f if it's missed), `Skeleton` (+ `SkeletonPoster`/`SkeletonText` shape helpers, shimmer keyframe added to `globals.css`), `Avatar`, `TagChip` (4 states: include/exclude/add/plain), `TriToggle` (2-segment include/exclude pill), `Panel`, `Eyebrow` — all new or reworked onto tokens.
- `ConfirmDialog` now renders through `Sheet` instead of its own bespoke scrim/panel markup — picked up focus trap + Escape + return-focus for free, which it didn't have before.
- `EmptyState` gained the design's accent-subtle icon tile + serif title, now sits in an elevated panel (was bare centered text). New `ErrorState` + compact `InlineErrorState` (danger-subtle tile, `TriangleAlert`, "Try again" retry — `03-components.md §15`'s "never a dead end" rule).
- `FandexScoreBadge` and `CommunityScoreBadge` both gained an explicit `variant: "inline" | "overlay"` prop (inline = plain colored text for a card meta row, overlay = the dark blurred poster-corner pill) — the two existing call sites in `PosterCard.tsx` were updated to pass `variant="overlay"` since the component's default changed; `ListCard.tsx`'s inline usage needed no change. `CommunityScoreBadge` deliberately stayed **uncolored** (crowd rating is metadata, not a personal signal — the design's restraint rule reserves color meaning for the one Fandex Score).
- `Spinner`/`Toast` — token pass only, same API.

**One real lint catch, not just a style note:** `Sheet`'s mount-on-open needed `setRendered(true)` synchronously inside its open-transition effect — the repo's `react-hooks/set-state-in-effect` ERROR rule (AGENTS.md load-bearing list) flagged it. Confirmed against 8 existing justified instances in the codebase (`Tooltip.tsx`, `PersonalSection.tsx`, etc.) that this is the established "sync to an external prop transition, not derivable during render" pattern the repo already accepts via a commented `eslint-disable-next-line` — added the same, not a restructure.

**Verification:** browser-checked live on `/discover` (fresh server, zero errors) — triggered the actual `EmptyState`/`SearchField`/`Button` chain by searching a nonsense query (serif title + icon tile + accent focus ring on the field all rendered correctly) and confirmed "Clear search" is clickable and restores results. `ConfirmDialog`/`Sheet`'s focus-trap and the primitive kit's logged-in-only consumers (Settings' disconnect/delete flows) are NOT yet manually verified — need a real session, same constraint as every other logged-in surface in this repo. `npm test` 307 passing, typecheck clean, lint 0 errors throughout.

### H1.6c — Adaptive nav + IA restructure  ⚠️ auth-adjacent, do not delegate
`AppNav` (one component, bottom bar < 768px / top bar ≥ 768px, one `<nav aria-label="Primary">` landmark, `aria-current="page"`, safe-area inset), skip-to-content link + `<main id="main">`, then the H1.1 route map: public Home at `/`, `/dashboard` → `/wishlist` 308, new `/calendar`, new `/profile` hub, `/settings` demoted to a sub-page. Touches the login landing, the session-aware nav, and H2c's return-path cookie flow.

**Per D-A:** five nav slots — Home · Search · Calendar · Library · You. `/wishlist` still exists as a route but is entered through a **Library ⇄ Wishlist tab**, and both routes light the **Library** nav item.

**Guardrail:** the public Home is a new public SSR surface → must be `BoundedCache`'d, must not write on GET, and must `export const dynamic = "force-dynamic"` if it reads an env var for an absolute URL.

**Added scope (2026-07-24, Nils's call):** A2's "Already-rated" tri-state filter, moved here from H1.6d — see that section's deferred note for the full investigation (the `membership` shape it extends threads through ~10 files including `discovery.ts`'s scoring engine). Bundled in because it's real backend work on the matcher-adjacent discovery pipeline, not Sonnet-safe content restyling.

**✅ Nav + IA restructure DONE 2026-07-24 (Opus, main loop). A2's Already-rated filter is the one remaining piece — see below.**

Scope confirmed with Nils before starting: **nav + routes with minimal placeholder pages** (rich Home/Calendar/Profile content stays H1.6e), and **post-login keeps landing on `/wishlist`** (preserving the onboarding-checklist flow) — `/` Home is a minimal placeholder for now.

- **`AppNav` (new, `src/components/AppNav.tsx`)** — the ONE adaptive nav. Desktop (≥768px): sticky top bar, `h-14`, logo + horizontal slots. Mobile (<768px): `fixed bottom-0` bar with `env(safe-area-inset-bottom)` padding, stacked icon+label slots. Both are a single `<nav aria-label="Primary">` with `aria-current="page"` on the active slot. Five slots (D-A): Home (`/`) · Search (`/discover`) · Calendar (`/calendar`) · Library (`/library`, also lit by `/wishlist`) · You (`/profile`, also lit by `/settings`). Session-aware like the old NavBar: anon's "You" opens the H2c `SignInDialog` (returnTo = current path) instead of linking to the authed hub; **logout moved off the nav onto the `/profile` hub**. The per-slot renderer is hoisted to module scope (not defined during render — the repo's `react/no-unstable-nested-components` rule is an error).
- **Global shell** — `AppNav` + a **skip-to-content link** (`sr-only` until focused → `#main`) now live in the **root layout** (`layout.tsx`), wrapping `{children}` in `<div id="main" tabIndex={-1} className="pb-16 md:pb-0">` (the mobile bottom padding clears the fixed bar). The old per-page `<NavBar />` was removed from all **7** consumers (discover, the moved wishlist, library, insights, settings, `PublicFacetView`, `item/debug`) and `NavBar.tsx` deleted — item-detail pages, which previously had *no* nav at all, now get the global one.
- **`SubBar` sticky offset** — was `top-14` (assuming a top nav everywhere); now `top-0 md:top-14`, because mobile has no top chrome (nav is at the bottom).
- **Routes/redirects (the H1.1 map):**
  - `/dashboard` → **308 → `/wishlist`** (`permanentRedirect`, server component). The whole wishlist page content moved to `src/app/wishlist/page.tsx` (renamed `DashboardPage` → `WishlistPage`, otherwise identical); `/dashboard/page.tsx` is now just the redirect.
  - **`/calendar` (new)** — minimal client page: auth-gate → `/api/calendar` (same payload the wishlist uses) → `CalendarView` (which carries its own Month⇄Agenda toggle from H1.6d). Filters/type-chips are H1.6e.
  - **`/profile` (new)** — the "You" hub: identity header (`Avatar` + displayName + provider), a link grid into every surface (Discover/Library/Wishlist/Calendar/Insights/Settings), and **Log out**. `/settings` keeps its own URL as the account/connections/data sub-page.
  - **`/` Home** — was a login-only landing that bounced authed users to `/dashboard`; now the public browse Home. Session-aware minimal version: anon → the sign-in hero + "Browse without an account"; authed → a small launcher grid (rich stats/rails are H1.6e). The auto-redirect-to-dashboard is gone.
- **Post-login targets** — every `?? "/dashboard"` fallback that a fresh login lands on (`api/auth/rawg`, `steam/callback`, `tmdb/callback`, `oauthConnect`, `AuthOptions`'s RAWG push) now points at `/wishlist`; the H2c return-path cookie still wins when present. Legacy `/item?…` unresolved redirects go to `/` (public) instead of the old authed `/dashboard`. `robots.ts` DISALLOW gained `/wishlist`, `/calendar`, `/profile`.
- **Verification:** typecheck clean, `npm test` 307 passing, `eslint src` 0 errors. Browser-verified anon at desktop + 375px mobile: Home (both anon hero and, by probe, the authed launcher path), the desktop top bar with correct `aria-current` highlighting (Home on `/`, Search on `/discover`), the mobile bottom bar matching the mockup (HOME·SEARCH·CALENDAR·LIBRARY·YOU), `/dashboard` returning a real **308→/wishlist** (curl-confirmed), `/calendar` `/profile` `/wishlist` all 200 then client-gating anon to `/`, the SubBar sticking to `top-0` on mobile, and the anon "You" slot opening the sign-in dialog. Zero **server** errors throughout (the browser console replayed stale SubBar parse errors from a mid-edit state — a known artifact of this Browser pane per [[h1-ui-overhaul-plan]]; every page rendered correctly, confirming they're stale).

**✅ A2's "Already-rated" tri-state filter DONE 2026-07-24 (Opus).** Added a third `rated` dimension to the `membership` filter, parallel to `library`/`wishlist`, tri-state (Any/Only/Hide). Predicate = `rating != null` (matches the Library page's existing `hideRated`), so it's distinct from `library` (which also counts unrated-but-owned). Threaded through every place membership is applied:
- **Schema:** `zMembership` (`schemas.ts`) gained `rated` — validated on both the `find` and `facet-fetch` request bodies.
- **Server filters:** `discovery.ts`'s `MembershipFilter` + `passesFilters` (catalog search; its `state` param widened to carry `rating`), and `facetDetail.ts`'s `MembershipFilterIn` + `buildExternalCandidates` ("more from the databases" supplement).
- **Client filters:** `facetFilter.ts`'s `passesYearMembership` (wishlist/library lists) and `discover/page.tsx`'s `browseFiltered` (the live browse feed).
- **UI:** a new named `MembershipFilters` type (`discovery/types.ts`, `{library?, wishlist?, rated?}`) replaces the inline shape in `UiFilters` and both pages' `usePersistedState` generics (prevents drift); `FilterPanel.tsx` gained a third "Rated" row using the **same `Tri` (Any/Only/Hide) control** as the other two — per the H1.6d decision to keep that over `ui/TriToggle` for consistency, so the design's tri-state intent is met without an inconsistent widget.
- **Decision:** kept the existing "In library" and "On wishlist" filters and **added** Rated (rather than reconceiving "In library" as the design's Wishlisted+Already-rated pair) — additive, no removal of working behaviour. The Library page's separate `hideRated` toggle was left untouched (it's its own control; `rated: "exclude"` is now the equivalent in the FilterPanel).
- **Verification:** 5 new regression tests (`facetFilter.test.ts`) pin the rated dimension (Any/Only/Hide, independence from library, combination with wishlist) — 312 tests total pass; typecheck + `eslint src` 0 errors. Browser-verified anon on `/discover`: the new "Rated" row renders in all three filter locations; "Rated: Only" correctly empties the feed (anon has zero rated items) and "Any" restores it, no refetch, zero server errors.

**H1.6c is now complete** (nav/IA restructure + A2). Next is **H1.6e** (page-by-page, all four states — including fleshing out the minimal Home/Calendar/Profile placeholders this pass created, and the D-E card-score-slot fix).

### H1.6d — Content components 🔵 in progress 2026-07-23
`PosterCard` / `ListCard` to the card spec (quick-action bar, rated state, selected state, compact variant); `ListRow`; **`Rail` (new — the carousel the board has always wanted)**; `GroupedView`; `CalendarView` restyle **+ the new Agenda view + skip-to-previous-month**; `TypeFilter` circles; `SortMenu`; `FilterPanel` → bottom sheet on mobile; `SubBar` re-composition.

**Per D-C:** the Agenda row's trailing `BellPlus` is replaced by an **add-to-wishlist** action, wired to the existing quick-action machinery (`useQuickActions` / `/api/watchlist`) rather than a new notification path. *(Not reached yet — Agenda view itself is still open, see below.)*

Backend work lands here: **A2's tri-state include/exclude filters**. No reminder backend.

**Shipped so far (2026-07-23, Sonnet main loop):**
- **`PosterCard`** — replaced the color-only top bar with a real **type chip** (dot + UPPERCASE mono label) per `03-components.md §2`; this isn't just a restyle, it fixes a genuine `06-accessibility.md` violation ("never encode meaning by color alone") the color-bar-only version had. Container moved to `radius-md`/`surface-elevated`/token borders; poster now scales 1.02 on hover (was the whole card); hover "View details" pill switched from solid accent to a neutral dark blurred pill (accent stays reserved for real actions, not a hover hint, per the design's restraint rule); footer typography onto `font-serif`/`font-mono` tokens.
- **`ListCard`** — token pass (radius-lg, surface-elevated, min-h-60px, serif title, mono meta); `text-neutral-600` separators moved to `text-secondary` (the old `neutral-600`-equivalent muted tone fails AA for normal text per `06`).
- **`ActionCells`** (shared Rate/Watched/Wishlist toolbar) — real judgment call, documented in the component: the design's own quick-action spec (`§2`) only shows 2 buttons (Rate + Bookmark) and colors the Rate button flat accent-gold when active; the app has a real 3rd action (library/watched status) the design never addressed. Resolution: Rate and Wishlist both go accent-subtle/accent when active (both are "personal preference" signals), Watched/library stays success-green (a distinct completion-status signal) — two colors across three cells, not three, and both drawn from real tokens instead of arbitrary hex. The star-picker's own per-star hover coloring (green/amber/red preview) is unchanged — that traffic-light feedback stays where it's genuinely useful (choosing a rating), just re-pointed at token hexes.
- **`FandexScoreBadge` / `CommunityScoreBadge`** (H1.6b) — `PosterCard`'s 2 call sites updated to `variant="overlay"`.
- **`SubBar`** — container/divider/sort-pill/view-toggle tokens; **the existing pill-button sort control and the type/source `Chip` row were kept as-is structurally** (Q14 already shipped these, deliberately, over the mockup's dropdown-`SortMenu`/circular-`TypeFilter` — respecting a real, tested, shipped decision rather than relitigating it unprompted); view-mode toggle and the mobile "Filters" trigger now use real lucide icons (`List`/`LayoutGrid`/`CalendarDays`/`SlidersHorizontal`) instead of text glyphs. `FacetChip` (must-include/exclude pills) recolored from arbitrary green/red hex to the same accent/danger convention `TagChip` (H1.6b) established.
- **`FilterPanel`** — token pass only; its 3-button Any/Only/Hide `Tri` control was deliberately **not** replaced with `ui/TriToggle` (that primitive models Include/Exclude with an *implicit* "neither" state per `§6c` — a different, less-explicit interaction than this working "Any" is its own button today).
- **`Rail`** (new) — built to the `§4` spec (serif header + optional "For you" pill + "See all" link, CSS-scroll-snap track, desktop hover chevrons). **Not yet exercised by a real page** — Home, its first consumer, doesn't exist until H1.6e. Roving-tabindex keyboard nav (spec's nice-to-have) isn't implemented; native tab-through-every-card order works today, flagged for the H1.6f a11y pass.

**`CalendarView` restyle + the new Agenda view + skip-to-previous-month ✅ done 2026-07-24 (Sonnet).**
- **Month grid** fully retokened (surface/border/text/radius/duration classes throughout, `TYPE_COLORS` kept as the per-type inline-style source since it's data-driven and not a fixed token); today's cell now gets the spec's 2px accent ring (`ring-2 ring-accent ring-inset`) instead of the old white-pill day number; current-month header is an accent pill instead of white.
- **New Agenda (list) view** (`AgendaView`/`AgendaRow`, the design's A1 delta): groups items into "This week / Next week / ⟨Month⟩" by sorting all items with `releaseDate >= today` ascending and splitting on bucket-label change (no back-filled past releases — matches the mockup's "Coming up" framing; the Month grid already covers browsing the past via its existing prev/next paging). Each row is a `ListRow`-style date-stack + 44px thumb + title/type/platform meta, reusing `useQuickActions` for the trailing action.
- **Toggle pill** (`List`/`CalendarDays` from lucide) switches `Month ⇄ Agenda`, per spec's "label = the OTHER view." Defaults to Month on both mobile and desktop — the mockup's "Agenda default on mobile" recommendation was skipped deliberately: a viewport-conditional default risks an SSR/hydration mismatch or a flash-of-wrong-view for a cosmetic nicety, not worth the risk class. Flag if you want it revisited.
- **Skip-to-previous-month, the board's flagged gap:** a "← Previous release" pill now sits symmetrically with the existing "Next release →" one, shown whenever an earlier month has a release — both now render regardless of whether the *current* month is empty (previously "Next release" only showed in the populated-month header; the empty-month state had its own separate copy of both buttons).
- **Per D-C:** the Agenda row's trailing `BellPlus` is wired to `useQuickActions().toggleWishlist()` (same mechanism `ActionCells` uses) instead of a reminder — accent-highlighted + `aria-pressed` when already wishlisted.
- **Cleanup:** `ItemBadges.tsx` (the old hand-rolled, non-token calendar badge cluster) is now dead code — deleted; replaced by a small in-file `ItemMeta` helper using lucide `Star`/`Bookmark`/`Check` on token colors (accent for rating/wishlist, success for library — same convention `ActionCells` established). `Tooltip.tsx` (still shared by `PosterCard`/`ListCard`/`CalendarView`'s hover previews) got a matching light token pass since it renders directly against the now-retokened calendar cells.
- **Verification:** typecheck clean, lint 0 errors, `npm test` 307 passing throughout. Browser-verified anon on `/discover`'s Calendar view at desktop AND 375px mobile width: Month grid (today ring, current-month pill, both skip buttons, single/multi-item cells, overflow drawer), Agenda view (This week/Next week/August grouping, mobile layout matches the mockup almost exactly), toggle switching both directions, and the anon wishlist-toggle failure path (401 → revert → toast, no crash) — zero console/server errors throughout. Logged-in-only behavior (a successful wishlist toggle, Library/Wishlist's real data) not checked — same constraint as every other logged-in surface in this repo.

**`FilterPanel` → bottom sheet on mobile ✅ done 2026-07-24 (Sonnet).** The original blocker stands as diagnosed: `FacetAutocomplete`'s `q`/`matches`/`open` state can't be safely duplicated across an inline desktop copy and a mobile-Sheet copy. Fix: a new `useMediaQuery` hook (`src/lib/useMediaQuery.ts`, SSR-safe two-pass pattern — starts `false` to avoid a hydration mismatch, corrects itself once in an effect after mount) decides which of exactly ONE of two render sites gets the single `advancedContent` element (`SubBar.tsx`) — desktop renders it inline as before; mobile renders the same element inside the existing `Sheet` primitive (already responsive bottom-sheet-on-mobile/modal-on-desktop from H1.6b, reused as-is), opened by the "Filters" button. Crossing the breakpoint remounts (loses an in-progress, not-yet-picked search query) rather than ever having two live copies — an accepted, documented tradeoff, not a silent gap. Browser-verified: desktop unchanged (inline row, zero regression); mobile "Filters" now opens a real bottom sheet (backdrop, grab handle, focus trap) instead of the old inline expand; typed into the sheet's "Must include" box and confirmed exactly one debounced `/api/discover/facets` request fired (no duplicate-instance drift); resizing desktop→mobile→desktop remounts cleanly each direction with zero console/server errors.

**Deliberately deferred, not forgotten:**
- **`TypeFilter` circles / `SortMenu` dropdown** — as noted above, kept as Q14's existing pill-button treatments rather than converted to the mockup's circular-icon/dropdown anatomy. Flag if you want the literal mockup shapes instead.
- **A2's "Already-rated" tri-state filter — moved to H1.6c, not a Sonnet H1.6d task after all.** Investigation (2026-07-24) found "Wishlisted" already has real tri-state filtering (the existing Any/Only/Hide `Tri` control, deliberately kept per the decision above — no work needed there). The actual gap is **Already-rated**, which has no filter today beyond a blunt Library-page-only `hideRated` boolean, and the `membership` shape it would extend to add a third dimension is threaded through ~10 files across the discovery/matching pipeline (`schemas.ts`'s `zMembership`, `discovery.ts`'s server-side scoring engine, `facetFilter.ts`, `liveDiscover.ts`, `facetDetail.ts`, `publicFacetDetail.ts`, the facet-fetch route) — real backend work on the core matcher, not UI wiring onto existing state. **Nils's call (2026-07-24): bundle it into the H1.6c session** (already Opus/main-loop, already touching risk-adjacent surfaces) rather than attempt it on Sonnet.

**H1.6d is otherwise complete** — every other item in this section shipped 2026-07-23/24. Next up is **H1.6c** (adaptive nav + IA restructure, now carrying A2 as an added scope item) — full-effort Opus/main-loop session, not Sonnet.

**Verification:** browser-checked on `/discover` (grid + list view, sort pills, type chips, hover states) and `/tag/action` (facet page reusing the same `PosterCard`/`ListCard`) on a freshly restarted dev server — zero console/server errors on either. `npm test` 307 passing, typecheck clean, lint 0 errors throughout. Logged-in-only surfaces (Library/Wishlist real cards with quick actions, the multi-select ring the spec mentions — which has no consumer anywhere in the app, not built) not checked — same constraint as every other logged-in surface.

### H1.6e — Page-by-page
Home (net-new: stats strip, best-genre card, rails, anon variant), Discover (+ advanced-filter sheet, + A5's grouped results), Calendar (net-new route), Library / Wishlist (one surface, two tabs per D-A), Item detail (**no watch prices** per D-C), Facet person / tag / **studio (no mockup — derive)**, Insights (**no "hours" stat** — see §8), Profile hub (net-new), Settings. Every page gets default / loading / empty / error.

**Home ✅ done 2026-07-26 (Sonnet).** Replaced H1.6c's minimal placeholder (bare sign-in hero / launcher grid) with the real page:
- **New `/api/home` route** (`src/app/api/home/route.ts`) — reuses `/api/discover`'s exact `fetchGamePage`/`fetchMoviePage`/`fetchShowPage` + `decorateSection`/`persistDiscoverItems` machinery (same item shape, so `PosterCard`'s quick actions work identically) rather than a parallel path. Three rails, all derived, no new endpoint-shaped data model: **Popular** (page-1 pool sorted by `communityScore`/votes desc), **Upcoming** (same pool, future-dated, sorted ascending), **Recommended for you** (signed-in + has-signal only — `personalizedFeed` re-sorted by taste score desc; cold-start accounts get Popular/Upcoming same as anon, no invented row). PR15's session-gated persist rule applies here too (Home is a public route — verified anon does not mint rows, same pattern as discover/facet).
- **Stats strip + best-genre card** (signed-in only): Library/Wishlist/Rated counts off `getLibraryFacetAnalysis` + a direct `user_watchlist` count; best genre is the top tag `FacetStat` by `ba` (Bayesian average, Q22's same shrinkage) with a `count >= 3` floor so a 1-title tag can't crown itself.
- **Anon variant**: compact hero (logo/sign-in/"browse without an account") unchanged in spirit from H1.6c, now followed by the same public Popular/Upcoming rails logged-in users see — matches the IA table's "public browse (Popular/Upcoming/Fandex Recommendation carousels)" framing from §2, not just a login wall.
- **Four states**: loading (skeleton rails via `Skeleton`/`SkeletonPoster`), error (`ErrorState` with retry — a fetch failure shows this for the whole page, including anon, an accepted tradeoff since auth state is now derived from the fetched payload rather than a separate probe), empty (`EmptyState` if every rail comes back empty), default (populated rails).
- **Verification:** typecheck clean, `npm test` 312 passing, `eslint` 0 errors (pre-existing `any`/`raw`-unused warnings only, matching `discover/route.ts`'s existing pattern). Browser-verified anon at desktop + 375px mobile: hero, Popular (15 items, correct crowd-rating desc order), Upcoming (15 items, correct date-asc order, no past dates), mobile bottom nav, real `<Link>` hrefs resolving to `/{type}/{uuid}/{slug}`, zero console/server errors (only the pre-existing dev-mode `next/image` custom-loader warning that predates this change, site-wide). **Not checked:** the signed-in stats strip/best-genre card and the Recommended rail (need a real session, same constraint as every other logged-in surface in this repo) — the loading/error/empty states were code-reviewed against the already-verified `Skeleton`/`ErrorState`/`EmptyState` primitives, not live-triggered.

**Calendar ✅ done 2026-07-26 (Sonnet).** Added the type-chip row the plan called for (`src/app/calendar/page.tsx`) — the same `Chip`/`TYPE_COLORS` convention `SubBar`'s type filter already uses, filtering the client-side `items` array before it reaches `CalendarView` (no server round-trip). Deliberately did **not** add a membership/year filter here: Calendar's whole purpose is showing your upcoming library+wishlist, so hiding by membership would just be a way to hide your own calendar — out of scope by design, not an oversight. Also hardened the fetch (previously an unguarded `await` chain with no catch — a failed `/api/calendar` call left the page spinning forever) into the same load/error/retry shape as Home. **Four states:** loading (`Spinner`), error (`ErrorState` + retry), empty — split into two cases: zero items at all ("nothing on your calendar yet", pointing at Discover) vs. zero items after a type filter ("no releases match this filter") — and default (populated, chips visible only once there's something to filter). **Verification:** typecheck clean, `eslint` 0 warnings, `npm test` 312 passing. Browser-verified: anon correctly redirects to `/` (existing auth-gate, unchanged), zero console/server errors. **Not checked:** the populated calendar with real items/chips (needs a real signed-in session — same constraint as every other logged-in surface).

**Profile hub ✅ done 2026-07-26 (Sonnet).** Extends H1.6c's minimal hub (identity + quick links + sign-out, unchanged) with the doc's stats/recent/upcoming/recommendations content, reusing data the app already fetches rather than inventing a parallel model:
- **Stats + best-genre card** — reuses `/api/home`'s `stats` payload verbatim (new shared `src/components/ui/StatTile.tsx`, factored out of Home so both pages render the identical tile instead of two copies of the same 12-line component).
- **"Coming up"** — the user's own next 5 wishlist releases off `/api/calendar` (already release-date sorted), rendered as compact rows, not full cards — this is a hub glance, not another grid.
- **"Recommended for you"** — reuses `/api/home`'s `recommendation` array in a mini `Rail` (top 8), the exact same taste-ranked pull Home's own rail shows.
- **Deliberately NOT built:** "recent adds" (the doc's 4th bullet) — `/api/library` has no add-timestamp in its response today (only `reviewedAt`/`releaseDate`; the `user_library.added_at` column exists in the schema but isn't selected or exposed), and threading it through a shared, tested endpoint is bigger than this hub-polish pass warrants. Flagged as an explicit follow-up, not silently dropped. Also **not** added: H4.1's legal-footer link — the Impressum/ToS pages it would point at don't exist yet (blocked on H4.0's pending legal advice per the roadmap), so linking to it would be a dead link.
- **States:** loading (`Spinner`, unchanged from H1.6c), error (`ErrorState` + retry — new, the identity fetch previously had no failure path at all), default (all sections render only when they have data — no empty-section placeholders cluttering a hub page), the auth-gate redirect is the existing "empty" case (anon never sees this page).
- **Verification:** typecheck clean, `eslint` 0 errors (pre-existing `any` warnings only), `npm test` 312 passing. Browser-verified anon: `/profile` still 200s then client-redirects to `/` (unchanged auth-gate), Home unaffected by the `StatTile` extraction (rendered identically, `/api/home` 200). **Not checked:** the stats/upcoming/recommendation sections themselves need a real signed-in session, same constraint as every other logged-in surface in this repo.

**Per D-D:** desktop is derived here, not mocked — `03-components.md`'s breakpoint rules over the app's existing multi-column layouts. Mobile is the fidelity target; desktop is reviewed in the browser.

**Copy sweep (D-C):** the mockups' empty-state copy promises "release reminders" in at least `wishlist.html`. Rewrite every such line — the UI must not advertise a feature that doesn't exist.

**✅ Checked 2026-07-26 (Sonnet).** Grepped the live app (`src/`) for `remind`/`notif`/"we'll let you know"/"we'll alert you" — the only hit is a code comment in `CalendarView.tsx` documenting the D-C decision itself (the Agenda row's `BellPlus` is wired to add-to-wishlist, not a reminder). No shipped page copies the mockups' reminder-promising language; every empty state built so far (Home, Calendar) was written fresh against the real feature set, not lifted from `docs/design/fandex-handoff/*.html`. The mockup HTML files themselves were left untouched — they're a historical design reference, not a live surface, so there's nothing to "ship" by editing their copy. Re-check this whenever a new page's empty state is drafted directly from a mockup file rather than written fresh.

Backend work lands here: **A5's typed search groups** and the **Home bundle shapes** (Popular / Upcoming / Recommendation — derivable from the Discover feed + Fandex scores, but no carousel-shaped endpoint exists).

**Item detail ✅ done 2026-07-26 (Sonnet).** "No watch prices" (D-C) needed no code change — grepped `src/` for `price`/`Price` and found zero references anywhere in the item detail surface; that decision was already satisfied (nothing was ever built to remove). The real gap here was that the whole surface (`ItemView.tsx` + its 8 sub-components: `MediaGallery`/`RatingsSection`/`FactsSection`/`LowerSections`/`PersonalSection`/`WishlistPanel`/`FandexScoreSection`/`primitives.tsx`, plus the outer `[type]/[id]/[slug]/page.tsx` wrapper) had **zero** token-class usage — it was still on 100% pre-H1.6 hardcoded Tailwind, the only page left in that state.
- **One real bug, not just a style gap:** the page wrapper hardcoded `bg-[#0a0a0a]` — the OLD pre-token dark hex — while every other page now resolves to the real `--color-surface` (`#100E0C`, changed in H1.6a). Item pages were rendering a visibly different (and slightly wrong) background shade from the rest of the app. Fixed to `bg-surface text-text-primary`.
- **A real contrast bug, matching the exact pattern H1.6d already fixed once on `ListCard`:** `text-neutral-500`/`text-neutral-600` used directly on body/label text throughout (facts labels, section eyebrows, ratings meta, wishlist panel copy) — both shades fail AA for text per the token file's own comment (`--color-neutral-500`/`600` are "muted/disabled" and "divider" tones, not text-safe). Migrated every such instance to the semantic `text-text-secondary`/`text-text-primary` tokens (not just a shade bump — matches the vocabulary every other H1.6 component uses, per §9.2's established convention) across all 8 components + the wrapper.
- **Raw hex → CSS var tokens** for the handful of semantic-color usages that had literal hex baked in: the star-rating picker's active/inactive colors, the personal-rating quality-tier colors (7+/5+/below, matching `ActionCells.tsx`'s already-established `ratingColor()` convention), the Fandex Score breakdown's positive/negative contribution colors, the media-gallery thumbnail selection ring, and the awards-line color — all now reference `var(--color-accent/success/warning/danger)` so they track future token retuning instead of drifting. **Left alone deliberately:** the tags/platforms/modes chips' per-category color still needs a literal hex string (it feeds a `${color}22` alpha-suffix concatenation trick that breaks on a `var()` reference — confirmed this the hard way when a first attempt at using a CSS var there would have silently produced invalid CSS); the image-overlay carousel arrows' `bg-black/60 text-white` (drawn over photo content, not page chrome — matches `PosterCard`'s identical hover-overlay convention); the cast-card photo-placeholder's `bg-neutral-800`/`text-neutral-600` (byte-for-byte the same combination `PosterCard`'s own poster-placeholder already uses, so this now matches rather than diverges).
- Added `font-serif`/`text-serif-2xl` to the `<h1>` — the token file's own comment names `serif-2xl` for exactly this ("detail hero"), and every other page's headline already uses the serif treatment; this page's title was still plain bold sans.
- **Verification:** typecheck clean, `eslint` 0 errors (1 pre-existing `any` warning, unrelated), `npm test` 312 passing. Item detail pages are **public** (no session needed for the catalog half), so this got a *full* browser verification unlike the auth-gated pages above: a movie page and a show page both rendered completely (gallery, title, dates, facts grid, cast strip, tags/details, links) with zero console/server errors at desktop AND 375px mobile; `getComputedStyle` confirmed the background now resolves to `rgb(16,14,12)` (the real surface token, matching Home/Calendar/Profile) and the `<h1>` renders in DM Serif Display at 34px. **Not checked:** the per-user half (rating stars, wishlist panel, Fandex Score breakdown) needs a real signed-in session, same constraint as every other logged-in surface — the anon-gated fallback UI (`AnonWishlist`, the sign-in-triggering rate stars) rendered correctly but wasn't exercised past the sign-in-dialog trigger. A game-type item page (different optional facts fields) wasn't spot-checked live, though it shares 100% of the same code paths as the movie/show pages that were.

**Facet pages (person/tag/studio) ✅ done 2026-07-26 (Sonnet).** `PublicFacetView.tsx` (the one component all three routes share) + `TagAdminControls.tsx` were the last public surfaces on pre-token styling — same `bg-[#0a0a0a]` background bug as item detail, fixed identically to `bg-surface text-text-primary`.
- **A real design-system violation, not just an inconsistency:** the crowd-average stat cards were colored `text-sky-400`/`text-sky-300` — literal default-Tailwind blue, unrelated to the app's palette entirely, and a direct violation of H1.6b's own documented rule ("crowd rating is metadata, not a personal signal — color is reserved for the one Fandex Score/personal average"). Crowd averages are now plain `text-text-primary`; "Your average" (a genuine personal signal) gets the one `text-accent` instead of default-Tailwind `emerald-400`.
- Same contrast fix as item detail: `text-neutral-500` on labels/meta → `text-text-secondary` throughout both files.
- Raw hex → tokens: the you-vs-crowd delta line (success/danger), the tag-impact pill (success-subtle/danger-subtle backgrounds + success/danger/secondary text, matching the same up/down/neutral convention `FandexScoreSection` just got), the name-collision warning line, and the sort-pill active state (now `border-accent bg-accent-subtle text-accent`, identical to `SubBar`'s established sort-pill pattern rather than a bespoke `border-neutral-500`/`text-white` look).
- `TagAdminControls` (admin-only, `SCORING_ADMIN_USER_IDS`-gated — near-zero blast radius) kept its deliberate amber "this is an admin control" visual distinction, but the amber now comes from `var(--color-warning)`/`border-warning`/`bg-warning-subtle` instead of stock Tailwind `amber-700`/`amber-950`; its inputs/dropdown/chips moved onto `bg-surface-elevated`/`border-border-strong`/`text-text-secondary`.
- Also added `font-serif`/`text-serif-2xl` to the person/tag/studio `<h1>` (same "detail hero" token item detail's heading now uses) and `font-mono` to the small uppercase eyebrow labels, matching the app-wide serif/mono split.
- **Verification:** typecheck clean, `eslint` 0 warnings, `npm test` 312 passing. Facet pages are public — full browser verification: `/person/christopher-nolan`, `/tag/action`, and `/studio/focus-features` all render completely (header, stat cards, sort pills, card grid) with zero console/server errors at desktop, `/tag/action` also checked at 375px mobile; computed background confirmed `rgb(16,14,12)` (the real surface token). **Not checked:** the you-vs-crowd delta/personal-average cards and `TagAdminControls` both require a real signed-in (and, for the latter, admin) session.

### H1.6f — Cross-cutting QA
A11y sweep against `06` (contrast incl. the `neutral-500` audit from §9.2, focus rings, 44px targets, reduced motion, nav landmark/`aria-current`, skip link); **Q3** (default sort + initial scroll); verify anon Discover's Popularity view is non-empty (H1.1's own flagged risk); delete the orphaned `SearchModal.tsx`; remove the empty `src/app/api/{calendar,detail,watchlist,sync,search}/` directory (a stray brace-expansion artifact, untracked by git); full `npm test` + typecheck + lint + build; a `/smoketest` sweep.

### Explicitly out of scope
Similar Items (already deferred post-H1), the light theme (shipped inert), and anything from D-C the answer says to drop. **No analytics or tracking scripts** — that would trigger H4.4's cookie-banner requirement.

### Deploy note
Railway deployments are paused until the billing cycle resets (~2026-08-01), so H1.6 is a **local-only build** until then — which is what makes this a good window for it. PR17's verification still has to land first once service returns.
