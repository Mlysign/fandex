# Fandex — Task Tracker

> **This file holds only what is still open.** Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it for the "why" behind a past decision; never read it end to end). One-page state → [STATUS.md](STATUS.md).

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2–4 sentences + a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session** — this file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ⚠️ Needs Nils — nothing else is blocked on anything but these

1. ✅ **Donations are LIVE (2026-08-12).** You set `NEXT_PUBLIC_SUPPORT_URL`; that alone wasn't enough, and the fix is worth knowing. Next inlines `NEXT_PUBLIC_*` into the **client bundle at build time**, and Railway only forwards a service variable into a Dockerfile build when the name is declared as `ARG` — it wasn't, so the builder baked in `undefined`. The failure was asymmetric and looked like success: `/legal/*/support` is a **server** component reading real `process.env` at runtime and rendered the link fine, while the sign-in dialog and `/profile` (both **client**) rendered nothing. Fixed by adding `ARG`/`ENV` to the Dockerfile builder stage. Verified live on all three surfaces as direct outbound `<a href>`. **Any future client-read `NEXT_PUBLIC_*` needs the same Dockerfile line** — `NEXT_PUBLIC_BASE_URL` never hit this because nothing reads it client-side.
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

## PR17 — post-outage verification ✅ CLOSED 2026-08-12

All five steps done. The leak is confirmed dead in prod (byte-identical crawl replay), the memory ramp is dead (flat `fileMb` plateau then reclaim across ~7 h), and **backups are proven recoverable by an actual restore drill** — integrity ok, every user table and every real catalog row matching live exactly.

Full readings, plus two corrected beliefs worth knowing before touching backups — an **unchanged** Litestream generation is the HEALTHY signal (a new one means the lineage broke), and **`wal-truncate` reclaims nothing while Litestream runs** (`busy: 1`, by design; no action needed, the volume is 12% used) → [archive](docs/archive/history.md), grep `PR17`.

---

## Facet-page compute + provider-quota exposure ⬜ NEW, open

**Distinct from the row leak PR13–PR16 closed** — that was unbounded thin ROW WRITES; this is COMPUTE and third-party quota on READ. Measured cold on prod (2026-08-12, reproducing 08-07 almost exactly): `/tag/telepathy` **59.8 s**, `/tag/action` 12.6 s, `/tag/sci-fi` 11.9 s, `/tag/comedy` 6.9 s, `/tag/mystery` 5.2 s, `/tag/romance` 5.1 s, `/tag/thriller` 4.9 s; warm repeats **0.13–0.16 s**. `openProviderCircuits` was `{}` throughout, so that 59.8 s is **genuine render cost, not a dead provider**.

Cause: all three facet routes are `force-dynamic` and `buildPublicFacetDetail` fans out per build (studio = up to 8 TMDB discover calls; tag = TMDB + RAWG + IGDB). `robots.txt` allows `/person/ /tag/ /studio/` and the slug surface (every person across ~2,000 titles) vastly exceeds any affordable cache → near-100% miss rate under a crawl sweep. **Compute AND quota exposure: RAWG's free tier is 20k req/mo.** Exactly the 2026-07-20 lesson ("any NEW public SSR surface re-runs its full cost per crawler hit"), still live here.

**Mitigated, not eliminated (2026-08-12):** `_facetPageCache` TTL **1 h → 24 h** (zero extra bytes; `scoringConfigSignature()` is in the key so admin edits still bust it immediately) and `max` **500 → 3,000**, sized against 17 measured prod payloads (p95 19,385 B) at a 2.5× heap factor against a 150 MB budget ≈ 145 MB. Arithmetic is in the code comment. **Still open** because the slug surface far exceeds 3,000 entries and the key includes page+sort+persist. Rejected: dropping `force-dynamic` (re-creates PR14's auth-state caching hazard) and `Disallow`ing the facets (throws away the P17 SEO surface). **Not proven** to be the original cost driver — live exposure found while verifying.

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

## H4 — Legal & compliance ✅ CLOSED 2026-08-03

**Nothing open.** H4.0 (advice: a standard imprint suffices) and H4.2 (Impressum written, filled, live in DE + EN) closed the epic. Full write-ups → [archive](docs/archive/history.md), grep `H3 monetization v1`. Live reference docs: [docs/compliance-review.md](docs/compliance-review.md) · [docs/cookie-assessment.md](docs/cookie-assessment.md) · [docs/monetization-legal.md](docs/monetization-legal.md).

**Three standing guards this epic leaves behind — read before touching the legal surface, monetization, or anything claimed "reachable":**

1. **A cookie banner is not needed today** — §25 TDDDG's strictly-necessary exemption covers all three cookies. ⚠️ **Any analytics, affiliate *tracking script*, or ad script triggers the banner requirement** (equal-prominence Accept/Reject). H3.4's links are plain outbound `<a href>`s specifically to stay inside the exemption; a Fandex-hosted `/out?url=` redirect or click pixel would break it. → [docs/cookie-assessment.md](docs/cookie-assessment.md)
2. **"The nav reaches it" is a different claim per auth state.** H4.1 put the legal links on `/profile` alone, reasoning `AppNav` reaches `/profile` from anywhere — true logged-in, false for anon ("You" is a `<button>` opening `SignInDialog`, and `/profile` bounces anon to `/`). No anonymous visitor could reach any `/legal/*` page. Now in the sign-in dialog *and* on every legal page. → [[anon-legal-reachability]]
3. **The Impressum stays `noindex, nofollow, noarchive, nosnippet` + out of `sitemap.ts`** now that it carries a real home address. Those directives, not `ProtectedText`'s client-side assembly, are what crawlers actually honour.

---

## Smoke test — 2026-08-12 (11th run, LIVE against fandex.org)

Scope: anon (sandbox pane) + logged-in (Nils's Chrome, real prod session) against production, hours after ~3 weeks of unreleased work finally deployed. **RAWG was genuinely down throughout** (`api.rawg.io` 522 in 19.6 s, breaker open) — which made this the second-ever free test of the degraded games paths. Severity: 🟠 fix soon · 🟡 minor · 🔵 nice-to-have.

**All five triaged and closed the same session (2026-08-12).** Four fixed in code; **SM39 deliberately NOT changed** — see its row.

| ID | Sev | Type | Area | Finding (with repro) |
|----|:--:|:--:|------|----------------------|
| SM38 | ✅ **FIXED** | seo/ux | Home · Discover · facet pages | **The anonymous public surface has ZERO clickable items.** Home renders 30 posters, Discover 80 titles, `/person/christopher-nolan` 30 posters — each with **0** `a[href^="/movie/\|/game/\|/show/"]` and 0 `role="button"` cards. Logged in, the same components render 300 real links on `/library`. Item pages are healthy standalone (200, `index, follow`) and DO link **out** to 9 person + 8 tag pages — so the internal link graph is one-directional: **items → facets, facets ↛ items**. Effects: an anon visitor cannot open a single item from the two main browse pages, and a crawler entering any facet page dead-ends. AGENTS.md records the accepted PR13–15 trade-off as "*fewer* clickable titles"; on Home it is now zero, which is a different bargain than the one signed off. Repro (anon): load `/`, `document.querySelectorAll('a[href^="/movie/"],a[href^="/game/"],a[href^="/show/"]').length` → 0. **FIX:** the anon branches of `persistDiscoverBatch` and `buildPublicFacetDetail` returned an empty uuid map; they now call the existing read-only `lookupExistingUuids` (a plain SELECT, exported for this). A comment in `publicFacetDetail.ts` had rejected exactly this — "no lookup-only fallback… on purpose", to keep the branch a flat write-or-don't for verifiability — but that verifiability is cheaper to get from a test than from the entire public link graph. **Verified on a real catalog (prod build, genuinely anon via `127.0.0.1:3100`):** Discover 0 → **32** links, `/tag/action` **40**, `/studio/a24` **26**, `/person/christopher-nolan` **13**, Home **14**; items with no row correctly stay inert. **The gate still holds byte-identically** — a 10-request Googlebot crawl across every affected surface left `media_items`/`media_links`/`media_external_ids` at 2531/4147/4158 unchanged. New test pins both halves together. |
| SM39 | 🟠 **OPEN — your call, deliberately not "fixed"** | data/ux | Fandex Score badge | **The score renders far outside the 0–100 its badge implies.** Across the 1,773 scored items in the real library: **min −362.3 · p10 −74 · median 93.4 · p90 301.1 · max 557.4**; **373 (21%) below 0 and 836 (47%) above 100 → 68% outside 0–100.** Shown as a bare integer on every card (The Godfather **−59**, The Last of Us **433**, Dead Space 362). This is the known consequence of the raw-sum formula and the `priorStrength`/role-weight re-tune is already time-gated below — this run is the evidence that it is **not cosmetic**: a negative score on The Godfather is user-visible today. Repro (logged in): `fetch('/api/library')` → percentiles over `fandexScore`. **NOT fixed, on purpose — clamping is the wrong fix and would break two dated design decisions.** `fandexScore.test.ts:239` pins "*deliberately UNBOUNDED — no clamp at 0 or 100 in either direction*" and `:280` pins that additivity survives a raw sum past 100. A display clamp would break `center + Σ(uncapped reasons) = headline`, which is itself a previously-fixed bug (a breakdown that visibly doesn't add up). So the real remedy is the **`priorStrength`/role-weight re-tune already time-gated below** — a data-driven judgement call, and yours. Two options when you get there: re-tune so the distribution lands in range, or relabel the badge so it doesn't imply 0–100. This row exists to make sure the re-tune isn't treated as cosmetic polish. |
| SM40 | ✅ **FIXED** | ui | 404 boundary | Every 404 (`/totally-unknown-path`, garbage item uuid, unknown person, unknown tag) correctly returns **HTTP 404 with the branded body**, but `<title>` is the ROOT title "Fandex — your index of every game, movie & show" instead of a not-found title. SM26 fixed titles across all real routes; the 404 boundary was missed. **FIX:** `not-found.tsx` now exports `metadata` with a bare `title: "Page not found"` (bare because the root layout's `template: "%s · Fandex"` appends the suffix — spelling it out yielded "Page not found · Fandex · Fandex") plus `robots: { index: false }`. Verified across all three 404 paths; real route titles unaffected. |
| SM41 | ✅ **FIXED** | ui | `/profile` | "Support Fandex" renders **twice** — once in the link grid ("Help cover the running costs") and again in the `LegalLinks` footer directly below. **FIX:** `LegalLinks`/`LegalFooter` gained `showSupport` (default **true**, so the sign-in dialog and legal pages are untouched) and `/profile` passes `false` — it keeps the grid row, which has a hint line the footer copy lacks. Verified the default still renders exactly one ko-fi link on `/legal/en/privacy` and `/legal/de/imprint`. |
| SM42 | ✅ **FIXED** | plan | Plan staleness (B block) | `/api/settings` GET → **405** (not the 401 the plan expects) and `POST /api/discover` → **405** (GET-only now). Not product bugs, but the plan's anon-401 probe for `/api/settings` therefore verifies nothing — checklist items 10–11 rewritten in `smoketest.md`: use `/api/library` + `/api/insights` as the anon-401 probes, and note that `POST /api/watchlist` returning **401** (not 400) on junk is correct — auth is checked before validation. |

**Held up well (verified live, anon + authed):** every route title correct on hard load — **SM26's `/settings` and `/discover` title bugs are fixed**; `/dashboard` → 308 → `/wishlist`; the imprint serves `noindex, nofollow, noarchive, nosnippet` and stays out of the 2,019-URL sitemap; `robots.txt` serves real content (SM7 still fixed). **SM8 back-button passes** — anon `/discover` → Calendar → `/` gives `history.length` **+1, not +2**, and Back returns to `/discover`. **SM19's render cap holds exactly at 300 cards / 6,539 DOM nodes** (was 2,014 / 44.5k). **13d passes fully** — the Wishlist tab sets `?tab=wishlist` while `location.pathname` stays `/library`, `h1` → "Wishlist", `document.title` deliberately unchanged, header count tracks the tab ("SAVED · 96", matching `user_watchlist`=96 in the DB). Library default sort is "Recently added" (13b). **Insights reconciles exactly** — type tiles 913+233+447 = **1593** = "Rated items", and the rating histogram sums to **1593** too. Mobile 375px: one visible nav (375×53), slots 75×52, **no horizontal overflow**. Console: only the known SM6 401 noise. **All three Ko-fi surfaces live** (support page, sign-in dialog, `/profile`) as direct outbound `<a href>`, no Fandex-hosted redirect.

**The RAWG-outage findings are the valuable half — all three 2026-08-02 single-source bugs are FIXED and now verified under a real outage** (the exact condition that exposed them): `/api/discover` browse returned 40 igdb + 40 tmdb; **`?section=games&page=2` (the load-more path, SM35) returned 40 igdb rather than `[]`**; **`/api/home` served 17 igdb games (SM36)**; and the breaker did its job — `/api/home` answered in **0.12 s** instead of the 60 s-per-call the pre-breaker code cost. Not covered: `/api/calendar/popular` is auth-gated (401 anon) and wasn't reachable in the anon pass.

**Verified NOT a bug:** `/library`'s "All · 2007" vs Insights' "1914 in library" — the All tab is the library ∪ wishlist union (1914 + 96 − 3 overlapping = 2007); the two figures measure different sets.

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
