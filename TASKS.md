# Fandex — Task Tracker

> **This file holds only what is still open.** Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it for the "why" behind a past decision; never read it end to end). One-page state → [STATUS.md](STATUS.md).

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2–4 sentences + a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session** — this file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ⚠️ Needs Nils — nothing else is blocked on anything but these

0. **Prod sweeps.** ✅ **The Wikidata franchise sweep RAN on prod 2026-08-14** — 1,803 checked, **407 found**, `remaining` 0, 13 batches, no failures. Prod now has 503 franchises across 416 movie / 385 game / **84 show** memberships and **34 cross-media franchises** (was 14, none with shows). Star Wars spans 24 items incl. Andor and Obi-Wan Kenobi; Andor's breakdown reads *Star Wars +5.8, you rate 7.45 over 19*. ⬜ **Still un-run: `POST /api/dev/crosslink`** `{"source":"steam","maxItems":25}` — games cross-linking (SM48). Skip RAWG while it's down.
   - **Both routes are session-gated** (`withScoringAdmin` reads the login cookie), so a bare terminal `curl` 404s no matter the syntax. Run them from the browser console on fandex.org while logged in. Also: in PowerShell `curl` is an alias for `Invoke-WebRequest` and does not accept `-H`/`-d` — use `curl.exe` or `Invoke-RestMethod`.

1. ✅ **Donations are LIVE (2026-08-12).** **Any future client-read `NEXT_PUBLIC_*` needs an `ARG` line in the Dockerfile** or Railway never forwards it into the build — and the failure looks like success, since server components still render it fine. → [[next-public-env-needs-dockerfile-arg]]
2. **`PRUNE_ON_BOOT=0` on Railway — optional now, your call.** The boot prune has now fired against prod **twice**, both times cleanly. On the 2026-08-12 redeploy it deleted 255 browsed-only rows (`media_items` 2267 → **2012**, exactly PR17's original expected figure; `media_links` 4225 → 3969, `media_external_ids` 4237 → 3970) and touched **zero** user rows — `user_library` 1912, `user_watchlist` 96, `user_item_state` 2337 all unchanged, `libRowsWithoutState`/`wishRowsWithoutState` still 0/0. The safety guard demonstrably holds in production. Set it to `0` only if you want no unattended deletes at all until (1a) confirms Litestream.
3. ~~Reclaim the WAL high-water~~ — **attempted twice 2026-08-12, cannot be done while Litestream runs** (`busy: 1`, no reclaim, both times). Not a fault and not worth chasing: the volume is 12% used with 4 GB free. Details in the PR17 section below.
4. **Watch whether prod STAYS up.** It served ~32 min on 2026-08-07 then was un-routed at the edge; this session it has been stable ~7 h. The app never crashed either time (`uptime` climbed monotonically), so both events read as a billing/pause action, not a technical one. If usage is still near the cap, resumed traffic re-accrues. **Affiliate signups stay parked until this is stably up for days, not hours** — every program reviews the applicant URL and a 404 buys a rejection.
5. **Review the Impressum** — content complete 2026-08-03, no placeholders left (H4.0's advice was "a standard imprint, nothing special"). Read `/legal/de/imprint`; the German version is the operative one. Once you're happy, H4.2 closes and **all of H3 unblocks**.
6. **On Ko-fi itself: no tiers, no perks, no memberships.** A donation with consideration is a taxable supply *and* a much stronger "commercial use" reading against TMDB's non-commercial-only free tier. Also still open: the monthly-running-cost placeholder on the support page — that's H3.0's number (#8).
7. **Build + sign the Android TWA** (P15) — Bubblewrap/PWABuilder → package name + signing-cert SHA-256 → set `TWA_PACKAGE_NAME`/`TWA_CERT_FINGERPRINT` on Railway.
8. **H3.0 — confirm the upkeep baseline**: the actual Railway monthly bill + domain + any other recurring cost. One number; it goes in the H3 section below.
9. **H3.8's thresholds are defined but NOT approved** (your call, 2026-08-02: "leave it defined but unapproved"). A future session must not read them as settled.
10. **Sign up for the affiliate programs** — **still PARKED** (your call, 2026-08-03), now on prod being **stably** up rather than up at all — see #4. Every program reviews the site URL on the application, so applying during an un-routed window buys a rejection, and reapplying is worse than a first application. Sequence once that holds: **GOG first** (the only merchant the catalog already product-links), then Humble → Fanatical → GMG, **Amazon LAST** — applying starts a 180-day/3-qualifying-sale clock that closes the account if missed, and Amazon is the only movie/show coverage. Full walkthrough → [docs/monetization-go-live.md](docs/monetization-go-live.md).

---

## Open — carried forward from Phase 6

- **P15** 🔵 · Med · ~25k — **Digital Asset Links** (`/.well-known/assetlinks.json`) + stable HTTPS origin for the Play Store TWA. Serving infra done (`src/app/.well-known/assetlinks.json/route.ts`, env-driven). Blocked on you (see above).
- **P16** ⬜ · Low · ~60k — Verify **OAuth + cookie flow inside the TWA**: re-register prod redirect URIs per provider; test webview behaviour + deep-link return / `sameSite`. Needs P15 first.
- **P18** ✅ 2026-08-03 — **JustWatch clickable streaming links.** Its original blocker (a JustWatch Content Partner API + a full-catalog re-projection) turned out to be wrong on both counts: TMDB already returns a per-region `link` in the payload already fetched, and the existing lazy self-heal path (`ensureTmdbDetail`) delivers it one detail view at a time — no mass op needed. → [archive](docs/archive/history.md), grep `P18 streaming links`.

---

## Closed epics — pointers only (full write-ups in the archive)

- **PR17 — post-outage verification** ✅ 2026-08-12. All five steps; the leak and the memory ramp are confirmed dead in prod and backups proven by a real restore drill. Two corrected beliefs before touching backups: an **unchanged** Litestream generation is the HEALTHY signal, and `wal-truncate` reclaims nothing while Litestream runs. → grep `PR17`.
- **H4 — legal & compliance** ✅ 2026-08-03. Three standing guards survive it, reproduced verbatim in `AGENTS.md`: a cookie banner isn't needed today but **any analytics/affiliate-tracking/ad script triggers it**; **"the nav reaches it" is a different claim per auth state** ([[anon-legal-reachability]]); the Impressum stays `noindex, nofollow, noarchive, nosnippet` and out of `sitemap.ts`. Live refs: [compliance-review](docs/compliance-review.md) · [cookie-assessment](docs/cookie-assessment.md) · [monetization-legal](docs/monetization-legal.md).
- **Smoke test 2026-08-12 (11th run)** ✅ All five findings fixed (SM38–SM42). The valuable half was the RAWG outage it ran during, which re-verified the three 2026-08-02 single-source games bugs as fixed under the exact condition that exposed them. → grep `Smoke test 2026-08-12 11th run`.
- **Facet-page compute + provider quota** ✅ 2026-08-13. Closed by a persisted SQLite L2 (`facet_page_cache`, `src/lib/facetCacheStore.ts`); `/tag/western` 63.17 s → 0.092 s across a full restart, zero provider calls warm. **⚠️ The "59.8 s render" that motivated it was 93% a dead RAWG, not inherent cost** — don't re-justify cache work with that figure. → grep `Facet-page compute`.

---

## MB — mobile testing batch, 2026-08-14 (Nils, 15 notes) 🔵 8 of 15 open

Nils's notes from using the app on his phone. Structural ones apply to web too. **No device access from a Claude session** — verification is the browser pane at 375×812 (touch emulation), so anything genuinely touch-only (long-press, swipe inertia) still needs an eyeball on the real device.

**✅ Shipped + verified this session:**
- **MB1** ✅ Nav slot "Library" → **"Wishlist"** + Bookmark glyph. It already hrefed `/wishlist`; only the label and icon lied. `match()` still covers `/library`.
- **MB2** ✅ **Auto-hiding list header.** `SubBar` retracts on scroll-down past 64px and returns on *any* upward flick (asymmetric thresholds — `lib/useHideOnScroll.ts`). Verified: `top: 0 → -159` down, back to `0` on a 50px scroll up.
- **MB3** ✅ **Settings connected-accounts overflow.** The row stacks below `sm` and the action group wraps. Verified at 375px: Disconnect's right edge 282 vs card 351, no document x-overflow.
- **MB4** ✅ **Rate popover no longer clipped by the carousel.** `<Rail>`'s `overflow-x-auto` clips on BOTH axes, so no z-index could save an `absolute` popover. `StarPicker` now portals to `document.body` and positions off the trigger's viewport rect (flips above near the bottom edge). Verified: parent is `<body>`, 10 stars, fully on-screen. **The outside-click test had to learn about the portal** — the picker is no longer a descendant of `rootRef`, so the old `contains()` check would have closed it on every star tap.
- **MB6** ✅ **Insights facet tap feedback.** Two distinct misses: no *press* state (everything was `hover:`, which a phone doesn't have) and no *pending* state (facet pages are `force-dynamic`). Fixed with `active:` + `touch-manipulation` + `<NavPendingBar>` (Next 16 `useLinkStatus`). Verified on all 86 facet links; the bar lights within ~120 ms of the tap and stays lit for the whole navigation.
- **MB9** ✅ **Recommended rail rotates properly.** Three compounding causes, none a bug alone: `keepTop = 3` pinned most of a phone-visible rail, `pickWeighted` bias 4 was steeply front-loaded, and the seed only moved once per UTC day. **The lesson: re-seeding does not produce turnover** — independent draws from a front-loaded ranking overlap heavily. Turnover is now *structural* (`rotateRailFresh`): one weighted hand per 6-hour epoch, dealt round-robin into disjoint shares. Measured on the real feed: **47 distinct titles over 5 periods (was ~15)**, overlap 1 within a cycle, ≤5 at the epoch boundary. **A rejected design is recorded in the code** — "exclude what the previous slot drew" needs unbounded recursion and its own test caught it still repeating 3 of 15.
- **MB12** ✅ **"Where to watch" always renders for movies/shows**, with an explicit "not streaming anywhere yet" (unreleased) or "not available in your region" line instead of the section vanishing. Games keep the gate — the Links section is their equivalent. Verified on *The Odyssey*.

**⬜ Still open:**
- **MB5** ⬜ Med — **card tooltip on touch.** Tapping Rate/Wishlist fires an emulated `mouseenter`, which trips `PosterCard`'s 350 ms hover timer and pops the tooltip. Wanted: suppress hover-open on touch, open on **long-press**, and render it in `<Sheet>` (the advanced-filter bottom sheet) rather than the fixed tooltip.
- **MB7** ⏸️ **NOT REPRODUCIBLE — needs Nils.** "The bottom nav scrolls away on Insights." Checked at 375×812 with a session: `position: fixed`, `top` unchanged at 965 across a 1500px scroll, stuck to the bottom, and **no ancestor with a `transform`/`filter`/`contain`/`backdrop-filter`** (the usual things that turn `fixed` into containing-block-relative). Most likely a real-device behaviour — Chrome Android's dynamic URL bar, or standalone PWA/TWA chrome. **Need: which surface is this — a Chrome tab, the installed PWA, or the TWA?**
- **MB8** ⬜ Med — **Calendar day → carousel below the month grid.** Today a day's items open in a desktop popover / mobile sheet (`CalendarView.tsx`).
- **MB10** ⬜ Med — **store links as brand logos, not `name →` chips** (`LowerSections.tsx` "Links"). Needs a bundled inline-SVG mark set (Steam/GOG/Epic/PSN/Xbox/Nintendo/itch.io/…) — **CSP blocks external assets**, so no remote favicons — with a text fallback for unknown sources.
- **MB11** ⬜ Med — **"More like this" on every item.** *Not* the diagnosis it looked like: `/api/detail/similar` returns real results for The Odyssey (**Troy, Ulysses**) and `SimilarRail` hides the rail below 3. So the fix is a provider fallback (TMDB `/recommendations`) when the local catalog is too thin — **which puts a provider call on a public route, so it needs a cache and a budget** (see the facet-page quota lesson above). **Decision needed** before building.
- **MB13** ⬜ Med — **detail hero should BE the gallery.** Merge `DetailHero` + `MediaGallery` on mobile: swipe through poster + images with dots, keeping the scrim, back/share and title overlay.
- **MB14** ⬜ **LARGE, own session, needs a decision** — **per-episode watched tracking for shows**, collapsed by season, mark-season-as-seen, Showly as the UX reference. **No episode data model exists** (only episode *counts* in `merge.ts`/`normalize.ts`). Needs: a seasons/episodes schema + a `user_episode_state` table (**the owning column must literally be named `user_id`** or GDPR erasure silently skips it), TMDB season/episode fetch + storage, and a Trakt watched-episode pull. **Open question: should marking an episode seen PUSH BACK to Trakt, or stay local?**
- **MB15** ⬜ **Partly diagnosed** — "Fandex says I own Gothic 1 Remake on Steam." The local DB says the ownership came from **RAWG**, not Steam: `user_item_state.source = 'rawg'`, `user_library.platform_sources = ["rawg"]`, `status = 'owned'`, written by `rawg.ts:62` mapping RAWG's own `user_game.status === "owned"`. The item *also* carries a Steam `media_link` (appid 1297900), which is the likely source of the wrong attribution. **Need: where does the UI say "Steam"?** — a screenshot would settle it in one step.

---

## H3 — Monetization 🔵 v1 built 2026-08-03; donations live, affiliate dark

**Goal:** revenue covers upkeep (Railway, domain, third-party APIs).

**The economics pivot on TMDB, not on hosting.** Upkeep is small (Railway Hobby $5/mo + usage, domain ~€10/yr, all APIs currently €0) — but TMDB's free API is **non-commercial only** and commercial use is **$149/mo**. So "commercial" multiplies upkeep ~10× overnight; any paid model must clear ~$155/mo before netting a cent. Trakt requires case-by-case approval for monetizing apps. RAWG is safe (free commercially to 20k req/mo + 100k MAU, no redistribution). **Donations are the gray zone** — TMDB doesn't say whether donation-funded counts as commercial.

**MODEL DECISION (locked 2026-07-18): v1 = donations + affiliate links (incl. gray-market key shops) only.** Ads and the one-time ad-free unlock are **deferred, not cancelled** — parked as Path B alongside freemium, all triggered by H3.8. **Consciously accepted risk:** Fandex monetizes on the free TMDB/Trakt tiers ("under the radar"). Failure mode is **API-key revocation without notice**, not a fine. **Do NOT contact TMDB/Trakt about commercial terms while under the radar.**

**Built 2026-08-03 — H3.3 ✅ (donations, live) · H3.4 ✅ (affiliate, DARK behind `MONETIZATION_ENABLED`) · H3.9 ✅ (go-live checklist).** Full write-ups → [archive](docs/archive/history.md), grep `H3 monetization v1`. Operating instructions → [docs/monetization-go-live.md](docs/monetization-go-live.md). **The one thing to know before touching any of it:** the catalog's store rows are Steam/PSN/GOG/Xbox/Nintendo/Epic/itch.io and only **GOG** is affiliate-capable, so `affiliate.ts` has *two* mechanisms — a rewriter for GOG-shaped links and `buildBuyLinks()` synthesizing per-title search links for the merchants we have programs with. → [[monetization-h3]]

**Still open:**
- **H3.0** ⬜ · High · **you** · ~0k — confirm the upkeep baseline (see "Needs Nils" above). Feeds the support page, which deliberately carries no cost figure.
- **Affiliate program signups** ⏸️ — parked on Railway (see "Needs Nils" #7); every program reviews the applicant site.
- **H3.8** 🔵 **defined 2026-08-02, explicitly NOT approved** — **Path B trigger**, two arms with different metrics:
  - **Ads → 10,000 pageviews/mo** (Monumetric's stated minimum). A better-RPM tier exists at 50k+ pv (Freestar/Mediavine, $15–40+ vs Monumetric's $10–20) — not a second gate, just worth re-checking which network fits.
  - **Freemium → 3,500 sustained weekly-active users.** The old "roughly 1k+ actives" napkin figure never netted out TMDB's $149/mo license. Actives needed to clear **just** the license (≈€137, no margin): 2%/1€ → 6,850 · 2%/2€ → 3,425 · 5%/1€ → 2,740 · 5%/2€ → 1,370. Even the best-case corner is above 1k. 3,500 clears it with real margin at a *conservative* 3%/1.50€, leaving room for Trakt's separate approval and normal churn.
  - **The metric, checked against the live schema:** no pageview/session log exists, and **`users.last_seen_at` is a false friend** — it's written only on a RAWG login or Steam OAuth callback (`src/app/api/auth/rawg/route.ts:72`, `.../steam/callback/route.ts:65`), never on an ordinary revisit via an existing 30-day cookie, and never at all for TMDB/Trakt. It undercounts badly. The best signal computable today (verified against the real DB) is "touched library/wishlist/rating in the last 7 days":
    ```sql
    SELECT COUNT(DISTINCT user_id) wau FROM (
      SELECT user_id, added_at ts FROM user_library WHERE added_at >= :weekAgo
      UNION ALL SELECT user_id, reviewed_at FROM user_library WHERE reviewed_at >= :weekAgo
      UNION ALL SELECT user_id, added_at FROM user_watchlist WHERE added_at >= :weekAgo
      UNION ALL SELECT user_id, added_at FROM user_item_state WHERE added_at >= :weekAgo
      UNION ALL SELECT user_id, reviewed_at FROM user_item_state WHERE reviewed_at >= :weekAgo
    )
    ```
    It counts only users who took a write action — a pure browser isn't captured by anything in the schema.
  - **✅ `last_seen_at` is now real (2026-08-03).** Stamped in `getSession()` (`src/lib/session.ts`), the one funnel every authenticated request passes through, rate-limited to **one write per user per UTC day** — `getSession()` runs several times per render, so an unconditional write would turn every authed read into a write. The freshness check is free: it rides along on the SELECT the epoch check already does. Best-effort (a write error is swallowed — a metric must never fail a login) and stamped only **after** epoch validation, so a revoked token can't report its owner active. Verified against the real `data/rr.db`: all three users were 7–11 days stale, a dev-login stamped only that user, and two further authed page loads wrote nothing. **This does not approve H3.8's thresholds** — it's the meter, not the trigger. Activity data is uncollectable retroactively, which is why it went in first.

**What's left before affiliate revenue exists:** Railway back → sign up (GOG first, **Amazon last** — its 180-day/3-sale clock closes the account if missed) → set the env vars → flip `MONETIZATION_ENABLED` → run the post-go-live cookie check. All of it is in the go-live doc.

---

## SM39 — the Fandex Score range ✅ root cause fixed 2026-08-14; one design call left

**Finding 1 — ✅ FIXED 2026-08-14. Prod's two gain constants were the whole of SM39.** `GET /api/dev/scoring` showed a **hand-tuned** config (`K_up 30 · K_down 20 · C 2 · director 4`), not a stale default. Feeding it back through the real library (`node scripts/probe-score-range.mjs data/rr.db --config <the GET response>`) reproduced SM39 almost exactly: **min −359 · p10 −71 · median 133 · p90 305 · max 556, 77.1% outside** vs SM39's −362.3 / −74 / 93.4 / 301.1 / 557.4. Fixed by fitting **only the gains** — 30/20 → **2.5/4**, every taste decision untouched → 0.9% outside. Note the fitted pair is `K_down > K_up`: the center sits at 66.8, so there are 33 points of room above against 66.8 below, and a symmetric pair cannot fit that. The save also stripped the vestigial `perCategoryCap` (zod `z.object` drops unknown keys).

**The trap that made local and prod diverge silently, worth knowing before touching any scoring default:** migration 9 seeds `scoring_config` with `INSERT OR IGNORE` (`migrations.ts:298`) and `getScoringConfig()` merges `{...DEFAULT, ...stored}` — **the stored blob wins**. A recalibrated default never reaches a database that already has a row. `tag_category` is seeded the same way. (The same merge is what lets a NEW knob ship with no migration — see the franchise section below.)

**Finding 2 — ⬜ a residual ~1% still prints outside 0–100, and that last bit is a design call.** With the gains fitted the tails are tiny but nonzero. Two measured ways to close them: top-N **3/2/2/1** → 0.1% outside (min 40, max 100) at the cost of a thinner breakdown and a narrower spread; or accept it. Worth knowing before spending effort: **`FandexScoreBadge` makes no 0–100 claim itself** — it prints a bare integer coloured against `center ± 10`, which reads correctly at any scale, and the 0–100 target lives only in `docs/fandex-score.md` §1. So "relabel rather than re-tune" is a live third option.

---

## Franchise / IP as a scoring factor ✅ BUILT 2026-08-14 · needs a deploy + your weight call

A fourth facet kind (`ip`) fed by TMDB `belongs_to_collection` + IGDB `franchises`, both already in stored `raw_data`. Full design → [docs/fandex-score.md](docs/fandex-score.md) §3.6. Measured on the real library: **516 of 1,903 scored items move** (Metal Gear Solid +5.2, LOTR +5.0, The Last of Us +4.7, Transformers −8.0).

**No migration and no prod config edit needed** — `getScoringConfig()` merges `{...DEFAULT, ...stored}`, so prod's existing row picks up `roleWeights.ip: 1.3` and `topIps: 1` from the defaults the moment the code deploys. Verified against the real local row, which predates both.

**The editor shipped 2026-08-14** (`0a1ee54`) — `/dev/scoring` → Taxonomy → **Franchises**. Migration 13 adds `ip_alias` (bundling, mirrors `tag_alias`) and `item_ip_override` (attach/detach one item). Verified on both apply paths against a copy of the real DB. Design + the resolution-point reasoning → [docs/fandex-score.md](docs/fandex-score.md) §3.6.

**Open — yours:**
1. ⬜ **Bundle `metal gear solid` into `metal gear`** (6 items each). One click in the panel; which name is canonical is your call, which is why it's not pre-applied.
2. ⬜ **Review the 31 title-match suggestions** — "Find suggestions" in the panel. 4 Star Wars shows, Fallout, The Witcher, Castlevania, Game of Thrones, Ghost in the Shell. Nothing applies until you accept it. **The Mandalorian is deliberately NOT among them** (no title signal at all) — attach it by hand, which is the mechanism's whole point.
3. ⬜ **Tune `ip`** once you've seen it live. Default 1.3 (peer with `director`, which you have at 4). `node scripts/probe-ip-impact.mjs data/rr.db --config <a GET /api/dev/scoring response>` shows what any value does to real titles first.
4. ⬜ **Optionally re-fit the gains.** Franchises widened the tails slightly (0.9% → 1.7% outside 0–100); the fitting pair moves 2.5/4 → **2.4/3.8**. Marginal.

**✅ Wikidata shipped 2026-08-14** (`313a830`) — **the shows gap is closed.** `POST /api/dev/scoring/wikidata` (admin, bounded + resumable, repeat until `remaining` is 0). On the local catalog: 2,295 items asked, **584 found, 605 attachments — 321 games, 165 movies, 98 shows.** Star Wars now spans 11 movies + 6 shows (The Mandalorian, Andor, Obi-Wan Kenobi…), plus links no TMDB collection has: Better Call Saul → Breaking Bad, Puss in Boots → Shrek.

- ⬜ **Run it against prod** — same shape as `/api/dev/crosslink`; prod's catalog is untouched. Repeat `POST {"maxItems":150}` until `remaining` is 0 (~15 calls).
- **Property per medium, both measured — don't "simplify" to one.** Films/shows: IMDb `P345` → **`P8345`** (P179 there also returns sub-series like "Star Wars original trilogy"). Games: Steam `P1733` → **`P179`** (P8345 is absent on games entirely).
- **Labels need `en,mul,en-gb`.** Plain `"en"` returns bare QIDs for the Half-Life/Portal/Fallout/Last of Us series — they carry `mul` labels. Anything still QID-shaped is dropped.
- **A wikidata write never overwrites a `manual` one** (`item_ip_override.source`, enforced in the upsert's WHERE) — otherwise a re-sweep would undo your corrections.
- **Measured dead ends, don't re-check:** TMDB keywords carry franchise names on 2 of 387 show payloads; TMDB has no collection concept for series.

---

## Drop the `user_library` / `user_watchlist` cache tables ⬜ NOT STARTED · **not delegable**

**The precondition is MET.** Migration 3's "expand-then-contract" never contracted: both tables are caches rebuilt from `user_item_state` by `matcher.ts`'s `rebuildCaches`. Dropping them was gated on `libRowsWithoutState` / `wishRowsWithoutState` reading **0/0 on prod**, and they do (confirmed 2026-08-12, and again post-redeploy).

**⚠️ Do NOT delegate this to a background or low-effort session, and do not let a plan hand it to Sonnet.** It touches `migrations.ts` *and* `matcher.ts`'s write paths — AGENTS.md's two named "main loop at full effort" areas. The failure mode is silent user-data loss, and **every DB test starts from a fresh database, so none of them exercise the upgrade path production actually takes**. Green tests would prove nothing here. Written up 2026-08-13 during a session that deliberately declined to execute it.

What it involves, so the next Opus session doesn't re-derive it:
- A real migration in `migrations.ts` dropping both tables, plus removing `rebuildCaches`'s writes and every read path that still selects from them (`/api/library`, `/api/calendar`, `libraryAnalysis`, `loadMembershipGroups` are the known consumers — grep before trusting that list).
- **Verification that actually counts:** run `node scripts/migrate.mjs` against a **copy of the real prod-shaped `data/rr.db`**, not a fresh one, and compare `user_library` / `user_watchlist` / `user_item_state` counts and a sample of rows before and after. The standalone path resolves neither the `@/*` alias nor extensionless specifiers, so an import mistake surfaces only there.
- Take a Litestream snapshot reading first. Backups are now proven restorable (PR17 step 4), which is exactly the safety net this op needs.

---

## 2026-08-13 — advanced search's Fandex Score (SM43–SM48) ✅ CLOSED

Six fixes, all shipped and verified on prod: the heal loop's latency budget (SM44, 66.3 s → 4.1 s),
the database half of search having no score fields (SM45 — the actual cause of the report), that half
rebuilt to Nils's spec with provider-side AND (SM46), Steam added as the games tag source (SM47), and
games cross-linked to every catalog on ingest plus a backfill (SM48). Full write-ups + the five traps
they turned up → [archive](docs/archive/history.md), grep `SM44 heal budget`.

**Still open here — your call:**

0. **PROD IS NOT BACKFILLED.** The script drains a local DB; prod's catalog is on the Railway volume. `POST /api/dev/crosslink` (admin-gated, 25 items / 20 s per request, returns a cursor) is the way in — **not yet run**. Until it is, prod fills organically at 30 cross-links per sync pass (~16 syncs). RAWG's pass should wait for RAWG to come back.

1. **`deckbuilding` + `tower defense` returns 0 from TMDB/RAWG/IGDB** — genuinely, not as a bug: IGDB has no game carrying both terms and RAWG is down. **Steam now covers it (277 games), so the query works.** Still worth re-running once RAWG is back; if RAWG stays empty, suspect a slug mismatch (`rawgTagSlug("deckbuilding")` → `deckbuilding`, while RAWG's tag may be `deck-building`) — there is no alias layer between our tag keys and a provider's vocabulary.
2. **Games' thin rows are mostly RAWG-only** — 20 of 24 sampled thin game rows have no IGDB link at all, so while RAWG is down nothing can heal them and they show no Fandex Score. **Your call was to fix the root cause: cross-link IGDB** (a backfill giving games their real second source), rather than fall back to a depressed number. Not started. `scripts/backfill-game-detail.ts` is the starting point.
3. **Progressive reveal is built but only half-observed.** `DiscoverPageClient.runSearch` paints local `find()` results first and folds `webItems` in when they land ("Show local results immediately" is the existing comment), the empty state is gated on `!webLoading` so an intermediate never reads as "No results", and there's a "Pulling more from the databases…" affordance. The database half still arrives as ONE batch, not a trickle — with AND that is unavoidable for tags (the conjunction is one query), so "slowly fills" is now local-then-external, at 6–9 s rather than 66 s.
4. **The shimmer and blank states were verified by code + unit tests, NOT visually** — driving the filter panel through the browser pane didn't land in the time available, and a shimmer is inherently racy to catch in a DOM snapshot. Worth an eyeball on a tag search with a mix of scored and unscored results.

**Also found:** standalone `node` can't import `src/lib/http.ts` — `ProviderUnavailableError`'s constructor uses TypeScript **parameter properties**, which Node's strip-only type removal rejects (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). Same class as the `import type` rule in AGENTS.md: any `scripts/*.mjs` that reaches a provider path dies on it. Not fixed (a one-line constructor rewrite; nobody needs it yet).

---

## Still open elsewhere

- **Fandex Score `priorStrength` (C=5) + per-role class weights may want re-tuning** now that the aggregate is a raw sum rather than a damped mean. **Time-gated:** revisit after a few weeks of real scores under the new formula (4 days as of 2026-08-02 — too soon; a re-tune now would fit noise).
- **Platform integrations** — **AniList is now the lead candidate.** Books (Hardcover + Open Library) are ⏸️ **postponed as a media type, 2026-08-03.** See [PLATFORMS.md](PLATFORMS.md).
  - **Hardcover ⏸️ PARKED — same call as Backloggd (yours, 2026-08-03).** PLATFORMS.md said "verify the auth first"; it was verified and failed, but the deciding fact turned out to be the usage terms, not OAuth: the docs call the API *"only for offline use at this time"*, reachable *"from localhost or APIs"*, with site allowlisting *"a way down the line"*. A hosted multi-user site is the case they haven't provided for. Secondary findings: no third-party OAuth (promised, not shipped), tokens expire on a **shared Jan 1 reset** so every user breaks the same day, no app-level credential (which gates the *metadata* role too), and the write mutations are entirely undocumented. Full write-up + the API constraints worth keeping (60 req/min, `_ilike` disabled, Typesense search) → PLATFORMS.md deep dive.
  - **The media-type cost is now measured** and lives in PLATFORMS.md ("What adding a media type actually costs") so it isn't re-derived. Two things worth knowing before any future type proposal: **no migration is needed** (`media_items.type` is plain TEXT, no CHECK constraint), and **`tsc` won't help you** — only one `Record<MediaType, …>` exists, so adding a union member compiles clean while silently doing nothing at the other ~9 app-level enumeration points.

---

## Recently closed — pointers only

Everything below is fully written up in [docs/archive/history.md](docs/archive/history.md). Earlier sessions (G#/SM34–37, the eight closed questions) are archived too.

**2026-08-12** — grep `PR17 post-outage verification`:

- **PR17 steps 1–3 closed against live prod** — the 2026-07-22 leak is confirmed fixed (byte-identical crawl replay), the memory ramp is dead (`fileMb` flat 74–76 MB over ~7 h), `rr.db` is 37.7 MB. Steps 4–5 still need the Railway shell. → [[prod-incidents]]
- **⚠️ Non-ASCII person slugs hard-404'd** — `personKey`/`slugify` used NFD/NFKD + combining-mark stripping, which does **nothing** for `ø å æ ł ß đ ð þ` (no canonical decomposition), so the next `[^a-z0-9]` strip deleted them: `"Lisa Tønne"` → `/person/lisa-t-nne`, 0 TMDB results. Fixed via a transliteration map in the new `src/lib/translit.ts`. **`tagKey` deliberately excluded — its keys are persisted.** → [[unicode-normalization-lossy-slugs]]
- **Facet payload cache enlarged** — TTL 1 h → 24 h, `max` 500 → 3,000, sized against 17 measured prod payloads rather than a blind multiple. See the open item above.

**2026-08-03** — grep `H3 monetization v1`:

- **P18 closed** — clickable streaming rows + offer-type line, via the existing lazy self-heal path, not a re-projection. Plus a default-ON boot-time prune of the browsed tail, `omdbConfigured()`, and cache-contraction drift counts in `/api/dev/dbsize` (tables still untouched, gated on PR17). → [archive](docs/archive/history.md), grep `P18 streaming links`.
- **H3 v1 built** — donations live, affiliate layer dark behind `MONETIZATION_ENABLED`, go-live checklist written. → [[monetization-h3]]
- **H4 epic closed** — H4.0's advice in, Impressum written + filled in both locales.
- **⚠️ A `//` comment rendered as visible page text** after a `return` was wrapped in a fragment. tsc, 540 tests, lint and build all passed; a human spotted it. `react/jsx-no-comment-textnodes` is now an eslint ERROR. → [[jsx-comment-in-children-renders]]
- **✅ Fixed 2026-08-03:** `--color-accent` in light theme measured **4.48:1** on `--color-surface` (under AA for body text, while its own comment claimed 4.5:1+). Now `#856619` → **4.76:1**; `--color-accent-subtle` was rebased onto the same hue. Verified via `getComputedStyle` in both themes (dark untouched). **Two adjacent gaps left deliberately unfixed — they change the design, not just a value, so they're your call:** `--color-accent-hover` sits at **3.47:1** (it's a *lightening* hover, so clearing AA means inverting it to darken-on-hover), and accent text on `--color-surface-inset` (#ECE6DA) is **4.32:1**. Note the light theme still has no toggle wired, so none of this is user-visible yet.
