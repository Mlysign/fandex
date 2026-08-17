# Fandex — Task Tracker

> **This file holds only what is still open.** Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it for the "why" behind a past decision; never read it end to end). One-page state → [STATUS.md](STATUS.md).

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2–4 sentences + a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session** — this file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ⚠️ Needs Nils — nothing else is blocked on anything but these

1. ✅ **Episode tracking is DONE and populated on prod (2026-08-16)** — nothing left for you here. The sync pulled **12,318 episodes across 280 shows** and bulk-filled the episode catalog in the same pass. Root cause of the dead first release, worth carrying: `/sync/watched/shows` returns **no** episode data in any variant. → [[trakt-episode-endpoints]]

2. ✅ **Prod sweeps — BOTH DONE.** The Wikidata franchise sweep ran 2026-08-14 (1,803 checked, **407 found**, `remaining` 0). **The Steam cross-link sweep ran 2026-08-17**: 253 items visited across 11 cursor batches, **131 games gained a Steam link** (`needing` 242 → 111). RAWG's pass is still un-run and stays that way while RAWG is down.
   - ⚠️ **The 111 still "needing" are NOT leftover work — do not re-run to chase them.** They were visited and could not link because those games are not on Steam. This is the trap already recorded for backfills: **a sweep driven off "what's still missing" never terminates.** The termination condition is the CURSOR draining (`remaining: 0`, `nextAfterId: null`), which it did.
   - **Both routes are session-gated** (`withScoringAdmin` reads the login cookie), so a bare terminal `curl` 404s no matter the syntax. Run them from the browser console on fandex.org while logged in. Also: in PowerShell `curl` is an alias for `Invoke-WebRequest` and does not accept `-H`/`-d` — use `curl.exe` or `Invoke-RestMethod`.

3. ✅ **Donations are LIVE (2026-08-12).** **Any future client-read `NEXT_PUBLIC_*` needs an `ARG` line in the Dockerfile** or Railway never forwards it into the build — and the failure looks like success, since server components still render it fine. → [[next-public-env-needs-dockerfile-arg]]
4. **`PRUNE_ON_BOOT=0` on Railway — optional now, your call.** The boot prune has now fired against prod **twice**, both times cleanly. On the 2026-08-12 redeploy it deleted 255 browsed-only rows (`media_items` 2267 → **2012**, exactly PR17's original expected figure; `media_links` 4225 → 3969, `media_external_ids` 4237 → 3970) and touched **zero** user rows — `user_library` 1912, `user_watchlist` 96, `user_item_state` 2337 all unchanged, `libRowsWithoutState`/`wishRowsWithoutState` still 0/0. The safety guard demonstrably holds in production. Set it to `0` only if you want no unattended deletes at all until (1a) confirms Litestream.
5. ~~Reclaim the WAL high-water~~ — **attempted twice 2026-08-12, cannot be done while Litestream runs** (`busy: 1`, no reclaim, both times). Not a fault and not worth chasing: the volume is 12% used with 4 GB free. Details in the PR17 section below.
6. **Watch whether prod STAYS up.** It served ~32 min on 2026-08-07 then was un-routed at the edge; this session it has been stable ~7 h. The app never crashed either time (`uptime` climbed monotonically), so both events read as a billing/pause action, not a technical one. If usage is still near the cap, resumed traffic re-accrues. **Affiliate signups stay parked until this is stably up for days, not hours** — every program reviews the applicant URL and a 404 buys a rejection.
7. **Review the Impressum** — ✅ **mechanically checked on live prod 2026-08-17, nothing wrong with it.** `noindex, nofollow, noarchive, nosnippet` intact; canonical + hreflang resolve to the real domain (not `localhost`, so the `force-dynamic` rule is holding); sections are `§ 5 DDG` + `§ 18 Abs. 2 MStV`, Kontakt, Verbraucherstreitbeilegung, Haftung für Inhalte, Haftung für Links, Urheberrecht; real postcode/town + email present; **zero placeholders**; the Verbraucherstreitbeilegung paragraph is the standard non-participation wording; and there is **no ODR / OS-Plattform link**, which is correct — that platform closed 2025-07-20. What remains is genuinely your sign-off (is the address the one you want published), not a defect. Once you're happy, H4.2 closes and **all of H3 unblocks**.
8. **On Ko-fi itself: no tiers, no perks, no memberships.** A donation with consideration is a taxable supply *and* a much stronger "commercial use" reading against TMDB's non-commercial-only free tier. Also still open: the monthly-running-cost placeholder on the support page — that's H3.0's number (#10).
9. **Build + sign the Android TWA** (P15) — Bubblewrap/PWABuilder → package name + signing-cert SHA-256 → set `TWA_PACKAGE_NAME`/`TWA_CERT_FINGERPRINT` on Railway.
10. **H3.0 — confirm the upkeep baseline**: the actual Railway monthly bill + domain + any other recurring cost. One number; it goes in the H3 section below.
11. **H3.8's thresholds are defined but NOT approved** (your call, 2026-08-02: "leave it defined but unapproved"). A future session must not read them as settled.
12. **Sign up for the affiliate programs** — **still PARKED** (your call, 2026-08-03), now on prod being **stably** up rather than up at all — see #6. Every program reviews the site URL on the application, so applying during an un-routed window buys a rejection, and reapplying is worse than a first application. Sequence once that holds: **GOG first** (the only merchant the catalog already product-links), then Humble → Fanatical → GMG, **Amazon LAST** — applying starts a 180-day/3-qualifying-sale clock that closes the account if missed, and Amazon is the only movie/show coverage. Full walkthrough → [docs/monetization-go-live.md](docs/monetization-go-live.md).

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

## MB — mobile testing batch, 2026-08-14 (Nils, 15 notes) 🟡 1 of 15 open

**14 of 15 shipped** (13 on 2026-08-14, MB14 on 2026-08-16 — fixed and verified the same day) — full write-ups → [archive](docs/archive/history.md), grep `MB — mobile testing batch`. Four findings there are worth reading before touching related code: **re-seeding does not produce turnover** (MB9), **`display:none` does not stop images downloading** (MB13), **Tailwind resolves competing utilities by stylesheet order, not class-attribute order** (the `buttonClasses` bug MB13 surfaced), and — spun out and **fixed the same day** — **a wrong `@theme` namespace prefix generates no rule at all**, which ran ~28 motion call sites at 150ms for three weeks with the whole quality bar green (grep `Motion tokens`).

**⚠️ Standing limitation: a Claude session has no access to Nils's phone.** Verification is the browser pane at 375×812 with touch emulation. That covers a lot — it caught the hidden-image downloads and proved the long-press gestures — but it provably cannot see MB7.

- **MB7** ⬜ **NOT REPRODUCIBLE in the browser pane — needs a device look.** "The bottom nav scrolls away on Insights." It's the **installed PWA** (Nils), which kills the obvious theory: standalone mode has no Chrome URL bar to hide, so the dynamic-toolbar explanation is dead.
  - **Ruled out by measurement at 375×812 with a session — don't re-check these:** the nav is `position: fixed` with `top` unchanged at 965 across a 1500px scroll; **no ancestor** carries a `transform`/`filter`/`perspective`/`contain`/`backdrop-filter`/`will-change` (the usual ways `fixed` silently becomes containing-block-relative — the whole chain to `<html>` was walked); **nothing covers it** (it's `z-40` and IS the topmost element at its own centre by `elementFromPoint`; the only higher-z element is the toast container at `z-100 bottom-4 right-4`, which doesn't overlap); and **`min-h-screen` is not insights-specific** — Home, Discover, Calendar, Profile and Settings all use it.
  - **Next step, on the device** (`chrome://inspect` against the installed PWA): does the nav's `getBoundingClientRect().top` actually move during the scroll, or does it stay put while something else changes? Those are different bugs with different fixes.
  - **⚠️ A Claude session cannot do this even with the phone plugged in** (established 2026-08-17): the browser tooling rewrites a `chrome://` URL to `https://chrome://`, and a Chrome extension cannot script `chrome://` pages regardless. It needs a human at `chrome://inspect`.
  - **Paste this into the remote console** once the PWA's inspector is open, then scroll — it answers the question above in one go rather than needing a second round-trip:
    ```js
    (() => {
      const nav = document.querySelector('nav.fixed, [class*="fixed"][class*="bottom"]')
              || [...document.querySelectorAll('nav')].at(-1);
      const s = [];
      const rec = () => s.push({ y: Math.round(scrollY), top: Math.round(nav.getBoundingClientRect().top),
        vh: innerHeight, vv: Math.round(visualViewport?.height ?? 0),
        off: Math.round(visualViewport?.offsetTop ?? 0), pos: getComputedStyle(nav).position });
      rec(); addEventListener('scroll', rec, { passive: true });
      visualViewport?.addEventListener('resize', rec);
      setTimeout(() => { console.table(s); window.__mb7 = s; }, 8000);
      return 'scroll for 8s — then read the table';
    })()
    ```
    **How to read it:** if `top` stays constant while `vh`/`vv` change, the nav is fine and the VIEWPORT is resizing (the PWA's own toolbar/safe-area) — a different bug from the nav moving. If `top` climbs with `y`, `position: fixed` is resolving against something other than the viewport after all, despite the ancestor chain having been walked clean.
  - **Do NOT speculatively add `viewportFit: "cover"`.** `layout.tsx`'s `viewport` export sets only `themeColor`, so `env(safe-area-inset-bottom)` — which `AppNav`'s mobile bar pads with — is always 0. That is self-consistent today (without `cover`, the app is already laid out inside the safe area) and changing it moves where the whole app paints.

- **MB14** ✅ **2026-08-16 — per-episode show tracking, working.** Root cause of the dead first release: `/sync/watched/shows` carries **no episode data in any variant** (measured — `seasons` absent on all 280 entries); the pull uses `/sync/history/episodes` now. → [[trakt-episode-endpoints]] · [archive](docs/archive/history.md), grep `MB14 — per-episode show tracking`.
- **MB16** ✅ **2026-08-16 — the episode UI, to Nils's spec.** "Up next" is now a full-width VERTICAL scroller of calendar-style list rows (show poster, checkbox where the wishlist toggle would be), about 2.5 rows tall, with "See all" → a new **Progress** tab in the library that isn't capped at 10 and pages as you scroll. `<EpisodeRow>` + `useEpisodeTick` are shared by both surfaces so the tick can't drift. → [archive](docs/archive/history.md), grep `MB16 episode UI`.
  - **The Progress tab deliberately does NOT load the library payload.** `/api/library` is **8.9 MB / 1,922 items** here, and `MyStuffContent` then runs merge/filter/sort memos over all of it; paying that before showing an episode left the tab blank for 30 s+ with the renderer unresponsive. The item fetch is now effect-driven and skipped for that tab.
  - **Two pre-existing bugs fixed on the way:** `loadItems()` had no `try/finally`, so a rejected fetch or a half-parsed body left `loading` true and the page stuck on "Loading…" with no error and no way out; and the mount effect referenced `init()` before its declaration (a stale-binding hazard the react-hooks rules flag as an error).
  - **A "Load more" button sits alongside the IntersectionObserver** — the observer needs a compositor and never fires in some embedded contexts, and a keyboard user shouldn't have to simulate a scroll.
  - **The tab set is now three: Wishlist · Progress · Library** (2026-08-16). "All" was a superset rather than a place, and Rated/Unrated were a rating filter wearing a tab's clothes. **Library is NOT the old All** — that folded in wishlist-only items. Retired values (`?tab=all|rated|unrated`) fall back to the route default, with a test pinning it so old links keep working.

- **Home progress module** ✅ **2026-08-16** — Home's three counters are gone; a carousel of the episode you'd watch next takes that slot, after the highlight panels. ONE filter (the preceding episode is watched) and ONE sort (a watch and a release are dated events on one timeline; latest first, capped at 10). `src/lib/upNext.ts` + `/api/progress` + `<ProgressRail>`. **Live and populated** now that MB14 feeds it real episodes. → [archive](docs/archive/history.md), grep `Home progress module`.
  - Two rules that outlived it, both now in `AGENTS.md`: **a 30-day recency FILTER was the first cut and was wrong** (a filter hides a show instead of ranking it — ask that of any "only show it if it's recent" rule), and **a module that renders `null` when empty must know why before it ships** (this one cost four deploys).

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

**Finding 2 — ⬜ re-measured 2026-08-17 against PROD's real config: it is 3.3% outside, not ~1%.** The old figure assumed `ip: 1.3`; prod runs **`ip: 3`**, which widened the tails a lot. `node scripts/probe-score-range.mjs data/rr.db --config <prod response>` on the real 1,922-item library:

| config | min | p10 | median | p90 | max | <0 | >100 | outside |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| **A · prod as it runs today** | −23 | 40 | 72 | 89 | 115 | 8 | 55 | **3.3%** |
| B · gains fitted (2 / 4.3) | −30 | 38 | 71 | 85 | 106 | 9 | 4 | 0.7% |
| C · C=5 + fitted gains | −42 | 37 | 71 | 85 | 106 | 10 | 10 | 1.1% |
| **E · top-N 3/2/2/1, gains unchanged** | **2** | 47 | 70 | 83 | **103** | **0** | 2 | **0.1%** |

**E is the standout and it is not the one the old note predicted.** It is the only row with *no negative scores at all* (min 2, max 103), and it needs no gain change — just tighter top-N. Its cost is the documented one: a thinner breakdown (fewer facets listed per item) and a narrower spread (p10–p90 of 36 points vs today's 49).

Three honest options, still your call: **(a) tighten top-N to 3/2/2/1** → 0.1% outside, no negatives; **(b) drop `ip` 3 → ~2**, which attacks the actual cause rather than the symptom (it alone moves 721 items by up to ±24); **(c) relabel** — `FandexScoreBadge` makes no 0–100 claim itself, printing a bare integer coloured against `center ± 10`, which reads correctly at any scale, and the 0–100 target lives only in `docs/fandex-score.md` §1.

⚠️ Both probes above ran against the LOCAL `data/rr.db` with prod's config imported. Local has more franchise attachments than prod did (584 vs 407 found by the Wikidata sweep), so the `ip` effect here is, if anything, slightly overstated — though the 70 suggestions applied to prod on 2026-08-17 have narrowed that gap.

---

## Franchise / IP as a scoring factor ✅ BUILT 2026-08-14 · needs a deploy + your weight call

A fourth facet kind (`ip`) fed by TMDB `belongs_to_collection` + IGDB `franchises`, both already in stored `raw_data`. Full design → [docs/fandex-score.md](docs/fandex-score.md) §3.6. Measured on the real library: **516 of 1,903 scored items move** (Metal Gear Solid +5.2, LOTR +5.0, The Last of Us +4.7, Transformers −8.0).

**No migration and no prod config edit needed** — `getScoringConfig()` merges `{...DEFAULT, ...stored}`, so prod's existing row picks up `roleWeights.ip: 1.3` and `topIps: 1` from the defaults the moment the code deploys. Verified against the real local row, which predates both.

**The editor shipped 2026-08-14** (`0a1ee54`) — `/dev/scoring` → Taxonomy → **Franchises**. Migration 13 adds `ip_alias` (bundling, mirrors `tag_alias`) and `item_ip_override` (attach/detach one item). Verified on both apply paths against a copy of the real DB. Design + the resolution-point reasoning → [docs/fandex-score.md](docs/fandex-score.md) §3.6.

**⚠️ The numbers this section used to quote were WRONG — prod was never read.** Live `GET /api/dev/scoring` on 2026-08-17 says **`ip: 3`** (not "the default 1.3") and **`director: 2`** (not 4), with `priorStrength: 2`, `K_up 2.5 / K_down 4`. The `ip` weight had already been tuned. This is the third time the "read `/api/dev/scoring` before theorising" rule has paid — the stored blob wins over any default, so a doc quoting defaults is quoting fiction.

**Done 2026-08-17 (on prod):**
1. ✅ **Bundled `metal gear solid` into `metal gear`.** Prod had 4 + 3 items, deduping to 5 — the two were double-attached. Canonical is `metal gear`: it is the series, Metal Gear Solid is a sub-series inside it.
   - **Two of the five members were wrong and were removed**: *PlayStation All-Stars Battle Royale* and *Super Smash Bros. Ultimate*, crossover fighters where Snake/Raiden guest-appear. Both were collecting the **full franchise deviation (+15.6 each at `ip: 3`)** — i.e. being credited with a Metal Gear rating for a cameo. Re-attach by hand if you disagree. Metal Gear is now Snake Eater, Delta, Ground Zeroes, Phantom Pain.
2. ✅ **Applied 70 of 71 title-match suggestions.** (Prod had **71**, not the 31 quoted here — that was the local count.) Overwhelmingly genuine: GTA III/V/San Andreas/Vice City → Grand Theft Auto, the five Back to the Future episodes, Half-Life 2's episodes, Elder Scrolls, System Shock, Sam & Max, The Last of Us Part I + Remastered. Stored `source: manual`, so a Wikidata re-sweep cannot undo them.
   - ⬜ **One deliberately skipped: the GAME `Journey` → `Journey Collection`.** That collection is a **1-item *movie*** collection — a name collision, not a franchise. Attach it only if you actually want the game folded into a film collection.
3. ✅ **`ip` is live at 3 and that is aggressive — measured.** `node scripts/probe-ip-impact.mjs data/rr.db --config <prod response>`: **721 of 1,904 items move**, swinging up to **±24 points** (Metal Gear Solid V +15.6 → 115; LOTR +15.0 → 108; Transformers: Age of Extinction −24.1 → −23). It is the main driver of finding 2 below. Lowering it to ~2 is the single biggest lever if you want the range back.
4. ⬜ **Optional gain re-fit** — see the measured table in the SM39 section; the honest options changed now that prod's real config is known.

**✅ Wikidata shipped 2026-08-14** (`313a830`) — **the shows gap is closed.** `POST /api/dev/scoring/wikidata` (admin, bounded + resumable, repeat until `remaining` is 0). On the local catalog: 2,295 items asked, **584 found, 605 attachments — 321 games, 165 movies, 98 shows.** Star Wars now spans 11 movies + 6 shows (The Mandalorian, Andor, Obi-Wan Kenobi…), plus links no TMDB collection has: Better Call Saul → Breaking Bad, Puss in Boots → Shrek.

- ⬜ **Run it against prod** — same shape as `/api/dev/crosslink`; prod's catalog is untouched. Repeat `POST {"maxItems":150}` until `remaining` is 0 (~15 calls).
- **Property per medium, both measured — don't "simplify" to one.** Films/shows: IMDb `P345` → **`P8345`** (P179 there also returns sub-series like "Star Wars original trilogy"). Games: Steam `P1733` → **`P179`** (P8345 is absent on games entirely).
- **Labels need `en,mul,en-gb`.** Plain `"en"` returns bare QIDs for the Half-Life/Portal/Fallout/Last of Us series — they carry `mul` labels. Anything still QID-shaped is dropped.
- **A wikidata write never overwrites a `manual` one** (`item_ip_override.source`, enforced in the upsert's WHERE) — otherwise a re-sweep would undo your corrections.
- **Measured dead ends, don't re-check:** TMDB keywords carry franchise names on 2 of 387 show payloads; TMDB has no collection concept for series.

---

## 🟡 `/library` + `/wishlist` are dead under `next dev` — DEV ONLY ⬜ your call which fix

**Found 2026-08-17 while verifying migration 16. Production is NOT affected** — a `next start` build hydrates both pages and renders real items, so fandex.org was never broken. (An earlier note in this file said it was; that was wrong, generalised from the dev server before the prod build was tested.) It is also **not** caused by migration 16 — it reproduces on a clean HEAD checkout.

**What it costs:** neither page can be developed or verified against `next dev` at all. That is why it went unnoticed — the smoke sweeps run against prod.

**Symptom (dev):** both routes SSR their full toolbar and then sit on “Loading…” forever. React never hydrates the `<main>` subtree, no effect runs, `/api/library` is never requested, and **clicking a tab does nothing** — no URL change, no `aria-selected` move, zero fetches. That last one is the 5-second reproduction.

**Root cause, measured:** `MyStuffContent` calls `useSearchParams()` (the `?tab=` IS the state, per SM21). That postpones its Suspense boundary — the DOM carries React's **`$~`** postpone marker and the fiber is `dehydrated: true` — and the `next dev` client never resumes it. **Replacing that single call with a plain `URLSearchParams` makes the page hydrate, fetch and render immediately, and the `$~` marker disappears.** That is the whole of it.

**Ruled out by experiment — don't re-try these:**
- **`export const dynamic = "force-dynamic"` on both pages does NOT fix it.** So it is not the static prerender.
- **Moving the `Suspense` boundary out of the client module into the server `page.tsx` does NOT fix it.** So it is not boundary placement.
- Not the API (`/api/library` 1,922 items + `/api/calendar` 95 complete in 3.0 s when fired by hand *on that page*), not `init()` bailing (auth returns a user; last sync 14 h vs a 24 h `SYNC_STALE_MS`, so the auto-sync branch never runs), not a console error, not a failed chunk, not a server error.
- ⚠️ `performance.getEntriesByType('resource')` lists only **completed** requests — "never issued" and "in flight" look identical there. That cost an hour.

**Diagnostic worth keeping:** `Object.keys(document.querySelector('main')).some(k => k.startsWith('__reactFiber'))` — `false` on `<main>` while `true` on `body` means an unhydrated subtree, not a slow request.

**Workaround today:** verify those two pages against the prod build — `npm run build && npm start` (the `prod` launch config, :3100). Proven working there.

**✅ DECIDED 2026-08-17 (Nils): option 1 — leave it, re-test on the next Next.js bump.** Do NOT restructure `MyStuffView` for this; the other two options are recorded only so the reasoning isn't re-derived. Add a re-test of these two pages to the checklist whenever `next` is upgraded (a Dependabot `next` bump is exactly the moment to try it).

**The three options:**
1. **Leave it, use the prod build to verify.** ← chosen. Zero risk, keeps SM21's URL-as-state exactly. Costs dev ergonomics on two pages.
2. **Pass `searchParams` from the server `page.tsx` as a prop** (the other option Next's own docs give). Keeps SSR correct with no flash, drops `useSearchParams` entirely — but a tab switch then needs a server round-trip instead of being instant.
3. **Derive the tab from `window.location.search` + a `popstate` listener.** Keeps switching instant, but the initial render no longer knows the tab server-side, so a deep link to `?tab=progress` flashes the default first.

Worth re-testing on the next Next.js bump before spending effort — this looks like a dev/Turbopack bug in 16.3.0, not a mistake in the app.

---

## Drop the `user_library` / `user_watchlist` cache tables ✅ DONE 2026-08-17 (migration 16)

**They are now VIEWS over `user_item_state`, not tables.** Migration 3's expand-then-contract finally contracted. `rebuildCaches` is deleted; the drift that was audited on every boot for a year is no longer absent but *impossible*, because there is nothing separate left to drift.

**Why views rather than rewriting the ~18 read sites:** it puts the correctness of every rating, status and review in two SQL definitions instead of eighteen queries — and, decisively, it makes the swap *provable* by diffing view output against the real stored rows. It is also cheaply reversible: `user_item_state` still holds everything, so a wrong view is one `CREATE VIEW` from correct, never a restore.

**Verification that actually counts (both apply paths, real data):**
- `node scripts/verify-cache-views.mjs data/rr.db` — view output vs the real tables, column by column: **byte-exact on all 2,017 rows**, `added_at` included, at zero tolerance.
- `node scripts/rehearse-cache-view-migration.mjs data/rr.db` — runs the **standalone** `scripts/migrate.mjs` against a prod-shaped copy and diffs pre-migration table vs post-migration view. Clean, idempotent on a second run, every other table's row count unchanged.
- Live: `/api/library` 1,922 items with ratings intact (incl. averaged 6.5), `/api/calendar` 95, `/insights` renders 1,671 rated / 1,922 in library / 6.7 average.

**⚠️ Three things a future session must not relearn the hard way:**
1. **A code-only rollback does NOT work.** Old code calls `rebuildCaches`, which issues INSERT/UPDATE/DELETE against a view — SQLite refuses ("cannot modify … because it is a view") and every library write fails. Rolling back means recreating the tables from the views too; the two-statement recipe is in migration 16's comment.
2. **Never index these names again.** `CREATE TABLE IF NOT EXISTS` over a view is a silent no-op, but `CREATE INDEX IF NOT EXISTS` over one **throws**. `db.ts`'s schema block re-runs before migrations on *every* boot and used to carry exactly those two index statements — left in, this migration would have applied cleanly and then stopped the app from starting on the next restart. They moved into migration 3 (the only thing still needing real tables, for its backfill); `cacheViews.test.ts` guards it at the source level.
3. **The wishlist view orders its JSON by `source` and the library view by `rowid`, deliberately.** `rebuildCaches` never named an order, so SQLite picked one per query — the wishlist's `SELECT source` is covered by the UNIQUE index (alphabetical), the library's five-column select is not (rowid order). Both are baked into years of stored JSON. Measured, not inferred.

Also retired with it: `dbSize.ts`'s `libRowsWithoutState` / `wishRowsWithoutState`, which did their job (0/0 on prod is what unblocked this) and can now only ever read 0. `dbPrune.ts`'s `PRUNABLE_WHERE` drops its two view clauses — provably redundant now, since a view row cannot exist without the `user_item_state` row it derives from — and keeps the hedge as a *measurement* (`wouldHaveLost*`, which must stay 0).

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
2. ✅ **Games' thin rows are mostly RAWG-only — FIXED on prod 2026-08-17.** Your call was to fix the root cause by cross-linking IGDB rather than fall back to a depressed number, and that is what ran: **319 games visited, 263 linked (82%), IGDB coverage `needing` 357 → 61.** No script needed in the end — `POST /api/dev/crosslink {"source":"igdb","maxItems":25}` already supports IGDB and is cursor-driven, so `scripts/backfill-game-detail.ts` stays unused.
   - Prod's remaining game-link gaps: **rawg 168** (untouched — RAWG has been down all day, timeouts + open circuit), **steam 111**, **igdb 61**. The steam and igdb figures are *visited-and-unlinkable*, not pending work — those titles simply aren't in those catalogs.
   - ⚠️ The route ignores an unrecognised `dryRun` key, so `{"dryRun":true}` **still writes**. Found by passing it and watching `needing` drop by 5. Don't trust it as a preview.
   - Practical note for a future long sweep: each 25-item batch takes ~15–20 s against IGDB's rate limit, and a browser-console loop dies at the 45 s CDP timeout. Kick the loop off as a detached async function writing progress to `window`, then poll that — the whole 319-item drain ran in one go that way.
3. **Progressive reveal is built but only half-observed.** `DiscoverPageClient.runSearch` paints local `find()` results first and folds `webItems` in when they land ("Show local results immediately" is the existing comment), the empty state is gated on `!webLoading` so an intermediate never reads as "No results", and there's a "Pulling more from the databases…" affordance. The database half still arrives as ONE batch, not a trickle — with AND that is unavoidable for tags (the conjunction is one query), so "slowly fills" is now local-then-external, at 6–9 s rather than 66 s.
4. **The shimmer and blank states were verified by code + unit tests, NOT visually** — driving the filter panel through the browser pane didn't land in the time available, and a shimmer is inherently racy to catch in a DOM snapshot. Worth an eyeball on a tag search with a mix of scored and unscored results.

**Also found — ✅ FIXED 2026-08-17.** Standalone `node` couldn't import `src/lib/http.ts`: `ProviderUnavailableError`'s constructor used TypeScript **parameter properties**, which Node's strip-only type removal rejects (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`), so any `scripts/*.mjs` reaching a provider path died on import. Same class as AGENTS.md's `import type` rule — **type-stripping erases, it never emits**, and a parameter property has to generate an assignment. Fields are now declared and assigned explicitly; verified by importing `http.ts` through `alias-hooks.mjs` and constructing the error with `host`/`retryInMs` intact.

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
