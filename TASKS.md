# Fandex — Task Tracker

> **This file holds only what is still open.** Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it for the "why" behind a past decision; never read it end to end). One-page state → [STATUS.md](STATUS.md).

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2–4 sentences + a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session** — this file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ✅ Decisions LOCKED 2026-08-17 — do not re-open these

Nils answered the full open-decision list in one pass. Treat every line here as settled; a future session that re-raises one is wasting his time. **One (#2) was later superseded by Nils himself on 2026-08-19; it is struck through rather than removed, and that is the only kind of change this list takes.**

1. **Impressum: APPROVED as-is.** H4.2 closes. **All of H3 is unblocked.**
2. **~~Affiliate signups: GO, starting with GOG, now.~~ SUPERSEDED 2026-08-19 by Nils** (see H3 below): the plan is ads-first and affiliate is demoted. Recorded rather than deleted, so the reversal is visible. The original text, still true as of 2026-08-17: The "prod stably up for days, not hours" gate is met (serving since 2026-08-12). Sequence unchanged: GOG → Humble → Fanatical → GMG → **Amazon LAST**. Claude does not do the signups — they carry his tax/payment identity.
3. **H3.0 is CLOSED as WON'T DO. The support page must NEVER quote a running-cost figure — permanently, not "until we have one".** The qualitative line ("Hosting, Domain und die Dienste … gehen auf eigene Rechnung") stays; no number ever joins it. Do not re-add H3.0 as an open item.
4. **Fandex Score range: RELABEL (option c).** 0–100 is a **target, not a rule**. His reasoning, worth keeping: *exceeding 100 is rare and makes an item stand out — it promotes the score rather than making it unbelievable.* So **no re-tune, no top-N change, `ip` stays at 3.** `docs/fandex-score.md` §1 updated to match. SM39 finding 2 is CLOSED. ⚠️ **Not violated by the 2026-08-22 selection fix**, which changes no top-N *count* and refits no gain: the buckets simply now rank by `dev · classWeight` (what §3.3's spec always said) instead of the raw `dev`, so the weights bind on WHICH facets fill the existing slots. It does move scores where a weight is not 1, and generally widens the spread, which this decision already accepts.
7. **Android TWA (P15/P16): NEEDS MORE DETAIL** before he acts — "Bubblewrap" read as belonging to a different project. See the P15/P16 section.
8. **H3.8 thresholds: APPROVED.** Ads at **10,000 pageviews/mo**, freemium at **3,500 sustained weekly-actives**. The long-standing "defined but explicitly NOT approved" guard is **retired** — these are now real triggers.
9. **`PRUNE_ON_BOOT` stays ON** (the guard has held in prod three times). **`priorStrength` / role-weight re-tune: NOT needed — current tuning approved as good.** That time-gated item is closed.

---

- **Legal pages — all `TODO(...)` strings resolved** ✅ 2026-08-17. Two were factually wrong after that day's decisions (privacy claimed no postal address was published while the approved Imprint publishes one; terms claimed H3.8 was undecided), and `TODO(H4.3)` was answered per-case rather than as one blanket claim. **The rule that outlives it: strings in `src/lib/legal/content/{de,en}/*.ts` `body:` arrays RENDER to users — they are not code comments.** → grep the archive for `TODO(H4.3)`.

## ⚠️ Needs Nils — this is the whole list

Everything else in this file is either done or a standing constraint. **The four platform questions on this list were answered 2026-08-23 and are now the `PL` section below. Nothing platform-related is waiting on you.**

1. **Android TWA (P15/P16): ⏸️ PAUSED BY NILS 2026-08-23 until the developer account is a BUSINESS account.** The app package is built and proven (sideloaded on the Pixel 8 with no address bar), and **the Play Console entry now exists**: created 2026-08-23, name `Fandex`, package `org.fandex.twa`, App, Free. Nothing else on the Play side is done, deliberately.

   ⚠️ **The upgrade is not only about invoicing, and this is the part worth knowing: the 12-testers/14-days gate applies to PERSONAL developer accounts ONLY.** Google's wording is "Google Play requires *personal* developer accounts created after November 13, 2023, to test their apps before those apps are eligible for distribution" (support.google.com/googleplay/android-developer/answer/14151465, checked 2026-08-23). InFlucx is currently a **Personal account**. An organization account is not subject to it. **So running a closed test now would very likely be throwaway work** — do the account upgrade first, then re-check whether the gate still applies at all.

   **When the account is upgraded, the remaining steps are, in order:** (a) `Test and release → App content` — privacy policy `https://fandex.org/legal/en/privacy`, Data safety, content rating, target audience; (b) upload `android-package/Fandex.aab`; (c) ⚠️ **APPEND the Play App Signing SHA-256** (`Test and release → Setup → App integrity`) to `TWA_CERT_FINGERPRINT` in Railway, comma-separated — **Google re-signs the store build**, so the fingerprint already live in `assetlinks.json` (`F7:75:02:5D:…`) is the upload key and will NOT verify the copy testers install; (d) confirm `https://fandex.org/.well-known/assetlinks.json` lists BOTH fingerprints; (e) testers, only if the gate still applies. Full walkthrough → [docs/twa-play-store.md](docs/twa-play-store.md).

2. **⚠️ RAWG is NOT down — its monthly API quota is exhausted. The sweep cannot run, and this is a different problem from 2026-08-17.** Measured 2026-08-20: `api.rawg.io` answers **`401 {"error": "The monthly API limit reached"}`** in 0.17 s. Not the timeouts and Cloudflare 522s of the August outage.

   **Evidence it is RAWG specifically, not the sweep** (the first control was misleading, so this took three): a prod `/api/calendar/popular` fan-out for a cold month returned 15 items whose id sources were `{igdb: 4, tmdb: 11}` and **zero rawg**; `crosslink {source:"rawg"}` processed 12 items across two batches and linked **0**; and `{source:"igdb", maxItems:15}` linked **1**, with the survey moving 60 → 59, proving the machinery and provider searches both work today. ⚠️ **Do not use Steam as the control** — its cursor drained on 2026-08-17, so its remaining 113 are the known-unmatchable residue and it links 0 whether or not anything is wrong.

   **What to do:** wait for the quota to reset, then run the sweep. Survey as of 2026-08-20: **rawg 157**, steam 113, igdb 59 of 760 games. Not urgent — **the dual-source design is doing exactly its job**, games still render everywhere because IGDB carries them, which is the invariant the 2026-08-02 outage bought.

   ⚠️ **The 401/403 latch shipped 2026-08-22, so next month's counter is readable.** RAWG is now latched off after five rejections instead of being re-asked ~5,600 times a day, which means the counter from the next quota window measures calls we actually *chose* to make. That is the measurement that will answer the question below; do not try to answer it from the pre-latch numbers.

   ⚠️ **What SPENT the 20,000 is still unidentified, and the obvious answer is not proven.** The tempting one is the facet crawler: a cold `/tag/{genre}` page costs **4 RAWG calls** (`docs/scalability.md`), that crawl left **24,953** `facet_page_cache` rows, and `/dev/analytics` shows it is measurably the traffic (**4,314 of 5,365 pageviews** on `/person`, `/tag` and `/studio` against **14** homepage views → `docs/seo.md`). ⚠️ **But every RAWG number we actually have was measured AFTER the quota was already gone**, so it describes wasted calls rather than spent ones: 13,068 requests in 10.5 h, and 4 in the first 31 s of a fresh container, **all 401**. That is a rate which would clear 20,000 in under two days by itself, but it is not evidence about what consumed the quota in the first place. **Do not pick between the two by reasoning** — this repo has mis-diagnosed a resource ramp twice that way. **Item 4 (the 401/403 latch) is the right first move regardless:** it removes the wasted traffic and makes the next month's counter readable, which is the only thing that will actually answer this. **It undercuts a monetization assumption either way:** `docs/monetization-go-live.md` records RAWG as "safe, free commercially to 20k req/mo", and we exhaust that at *pre-launch* traffic because cost scales with catalog breadth and crawler appetite, not with pageviews.


3. **Optional, and no longer urgent: the GOG affiliate signup.** Demoted 2026-08-19 with the rest of the affiliate plan (see H3 below). Worth one email anyway, because GOG's dashboard is a free click meter on a site that deliberately collects no click data of its own. **Do NOT apply to Amazon** — its 180-day / 3-sale clock starts at signup, and the self-referral shortcut is a terms breach that closes the account rather than a loophole.

4. ~~**Franchise rail: should it ask the provider for the titles we do not hold?**~~ ✅ **ANSWERED AND BUILT 2026-08-23** (`9255b1f`). You said yes, with a cost question attached, and the answer changed the design: a full ingest would have grown the catalog 2,569 → ~16,500 items (IGDB franchises average 78 members, largest 394), and RAM is 77% of the Railway bill. So it is a thin `franchise_members` table filled by a background sweep, read with **zero provider calls** on the page, and a title we do not hold is still clickable via `/r/`, which ingests it on click. **Swept on prod: 353 franchises, 10,841 members, and the DB did not grow.** → [docs/optimization-plan.md](docs/optimization-plan.md) §2.2.

5. **One sentence needed for the privacy policy: which region does Railway host us in?** Steam's Web API terms (read 2026-08-23, PL5) require that Steam data is stored in a country the privacy policy **identifies**. The policy names Railway as the host but not the region, so this is an open obligation on a live term. **Deliberately not guessed:** the region is a runtime env var, not knowable from the repo, and inventing a data-residency claim in a legal document is worse than a noted gap. Tell me the region and it is one sentence in `src/lib/legal/content/{de,en}/privacy.ts`.

**Standing constraints — not tasks, but do not violate them:**
- **Ko-fi: no tiers, no perks, no memberships.** A donation with consideration is a taxable supply *and* a much stronger "commercial use" reading against TMDB's non-commercial-only free tier.
- **The support page never quotes a running-cost figure** (H3.0, closed as won't-do 2026-08-17). The qualitative "it costs money to run" line stays; no number ever joins it.
- **Do NOT contact TMDB or Trakt about commercial terms** while monetizing on their free tiers — the accepted risk is key revocation, and asking invites it.
- **Watch that prod stays up.** Continuous since 2026-08-12; both prior outages were un-routings (billing/pause), never crashes — `uptime` climbed monotonically through both.

## ✅ Backups: closed, and PROVEN RESTORABLE twice (2026-08-20, 2026-08-23)

Migration 16 put SQLite 3.44+ syntax in a view and Litestream v0.3.13 embeds ~3.40, so it replicated **nothing** for two days while every other check stayed green. Fixed in `9d63a68` (migration 18). Both drills returned `ALL TABLES MATCH`. The full record, the one-paste Railway console command, and the superseded memory-ramp time series → grep the [archive](docs/archive/history.md) for `restore drill`.

**The two rules that stay live:** ⚠️ **Railway volume backups are Pro-plan only, so Litestream is the only copy**; and ⚠️ **a drill proves the backup you had THAT DAY**. Re-run it after ANY schema change. It is not due right now; the 2026-08-23 drill covers the current schema.

---

## PL: platform capability findings, turned into work (2026-08-23)

**Source:** the `PLATFORMS.md` re-read. **Nils decided every open question on 2026-08-23** and those answers are baked into the tasks below; the "decided against" list at the end is as load-bearing as the tasks.

✅ **PL1, PL2, PL3 and PL5 all shipped on 2026-08-23 and are live on prod.** Still open: **PL4** (the import, the big one) and **PL6** (a colour-coding leftover, small). The four done ones are one-line pointers below; their full reasoning is in the commit messages and in the [archive](docs/archive/history.md) (grep `PL1 / PL2 / PL3 / PL5`).

- **PL1. Remove OMDb entirely. ✅ 2026-08-23** (`21cfa92`). Gone, with `src/lib/noOmdb.test.ts` pinning it removed. Certification and `imdbId` survive via TMDB/Trakt; **awards had no second source and is gone from the item page**, and Metacritic is now games-only.
- **PL2. Trakt's free caps. ✅ 2026-08-23** (`9a08b68`). A rejected write is now a per-provider sync warning the user can read, deliberately **not** a throw — the pull is what must throw. → `src/lib/traktAccountLimit.test.ts`.
- **PL3. Drop RAWG's metadata role. ✅ 2026-08-23** (`5fdc0c1`). Dropped from the FACET paths (the 4 RAWG calls on a cold `/tag/` page) and **deliberately kept in browse**, where it is the only second *paginating* games source; RAWG stays a connector. → `src/lib/noRawgOnFacetPaths.test.ts`. ⚠️ **Re-measure when the quota window resets:** a cold `/tag/` page should now cost 10 provider calls, not 14.
- **PL5. Steam's API terms. ✅ 2026-08-23** (`022f94e`). **Commercial use is not prohibited**, 100k calls/day, no NC clause — the only games provider with no monetization cliff. Terms box → [PLATFORMS.md](PLATFORMS.md). ⚠️ **Two obligations came with it and are still open:** the data-residency sentence (needs the Railway region from Nils — item 5 on the Needs-Nils list above), and **the Valve name/logo requirement has not been audited page by page** — `<BrandGlyph source="steam">` likely satisfies it, but "likely" is not an audit. ⚠️ **The terms cover `api.steampowered.com` and NOT `IStoreQueryService`**, the undocumented store endpoint behind the tag search; that stays the larger separate risk.

- **PL4. The list import: Letterboxd first, IMDb alongside. ⬜ Design is DONE and lives in [docs/letterboxd-import.md](docs/letterboxd-import.md); read that before building.** The only item here that adds reach while LOWERING provider cost per user: free to the user, no OAuth, no ongoing quota. **Nils promoted Letterboxd above IMDb on 2026-08-23** because it is the userbase most worth reaching and the import is the whole switching cost. One importer, two parsers.
  - **Three verified facts that decide the build, all measured rather than read.** The Letterboxd export is **free** (their Pro page lists nine Pro and five Patron benefits; export is not one). The **username import is closed**: their terms forbid scrapers, require access "through the interface we provide", and bar exporting content that is not your own, and a username box has no proof of ownership anyway. And **Android is a silent dead end**: their app claims every `letterboxd.com` URL with no path filter and beats Chrome in the resolver, so the link opens their in-app webview where **Export Data downloads nothing at all** (verified on a Pixel 8).
  - ✅ **Import before signup: APPROVED** (Nils, 2026-08-23). Parse while logged out, show the matched films and a taste preview, then ask for the account. ⚠️ **Nothing may touch the DB until signup** (PR15's anon write gate), and the staging store is a table **written on a request path by anonymous strangers**, which is the shape that filled `facet_page_cache` to 222 MB: it needs a row or byte ceiling, an **interval** sweep in bounded batches rather than boot-only, and eviction by write time. It holds personal data before an account exists, so `deleteAccount()` will not cover it (no `user_id`) and the TTL is the only protection.
  - ✅ **Mobile: offer BOTH paths and let the person choose** (Nils, 2026-08-23). "Continue here" with the accurate Android warning, and "Continue on a computer". Pair the handoff with a `share_target` on `src/app/manifest.ts`, which has none today and which also carries into the TWA.
  - ⚠️ **Confirm the CSV filenames and column headers against a REAL export before writing the parser.** Every schema claim in the doc is from secondary sources; Letterboxd publishes none. Same rule `/api/dev/trakt-shape` exists to enforce.

- **PL6. One dead brand-hex code path, and that is all that is left. ⬜ Tiny.** The 2026-08-18 rule is "no brand hue in ANY state; identify a provider by its LOGO". Found 2026-08-23 while auditing outbound Steam links for PL5: the Steam trailer link in `src/components/item/LowerSections.tsx` still painted itself `#1b9af7` inline. **Fixed** (`bce4611`). **The audit of the remaining three `SOURCE_COLORS` readers found nothing else live**, which is worth writing down so nobody re-audits it: `Badges.tsx`'s `SourcePill` is called **only** by `/item/debug` (an internal page, and an accepted exception since 2026-08-18), and **`SubBar.tsx:227`'s source-filter chips are DEAD CODE** — `availableSources` / `activeSources` / `onToggleSource` are all optional and **not one of the three callers** (`HomePageClient`, `DiscoverPageClient`, `CalendarPageClient`) passes any of them, so the chips never render. **The only work here is deleting that dead branch**, and only if you are in the file anyway. `TYPE_COLORS` (game/movie/show) is a **different axis and stays**. → [[platform-brand-marks-not-colours]]

**Decided AGAINST on 2026-08-23, and not to be re-raised without new information:**
- **GiantBomb for game credits.** It is the only free fix for games having no cast/crew (so the Score's people axis is movie/show only), but commercial use needs **written permission**, the same terms class that parked Hardcover and Backloggd. Not opened. MobyGames stays rejected at $4,999.99/mo.
- **Anime as a media type via MyAnimeList.** MAL is the viable connector, since AniList's is barred by its competing-service clause while its metadata half is unaffected. Not opened: a whole new media type, and ~9 enumeration points `tsc` will not flag.
- **Letterboxd stays built and dark.** No working key, but the 401/403 latch (2026-08-22) means it costs nothing now, and deleting working code to chase a key that may still arrive is the worse trade. `HIDDEN_PROVIDERS` already covers it.
- **Books stay parked** (Hardcover's terms, 2026-08-03). Open Library remains the best metadata whenever they revive.

## Open — carried forward from Phase 6

### P15/P16 — the Android app. Read this before deciding; "Bubblewrap" needed context.

**→ The click-by-click version is [docs/twa-play-store.md](docs/twa-play-store.md)** (2026-08-22). The section below is the *why*; that doc is the *how*, plus the two traps: the 12-testers/14-days gate is **per app**, and the SHA-256 the assetlinks file needs is the one Play Console shows under **App integrity**, not the one in the package PWABuilder hands you — Google re-signs every upload.

**⚠️ "Bubblewrap" is two things, which is exactly why decision #7 read as cross-project contamination.** It is Nils's first published game (the `mobilegameportfolio` project, in closed testing as of 2026-08-22) *and* it is Google's CLI for building a TWA. The doc above uses **PWABuilder** instead so the word never has to appear.

**This is Fandex, not a different project.** It traces back to a decision you locked on **2026-06-18**: *"public website first, Android as a PWA/TWA wrapper"* — i.e. Fandex ships to the Play Store as a **thin Android app that just displays fandex.org**, not as a separate codebase. Two months on, the name of the tool (Bubblewrap) carried none of that context. Fair.

**What a TWA is.** A *Trusted Web Activity* is an Android app whose entire content is your website, rendered by the user's Chrome. No second codebase, no rewrite, no separate release of features — you ship the website, the app shows it. The only reason it isn't just a browser shortcut is that a TWA can **hide the browser address bar**, so it looks like a native app. Hiding that bar is exactly what needs proving you own the domain — which is what P15 is.

**What's already built (by Claude, done):** `src/app/.well-known/assetlinks.json/route.ts` serves the Digital Asset Links file Google's verifier fetches. It's env-driven and currently returns an empty `[]`, which is valid JSON and simply means "no app claims this origin yet". **P14 (PWA manifest + service worker) is also done** — that's the prerequisite that makes the site installable at all.

**What only you can do, and why.** The **signing key** and the **Play Console account** are a credential and an account tied to your identity, so Claude does not make either. Everything mechanical after that is [docs/twa-play-store.md](docs/twa-play-store.md). Older context (what a TWA is and is not, Bubblewrap) → [archive](docs/archive/history.md), grep `P15/P16 Android TWA`.

## Closed epics — pointers only (full write-ups in the archive)

- **PR17 — post-outage verification** ✅ 2026-08-12. All five steps; the leak and the memory ramp are confirmed dead in prod and backups proven by a real restore drill. Two corrected beliefs before touching backups: an **unchanged** Litestream generation is the HEALTHY signal, and `wal-truncate` reclaims nothing while Litestream runs. → grep `PR17`.
- **Smoke test 2026-08-12 (11th run)** ✅ All five findings fixed (SM38–SM42). The valuable half was the RAWG outage it ran during, which re-verified the three 2026-08-02 single-source games bugs as fixed under the exact condition that exposed them. → grep `Smoke test 2026-08-12 11th run`.

---

## H3 — Monetization 🔵 ads-first since 2026-08-19; donations live, affiliate built + dark + demoted

**Goal:** revenue covers upkeep (Railway, domain, third-party APIs).

**⚠️ THE PLAN CHANGED 2026-08-19. Read this before acting on anything below it.** Nils's call, after a per-1,000-user revenue model: **go live → wait for traction → ads → premium (ad-free + extras)**. Affiliate is **demoted, not cancelled**; the code stays built and dark. Full reasoning, the model, and the numbers → [docs/monetization-go-live.md](docs/monetization-go-live.md), the "DIRECTION CHANGED" section at the top.

The three findings that decided it, so nobody re-derives them:
- **Per 1,000 monthly actives: ads ~€150, premium ~€60, donations ~€14, affiliate ~€3.** Affiliate is last by 20 to 50 times.
- **Fandex is past-tense.** People log what they already played or watched, so a buy link on an item already in a library arrives after the purchase decision. Only the **wishlist** and the **calendar** are pre-purchase surfaces.
- **Affiliate is the only method that cannot clear its own cliff.** Covering upkeep once TMDB's $149/mo commercial tier applies needs ~1,000 users on ads, ~2,300 on premium, and **~45,000 on affiliate**.

**The economics pivot on TMDB, not on hosting.** Upkeep is small (Railway Hobby $5/mo + usage, domain ~€10/yr, all APIs currently €0) — but TMDB's free API is **non-commercial only** and commercial use is **$149/mo**. So "commercial" multiplies upkeep ~10× overnight; any paid model must clear ~$155/mo before netting a cent. Trakt requires case-by-case approval for monetizing apps. RAWG is safe (free commercially to 20k req/mo + 100k MAU, no redistribution). **Donations are the gray zone** — TMDB doesn't say whether donation-funded counts as commercial.

**Consciously accepted risk:** Fandex monetizes on the free TMDB/Trakt tiers ("under the radar"). Failure mode is **API-key revocation without notice**, not a fine. **Do NOT contact TMDB/Trakt about commercial terms while under the radar.**

**Built 2026-08-03 — H3.3 ✅ (donations, live) · H3.4 ✅ (affiliate, DARK behind `MONETIZATION_ENABLED`) · H3.9 ✅ (go-live checklist).** Full write-ups → [archive](docs/archive/history.md), grep `H3 monetization v1`. **The one thing to know before touching any of it:** the catalog's store rows are Steam/PSN/GOG/Xbox/Nintendo/Epic/itch.io and only **GOG** is affiliate-capable, so `affiliate.ts` has *two* mechanisms — a rewriter for GOG-shaped links and `buildBuyLinks()` synthesizing per-title search links for the merchants we have programs with. → [[monetization-h3]]

**Still open:**
- **H3.0** ✅ **CLOSED as WON'T DO 2026-08-17** — the support page never quotes a cost figure. Permanent, not pending.
- **Affiliate program signups** 🔵 **DEMOTED 2026-08-19.** Was "GO, GOG first" (2026-08-17); the revenue model retired that urgency. **GOG alone is still worth one email**, mainly because its dashboard is a free click meter on a site that collects no click data of its own. **Do NOT apply to Amazon**: the 180-day / 3-qualifying-sale clock starts at signup, Amazon pays **1% on video games** (6% on Blu-ray/DVD) since June 2025, and self-referring to beat the clock is an explicit terms breach that closes the account rather than a shortcut. **Nils does any signup himself** — they carry his tax/payment identity.
- **H3.8** ✅ **APPROVED 2026-08-17, and now THE PLAN rather than a parked Path B.** Both gates became measurable on 2026-08-19 (`/dev/analytics`). **Ads → 10,000 pageviews/mo** · **Freemium → 3,500 sustained weekly actives.**
  - **Ads → 10,000 pageviews/mo** (Monumetric's stated minimum). A better-RPM tier exists at 50k+ pv (Freestar/Mediavine, $15–40+ vs Monumetric's $10–20) — not a second gate, just worth re-checking which network fits.
  - **Freemium → 3,500 sustained weekly-active users.** The old "roughly 1k+ actives" napkin figure never netted out TMDB's $149/mo license. Actives needed to clear **just** the license (≈€137, no margin): 2%/1€ → 6,850 · 2%/2€ → 3,425 · 5%/1€ → 2,740 · 5%/2€ → 1,370. Even the best-case corner is above 1k. 3,500 clears it with real margin at a *conservative* 3%/1.50€, leaving room for Trakt's separate approval and normal churn.
  - **✅ Both gates are instrumented (2026-08-19)** — `/dev/analytics` measures them directly, plus the anon-vs-signed-in split that decides which arm is worth building. Self-hosted, no third-party analytics, no cookie. ⚠️ **Client beacon, so crawlers are invisible by design** — right population for an ads decision, wrong one for SEO (use Search Console). → [[telemetry-self-hosted]]
  - **The metric, as checked against the schema in July 2026:** no pageview/session log existed then, and **`users.last_seen_at` is a false friend** — it's written only on a RAWG login or Steam OAuth callback (`src/app/api/auth/rawg/route.ts:72`, `.../steam/callback/route.ts:65`), never on an ordinary revisit via an existing 30-day cookie, and never at all for TMDB/Trakt. It undercounts badly. The best signal computable today (verified against the real DB) is "touched library/wishlist/rating in the last 7 days":
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
  - **✅ `last_seen_at` is real (2026-08-03)** — stamped in `getSession()`, one write per user per UTC day, best-effort, only after epoch validation. It is the meter, not the trigger. → grep the archive for `last_seen_at`.

**If affiliate is ever revived:** sign up → set the env vars → flip `MONETIZATION_ENABLED` → run the post-go-live cookie check. The runbook is still accurate and still in the go-live doc; only its priority changed.

---

- **SM39 — the Fandex Score range** ✅ CLOSED 2026-08-17. Root cause (prod's hand-tuned gains) fixed 2026-08-14; the residual out-of-range was then **relabelled, not re-tuned** — 0–100 is a target, see `docs/fandex-score.md` §1 and the locked-decisions list above. → grep the archive for `SM39`.
- **Franchise / IP as a scoring factor** ✅ CLOSED 2026-08-17. Built + Wikidata-swept 2026-08-14; the panel was cleared on prod 2026-08-17 (metal gear bundled, two crossover cameos removed, 70 of 71 suggestions applied). `ip` stays at **3**. → grep the archive for `Franchise / IP`.

## 🟡 `/library` + `/wishlist` are dead under `next dev` — DEV ONLY, and the fix is DECIDED

**Prod is unaffected** and always was; a `next start` build hydrates both pages. **Nils decided 2026-08-17: option 1, leave it** — do not restructure `MyStuffView`. Cause is measured: `useSearchParams()` postpones the Suspense boundary (React `$~` marker) and the dev client never resumes it. Looks like a Turbopack bug in Next 16.3.0.

**Two things to carry forward.** Verify those pages on the `prod` launch config (:3100), and **re-test them on the next `next` bump** — a Dependabot PR is the moment. Diagnostic: `Object.keys(document.querySelector("main")).some(k => k.startsWith("__reactFiber"))` false on `<main>` but true on `body` = unhydrated subtree, not a slow fetch.

⚠️ **Re-check before spending any time on it:** `/wishlist` hydrated normally under `next dev` on 2026-08-18. One observation, and `MyStuffView` changed that session, so it may be fixed or intermittent. Full write-up, the three options and the ruled-out experiments → [archive](docs/archive/history.md), grep `library + wishlist dead under next dev`.

- **Drop the `user_library` / `user_watchlist` cache tables** ✅ DONE 2026-08-17 (migration 16 — they are VIEWS now). **Two traps live on in migration 16's own comment and in `src/lib/cacheViews.ts`: a code-only rollback breaks every library write, and `CREATE INDEX` on either name throws at boot.** → grep the archive for `migration 16`.

- **Advanced search's Fandex Score (SM43–SM48)** ✅ FULLY CLOSED 2026-08-17 — the last two open items (the IGDB cross-link backfill and the shimmer/blank-state check) both landed. → grep the archive for `SM44 heal budget`.

## Still open elsewhere

- **The 2026-08-23 optimization sweep: ✅ ALL SIX ITEMS DONE** (`8518b77` `25a3d96` `9255b1f` `742fdbe`). `/api/discover` 930 ms → 95 ms and 20 TMDB calls per 10 browse requests → **0**; item pages went from **zero** server-rendered links to any sibling title to 3–14; the franchise rail now lists what a franchise actually holds (353 franchises / 10,841 members swept on prod, and the DB did not grow). Answers item 4 above. What is left, and why the WAL is deliberately NOT being reclaimed → [docs/optimization-plan.md](docs/optimization-plan.md) §5.

- **Fandex Score `priorStrength` (C=5) + per-role class weights may want re-tuning** now that the aggregate is a raw sum rather than a damped mean. **Time-gated:** revisit after a few weeks of real scores under the new formula (4 days as of 2026-08-02 — too soon; a re-tune now would fit noise). ⚠️ **Re-read this after 2026-08-22.** The class weights now decide WHICH facets are selected, not just how much a selected one counts (they were silently ignored by the top-N sorts until then), so a re-tune is a bigger lever than it was when this was written, and any measurement taken before that date describes the old selection.
- **Platform integrations.** **The open questions were answered on 2026-08-23; the work is the `PL` section above.** What survives here as standing context: AniList is **connector-blocked** on a terms clause barring "competing non-complementary services… anime and manga list or tracker services", while its metadata half is unaffected and could ship alone; books (Hardcover + Open Library) stay ⏸️ **postponed as a media type, 2026-08-03**. Capability reference → [PLATFORMS.md](PLATFORMS.md).
  - **Hardcover ⏸️ PARKED — same call as Backloggd (yours, 2026-08-03).** PLATFORMS.md said "verify the auth first"; it was verified and failed, but the deciding fact turned out to be the usage terms, not OAuth: the docs call the API *"only for offline use at this time"*, reachable *"from localhost or APIs"*, with site allowlisting *"a way down the line"*. A hosted multi-user site is the case they haven't provided for. Secondary findings: no third-party OAuth (promised, not shipped), tokens expire on a **shared Jan 1 reset** so every user breaks the same day, no app-level credential (which gates the *metadata* role too), and the write mutations are entirely undocumented. Full write-up + the API constraints worth keeping (60 req/min, `_ilike` disabled, Typesense search) → grep the [archive](docs/archive/history.md) for `platform deep dives` (PLATFORMS.md was streamlined to three tables 2026-08-20).
  - **The media-type cost is measured** and lives in the [archive](docs/archive/history.md) under `What adding a media type actually costs` (grep `platform deep dives`) so it isn't re-derived. Two things worth knowing before any future type proposal: **no migration is needed** (`media_items.type` is plain TEXT, no CHECK constraint), and **`tsc` won't help you** — only one `Record<MediaType, …>` exists, so adding a union member compiles clean while silently doing nothing at the other ~9 app-level enumeration points.

---

## Recently closed — pointers only

Everything below the line is fully written up in [docs/archive/history.md](docs/archive/history.md). **Grep it; don't read it.**

- **2026-08-12 / 2026-08-03** → grep `PR17 post-outage verification`, `H3 monetization v1`, `P18 streaming links`.
  - **Two light-theme contrast gaps stay deliberately unfixed and are yours to call** (they change the design, not a value): `--color-accent-hover` is **3.47:1**, accent text on `--color-surface-inset` is **4.32:1**. No light-theme toggle is wired, so neither is user-visible yet.
- Earlier sessions (G#/SM34–37, the eight closed questions) are archived too.
