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
4. **Fandex Score range: RELABEL (option c).** 0–100 is a **target, not a rule**. His reasoning, worth keeping: *exceeding 100 is rare and makes an item stand out — it promotes the score rather than making it unbelievable.* So **no re-tune, no top-N change, `ip` stays at 3.** `docs/fandex-score.md` §1 updated to match. SM39 finding 2 is CLOSED.
7. **Android TWA (P15/P16): NEEDS MORE DETAIL** before he acts — "Bubblewrap" read as belonging to a different project. See the P15/P16 section.
8. **H3.8 thresholds: APPROVED.** Ads at **10,000 pageviews/mo**, freemium at **3,500 sustained weekly-actives**. The long-standing "defined but explicitly NOT approved" guard is **retired** — these are now real triggers.
9. **`PRUNE_ON_BOOT` stays ON** (the guard has held in prod three times). **`priorStrength` / role-weight re-tune: NOT needed — current tuning approved as good.** That time-gated item is closed.

---

- **Legal pages — all `TODO(...)` strings resolved** ✅ 2026-08-17. Two were factually wrong after that day's decisions (privacy claimed no postal address was published while the approved Imprint publishes one; terms claimed H3.8 was undecided), and `TODO(H4.3)` was answered per-case rather than as one blanket claim. **The rule that outlives it: strings in `src/lib/legal/content/{de,en}/*.ts` `body:` arrays RENDER to users — they are not code comments.** → grep the archive for `TODO(H4.3)`.

## ⚠️ Needs Nils — this is the whole list

Everything else in this file is either done or a standing constraint.

1. **Android TWA (P15/P16): do it, or park it explicitly.** Full context is in the P15/P16 section below — it is Fandex shipped as a thin Play Store wrapper of the website (your 2026-06-18 decision), and it needs a signing key plus a one-off $25 Play account. Either answer is fine; it blocks nothing. Right now it just reads as in-progress work that isn't progressing.

2. **⚠️ RAWG is NOT down — its monthly API quota is exhausted. The sweep cannot run, and this is a different problem from 2026-08-17.** Measured 2026-08-20: `api.rawg.io` answers **`401 {"error": "The monthly API limit reached"}`** in 0.17 s. Not the timeouts and Cloudflare 522s of the August outage.

   **Evidence it is RAWG specifically, not the sweep** (the first control was misleading, so this took three): a prod `/api/calendar/popular` fan-out for a cold month returned 15 items whose id sources were `{igdb: 4, tmdb: 11}` and **zero rawg**; `crosslink {source:"rawg"}` processed 12 items across two batches and linked **0**; and `{source:"igdb", maxItems:15}` linked **1**, with the survey moving 60 → 59, proving the machinery and provider searches both work today. ⚠️ **Do not use Steam as the control** — its cursor drained on 2026-08-17, so its remaining 113 are the known-unmatchable residue and it links 0 whether or not anything is wrong.

   **What to do:** wait for the quota to reset, then run the sweep. Survey as of 2026-08-20: **rawg 157**, steam 113, igdb 59 of 760 games. Not urgent — **the dual-source design is doing exactly its job**, games still render everywhere because IGDB carries them, which is the invariant the 2026-08-02 outage bought.

   ⚠️ **What is burning 20,000 requests a month is now all but named: the facet crawler.** Two independent numbers point at it. `/api/health`'s `providerCalls` measured a cold `/tag/{genre}` page at **4 RAWG calls** (`docs/scalability.md`), and that crawl produced **24,953** `facet_page_cache` rows, which is on the order of 100,000 RAWG calls against a 20,000/mo quota. Separately, `/dev/analytics` showed **4,314 of 5,365 pageviews** on `/person`, `/tag` and `/studio` against **14** homepage views, so the crawler is measurably the traffic (→ `docs/seo.md`). **Still short of a measurement:** `providerCalls` is a live counter reset on restart, so nobody has watched it across a month. Nothing else is within an order of magnitude, but this repo has mis-diagnosed a resource ramp twice by reasoning instead of measuring, so confirm before spending money on it. **It undercuts a monetization assumption either way:** `docs/monetization-go-live.md` records RAWG as "safe, free commercially to 20k req/mo", and we exhaust that at *pre-launch* traffic because cost scales with catalog breadth and crawler appetite, not with pageviews.


3. **Optional, and no longer urgent: the GOG affiliate signup.** Demoted 2026-08-19 with the rest of the affiliate plan (see H3 below). Worth one email anyway, because GOG's dashboard is a free click meter on a site that deliberately collects no click data of its own. **Do NOT apply to Amazon** — its 180-day / 3-sale clock starts at signup, and the self-referral shortcut is a terms breach that closes the account rather than a loophole.

4. **⚠️ Latch off providers that keep returning 401 — measured, and it is a third of all provider traffic.** In 10.5 h prod sent **13,068** requests to RAWG, **4,343** to OMDb and **3,155** to Letterboxd, and **every single one returned 401**. `http.ts` never opens the breaker on a 4xx (deliberately: our own bad request must not take a healthy host down for everyone), but a 401 repeated 13,068 times is a dead credential, not a bad request. A consecutive-401 latch is one small change in `http.ts` with no product impact. **Claude can do this; it is only unstarted because the session ended.** → [docs/scalability.md](docs/scalability.md) §1a

**Standing constraints — not tasks, but do not violate them:**
- **Ko-fi: no tiers, no perks, no memberships.** A donation with consideration is a taxable supply *and* a much stronger "commercial use" reading against TMDB's non-commercial-only free tier.
- **The support page never quotes a running-cost figure** (H3.0, closed as won't-do 2026-08-17). The qualitative "it costs money to run" line stays; no number ever joins it.
- **Do NOT contact TMDB or Trakt about commercial terms** while monetizing on their free tiers — the accepted risk is key revocation, and asking invites it.
- **Watch that prod stays up.** Continuous since 2026-08-12; both prior outages were un-routings (billing/pause), never crashes — `uptime` climbed monotonically through both.

## ✅ Backups: broken 2026-08-17, fixed 2026-08-19, and PROVEN RESTORABLE 2026-08-20

**Closed.** Migration 16 put SQLite 3.44+ syntax in a view; Litestream v0.3.13 embeds ~3.40, so it replicated **nothing** for two days while every other check stayed green. Fixed in `9d63a68` (migration 18).

**The drill ran on 2026-08-20 and passed:** restored from generation `c62d7dc17a0fd0cb` into `/tmp`, `integrity_check: ok`, the file byte-for-byte the same size as live (161,644,544), and **all seven tables matching live exactly** — `users` 1, `user_identities` 4, `user_item_state` 2419, `media_items` 2770, `user_episode_state` 12342, `show_episodes` 7055, `media_links` 5224. Scratch file removed; `/app/data/rr.db` untouched. Full record → grep the archive for `restore drill`.

⚠️ **Railway volume backups remain Pro-plan only** (re-confirmed on the Backups tab, 2026-08-20), so **Litestream is still the only copy**. And **a drill proves the backup you had THAT DAY** — the 2026-08-12 drill was invalidated by a schema change five days later and nobody noticed for two more. **Re-run it after ANY schema change.**

### ✅ The file already reclaimed itself — there is no VACUUM step, and there never was

**`rr.db` went 331.4 MB → 154.2 MB on the fix deploy, unprompted.** `src/lib/db.ts` VACUUMs whenever a migration actually applies (H2a), migration 18 applied, so it fired — **with Litestream attached, completing fine.** A `VACUUM_ON_BOOT` entrypoint flag was added and removed the same day: a third, worse copy, resting on a premise that drop disproves. The manual lever is `POST /api/dev/prune {"action":"vacuum","confirm":"VACUUM"}`, which checks free space first. **The WAL is still 340.8 MB** — that one does need the last connection to close with Litestream detached.

### ⚠️ The memory ramp: measured, and it is the JS HEAP. Both of my earlier answers were wrong.

`/api/health` sampled every 5 min for ~6.5 h. **Read `heapTotal`, not `heapUsed` at boot** — that is the mistake that produced two wrong diagnoses in a row.

| | 12:24 (boot) | 18:18 (6 h later) |
|--|--|--|
| node RSS | 95 MB | **420 MB** |
| **`heapTotal`** | **33 MB** | **289 MB** |
| `rss − heapTotal` (native) | 60 MB | 126 MB |
| litestream RSS | 33 MB | 25 MB (flat throughout) |
| `cgroupMb.fileMb` | 60 | oscillates 38–546, repeatedly reclaimed |

**The heap grew 256 MB; native grew 66 MB.** So it is a JS-side ramp, and the two answers I gave before it were sampled properly are both retracted:

1. **Not page cache.** `fileMb` is noise around a flat mean and gets reclaimed; it is not the trend. That was the 2026-07-22 answer being reached for out of habit.
2. **Not native memory either.** I said "`heapUsed` flat at 30 MB ⇒ native, stop reading cache code" (the 2026-07-21 rule). That was drawn from three or four spot checks that **all happened to land minutes after a container boot**, where the heap genuinely is 30 MB. The time series shows heap climbing the whole way. **A rule of thumb applied to unrepresentative samples is worse than no rule** — the samples were the problem, not the rule.

**What is actually growing:** the in-process L1 caches, filling under a crawl. The largest is `_facetPageCache` (`max: 3000`, whose own comment budgets **~145 MB retained**), beside ~10 more `BoundedCache`s. The ramp begins with a traffic burst at ~15:30 UTC.

**Not urgent, and do not "fix" it blind.** 289 MB against `--max-old-space-size=1536`; no OOM risk, and that heap is the cache doing its job. ⚠️ **NOT established: whether `fe12682` made it worse** — the burst began before that deploy, so the pre/post comparison is confounded. Settle it by comparing heap against **crawl volume**, not wall-clock. If a bound is ever wanted, the lever is `_facetPageCache`'s `max`, sized against measured retained bytes. → [[prod-incidents]]

## Open — carried forward from Phase 6

### P15/P16 — the Android app. Read this before deciding; "Bubblewrap" needed context.

**This is Fandex, not a different project.** It traces back to a decision you locked on **2026-06-18**: *"public website first, Android as a PWA/TWA wrapper"* — i.e. Fandex ships to the Play Store as a **thin Android app that just displays fandex.org**, not as a separate codebase. Two months on, the name of the tool (Bubblewrap) carried none of that context. Fair.

**What a TWA is.** A *Trusted Web Activity* is an Android app whose entire content is your website, rendered by the user's Chrome. No second codebase, no rewrite, no separate release of features — you ship the website, the app shows it. The only reason it isn't just a browser shortcut is that a TWA can **hide the browser address bar**, so it looks like a native app. Hiding that bar is exactly what needs proving you own the domain — which is what P15 is.

**What's already built (by Claude, done):** `src/app/.well-known/assetlinks.json/route.ts` serves the Digital Asset Links file Google's verifier fetches. It's env-driven and currently returns an empty `[]`, which is valid JSON and simply means "no app claims this origin yet". **P14 (PWA manifest + service worker) is also done** — that's the prerequisite that makes the site installable at all.

**What only you can do, and why.** Generating the Android package requires creating a **signing key** and a **Play Console account** — a credential and an account tied to your identity, so Claude does not do it. The mechanical shape:
1. Run **Bubblewrap** (Google's CLI) or **PWABuilder** (a website that does the same thing without installing anything) against `https://fandex.org/manifest.webmanifest`. Output: a signed `.aab` plus two values — the **package name** (e.g. `org.fandex.twa`) and the signing cert's **SHA-256 fingerprint**.
2. Set those as `TWA_PACKAGE_NAME` and `TWA_CERT_FINGERPRINT` on Railway. The route above starts serving a real claim; verify at `/.well-known/assetlinks.json`.
3. Upload the `.aab` to the Play Console. (Google charges a **one-off $25** developer registration.)

**The rest of the context** (what a TWA is and is not, Bubblewrap, the signing key, the one-off $25 Play account) → [archive](docs/archive/history.md), grep `P15/P16 Android TWA`.

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

- **Fandex Score `priorStrength` (C=5) + per-role class weights may want re-tuning** now that the aggregate is a raw sum rather than a damped mean. **Time-gated:** revisit after a few weeks of real scores under the new formula (4 days as of 2026-08-02 — too soon; a re-tune now would fit noise).
- **Platform integrations** — **AniList is CONNECTOR-BLOCKED on a terms clause, not a lead candidate** (corrected 2026-08-20; PLATFORMS.md and its deep dive already said so, this line did not). Its API is barred from "competing non-complementary services of the same nature… anime and manga list or tracker services", which is what Fandex is. The **metadata-only** half is unaffected and could ship alone. Books (Hardcover + Open Library) are ⏸️ **postponed as a media type, 2026-08-03.** See [PLATFORMS.md](PLATFORMS.md).
  - **Hardcover ⏸️ PARKED — same call as Backloggd (yours, 2026-08-03).** PLATFORMS.md said "verify the auth first"; it was verified and failed, but the deciding fact turned out to be the usage terms, not OAuth: the docs call the API *"only for offline use at this time"*, reachable *"from localhost or APIs"*, with site allowlisting *"a way down the line"*. A hosted multi-user site is the case they haven't provided for. Secondary findings: no third-party OAuth (promised, not shipped), tokens expire on a **shared Jan 1 reset** so every user breaks the same day, no app-level credential (which gates the *metadata* role too), and the write mutations are entirely undocumented. Full write-up + the API constraints worth keeping (60 req/min, `_ilike` disabled, Typesense search) → grep the [archive](docs/archive/history.md) for `platform deep dives` (PLATFORMS.md was streamlined to three tables 2026-08-20).
  - **The media-type cost is measured** and lives in the [archive](docs/archive/history.md) under `What adding a media type actually costs` (grep `platform deep dives`) so it isn't re-derived. Two things worth knowing before any future type proposal: **no migration is needed** (`media_items.type` is plain TEXT, no CHECK constraint), and **`tsc` won't help you** — only one `Record<MediaType, …>` exists, so adding a union member compiles clean while silently doing nothing at the other ~9 app-level enumeration points.

---

## Recently closed — pointers only

Everything below the line is fully written up in [docs/archive/history.md](docs/archive/history.md). **Grep it; don't read it.**

- **2026-08-12 / 2026-08-03** → grep `PR17 post-outage verification`, `H3 monetization v1`, `P18 streaming links`.
  - **Two light-theme contrast gaps stay deliberately unfixed and are yours to call** (they change the design, not a value): `--color-accent-hover` is **3.47:1**, accent text on `--color-surface-inset` is **4.32:1**. No light-theme toggle is wired, so neither is user-visible yet.
- Earlier sessions (G#/SM34–37, the eight closed questions) are archived too.
