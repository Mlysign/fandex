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
  non-loopback host).
  - ⚠️ **"A live run is anon-only by construction" was WRONG — corrected 2026-08-12 (11th run).**
    `/api/dev/login` is indeed unavailable on prod, but **Nils's own Chrome (`claude-in-chrome`)
    holds a live prod `rr2_session`, including the `SCORING_ADMIN_USER_IDS` admin gate.** That
    makes a live run **fully two-state**, and it is the best setup this plan has ever had:
    **the in-app pane is genuinely anon** (fresh sandbox, no cookie) **and Chrome is logged in**,
    simultaneously, with no `127.0.0.1` trick and no logout risk. Probe Chrome with
    `fetch('/api/library').then(r=>r.status)` → 200. It also reaches `/api/dev/dbsize` and
    `/api/dev/prune` on prod, which is the only way to read prod row counts. Useful trick when another Claude
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

Confirm with `fetch('/api/auth/me')` → `user` non-null. **Do not hit `/api/auth/logout`** to
go anon, see the warning below (and JS can't clear an `httpOnly` cookie, so the
`document.cookie = "rr2_session=; …"` recipe that used to be here never worked).

### Going ANON without destroying the session (added 2026-08-02 — this finally works)

**Use `127.0.0.1` instead of `localhost`.** Cookies are keyed by HOST STRING, so
`127.0.0.1:3100` and `localhost:3100` are separate cookie jars: the first is genuinely
logged out, the second keeps its session untouched. Both hosts pass `/api/dev/login`'s
loopback gate, so you can hold both states at once in two tabs. This is what let the
anon-only H4.10 fix be verified on the real anon path; before it, four sweeps in a row
logged "anon client-side behaviour not covered".

⚠️ **Production build only.** Under `next dev` nothing hydrates on `127.0.0.1` (the dev
client is bound to `localhost`): zero React fibers on `body`/`nav`/`main`, no effects, no
client fetches — so every client-rendered thing looks broken or absent. It produced a
confidently WRONG reading first time (the anon "You" nav slot appeared to be a plain `<a>`,
which would have "disproved" a real finding; on the prod build it's a `<button>`). Recipe:

```
preview_stop → npm run build → preview_start {name:"prod"}   # :3100
navigate  http://127.0.0.1:3100/                             # genuinely anon
```
Sanity-check hydration before trusting anything client-side:
`Object.keys(document.querySelector('main')).filter(k=>k.startsWith('__react')).length` — 0
with a non-zero count on `nav` means not hydrated, not "the feature is missing".

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
   (signed-in-with-taste-signal only), and neither must the **highlight panels** or the
   **"Up next" progress rail** (both authed-only). ⚠️ **The three-counter stats strip
   (library / wishlist / rated) was REMOVED 2026-08-16** — its absence is correct, not a
   regression; older checklist lines saying "no stats strip (authed only)" are obsolete.
   Cards in the rails
   are linkable only when the item already has a catalog row (PR15) — a non-linkable card
   doesn't navigate, that's correct, not a bug. ⚠️ **But it must still render its Rate/Wishlist
   bar for an anon viewer** (AN4, 2026-08-18): the bar's job logged out is "prompt sign-in",
   which needs no item identity. Every card carries it or none do — a grid where only some
   cards have buttons is the regression. `[...document.querySelectorAll('[data-item-id]')]
   .filter(c => !c.querySelector('[aria-label^="Sign in"]')).length` must be **0** anon.
1b. **`/calendar` anon — PUBLIC since 2026-08-18 (AN1).** It must NOT redirect. Popular renders;
    the Wishlist and Library scope chips are dimmed, carry `aria-label="… — sign in to use"`, and
    open the sign-in dialog rather than toggling. `/api/calendar/popular` answers **200** anon
    while `/api/calendar` stays **401**.
1c. **`/wishlist` anon — a sign-in GATE, not a redirect (AN2).** `location.pathname` must still be
    `/wishlist` and the page must read "Sign in to see your wishlist". A bounce to `/` is the
    regression; it reads as a broken nav link, because `AppNav` shows that slot to anon visitors.
1d. **The nav search box, anon (AN3).** Open it (desktop ≥768px), type 3+ chars, expect a real
    dropdown — it was totally inert while `/api/discover/facets` was session-gated. Enter with
    nothing matched must land on `/discover` with the query carried into its search field.
    **The tell for the whole class:** a non-OK response deliberately keeps the dropdown CLOSED, so
    a gating regression looks like "no matches", not like an error.
1c-i. **`/insights`, `/profile` and `/settings` anon — same rule, fixed 2026-08-27 (SM52).** All
    three used to `router.replace("/")`. Each must now stay on its own `location.pathname` and read
    "Sign in to see your Insights" / "…your profile" / "…open your settings", with a working Sign in
    button and a "Browse without an account →" link. They share one component,
    `components/auth/SignInGate.tsx`, so check all three: a regression in the gate shows up on
    whichever page you skip. `/profile` additionally must render the LEGAL FOOTER while signed out
    (Privacy / Terms / Contact / Imprint) — the bounce used to swallow it, which is the
    [[anon-legal-reachability]] gap. ⚠️ **Verify on the `prod` config, not `next dev`**: `/settings`
    is a fourth page in the unhydrated-subtree family (`mainFibers` 0, `bodyFibers` 2 under dev), so
    the dev server renders the signed-in chrome with everything empty for anon and authed alike.
1e. **Every anon gate must ASK, never disappear.** Sweep the logged-out surface for controls that
    silently do nothing: the item page's "Sign in to see your Fandex Score" panel must be a real
    `<button>` (AN5), and card Rate/Wishlist must open the dialog rather than 401 into a
    "Couldn't save your rating" toast.
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
10. `/api/discover` anon **GET** happy path; malformed JSON body → 400 not 500 (S8 zod).
    **Corrected 2026-08-12 (SM42): `POST /api/discover` is 405** — the route is GET-only now, so
    the old "GET/POST" wording made the malformed-body probe test nothing. Send the malformed body
    to a route that actually accepts POST.
11. Gated APIs anon → 401 with a sane error shape. **Use `/api/library` and `/api/insights`** —
    both verified 401 on 2026-08-12. **Not `/api/settings` (405) and not `GET /api/watchlist`
    (405)**: those verbs aren't routed, so a 405 comes back before any auth check and the probe
    proves nothing about the gate. `POST /api/watchlist` with junk correctly returns **401**, i.e.
    auth is checked before validation — that ordering is right, so don't read the absence of a 400
    as missing validation.
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
    the **`/profile` hub** (stats strip, "Coming up" list, Recommended rail — `/profile`'s
    strip is untouched and still expected), **`/calendar`** (type-chip filter + its
    month/agenda toggle), Home's **rotating highlight panels + "Up next" progress rail +
    Recommended rail** (Home's own three-counter strip was removed 2026-08-16 — see C3),
    and the **Library ⇄ Wishlist tab** (switch both directions). ⚠️ **The two tabs SHARE one
    set of persisted filter/sort keys** (`rr_mystuff_sort`, `rr_mystuff_search`, … — see
    `MyStuffView.tsx`), so a filter set on one side carries to the other. This check used to
    say the opposite ("separate persisted keys by design"); that was written the day before
    C8 (2026-07-28) merged the two pages into one component and was never updated. Carry-over
    is the expected behaviour, not a finding.
13b. **"Recently added" is the default sort, and it must be checked on BOTH tabs** (H1.6f).
    Verify on Library AND on Wishlist: it's the pre-selected sort on a fresh visit, the list
    really is newest-added-first (not release-date order), and items with no `added_at` sort
    last. ⚠️ **Checking only Library is how this went a month with the wishlist half totally
    inert** (H1.6f 2026-07-27 → fixed 2026-08-26): `/api/calendar` never sent `addedAt`, so
    every wishlist item tied at -Infinity and the list kept the route's release-date order.
    One component, two routes — the tab you skip is the one that breaks.
13b-i. **An item on BOTH lists sorts by the right event.** Wishlist something, then rate or mark
    it owned so it appears in both (a Steam game you own and still have wishlisted is the natural
    case). On the **Wishlist** tab it must sit at its WISHLIST date; on **Library**, at its
    library date. Both dates come from one `addedAt` field, so getting this wrong looks like a
    correct sort with one item in a strange place.
13b-ii. Also verify Library **no longer auto-scrolls to today** (Q3 fix — it should open at the
    top); Wishlist SHOULD still auto-scroll (that's intended).
13b-iii. **A Filters-sheet pill must be checked with a PERSON or a STUDIO, on all three tabs.**
    Open Filters → Must include, type an actor or studio you own a few titles by, pick the
    match, and confirm the count and the list. ⚠️ **Testing this with a genre tag proves
    nothing**: tags were the one facet kind that worked while people, studios and franchises
    matched ZERO on Library and Wishlist for a month (2026-07-30 → fixed 2026-08-28). The
    routes shipped `sources[].data` as `{}` and the client re-derived facets from it, so three
    of four kinds were simply absent. **A pill that matches nothing renders identically to a
    genuine zero result**, which is the whole reason it needs an item you KNOW should match.
    The pill's count is catalog-wide, so it can legitimately exceed the tab's hits (Rebecca
    Ferguson: 6 in the catalog = 5 Library + 1 Wishlist). Also check exclude, and check that
    two pills AND rather than OR.
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
13e-i. **⚠️ Check the cap on BOTH routes, and note which one the nav links to (SM49, ✅ FIXED
    2026-08-27).** The cap now reads `capRender = activeTab === "library"`, and
    `src/components/myStuffRouteConditions.test.ts` fails on any `route ===` condition in that file.
    Measured after the fix on the prod build, signed in: `/library` 300 cards / 6,519 nodes,
    `/wishlist?tab=library` **300 / 6,519** (was 1,929 / 40,748 / 120,583px), `/wishlist` 95 / 2,222.
    Keep running it anyway; the point below is what generalises.
    13e above names `/library`, and `/library` passed — which is exactly how this stayed open. The
    cap was `capRender = route === "library" && …`, so the identical Library **tab** at
    `/wishlist?tab=library` rendered the whole list, and **`AppNav` has no `/library` link at all**,
    so the uncapped route was the one a signed-in person actually reaches. Run the count on BOTH and
    diff them. Generalise it:
    **whenever a fix is gated on `route ===`, in a component two routes share, the check must name
    both.** Same probe catches SM51, the placeholder that said "Search your wishlist…" while
    the `<h1>` said Library (✅ fixed the same day; it is `TAB_SEARCH_PLACEHOLDER[activeTab]` now,
    and the anon gate's copy and its returnTo went with it). ⚠️ **Clear `rr_`-prefixed storage
    between the two measurements** — the
    persisted `rr_mystuff_search` carried a search term across and the control read 2 cards.
13e-ii. **Key an order/sort assertion on the SLUG, never the title.** 35 titles are duplicated in
    the local catalog (a 1999 anime and a 2023 live-action *One Piece*, both legitimately present
    and correctly slugged `-2023`). Title-keying the 13b sort check invented three phantom
    "violations"; re-keying on `href.split('/')[2]` gave a clean strictly-descending pass over 500
    cards. Two sibling rows that differ only by year are the DESIGNED collision behaviour, not a
    duplicate — don't log them.
13e-iii. **The two per-user preferences (2026-08-27). Both are DISPLAY-only, and the check that
    matters is that nothing was deleted.** Settings → *What you track* and *Your platforms*.
    ⚠️ **Verify on the `prod` config**: `/settings` is in the `next dev` unhydrated family, so the
    dev server never runs the effect that loads either one.
    - **What you track**: turn Games off. The Games chip must vanish on **all four** surfaces (Home,
      Discover, Calendar, Library/Wishlist) and `a[href^="/game/"]` must read 0 on each. Measured
      2026-08-27: Library `TITLES · 1,942` → `1,212`. Turn it back on and confirm you get **the same
      numbers back** (239 game links, 1,942) — that is the check that the preference never reached a
      sync pull, where the prune invariant would have deleted the rows for real.
    - ⚠️ **The picker must refuse to turn the LAST type off.** "Uses none" cannot round-trip (it is
      indistinguishable from "never configured"), and an app with every list empty and no
      explanation is the failure this guards.
    - **Your platforms**: pick two. The "Available on" section must offer exactly those two, and say
      "Showing the platforms you own". Measured: 185 options → 2.
    - ⚠️ **A chip you have SELECTED must stay visible even after it stops being owned.** Repro:
      select Nintendo Switch, then set owned to Netflix only. Before the fix the list stayed filtered
      to 209 titles with no chip to un-press and only Reset all as an escape.
    - ⚠️ **A count beside a chip is a promise.** `Netflix 269` must yield `Show 269 titles`, not 270.
      Build option counts from the set with every OTHER filter applied but this one.
    - **A Home rail that loses all its items to the filter must SAY so**, not return null. That is
      SM36's failure mode and this setting reintroduces it from two screens away, since rails are
      sliced to 15 at snapshot-build time.


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
13j. **The calendar month grid is DAY-FIRST (2026-08-26).** At 375px, check all four cell kinds,
    not one: a busy day, a 3+ day with "+N more", a single-release day, and an EMPTY day. Every one
    must open the day rail below the grid, and nothing in the grid may navigate to an item:
    a single-release day jumping straight to the item page is the old behaviour, i.e. a regression.
    Tap a busy cell in several places (top corner, over a title line, the gap between lines): the
    outcome must be identical every time. An empty day must say "Nothing releasing on this day"
    rather than doing nothing. Then: **swipe** left/right anywhere on the grid to page the month
    (a vertical scroll and a slow drag must NOT page it), and swipe sideways INSIDE the open day
    rail, which must scroll the rail and leave the month alone. Finally, with no day open, check
    the page does not scroll at all on a 6-week month: `document.documentElement.scrollHeight -
    innerHeight` should be `0`. It was permanently 64px (a 100vh page under a `pb-16` wrapper) until
    2026-08-26, so a small non-zero number here means that padding/height pair has drifted again.
13ja. **The calendar does not scroll AT ALL, in any state (2026-08-26, second pass).** It is one
    viewport tall and the grid and day rail trade height with each other. The check is one line,
    run in every state: `document.documentElement.scrollHeight - innerHeight` must be **0** with
    the month closed, with a busy day open, with an empty day open, and straight after a swipe.
    `scrollY` must stay 0 throughout, and the filter bar must never slide away (it hides on
    scroll, so any movement here shows up as a disappearing header). Opening a day collapses the
    month to the selected week on a phone, two weeks at 900px of desktop; closing it expands the
    month back. A busy day and an EMPTY day must give the rail the SAME height, since an empty
    day moving the layout the other way was half of what felt broken. The utility row under the
    month name must stay 24px while a month fetch runs, changing only its text.
    ⚠️ **Measuring any of this in the browser pane requires killing transitions first**,
    with `*{transition:none !important}`, or `getBoundingClientRect` returns the START of every
    animated height and the collapse reads as not working at all. Same family as the hover trap.

13jb. **What the 12th run cleared, and the one thing it could NOT (2026-08-26).** 13j/13ja both
    pass in full — at 375 and 1280, anon and authed, dev and prod, with `scrollHeight - innerHeight`
    and `scrollY` both 0 in every state and the rail exactly 395px whether the day is busy or empty.
    Hit-testing found 0 misses over 30 points × 4 cell kinds. Swipe behaves on all four cases
    (fast-horizontal pages; vertical, 900 ms-slow, and inside-the-rail all correctly don't) — drive
    it with synthetic `TouchEvent`s built from `new Touch({identifier,target,clientX,clientY})`,
    which works fine in the pane.
    ⚠️ **UNVERIFIED, and not verifiable in the browser pane: does the height budget re-fit on a
    VIEWPORT RESIZE?** `boxH` comes from a `ResizeObserver`, and the pane never delivers one (see
    the tooling section). A real window drag, or a mobile URL bar hiding, is the untested case; if
    it does not re-fit, the symptom is cells keeping their old height inside a shrunken
    `overflow-hidden` box, i.e. **weeks clipped with no way to scroll to them**. Nils can settle it
    in two seconds in a real browser: open `/calendar`, drag the window shorter, count the week rows.
13jc. **Price the filter bar against the height budget (SM53, 2026-08-26).** The page is now a
    fixed budget, so the sticky bar is competing with the grid for it. At 375×812 measure
    `document.querySelector('main').getBoundingClientRect().top` — it was **175px, 22% of the
    viewport** (two wrapped rows of seven 40px icon-only chips + a 38px toggle row), leaving 486px
    of grid. Re-measure after any change to the chip set: one more chip wraps a row and costs
    another 60px of calendar. Targets themselves are fine and don't need re-measuring (`.tap-44`
    gives each chip a 44×44 `::after`; clearance 4px horizontal, 16px vertical, no overlap).

**C3. Episode tracking + Home's progress rail (added 2026-08-16, MB14)** — brand new surfaces; nothing before this date exercised them.
13k. **MB14 — per-episode tracking (2026-08-16), item page.** On a SHOW's item page, a
    "Your progress" section lists seasons collapsed with an `n/total` count. Expand one (the
    first expand is what lazily fetches that season's episodes from TMDB — expect a one-off
    delay, then instant forever), tick a single episode, tick a whole season from its header
    row, and reload: the counts must survive. **Exactly ONE `<EpisodeTracker>` in the DOM** —
    this page has a history of double-mounting islands. A movie/game item page must show no
    such section at all.
13l. **The "Up next" progress rail on Home (2026-08-16).** Signed-in only, sorted AFTER the
    highlight panels. Check three things the unit tests can't: (a) every tick box is **empty**
    at rest — a check on a resting card is the bug Nils caught, since every card here is
    unwatched by definition; (b) tapping one fills the check, holds, then the card fades and
    shrinks out and the list re-orders; (c) the show whose episode you just ticked jumps to the
    FRONT with its next episode, because the tick is a new event on the sort's timeline.
    Nothing to continue → the rail renders nothing at all (no empty-state panel).
13n. **Episode tracking: "LIVE BUT PULLS NOTHING" NO LONGER REPRODUCES LOCALLY (updated 2026-08-26).**
    The 2026-08-16 reading (`shows=280 withEpisodes=0 episodes=0`, measured on prod) is stale for
    `data/rr.db`, which now holds **12,343 `user_episode_state` rows across 280 shows** and 7,053
    `show_episodes` catalog rows. Verified end to end: Friends renders 10 seasons at 24/24 … 17/17
    summing to the DB's 228, one tracker mount, expanding a season lazily fetches real episode
    titles (~4 s once), and Home's "Up next" lists 10 real next-episodes with every tick box empty
    at rest. **So an empty rail is a finding again, not a known symptom** — but check the DB first
    (`SELECT COUNT(*) FROM user_episode_state`) and re-measure PROD separately before concluding
    anything about prod. If it IS empty, `/api/dev/trakt-shape` (GET, admin-gated, shape-only)
    still compares `?extended=full` against the plain call and says which half is empty.
    ⚠️ `catalogEps` far below `watchedEps` (One Piece: 26 vs 1,157) is the LAZY FILL working as
    designed — only expanded seasons are cached. Not a finding.
13n-i. **Audit for cross-type identity merges (SM50).** ✅ **Root cause fixed and the rows repaired
    2026-08-27**, so both probes below should now return ZERO. Keep running them: they are cheap,
    and they are the only check that would catch a new door onto the same bug. `media_links` is
    UNIQUE(source, source_id, **media_type**) since migration 23, and `scripts/repair-cross-type-
    links.mjs` is the one-off repair (report-only without `--apply`).
    ⚠️ **A fourth pair was found by the repair script that these two probes MISSED**: tmdb 1402
    (*The Walking Dead* the show) on the movie *The Pursuit of Happyness*. It had zero episode rows
    and one tmdb id, so probe 1 and probe 2 both passed it. Run the script's report as a third probe.
    Two cheap SQL probes, and run both; the first one is what makes the second legible:
    ```sql
    -- a SHOW's episodes filed against a non-show row
    SELECT m.type, m.slug, COUNT(*) FROM user_episode_state u
      JOIN media_items m ON m.id = u.media_item_id WHERE m.type != 'show' GROUP BY 1,2;
    -- one catalog row carrying two ids from the same provider
    SELECT media_item_id FROM media_external_ids WHERE source='tmdb'
      GROUP BY media_item_id HAVING COUNT(DISTINCT external_id) > 1;
    ```
    Both returned 3 rows: trakt show 386 *SpongeBob SquarePants* merged onto the MOVIE **Being John
    Malkovich**, 1416 *House of Cards* onto **Ratatouille**, 113656 *Legion* onto **The Raid 2**.
    ⚠️ **The user-visible half is the outbound links, not the episode counts** — `/movie/being-john-
    malkovich` served "Official site" → `spongebob.nick.com` and a Trakt link to the show, plus the
    show's genres, while correctly rendering NO "Your progress" section. So the type guard on the UI
    passing is not evidence the data is clean; check `media_links.title != media_items.title` too
    (most hits there are legitimate normalisation — *Atomic Heart 2* vs *II* — a cross-TYPE one is not).
13m. **⚠️ The Trakt round-trip is the one thing no Claude session has verified.** The push/pull
    paths were exercised only by unit tests and a keyless local session (marks land as
    `source: "local"`). On a run with a real Trakt identity connected: tick a season, confirm it
    appears on trakt.tv, then un-watch something ON TRAKT, sync, and confirm it disappears here.
    That last half is the prune path — the one whose failure mode is silent data loss.

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

**H. Anon linkability + score sanity (added 2026-08-12, 11th run — both produced findings)**

49. **Count clickable ITEMS on every public surface, anon.** Not "does it render" — does it
    *link*. On `/`, `/discover` and a facet page, run
    `document.querySelectorAll('a[href^="/movie/"],a[href^="/game/"],a[href^="/show/"]').length`
    **and** `document.querySelectorAll('[role="button"]').length`. The 11th run found **0 and 0
    on all three** (SM38) while the same components render 300 real links logged in — so a
    poster-count or "it looks fine" check passes straight through this. Also assert the reverse
    direction still works: an item page must still link OUT (`grep -o '/person/[a-z0-9-]*'` → ~9,
    `/tag/` → ~8). The failure mode is a **one-directional link graph**, which no single-page
    check can see.
50. **Fandex Score distribution, logged in** (plan item 34, made concrete). Two-call recipe from
    the Chrome gotcha above: fetch `/api/library`, then report
    `min / p10 / p50 / p90 / max`, `below0`, `above100` over `fandexScore`. 11th run: **−362.3 /
    −74 / 93.4 / 301.1 / 557.4, with 21% below 0 and 47% above 100** (SM39). A badge that reads
    `0–100` while two thirds of the library falls outside it is a finding even though every
    individual value is "correct" under the raw-sum formula.
51. **After ANY `NEXT_PUBLIC_*` env change, verify a CLIENT surface, not just a server one.**
    Next inlines these at build time and Railway only forwards a variable into a Dockerfile build
    if it is declared as `ARG`. The failure is asymmetric and reads as success: the server-rendered
    page shows the value while every client component shows nothing. Check a client surface
    (the sign-in dialog) *and* a server one (`/legal/en/support`), or grep the loaded chunks:
    `[...document.querySelectorAll('script[src]')].map(s=>s.src)` → fetch each → search for the value.

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

## Gotchas — grouped by when they bite you

_Consolidated 2026-08-02 from three dated lists (2026-07-18, 07-28, 08-02). Contradictions between them were resolved in favour of the current rule; duplicates merged._

### 🚨 Read these two before logging ANY finding

- **`/library` and `/wishlist` DO NOT HYDRATE on a hard load under `next dev` (Turbopack) — a DEV-SERVER bug, not a product bug (SM34).** Symptom: permanent "Loading…" spinner, 0 cards, **zero console errors**, and exactly ONE request in Resource Timing (`/api/auth/me`, which is AppNav's — not MyStuffView's). It looks exactly like a catastrophic product regression and it is not. **The 30-second test** — fibers attach to hydrated DOM only:
  ```js
  const fk = el => Object.keys(el).filter(k => k.startsWith('__react')).length;
  ({ main: fk(document.querySelector('main')), nav: fk(document.querySelector('nav')) })
  ```
  `nav: 2, main: 0` = never hydrated → dev artifact, **not a finding**. Client-side navigation to the same route works fine. **So verify those two routes on the PRODUCTION build before logging anything:** `preview_stop` → `npm run build` → `preview_start {name:"prod"}` (:3100, already in launch.json) → 300 cards, both fetches, `main` hydrated. **Cookies ignore port**, so the `rr2_session` minted on :3000 is sent to :3100 unchanged — which matters because `/api/dev/login` 404s under `NODE_ENV=production` and can't re-mint there. Already ruled out, don't re-investigate: stale `.next`, and the 2026-08-02 `http.ts`/`discoverFeed.ts` changes.
- **Before blaming the app for anything slow or empty, check whether a PROVIDER is down.** Read **`/api/health` → `openProviderCircuits`**, which names every host whose breaker is open (`{}` = all healthy). Or, no browser: `curl -s -o /dev/null -w "%{http_code} %{time_total}\n" --max-time 45 https://rawg.io/`. RAWG was fully down through the whole 10th run (Cloudflare 522 after ~19.8 s — theirs, not our key).

### Discriminators — things that look like bugs and aren't

- **A provider outage is the best free test of the degraded paths — use it rather than working around it.** It surfaced SM35 (games load-more is RAWG-only while the initial browse is dual-source) and SM36 (Home's Popular rail is RAWG-only for games). Whenever a provider IS down, deliberately re-check: **per media type, does every surface still have a second source?**
- **The Fandex Score breakdown does NOT sum to the headline if you scrape every `+N.N` off the page — and that's correct.** Capped reasons (`contribution: 0`) render their **`impact`** in the same ±N.N format, below a divider reading "NOT COUNTED FOR THIS TITLE…". Naive scraping gave 67 + 24.1 = 91.1 against a headline of 86; the real check is `center + Σ(reasons where !capped)` = 67 + 18.6 = 85.6 → 86 ✓. Take it from `/api/detail`'s `fandexReasons` + `fandexCenter`, not the DOM.
- **`/api/detail/similar` is a DIFFERENT endpoint from `/api/detail`** — a substring filter matches both and reads as the old double-mount bug. Filter exactly, or count `iframe`s instead. Relatedly, "More like this" correctly doesn't render when the catalog yields only ~2 similar items (sparse unreleased movies); it renders fine at 12.
- **Two `<nav aria-label="Primary">` in the DOM is CORRECT** — `AppNav` renders the desktop and mobile bars as a pair and hides one with `display:none`, removing it from the a11y tree. `find`/`read_page` still surface both. Investigated and dismissed 2026-07-27 — don't re-log.
- **Wait ~8s, not 5, before judging an authed hub empty.** `/profile` fires `/api/home` + `/api/calendar` in parallel, both cold-compiled; at 5s it shows only its identity + link grid, which reads convincingly as "the rails were never built". They pop in late with **no skeleton** (that missing skeleton is itself a minor finding, logged once).
- **Case-sensitivity + scroll position will fake a missing UI section.** A5's People/Titles group headers are `text-transform: uppercase` in CSS and sit above the post-search scroll position. A `/\bPeople\b/` probe on `innerText` plus an unscrolled screenshot made a working feature look broken. Scroll to top first, and prefer querying elements (`a[href^="/person/"]`) over matching rendered text.
- **The dim numeric font makes 6 and 8 indistinguishable in screenshots** — "Watchlist items 96" read convincingly as 98. Confirm any number that matters via `innerText`.
- **Q26 scroll-to-top is intentional** on Discover when switching to a non-date sort. Don't set a scroll position then change sort — the effect resets it and you measure nothing.
- **Facet "Highest rated" ranking obscure titles first is SM3** (no vote damping), not a provider bug.
- **Known 401 noise (SM6):** anon pages fire authed calls — `/api/detail`, `/api/facet/mine`, `POST /api/discover/find`. Don't re-log.
- `GET /api/watchlist` is 405 (POST/DELETE only) — use `/api/library` as the auth probe.
- Wishlist remove leaves the row until reload (SM1) — verify via network 200 + reload, not the UI.
- Legacy facet redirect param is **`kind`**, not `type`: `/insights/facet?kind=person&key=…` → 308; wrong params fall back to `/insights` (intended).
- View mode is **per-page** (`rr_view_discover` / `rr_view_library` / `rr_view_wishlist` via `useViewMode`). The *type* filter is still shared (`rr_type_filter` — SM2's real remaining half).

### Auth state

- **Check auth FIRST — the pane is often already logged in.** `fetch('/api/library').then(r=>r.status)` → 200 authed, 401 anon. Both the in-app pane and `claude-in-chrome` can arrive authenticated; a session cookie persists across conversations.
- **`/api/auth/me` wraps the user as `{user:{userId,…}}` — the field is `userId`, NOT `id`.** A probe reading `j.user.id` gets `undefined` and reads exactly like "anon". The 6th sweep spent its first probes believing it was logged out while looking at an obviously authenticated Home. Assert on `!!j.user`.
- **To go anon, use `127.0.0.1` (see the Auth section above) — NEVER log out.** Logging out bumps `session_epoch` and ends the real session everywhere at once, recoverable only by a real OAuth round-trip. _(The 2026-07-18 list used to recommend the Log out button; that guidance is withdrawn.)_
- **`curl.exe` from PowerShell sends no cookie**, so status codes, redirects (`-D -`), SSR HTML and API error shapes are reachable while staying logged in. It **cannot** cover anything client-side (the SM8 Back test, the sign-in dialog, the anon "You" slot) — say so explicitly rather than implying a full anon pass. Strip tags in PS 5.1 with `[regex]::Replace($h,'<script[\s\S]*?</script>',' ')` then `[regex]::Replace($t,'<[^>]+>',"`n")`.

### 🚨 A pane that isn't DISPLAYED starves the rendering loop — check this FIRST

Added 2026-08-26 (12th run), which produced **two confident false positives** before a control
caught them. The plan already said "a browser pane that isn't displayed stops compositing"; what
that costs is bigger than `getComputedStyle` returning start values. **Everything driven by the
rendering lifecycle silently never runs:**

- `computer{action:"screenshot"}` and every `computer` click → timeout, "the pane is not displayed"
- `requestAnimationFrame` → **never fires** (a 60-frame rAF loop times out at 30 s)
- **`ResizeObserver` → never fires**, so any layout that re-fits on resize looks permanently broken
- **`IntersectionObserver` → never fires**, so lazy-load / infinite-scroll sentinels look dead
- `tabs_select` does NOT reliably fix it; it can stay hidden for the whole session

**The 30-second control, and run it before logging any of the above.** Attach your OWN observer,
resize, and see whether *yours* fires either:
```js
window.__ro_log=[]; const el=document.querySelector('SELECTOR');
window.__ro=new ResizeObserver(()=>window.__ro_log.push(el.clientHeight)); window.__ro.observe(el);
// …resize_window… then read window.__ro_log
```
`__ro_log` empty while `el.clientHeight` demonstrably changed = **your tooling, not the app**. The
12th run nearly filed "the calendar never re-fits on viewport resize" (its cells stayed 95px while
its box went 613→333, clipping three weeks) and "the /library lazy-load sentinel is dead" — both
were this. `resize_window` still changes layout, so `clientHeight`/`getBoundingClientRect` DO
update; only the *notification* is lost, which is what makes it so convincing.

**What still works, and is what the rest of a sweep should lean on:** `javascript_tool` probes,
`.click()` on React handlers (state updates commit fine — they aren't frame-driven), `fetch`,
`elementFromPoint` hit-testing, synthetic `TouchEvent` swipes, `curl`, `preview_logs`,
`read_console_messages`. A whole calendar sweep ran on those alone.

### 🚨 A background tab has NO VIEWPORT — every geometric number from it is garbage

Same run. A tab opened by `preview_start` but never fronted reports **`innerWidth: 0,
innerHeight: 0`**. `100dvh` then resolves to 0, so the page-root height collapses and
`documentElement.scrollHeight - clientHeight` reads a plausible-looking **191** on a page whose
whole invariant is that it never scrolls. **Assert `innerWidth > 0` in the same probe as any
geometry** — the same measurement returned 0 the moment the tab got a real viewport. Cheap habit:
always return `iw`/`ih` alongside whatever you measured.

### Browser tooling quirks

- **`javascript_tool`: wrap every probe in an IIFE** — consecutive calls share a scope, so re-declaring `const inp` throws "Identifier already declared". Top-level `await` works in some calls and not others; `.then()`/`new Promise` always works.
- **In `claude-in-chrome` (NOT the in-app pane) `javascript_tool` returns `{}` for ANY async result** — an `async` IIFE and a bare `new Promise` both resolve to an empty object, so every `fetch` probe silently reads as "no data" rather than erroring. Cost several round trips on the 11th run. **Recipe: split it in two calls** — fire the async work and stash it, then read it synchronously:
  ```js
  // call 1
  window.__probe='pending'; fetch('/api/library').then(r=>r.json())
    .then(j=>{ window.__probe=JSON.stringify(/* summarise here */); }); 'started'
  // call 2
  window.__probe
  ```
  Summarise **inside** the page (percentiles, counts) — never return a 1,900-item payload.
- **`.click()` via `javascript_tool` on a React-controlled element reads STALE state in the same synchronous script** — the click dispatches but React's re-render hasn't committed. Add `await new Promise(r => setTimeout(r, 150))`, or use the `computer` tool's real click, which goes through the browser event loop and has no race.
- **`javascript_tool` blocks reads of anything it reads as a credential** — `getPropertyValue` on a CSS custom property returned `[BLOCKED: Sensitive key]` purely because the surrounding object key was named `accentToken`. Rename the variable and it works. Avoid `token`/`key`/`secret` in identifiers when probing styles.
- **Screenshot pixels ≠ viewport pixels at mobile.** After `resize_window {preset:"mobile"}` (375×812), screenshots come back 563×1218 — a 1.5× factor, and `computer` clicks take *screenshot* coordinates. Also: a coordinate `left_click` fails until a screenshot has been taken in that viewport, and `navigate` invalidates that cache.
- **`resize_window`'s `region` is ignored** by `computer{action:"screenshot"}` and `zoom` in the in-app pane (full viewport returned). Read geometry via `javascript_tool` instead of measuring on a crop.
- **`resize_window` on a REAL Chrome (`claude-in-chrome`) can't hit 375/500/1280** — a desktop window has an OS-imposed minimum (~606px narrowest, ~1034px widest on this machine); asking for 375 silently clamps. Always read `innerWidth` after resizing rather than trusting the success message. Arbitrary widths are only reliable in the sandboxed in-app pane.
- **`navigate`'s "navigated to <url>" line reports a stale URL** and the footer title can lag a redirect. Read `location.href` / `document.title` via `javascript_tool` — a made-up uuid looked like it landed on Home when it had correctly rendered the branded 404.
- **`navigate` is intermittently denied by the safety classifier** for reasons unrelated to the URL (the same URL succeeds on a bare retry). Retry once before investigating.
- **The dev server can die silently between phases of a long session** (twice in the 10th run — every `curl` returns `000`). `preview_list` returning `[]` is the tell; just `preview_start` again.
- **Tab titles: test by HARD LOAD, never by clicking through the nav** (SM10). Client-side nav is the one path where `usePageTitle` works, so a click-through check false-passes on all 7 pages.
- **Multiple connected Chrome browsers** — if `list_connected_browsers` shows more than one, a mid-session action can suddenly demand an `AskUserQuestion` to pick. Ask, then `select_browser`; nothing is lost.

### Environment + write safety

- **NEVER run `npx next build` while the dev server is running.** It overwrites `.next` with production output and corrupts the running dev server — routes start returning **404 HTML**, which surfaces as a plausible product bug (`/api/auth/me` 404 → `/calendar` shows "Couldn't load your calendar"). If a route 404s unexpectedly mid-sweep: confirm the file exists and `git status` is clean, then `preview_stop` → `rm -rf .next` → `preview_start`. Build only after stopping the preview.
- **Clearing persisted UI state between probes:** all keys are `rr_`-prefixed — `Object.keys(sessionStorage).filter(k=>k.startsWith('rr_')).forEach(k=>sessionStorage.removeItem(k))` (and the same for `localStorage`). Do this before any sort/filter/scroll test; a stale persisted query silently puts Discover in SEARCH mode.
- **Write tests:** Steam is read-only; a game wishlist add/remove goes to RAWG (net-zero verified safe 2026-07-18). **Skip RATING writes** — they create real reviews on the user's platform accounts and clearing isn't obviously exposed. Note as not-exercised.
- **After any change to `SubBar`, `PosterCard`, `ActionCells`, or the two score badges, re-check ALL of Discover/Library/Wishlist/Calendar + facet pages** — they share these components, and a fix verified on one can still be broken on another with slightly different props (Library's extra "Hide rated" chip broke the Filters-button layout — SM17 — while Discover was clean).
- Anon Discover/facet cards are **non-linkable by design** (PR14/PR15 — no `<a>`, no action bar), so "click then Back" flows can't be tested anon there. Home's rails DO have real links for catalog items — use those.
- `.env` is loaded by Next dev automatically; `JWT_SECRET` is set there (don't print it).
- Dev server compiles routes lazily — distinguish "slow first hit" from a real hang.
- CSP is prod-only (dev keeps only `frame-ancestors`) — don't chase CSP issues locally.
- **Known config gaps, not bugs:** OMDB key invalid (missing RT/IMDb scores on detail pages), Letterboxd hidden, Steam CDN images 404 for delisted games.
