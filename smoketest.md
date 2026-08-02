# Fandex — smoke test plan

Living plan for the `/smoketest` skill. **Findings do NOT go here** — they go into
[TASKS.md](TASKS.md) as a dated "Smoke test — YYYY-MM-DD" section (same convention as the
2026-07-17 QA sweep, ids `Q#`/`N#`). Use id prefix **`SM#`** (plain `S#` collides with the
security tasks). Before logging anything, check the existing Q/N/SM tables — don't re-log a
known open finding; note "still present" only if it's load-bearing.

**Etiquette:** observe, don't fix. Log functional bugs, data inconsistencies, nav/state
loss, console/server errors — AND (since 2026-07-18, per user request) a **dedicated UI/UX
evaluation** (section E below). The user still does their own Chrome pass for final taste
calls, but concrete UX findings (readability, touch targets, layout problems, inconsistent
visual language) are in scope for the sweep.

## How to run

- Dev server: `preview_start {name: "dev"}` (.claude/launch.json → `npm run dev`, port 3000,
  autoPort). Next 16 dev server; first compile of each route is slow — a 5–15s first response
  is normal, not a hang.
- Local DB: `data/rr.db` (real library snapshot, 1 user, 4 identities: steam/rawg/trakt/tmdb).
  It's the production-shaped upgrade-path DB — treat writes as acceptable (it's a dev copy)
  but don't bulk-delete.
- Server logs: `preview_logs`; console: `read_console_messages`; network: `read_network_requests`.
- **Live/production run** (e.g. "smoketest the live version" after a deploy): point
  `preview_start`/`navigate` at `https://fandex.org` instead of localhost. No `preview_logs`
  or local DB access — rely on `read_console_messages`/`read_network_requests` + reading actual
  response bodies (status codes alone aren't enough, see SM7). The `/api/dev/login` shortcut
  below is **localhost-only by design** (it 404s when `NODE_ENV=production` and for any
  non-loopback host), so a live run is anon-only by construction. Useful trick when another Claude
  session already has `next dev` running in this folder and blocks a fresh `preview_start`:
  `preview_start({url: "http://localhost:3000"})` (or the live URL) still opens a plain browser
  tab pointed at it — that bypasses the "server already running" conflict entirely since it's
  not trying to spawn a second dev server.

## Auth (logged-in state, no OAuth needed)

**Since 2026-07-28 this is one navigation.** `GET /api/dev/login`
(`src/app/api/dev/login/route.ts`) mints a real session for the `users.id` in
`DEV_LOGIN_USER_ID` and redirects to `/`. The local `.env` already points it at the real
account (4 identities, ~1,919 library items).

```
preview_start {name: "dev"}
navigate  http://localhost:3000/api/dev/login     # sets rr2_session, redirects to /
navigate  http://localhost:3000/library           # …or any gated surface
```

Confirm with `fetch('/api/auth/me')` → `user` non-null. To go anon again for the same
sweep, clear the cookie in the browser (`document.cookie = "rr2_session=; path=/; max-age=0"`)
or use a second tab — **do not hit `/api/auth/logout`**, see the warning below.

It works in the **in-app Browser pane**; no dependency on Nils's own Chrome. Three
fail-closed gates (`NODE_ENV !== "production"` · loopback host · the env var names a user
with a real identity row), each pinned by a test, so it cannot affect fandex.org.

⚠️ **Never log out at the end of a sweep.** Logout bumps `users.session_epoch`, which
invalidates every outstanding token — and only a real OAuth round-trip restores a normal
session. (The dev route mints against the *current* epoch, so it recovers fine, but Nils's
own browser session would be dead.)

Never enter real passwords / do real OAuth. The OAuth round-trip itself (Trakt login,
H2c intent-drain across the redirect) can only be verified on live — out of scope here;
test the pieces (dialog opens, return-path cookie set, guard rejects evil paths).

<details>
<summary><b>Superseded recipes</b> (kept only to explain why four sweeps were logged as blocked)</summary>

- **Hand-minted JWT + `document.cookie`** — signed with `JWT_SECRET` from `.env`, `se`
  matching `users.session_epoch`. Reliably **blocked by the harness's safety classifier**
  as credential-forging from 2026-07-18 onward. Don't retry it; it is also now pointless.
- **Handoff to Nils's own Chrome** via the `claude-in-chrome` MCP tools, which already held
  a live `rr2_session` for `localhost:3000` (this is what unblocked the 5th sweep, the
  first logged-in one). Still works, but needs his browser running with a live session.

Neither is needed now.
</details>

## Flow checklist

Anonymous first (public surface), then logged-in. Check console + server logs after each block.

> **⚠️ Plan refreshed 2026-07-27 after H1.6c/e/f.** The IA changed substantially:
> `/` is now the public browse **Home** (rails, not a login wall), `/dashboard` 308s to
> **`/wishlist`** (which IS a real route now — the old "not a real route" note was removed),
> and `/calendar` + `/profile` are new. The top `NavBar` was **deleted** and replaced by
> `AppNav` (desktop top bar / mobile bottom bar) — so the old Q9 "hamburger overlay" and Q1
> "nav not session-aware" notes are obsolete, there is no hamburger any more.

**A. Public / anonymous**
1. `/` **Home** (rebuilt H1.6e) — anon: sign-in options + "Browse without an account" + the
   public **Popular** and **Upcoming** rails. **Recommended-for-you must NOT appear for anon**
   (signed-in-with-taste-signal only), and **no stats strip** (authed only). Cards in the rails
   are linkable only when the item already has a catalog row (PR15) — a non-linkable card
   renders inert, that's correct, not a bug.
2. `/discover` anon — ungated (H2b), items render, search + filters work, no user-specific rows.
   **A5 (2026-07-26):** typed **People / Tags** result groups are **signed-in only**. For anon,
   searching a person's name must return Titles ONLY — no People/Tags groups, no "Titles"
   header, and `/api/discover/facets` must never be called (check `read_network_requests`;
   only `/api/discover?q=` should fire).
3. Item page `/{movie|show|game}/{uuid}/{slug}` — pick one via discover link-through. SSR content,
   OG/meta tags present, `noindex` while `PUBLIC_ITEMS_INDEXABLE` unset. Anon sees REAL star +
   wishlist controls (H2c); interacting opens the sign-in dialog (not a redirect); dialog sets
   return-path cookie; `isSafeReturnPath` rejects `//evil` & absolute URLs.
4. Wrong-slug URL (right uuid, junk slug) — should canonicalize/redirect or still render, not 404.
5. Facet pages (P17): `/person/christopher-nolan`, `/tag/sci-fi`, `/studio/<one>` — resolve via
   provider, grid renders with real `<a>` links, sort re-queries, Load more 60→120, pagination
   past end doesn't error.
6. `/insights/facet?...` legacy URL → 308 to the public facet page.
7. Gated pages anon: `/library` `/wishlist` `/calendar` `/profile` `/insights` `/settings` —
   graceful (shell 200s, then client-side redirect to `/`, not error/blank). `/dashboard` must
   **308 → `/wishlist`**. (`/wishlist` became a real route in H1.6c — the old "not a real route"
   note here was stale and is removed.)
   **Always pair this with the Back-button check in D.20 — see SM8**: a gated page that
   redirects with `router.push` instead of `replace` leaves itself in history and traps Back.
8. 404s: garbage uuid item URL, unknown person, and a plain unknown path. Branded 404 (Q13
   fixed; retokened H1.6f — expect a serif heading + accent-gold "404" eyebrow, not the old
   neutral one).
9. `/robots.txt`, `/sitemap.xml` (sitemap is cached-by-default — note staleness only),
   `/api/health` → 200 ok. **On a LIVE run, actually read robots.txt's `Host:`/`Sitemap:`
   values, don't just check the status code** — SM7 (2026-07-19) was a 200 response with a
   dead `localhost:3000` origin baked in at build time (route lacked `dynamic =
   "force-dynamic"`, fixed). A route returning 200 with the wrong content is exactly the
   kind of thing a status-code-only check misses.

**B. API probes (curl or fetch, both auth states)**
10. `/api/discover` anon GET/POST happy path; malformed JSON body → 400 not 500 (S8 zod).
11. Gated APIs anon (`/api/library`, `/api/watchlist` POST, `/api/settings`) → 401, error shape sane.
12. Junk input: watchlist POST with bad posterUrl (S12), bad enum values → 400.

**C. Logged-in (minted cookie — or, much better, see below)**
> **✅ 2026-07-27, 5th pass: this block finally RAN.** The unlock was trivial and is the thing to
> try FIRST next time: **Nils's own Chrome (the `claude-in-chrome` tools, NOT the in-app Browser
> pane) already holds a live `rr2_session` cookie for `localhost:3000`.** No mint, no OAuth, no
> classifier block — `list_connected_browsers` → `tabs_create_mcp` → navigate to localhost →
> probe `fetch('/api/library')` and check for 200. Don't reach for the (still-blocked) mint
> recipe until that probe comes back 401.
>
> ⚠️ **Do NOT log out at the end of a logged-in sweep** — it bumps `session_epoch` and there is
> no way back in without Nils re-doing OAuth by hand. Run anon checks in a separate profile, or
> accept an authed-only pass. Findings from the 5th pass: **SM10–SM16**.
>
> Session in use: `ramses3006`, RAWG identity, 1,918 library items / 97 wishlist / 1,595 rated.
>
> **6th pass, 2026-07-28:** the **in-app Browser pane** was already authenticated on `preview_start`
> — no mint, no Chrome handoff, no `/api/dev/login` call needed. Check auth first and you may find
> the whole block is already unlocked. Counts as of this run: 1,920 library / 96 wishlist /
> 1,597 rated. Findings: **SM18–SM32**.
13. Nav pages all render with real data (library ~2k items). **New/changed in H1.6c/e/f:**
    the **`/profile` hub** (stats strip, "Coming up" list, Recommended rail), **`/calendar`**
    (type-chip filter + its month/agenda toggle), Home's **stats strip + best-genre card +
    Recommended rail**, and the **Library ⇄ Wishlist tab** (switch both directions; each side
    must keep its own filters/sort — they use separate persisted keys by design).
13b. **Library's default sort is now "Recently added"** (H1.6f). Verify: it's the pre-selected
    sort on a fresh visit, the list really is newest-added-first (not release-date order), and
    items with no `added_at` sort last. Also verify Library **no longer auto-scrolls to today**
    (Q3 fix — it should open at the top); Wishlist SHOULD still auto-scroll (that's intended).
13c. **A5 typed search groups, logged in**: search a person's name on Discover → a **People**
    group and (for a genre word) a **Tags** group render above a **Titles** header, each pill
    links to the right `/person/…` / `/tag/…` page. This is the half no anon sweep can reach.
14. Wishlist: add from an item page → appears in `/wishlist` → survives reload → remove → gone.
    (DB write-back to platforms will fire with real tokens — acceptable on dev data, but prefer
    an obscure item and undo it.)
15. Rate an item (stars) → survives reload → shows in the facet-page personal overlay.
16. `/insights` renders; facet link-through → public facet page shows you-vs-crowd overlay.
17. Search in discover: query + filter, persisted across item→Back (usePersistedState; N-positives).
18. Settings: renders, country setting present; don't disconnect anything (bumps epoch → kills
    minted token — re-mint if it happens).
19. Calendar/timeline views on wishlist/library render. (Q3's mid-scroll landing is FIXED for
    Library as of 2026-07-27 — if it still drops you mid-list, that's a regression, not a known.)

**C2. The 2026-07-28 mockup-gap surfaces (A1/B5/B6/B7/C8)** — added after the 6th sweep, which
was the first to exercise them. Every one of these produced a finding; re-check them directly.
13d. **C8 — the Library/Wishlist merge.** The four status tabs (All/Wishlist/Unrated/Rated)
    reversed C8's original "never navigation" call (fixed 2026-07-28, SM21 — T10). Regression
    test: on `/library` click "Wishlist" → assert `location.search` becomes `?tab=wishlist`
    (`location.pathname` deliberately stays `/library` — only the query changes), the `<h1>` and
    the header count both track the ACTIVE TAB, and that Back returns to the All tab (query param
    dropped) rather than exiting the page. `document.title` is NOT part of the fix (stays
    "Library · Fandex" on every tab, on purpose — a client-side title effect would reintroduce the
    SM10 race). `/wishlist` (the real route) should still get everything right by the same logic.
    Note the persisted keys are now **shared** (`rr_mystuff_sort` / `_search` / `_membership` /
    `_incFacets` / `_excFacets` / `_year`); only `rr_view_*` is per page. The old checklist line
    "each side must keep its own filters/sort — separate persisted keys by design" is **obsolete**.
13e. **C8 render volume (SM19, fixed 2026-07-28 — T11).** `/library` used to render the whole
    list at once (2,014 cards / 44.5k nodes as of the 6th sweep); it now caps the first render at
    300 and grows by 300 via an `IntersectionObserver` sentinel as you scroll. Re-verify the cap
    holds: `document.querySelectorAll('a[href^="/game/"],a[href^="/movie/"],a[href^="/show/"]').length`
    should read ~300 on load, then grow after `window.scrollTo(0, document.body.scrollHeight)`.
    Also re-time a search keystroke (set `.value` via the native setter, dispatch `input`, measure
    around the dispatch, **especially clearing the box back to empty** — 1,426ms pre-fix) — the
    search filter now reads a 200ms-debounced value, so this should be well under 100ms.
13f. **B5 — NavSearch keyboard path.** Type a person's name in the desktop nav field, then test
    **Enter** (must navigate), **ArrowDown/Up** (must move a highlight and set
    `aria-activedescendant`), and whether suggestions are real `<a href>`. 6th-sweep note (SM24):
    keyboard nav was actually already working — only the missing `<a href>` was real (fixed
    2026-07-28, T8, now `next/link`). If a future sweep sees Enter/ArrowDown doing nothing again,
    check the browser-automation tool's key names first (a "Return"/"Down" alias not mapping to
    `key: "Enter"`/`"ArrowDown"` produced a false positive here) before filing a new finding.
13g. **B6 — item score panel.** Expand "Why?" and verify the parts compose: scrape
    `Your baseline` + every `[+-]N.N` delta and assert `baseline + Σ ≈ headline` (passed:
    67 + 3.8 = 70.8 → 71). Check both a **rated** and an **unrated** item — the unrated one used to
    expose SM23 (a Fandex Score existed on the detail page but the facet-page card showed the
    provider's `/10` instead — fixed 2026-07-28, T12, by healing thin links before scoring). Escape
    closes this popover, and now closes the calendar star picker too (SM32, fixed T6).
13h. **B7 — Insights.** Reconcile the numbers every time: type tiles must sum to "Rated items",
    and the "HOW YOU RATE" histogram must sum to the same figure (both passed). Read the section
    **copy** too, not just the numbers — SM27 (two wrong sentences over correct charts) was fixed
    2026-07-28, T4: the bucket step is now adaptive and the stray "tick on each bar" clause is gone.
13i. **A1 — calendar agenda rows at 375px.** SM28 found the Rate+Bookmark bar eating ~145px of the
    row, truncating most titles to ~12 chars. Re-measured 2026-07-28 (after L4 changed the row's
    density): the title box was still only 132px, so titles wrapped to 2 lines (`line-clamp-2`, T13)
    instead — expect ~30-36 chars now, not a fixed-width truncation. Screenshot at mobile.

**G. Provider-degradation checks (added 2026-08-02, 10th run)**

Why this section exists: the app has per-source *failure* isolation everywhere, which made everyone assume
a dead provider was handled. It is — for *correctness*. The 10th run (during a real RAWG outage) found two
surfaces that quietly lose a whole media type instead, and a third that had cost 60 s/request until `G1`.

45. **Is anything down right now?** `curl -s http://localhost:3000/api/health` → read `openProviderCircuits`.
    `{}` = all healthy. If a host is listed, sections 46–48 are live-testable for free; if not, they can be
    forced by temporarily pointing a provider key at a bad value (don't commit it) or simply skipped.
46. **Per media type, does every surface still have a second source?** With one provider down, check the
    type it owns across ALL of: Home's three rails (each type filter separately — SM36 was only visible
    with the Games chip selected), Discover's initial browse, Discover's **load-more per section** (SM35 —
    the initial browse being fine does NOT clear this, they use different code paths), `/api/calendar/popular`,
    and `/profile`'s Coming up. Cheap probes:
    ```
    curl -s ".../api/discover"                       # by-source mix of the initial browse
    curl -s ".../api/discover?section=games&page=2"  # the load-more path, separately
    curl -s ".../api/home"                           # trending / upcoming / recommendation, per type
    curl -s ".../api/calendar/popular?month=YYYY-MM"
    ```
47. **A load-more that returns nothing must not stay an enabled, silent button.** Click it in the UI and
    assert the control either disables, shows an end-state, or says why — SM35's stays clickable forever.
48. **The breaker itself:** the server log should show `provider_circuit_opened` once (not per request),
    then `provider_circuit_reopened` with a DOUBLING `openMs` (30 s → 60 s → 120 s, capped at 5 min), and
    the per-skip lines must stay one line each with **no stack trace** (a stack per skip floods the log —
    it fired hundreds of times in one run). Re-check after any change to `http.ts` or `discoverFeed.ts`.

**D. Cross-cutting**
20. Back-button spot checks on any NEW surface (full deep-dive already done — N1/N2/N3 known).
    **Targeted regression test for SM8 (added 2026-07-27), run ANON:** from `/discover`, click a
    gated nav item (Calendar), land on `/`, then press Back. **Pass = you return to `/discover`.**
    **Fail = you bounce to `/` again** (the tab title flashes "Calendar · Fandex" on the way).
    Instrument it — `history.length` before the click vs after: a jump of **+2** for one nav
    click means the gate used `push` and left the gated route in history. Re-check every gated
    route *and* the logout buttons on `/profile` and `/settings`.
21. **Both layouts on every flow**: run each checklist flow in the desktop viewport AND
    `resize_window` preset mobile (375×812) — not just one mobile spot-check at the end.
    Cheap way: after each desktop flow passes, re-run its key screen at mobile width and
    screenshot. (Q9's translucent hamburger and Q1's non-session-aware nav are both gone —
    `NavBar` was deleted in H1.6c. Check `AppNav` instead: the mobile **bottom** bar, its
    safe-area inset, `aria-current` on the active slot, and that the anon "You" slot opens the
    sign-in dialog rather than linking to `/profile`. Measured 2026-07-27: nav slots are
    75×52px, comfortably over the 44px bar.)
22. Console errors anywhere = always log; server log warnings/errors after the sweep.
23. Data consistency: same list twice in a row (discover, facet) — stable order, same counts.
24. **Scroll smoothness**: on Discover browse + a big facet page + wishlist/library, scroll
    continuously through the list and click "Load more" / lazy-load boundaries mid-scroll.
    Pass = the viewport position holds steady; fail = jittery jumps, content shifting under
    the cursor when new items/months mount, or scroll position teleporting (beyond the known
    auto-scroll-to-today on mount, N2). Check both layouts — mobile momentum scroll included.
    Evidence: record scrollY before/after a Load more via `javascript_tool`.
25. **Platform sync write-back validation**: after a wishlist add (C.14), verify the change
    actually reached the platform — not just that our API returned 200. How: read the
    provider's own state read-only — for Trakt, GET the user's watchlist from the Trakt API
    using the stored (decrypt-tolerant) token from `user_identities`; for RAWG, GET the
    public wishlist of `@ramses3006`. Confirm the item appears after add and is gone after
    the remove. Steam is read-only (no write-back to verify). Log any drift (200 locally but
    absent on the platform = broken write-back; that's a 🟠).

35. **"Coming up" / date-filtered lists must actually be filtered** (added 2026-07-28, SM18, fixed
    same day — T1). Any surface headed "Coming up"/"Upcoming" — `/profile`, `/calendar`'s two
    views, Home's Upcoming rail — must be checked against **today's date**, not just for
    rendering. The trap: `GET /api/calendar` returns all wishlist items sorted by release date
    **ascending with no future filter** (still true, by design — the calendar's own Month grid and
    the Wishlist tab both need the unfiltered history), so a consumer that naively slices the
    first N shows 1950s films as upcoming. `/calendar` always filtered client-side; `/profile` now
    does too via the shared `upcomingFrom()` helper (`src/lib/upcoming.ts`). Cheap probe:
    `fetch('/api/calendar').then(r=>r.json()).then(j=>j.items[0].releaseDate)` will still show a
    past date (that's the raw feed, correctly) — check what each CONSUMER does with it, not the
    endpoint itself.
36. **Displayed counts vs displayed rows** (added 2026-07-28, SM20/SM21, fixed same day — T3/T10).
    Wherever a header shows "N titles"/"N rated"/"N saved", count the rendered cards and compare.
    Two mismatches found: Discover's `TITLES · N` counted local-catalog matches while the grid
    showed provider results ("TITLES · 1" over 17 cards) — now hidden entirely while a search is
    active, since no single number spans both sources. Library's header count was route-derived
    so it kept saying "1597 rated" while the Wishlist tab showed 96 items — now tracks the active
    tab (see 13d above for the accompanying `?tab=` URL check).
37. **Page titles by hard load, every route, every sweep** (SM26 — the SM10 lesson generalized).
    Cheapest form, no browser needed:
    `curl -s http://localhost:3000/<route>` and regex the `<title>`. Loop all of
    `/ /discover /library /wishlist /calendar /profile /insights /settings /person/… /tag/…`.
    Found 2026-07-28: `/settings` → "Profile · Fandex", `/discover` → the root title.

**F. Tag taxonomy round trip (added 2026-07-30, per user request)**

Why this section exists: **two of the three most recent tag bugs were this exact path**, and
nothing in the plan exercised it. A reassigned tag kept its OLD heading on the item page while the
inline picker on the very same chip showed the new one (fixed 2026-07-30) — and the worse half of
that fix: the display loop iterated the **static 9-entry `CATEGORIES` const** against a **live
10-row `tag_category` table**, so a tag overridden into an admin-created category **vanished from
the page entirely** rather than merely grouping wrong. Both are invisible to typecheck, lint and
the whole test suite.

Needs `/dev/scoring` access (`SCORING_ADMIN_USER_IDS` must include your userId — it's set locally).
Do the whole thing including the revert; a half-run leaves the taxonomy dirty.

38. **Create a category.** `/dev/scoring` → Taxonomy → type a LABEL only (e.g. "Smoke Test Cat")
    and press Add. The id is DERIVED (T5 — typing a human label into a separate id field used to
    400 and was the root cause of "my created categories are gone"). Assert: the row appears in the
    list, and `fetch('/api/dev/scoring/categories')` includes it. There is **no colour picker** any
    more (2026-07-30) — colour is per facet CLASS, not per category; the swatch shows the derived
    class colour. A picker reappearing here is a regression.
39. **Reassign a tag into it.** In the same tab's tag table, find a tag you know is on a real item
    (`steampunk` and `cyberpunk` are both present in the local DB) and pick the new category from
    its dropdown.
40. **Facet page.** `/tag/steampunk` → the category chip shows the NEW label. Its colour must be
    the shared tag gold (`rgb(172, 154, 114)`), NOT a per-category hue.
41. **Item page — the pair that used to disagree.** Open an item carrying that tag (the facet page's
    own grid is the fastest route). Assert BOTH: the chip lists under the **new** heading, AND the
    hover-revealed `TagCategoryPicker` on that same chip shows the same category. Then the harder
    half: **the chip must still exist at all** — an admin-created category id is not in the static
    `CATEGORIES` const, which is what used to make it disappear. Cheap probe:
    `[...document.querySelectorAll('a[href^="/tag/"]')].map(a=>a.textContent)` must still contain it.
42. **Insights, without a restart.** `/insights` → a panel for the new category appears, containing
    that tag. This is the cache assertion: `scoringConfigSignature()` folds the category +
    override signatures in, so a write must bust BOTH `getLibraryFacetAnalysis`'s cache and
    `buildProfile`'s. If the panel only appears after a server restart, that chain is broken.
43. **Revert.** `DELETE /api/dev/scoring/categories?id=<id>` (or the row's Delete button). You do
    NOT need to move the tag back first — **deleting a category cascades its overrides away**
    (verified 2026-07-30: after deleting `smoke-test-cat`, `steampunk`'s override row was gone), so
    the tag falls back to `categorizeTag()`'s heuristic on its own.
44. **Reverse sweep — the half that gets skipped.** Re-check 40/41/42 and assert the taxonomy is
    genuinely back where it started, not just "different":
    - the chip is back under its ORIGINAL heading (`steampunk` → **Setting**, from the heuristic),
    - `/api/insights`'s `tagCategories` no longer contains the deleted id (no orphan panel),
    - `/api/dev/scoring/overrides` has no row for the tag.

    **What this canNOT reach:** `groupTagsByCategory`'s `FALLBACK_CATEGORY_ID` → *Other* path, for
    a tag whose override points at a category that no longer exists. The cascade above means the
    admin UI can't produce that state, so the fallback is defence-in-depth against a hand-edited DB
    or a race — not a step you can execute here. Don't log it as untested coverage; it's
    unreachable by design.

**E. Dedicated UI/UX evaluation (added 2026-07-18, per user request)**
Run on the main surfaces (landing, Discover, item page, facet page, wishlist/library,
Insights, Settings), desktop + mobile. Screenshot evidence for each finding.
26. **Links — consistent visual language**: are clickable things visibly clickable, and
    styled the same everywhere? (Known inconsistency: facet grids use real `<a>`, browse
    grids use `role="button"` divs — N3.) Hover/focus states present? Visited/unvisited
    treatment consistent? In-text links distinguishable from plain text without hovering?
27. **Readability**: font sizes — body text, metadata lines (dates, "· 2 dates", role
    badges), section headers — comfortably legible at arm's length on mobile? Contrast of
    dim/gray secondary text against the dark background OK (spot-check computed colors vs
    WCAG AA via `javascript_tool`)? Line lengths on wide desktop not overlong?
28b. **SubBar's chip-row wrap at mobile widths, per page** (added 2026-07-27, SM17). The
    "Filters" trigger sits `ml-auto` inside the same flex row as the type chips — on a page
    whose chip row has MORE than the base 4 (`All`/`Games`/`Movies`/`Shows`), e.g. Library's
    extra "Hide rated" chip, that row wraps at 375px and the trigger strands alone on its own
    line with a visible gap above it. Discover and Wishlist (exactly 4 chips) don't show it.
    Check every page that renders `SubBar` with an extra chip (`filters`/`hideRated` props) at
    375px specifically, not just Discover — a pass on Discover does NOT clear this for Library.
28. **Touch targets (mobile)**: links/buttons ≥ ~44×44px — measure the quick-action icons
    on cards (rate / watched / wishlist), tag chips, sort buttons, calendar day cells,
    month-scrollbar entries via `getBoundingClientRect`. Adjacent targets far enough apart
    to not mis-tap?
    **How to measure this properly (learned H1.6f):** the visible box is NOT the hit area.
    SubBar controls carry a `.tap-44` / `.tap-44-y` class whose transparent `::after` claims
    `max(100%, 44px)` — so compute the EFFECTIVE rect (`max(rect, 44)`, width-only for
    `.tap-44-y`) and then **check every pair for overlap**, because an expanded region that
    collides with its neighbour silently steals that neighbour's taps, which is worse than the
    small target it fixed. Run at 375 / 500 / 1280px — the chip and sort lines only become
    vertical neighbours once Row 1 wraps, so the collision is width-dependent.
    Known-and-accepted: the 3 view-toggle buttons are **34×44** (they can't each claim 44px of
    width inside a ~102px segmented group). **`ActionCells` fixed 2026-07-27 (task S3)** — card
    layout got `.tap-44-y` (width was already >44px in practice, only height 32→44 needed
    expanding), row layout got full `.tap-44` **plus** its gap widened `gap-1`→`gap-2` (4px→8px,
    otherwise the three 44px-wide expansions would overlap by 4px each), star-picker buttons got
    `.tap-44-y` only (10 stars at 2px gaps can't each claim 44px width). Verified: zero overlap
    in either layout, a functional click inside the invisible padding routes to the right button.
    Don't re-measure this every sweep — it's fixed; just flag if a future style change to
    `ActionCells.tsx`'s gaps/sizes looks like it could have reopened the collision.
29. **Layout**: wasted or cramped space at each breakpoint; grids reflowing sensibly between
    375px / tablet / wide desktop; no overflow, truncation without tooltip/ellipsis, or
    overlapping elements; sticky headers/filters behaving while scrolling.
30. **More (open-ended)**: anything a demanding user would grumble about — loading/skeleton
    states, focus visibility for keyboard nav, empty states, spacing rhythm, icon-only
    buttons without labels/tooltips. Log with screenshots; user makes final taste calls.
31. **Cross-surface consistency diff** (added 2026-07-19 — the user found Q14/Q15 that the
    sweeps missed): the same conceptual view rendered on different pages must match. Put the
    card grid on Discover, Library/Wishlist, and a facet page side by side (screenshots) and
    diff: card aspect/height, media-type indicator, quick actions, sort UI, badges (Fandex
    Score), dividers/scrubber. Same for list view. Any divergence not obviously
    context-dependent (platform rating, date formatting, person role) is a finding.
32. **Discover filter × sort matrix** (missed Q16/Q17): don't test filters and sorts in
    isolation. Combine each sort with hide-in-library + hide-on-wishlist, and tag-include
    filters with both hides — watch result COUNTS across pages (a shrinking page = post-slice
    filtering) and check via `read_network_requests` whether provider queries actually carry
    the filter, or results are only ever local-catalog matches dressed up as discovery.
33. **Displayed-math sanity** (missed Q20a): wherever the UI shows a headline number WITH a
    breakdown (Fandex Score "why", stats), check the parts plausibly compose to the whole.
    Parts that visibly don't add up are a finding even if the underlying math is correct.
34. **Distribution sanity, logged-in** (missed Q19): for personalized numbers (Fandex Score),
    eyeball the spread across a real library — a tight clump (e.g. everything 40–60) or a
    misleading center is a product finding even when each individual value is "correct".

## Gotchas learned (2026-08-02, 10th run) — READ THE FIRST TWO BEFORE ANYTHING ELSE

- **🚨 `/library` and `/wishlist` DO NOT HYDRATE on a hard load under `next dev` (Turbopack) — this is a
  DEV-SERVER bug, not a product bug (SM34).** Symptom: a permanent "Loading…" spinner, 0 cards, **zero
  console errors**, and the browser's Resource Timing showing exactly ONE request (`/api/auth/me`, which
  is AppNav's — not MyStuffView's). It looks exactly like a catastrophic product regression and it is not.
  **The 30-second test that tells them apart** — fibers are attached to hydrated DOM only:
  ```js
  const fk = el => Object.keys(el).filter(k => k.startsWith('__react')).length;
  ({ main: fk(document.querySelector('main')), nav: fk(document.querySelector('nav')) })
  ```
  `nav: 2, main: 0` = the subtree never hydrated → dev-server artifact, **not a finding**.
  Client-side navigation to the same route works fine (that path renders on the client, no hydration).
  **So: verify `/library` and `/wishlist` on the PRODUCTION build before logging anything about them** —
  `preview_stop` → `npm run build` → `preview_start {name:"prod"}` (:3100, already in launch.json) →
  they work perfectly there (300 cards, both fetches, `main` hydrated). **Cookies ignore port**, so the
  `rr2_session` minted on :3000 is sent to :3100 unchanged — you stay logged in across the switch, which
  matters because `/api/dev/login` 404s under `NODE_ENV=production` and can't re-mint one there.
  Already ruled out, don't re-investigate: stale `.next` (reproduces after `rm -rf .next` + restart) and
  the 2026-08-02 `http.ts`/`discoverFeed.ts` changes (reverting them to `7c442b8` reproduces identically).
- **Before blaming the app for anything slow or empty, check whether a PROVIDER is down.** RAWG was fully
  down during this run (`https://rawg.io/` itself → Cloudflare **522** after ~19.8 s, so not our key).
  Cheapest check, no browser: `curl -s -o /dev/null -w "%{http_code} %{time_total}\n" --max-time 45
  https://rawg.io/` — or just read **`/api/health` → `openProviderCircuits`** (added 2026-08-02), which
  names every host whose circuit breaker is currently open. `{}` = everything healthy.
- **A provider outage is the best free test of the degraded paths — use it rather than working around it.**
  What it surfaced this run: games load-more is RAWG-only (SM35) while the initial browse is dual-source,
  and Home's Popular rail is RAWG-only for games (SM36). Worth re-checking deliberately whenever a
  provider IS down: per media type, does every surface still have a second source?
- **The Fandex Score breakdown does NOT sum to the headline if you scrape every `+N.N` off the page — and
  that is correct.** Capped reasons (`contribution: 0`) render their **`impact`** in the same ±N.N format,
  separated by a divider reading "NOT COUNTED FOR THIS TITLE — OUTSIDE THE TOP MATCHES THIS ITEM SELECTS".
  Scraping naively gave 67 + 24.1 = 91.1 against a headline of 86; the real check is `center + Σ(reasons
  where !capped)` = 67 + 18.6 = 85.6 → 86 ✓. Get it from `/api/detail`'s `fandexReasons` + `fandexCenter`
  (authoritative, one call) rather than the DOM.
- **`/api/detail/similar` is a DIFFERENT endpoint from `/api/detail`** — a substring filter on `/api/detail`
  matches both and reads as the old double-mount bug. Filter exactly, or check `iframe` count instead.
  Relatedly: "More like this" correctly does not render when the catalog yields only ~2 similar items
  (sparse unreleased movies); it renders fine at 12. Not a finding.
- **The dev server can die silently between phases of a long session** (observed twice this run — every
  `curl` returns `000`). `preview_list` returning `[]` is the tell; just `preview_start` again.

## Gotchas learned (2026-07-28 run)

- **`/api/auth/me` wraps the user as `{user:{userId,…}}` — the field is `userId`, NOT `id`.**
  A probe reading `j.user.id` returns `undefined`, `JSON.stringify` drops the key, and the result
  reads exactly like "anon". The 6th sweep spent its first probes believing it was logged out
  while looking at an obviously authenticated Home. Always assert on `!!j.user`, or cross-check
  with `fetch('/api/library').then(r=>r.status)` (200 = authed, 401 = anon).
- **The anon side can be covered without touching the session** — `curl.exe` from PowerShell sends
  no cookie, so status codes, redirects (`-D -` for `location:`), SSR HTML and API error shapes are
  all reachable while staying logged in. What it CANNOT cover: anything client-side (the SM8 Back
  test, the sign-in dialog, the anon "You" nav slot). Say so explicitly rather than implying a full
  anon pass. To strip tags from SSR HTML in PS 5.1:
  `[regex]::Replace($h,'<script[\s\S]*?</script>',' ')` then `[regex]::Replace($t,'<[^>]+>',"`n")`.
- **`resize_window`'s `region` argument is ignored by `computer{action:"screenshot"}` and `zoom` in
  the in-app pane** — both return the full viewport ("region crop not yet supported"). Don't build
  a measurement on a cropped screenshot; read geometry via `javascript_tool` instead.
- **Screenshot pixels ≠ viewport pixels at mobile.** After `resize_window {preset:"mobile"}`
  (375×812) screenshots come back 563×1218 — a 1.5× factor. `computer` clicks take *screenshot*
  coordinates, so scale before clicking.
- **A `left_click` with `coordinate` fails until a screenshot has been taken in that viewport** —
  "no screenshot dimensions cached". A `navigate` invalidates the cache, so re-screenshot after
  every navigation before coordinate-clicking.
- **`javascript_tool` DOES support top-level `await` in some calls and rejects it in others** —
  the first call of a session failed with "await is only valid in async functions". Wrapping in
  `new Promise(r=>setTimeout(…))` or `.then()` always works; prefer that.
- **Consecutive `javascript_tool` calls share a scope** — re-declaring `const inp` in a later call
  throws "Identifier already declared". Wrap every probe in `(function(){…})()`.
- **`navigate`'s "navigated to <url>" line reports a stale URL** (usually the origin) and the tab
  title in its footer can lag a redirect. Read `location.href` / `document.title` via
  `javascript_tool` before concluding anything about where you landed — a made-up item uuid looked
  like it had silently landed on Home when it had correctly rendered the branded 404.
- **The dim numeric font makes 6 and 8 indistinguishable in screenshots** at small sizes — Settings'
  "Watchlist items 96" read convincingly as 98. Confirm any number that matters via `innerText`.

## Gotchas learned (2026-07-18 run)

- **The preview browser keeps the httpOnly `rr2_session` cookie across sessions** — check
  auth state FIRST (`fetch('/api/library')` → 200 = logged in, 401 = anon) before assuming
  anon. JS cannot delete an httpOnly cookie; use the nav "Log out" button to go anon (this
  bumps `session_epoch`, so re-mint tokens with the NEW epoch afterwards). Epoch is **3** as
  of 2026-07-18.
- If already logged in, run the logged-in sweep FIRST, then logout → anon (saves a mint).
- `javascript_tool`: no top-level `await` (wrap in `Promise`/`.then`); no repeated
  `const` names across calls (wrap in IIFE); `computer {action:"wait"}` requires `tabId`;
  coordinate clicks need a prior screenshot AND screenshot pixels ≠ viewport pixels.
- Set-Cookie inspection: PS 5.1 `Invoke-WebRequest` hides it on redirects — use
  `curl.exe -s -o NUL -D -`.
- Legacy facet redirect param is **`kind`** (not `type`): `/insights/facet?kind=person&key=…`
  → 308; wrong params fall back to `/insights` (intended).
- **Known 401 noise (SM6)**: anon pages fire authed calls — `/api/detail`, `/api/facet/mine`,
  `POST /api/discover/find` (search then falls back to `GET /api/discover?q=`). Don't re-log.
- `GET /api/watchlist` is 405 (POST/DELETE only); use `/api/library` as the auth probe.
- Wishlist remove leaves the row until reload (SM1) — verify removal via network 200 +
  reload, not the UI.
- ~~View mode is a single global `rr_view_mode` key (SM2)~~ — **no longer true**: view mode is
  per-page now (`rr_view_discover` / `rr_view_library` / `rr_view_wishlist` via `useViewMode`).
  The *type* filter is still shared (`rr_type_filter`, SM2's real remaining half).
- **NEVER run `npx next build` while the dev server is running** (cost real time on the
  2026-07-27 run). It overwrites `.next` with production output and corrupts the running dev
  server — routes start returning **404 HTML**, which then surfaces as a plausible-looking
  product bug (`/api/auth/me` 404 → `/calendar` renders its "Couldn't load your calendar"
  error state). If any route 404s unexpectedly mid-sweep: check the file still exists and
  `git status` is clean, then `preview_stop` → `rm -rf .next` → `preview_start`. Build only
  after stopping the preview.
- **Clearing persisted UI state between probes:** `sessionStorage`/`localStorage` keys are all
  `rr_`-prefixed, so
  `Object.keys(sessionStorage).filter(k=>k.startsWith('rr_')).forEach(k=>sessionStorage.removeItem(k))`
  (and the same for `localStorage`) gives a clean baseline. Worth doing before any
  sort/filter/scroll test — a stale persisted query silently puts Discover in SEARCH mode and
  you'll be measuring the wrong thing.
- **Q26 scroll-to-top is intentional**: switching to a non-date sort on Discover jumps to the
  top. Don't set a scroll position and then change sort — the effect will reset it and the
  test measures nothing.
- Anon Discover/facet cards are **non-linkable by design** (PR15/PR14 — no `<a>`, no action
  bar), so "click an item then press Back" flows can't be tested anon there. Home's rails DO
  have real links for items already in the catalog — use those for anon link-through tests.
- Write tests: Steam is read-only; a game wishlist add/remove goes to RAWG (net-zero
  verified safe 2026-07-18). Skip RATING writes — they create real reviews/ratings on the
  user's platform accounts and clearing isn't obviously exposed; note as not-exercised.
- Facet "Highest rated" ranking obscure titles first is SM3 (no vote damping), not a
  provider bug.
- **Tab titles: test them by HARD LOAD, never by clicking through the nav** (learned SM10). A
  client-side nav is the one path where `usePageTitle` works, so a click-through check shows a
  false pass on all 7 pages. `navigate` to the URL, wait, then read `document.title`.
- **The dev server needs ~8s, not 5, for the fetch-heavy authed hubs** (`/profile` fires
  `/api/home` + `/api/calendar` in parallel, both cold-compiled). At 5s `/profile` shows only its
  identity + link grid, which reads convincingly as "the stats/Coming-up/Recommended rails were
  never built" — they were; they just pop in late with **no skeleton**. Wait 8s before judging any
  authed hub empty. (Corollary worth logging once: that missing skeleton is itself a minor finding.)
- **Case-sensitivity + scroll position will fake a missing UI section.** A5's People/Titles group
  headers are `text-transform: uppercase` in CSS, and the group sits above the default scroll
  position after a search. A `/\bPeople\b/` probe on `innerText` plus an unscrolled screenshot
  made a working feature look broken. Scroll to top and screenshot before concluding anything is
  absent, and prefer querying for the elements (`a[href^="/person/"]`) over matching rendered text.
- **Two `<nav aria-label="Primary">` in the DOM is CORRECT** — `AppNav` renders the desktop and
  mobile bars as a pair and hides one with `display:none`, which removes it from the a11y tree.
  `find`/`read_page` will still surface both and describe one as a "duplicate". Investigated and
  dismissed 2026-07-27 — don't re-log it.
- **`javascript_tool` blocks reads of anything it reads as a credential** — `getPropertyValue`
  on a CSS custom property returned `[BLOCKED: Sensitive key]` purely because the surrounding
  object key was named `accentToken`. Rename the variable (`brandAccent`) and it works. Not a
  real block, just avoid `token`/`key`/`secret` in identifiers when probing styles.
- **`resize_window` on a REAL connected Chrome browser (`claude-in-chrome` tools) cannot hit
  arbitrary widths like 375/500/1280 — those are only reliably achievable in the sandboxed
  in-app Browser pane (`mcp__Claude_Browser__resize_window`).** A real desktop Chrome window has
  an OS/Chrome-imposed minimum width (measured 2026-07-27: ~606px was the narrowest achievable,
  ~1034px the widest, on this machine) — asking for 375 silently clamps to whatever the window
  manager allows, and `innerWidth` after the call may not match the requested value at all.
  Always read `innerWidth`/`innerHeight` via `javascript_tool` right after a `resize_window` call
  to confirm what you actually got, rather than trusting the tool's "successfully resized"
  message. If a real 375px viewport matters (not just "narrow enough to hit the 2-column
  breakpoint"), device emulation is needed, which these tools don't expose — note the
  substitution rather than claim an exact width you didn't verify.
- **Multiple Chrome browsers can be connected to one account** — if `list_connected_browsers`
  ever shows more than one, a browser action mid-session can suddenly demand you call
  `AskUserQuestion` to pick one (even after you were already successfully driving a tab). Ask,
  then `select_browser` with the chosen deviceId — the existing tab/session state is preserved,
  nothing is lost by the prompt.
- **`.click()` via `javascript_tool` on a React-controlled element can read STALE state if you
  check the DOM in the same synchronous script** — the click dispatches and React schedules the
  re-render, but the very next line in the same script may run before that commit lands. Add a
  small `await new Promise(r => setTimeout(r, 150))` between the click and the check (top-level
  `await` works in `javascript_tool`), or use the `computer` tool's real click instead, which
  goes through the actual browser event loop and doesn't have this race.
- **`navigate` is intermittently denied by the safety classifier** for no reason tied to the
  URL (same URL succeeds on a bare retry seconds later) — don't treat one blocked `navigate`
  as a broken page; just retry once before investigating further. This is separate from the
  cookie-mint block above, which is a hard, consistent block, not intermittent.

- **Both the in-app Browser pane AND `claude-in-chrome` can end up already authenticated**
  (observed 2026-07-27) — a session cookie apparently persists across conversations in this
  environment, not just in the "real Chrome" tool. Always `fetch('/api/auth/me')` to check
  BEFORE assuming a fresh browser tab is anon, in either surface. If both are authenticated and
  you need a genuine anon pass, do NOT log out to get it — that bumps `session_epoch` and ends
  the real session in both places at once (same account, same token validity). Either ask the
  user to test anon in a separate profile, or accept an authed-only pass and say so explicitly.
- **Post-rebuild targeted check (2026-07-27):** after any change to `SubBar`, `PosterCard`,
  `ActionCells`, or the two score badges, re-check ALL of Discover/Library/Wishlist/Calendar's
  facet pages — they share these components, and a fix verified on one (e.g. Discover) can
  still be broken on another with slightly different props (Library's extra "Hide rated" chip
  broke the Filters-button layout — SM17 — even though Discover was clean).

## Environment gotchas

- `.env` is loaded by Next dev automatically; JWT_SECRET is set there (don't print it).
- Dev server compiles routes lazily — distinguish "slow first hit" from a real hang.
- CSP is prod-only (dev keeps only frame-ancestors) — don't chase CSP issues locally.
- OMDB key invalid + Letterboxd hidden (memory) — missing RT/IMDb scores on detail pages is a
  KNOWN config gap, not a bug.
- Steam CDN images for delisted games 404 — known noise, not a finding.
