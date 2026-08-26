# Fandex: Status

_Your index of every game, movie & show._ · **This file is current STATE only.** Open work in detail → [TASKS.md](TASKS.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it, don't read it). Every load-bearing rule → [AGENTS.md](AGENTS.md).

_Last updated: 2026-08-26 (12th smoke test: two 🟠 added below, SM49/SM50; no code changed). Previously 2026-08-26, hygiene pass._

> **Ten decisions were locked on 2026-08-17.** Impressum approved, affiliate signups unparked (**superseded 2026-08-19: ads-first, affiliate demoted**), H3.0 closed as won't-do, the Score's 0–100 range relabelled as a target rather than re-tuned, H3.8 approved, `PRUNE_ON_BOOT` stays on, Score tuning approved as-is. **They are settled: see the top of [TASKS.md](TASKS.md) and don't re-open them.**

---

## ▶ What's open

| | Item | Blocked on |
|--|------|--|
| 🟠 | **The Library tab renders its whole list on the route the nav links to** (SM49) | **Nobody.** `capRender` gates on `route === "library"`, so `/wishlist?tab=library` skips SM19's 300-card cap: 1,929 cards / 40,748 DOM nodes / 120,583px on the prod build, against 300 / 6,519 / 18,976 for the identical view at `/library`. `AppNav` has no `/library` link, so the uncapped route is the one people reach. One-line fix, not yet made. → [TASKS.md](TASKS.md) |
| 🟠 | **Three Trakt SHOWS are merged onto MOVIE catalog rows** (SM50) | **Nobody**, but it is on a public page: `/movie/being-john-malkovich` serves "Official site" → `spongebob.nick.com` and a Trakt link to the show. Also House of Cards → Ratatouille, Legion → The Raid 2. 249 episode-watch rows sit on movies; the real show rows have 0 progress. 3 of 2,734 items. ⚠️ Root cause in `matcher.ts` is **not** diagnosed — main-loop work. → [[cross-type-identity-merge]] |
| 🟡 | **`/library` + `/wishlist` + facet pages dead under `next dev`** | **Your call** which fix (see TASKS.md). Prod is unaffected; verify those pages on the `prod` launch config meanwhile. ⚠️ **Still reproducing on 2026-08-26** (`/library` hard load under `next dev`: `main` 0 React fibers, `nav` 2), so the 2026-08-18 "may be fixed" note is settled — it is not. |
| 🔵 | **H3: monetization, now ADS-FIRST** | **Nobody, yet.** The next move is traffic, not a signup. Affiliate demoted; GOG is one optional email. → [docs/monetization-go-live.md](docs/monetization-go-live.md) |
| ⏸️ | **P15/P16: Android TWA, built and installed, then PAUSED** | ⏸️ **Nils, 2026-08-23**, until the developer account is upgraded Personal → Business. ⚠️ The 12-testers/14-days gate applies to **PERSONAL** accounts only, so a closed test now is likely throwaway work: upgrade first, then re-check whether the gate applies at all. → [TASKS.md](TASKS.md) item 1 |
| 🟡 | **RAWG monthly quota exhausted** | **Nobody.** PL3 shipped 2026-08-23, so the facet paths no longer touch RAWG. ⚠️ **Re-measure when the window resets**: a cold `/tag/` page should now cost 10 provider calls, not 14. ⚠️ **What SPENT the quota is still unidentified**, and the obvious answer is unproven, because every RAWG figure we hold was measured *after* the quota was gone. The 401/403 latch makes next month's counter readable. |
| 🟡 | **Facet pages link only titles we already hold** | **Nobody.** `/person/christopher-nolan` links 13 of 60. That is UNDER-LINKING, not a rendering bug, and facet pages stay out of the sitemap until it is fixed. → [docs/seo.md](docs/seo.md) |
| 🟡 | **The list import's CSV headers are unconfirmed** | **Nobody**, but it wants a REAL Letterboxd export. The parser is header-driven and fails loudly rather than silently, so a rename is survivable; the names came from secondary sources. → [docs/letterboxd-import.md](docs/letterboxd-import.md) |

## 🟢 Prod

fandex.org is **up, serving, and running `main`'s HEAD**, continuously since **2026-08-12**.

- **Litestream is the ONLY copy of the database.** Railway volume backups are Pro-plan only (re-confirmed 2026-08-20: the Backups tab reads "No Backups"). There is no second net.
- **The restore drill PASSED 2026-08-23**, `ALL TABLES MATCH` on all eight, including the 10,841 `franchise_members` rows written the same day. ⚠️ **It is due again after the NEXT schema change.** A drill proves the backup you had that day, not the one you have now.
- **No prod sweeps are outstanding.** Steam cross-link ran 2026-08-17, Wikidata franchise 2026-08-14. `PRUNE_ON_BOOT=0` is a preference now, not a precaution: the guard has held three times.
- **A push that doesn't reach prod is a CI problem until proven otherwise.** Railway has Wait-for-CI ON, so a red CI silently blocks every deploy and `uptime` climbs straight through it. Check `gh run list --workflow=ci.yml` first. This has bitten twice, both times `npm audit` going red against an **unchanged** dependency tree.
- **Watch that it STAYS up.** The app never crashed in either historical outage: `uptime` climbed monotonically, so it was **un-routed**, which reads as a billing action rather than a technical one.

## 🟡 `/library`, `/wishlist` and the FACET pages do not work under `next dev` (DEV ONLY)

**Production is unaffected** and this was never user-facing. It does mean **those pages cannot be developed or verified against the dev server**, which is why it went unnoticed: the smoke sweeps run against prod.

Under `next dev` the pages render their toolbar server-side and then sit on "Loading…" forever: React never hydrates the `<main>` subtree, no effect runs, and clicking a tab does nothing. For `/library` and `/wishlist` the cause is measured: `useSearchParams()` postpones the Suspense boundary (React comment marker `$~`) and the dev client never resumes it.

⚠️ **It is wider than that, and the cause is NOT established.** `/tag/cyberpunk` behaves identically under `next dev` (zero item links, no `__react*` keys on `<main>`) while the same page on a `next start` build renders 60, and that page never calls `useSearchParams()`. Recorded as a measurement, not a diagnosis.

⚠️ **A contradicting observation, 2026-08-18: `/wishlist` hydrated and rendered real items under `next dev`.** One page, one session, and that session also added a state branch to `MyStuffView`. **Re-check both pages under `next dev` before spending any time on the three options in TASKS.md**: the bug may be gone, or intermittent, which would change which fix is right.

**The practical rule, unchanged and now wider: verify any page whose content is client-rendered against the `prod` launch config (:3100), not the dev server.**

## 🧭 Monetization: ads-first since 2026-08-19

**Nils's call: go live → wait for traction → ads → premium (ad-free + extras).** Affiliate is **demoted, not cancelled**, and the code stays built and dark behind `MONETIZATION_ENABLED`. The old plan (seven affiliate signups, GOG first) is retired.

The model that decided it, per **1,000 monthly active users**: **ads ~€150 · premium ~€60 · donations ~€14 · affiliate ~€3.** Affiliate is last by 20 to 50 times for reasons specific to this app: Fandex is **past-tense** (a buy link arrives after the purchase decision), only **GOG** appears in the catalog at all (295 of 1,033 games; six of seven programs appear on **zero** items), and Amazon pays **1%** on video games. The settling argument: covering upkeep once TMDB's $149/mo commercial tier applies takes ~1,000 users on ads and **~45,000 on affiliate**, so affiliate is the only method that cannot clear its own cliff.

Both H3.8 gates are measurable now rather than theoretical. Full reasoning and the standing guard against self-referring → [docs/monetization-go-live.md](docs/monetization-go-live.md).

**Two admin dashboards are live and self-hosted**, behind the `SCORING_ADMIN_USER_IDS` allowlist: `/dev/analytics` (pageviews/30d vs the 10,000 ads gate, signed-in WAU vs the 3,500 freemium gate, the anon-vs-signed-in split) and `/dev/users` (audience, read from rows that already exist and storing nothing). No Google Analytics, no third-party script, no cookie, no IP stored. ⚠️ **Counts before 2026-08-20 are not comparable to later ones**: the beacon was reading ~80% crawler until it was filtered by user agent, and the real human figure is two digits. "How often do they use the app" has **no exact answer in this schema**, so `/dev/users` reports three labelled proxies rather than inventing a frequency.

## 🔎 Organic reach

**Ads-first means the bottleneck is traffic.** The reference, the numbers, and what remains → **[docs/seo.md](docs/seo.md)**.

- **Search Console is VERIFIED**, `fandex.org` as a Domain property via a DNS TXT record on the apex. ⚠️ **Deleting that record un-verifies the property and empties every report.**
- **Structured data is live** on item pages (`Movie` / `TVSeries` / `VideoGame` + `BreadcrumbList`) and calendar months (`ItemList`), where there was previously zero `ld+json` across 2,022 indexable pages.
- **The homepage is no longer a crawl dead end**: `/` serves **94 server-rendered links** at **0 provider calls per view**.
- **`/calendar/{YYYY-MM}`** is server-rendered, eight months in the sitemap, with three crawl bounds.
- **Thin facet pages are `noindex, follow`** below 3 pooled titles.
- ⚠️ **Still open:** facet pages link only the titles we already hold (see the table above).

⚠️ **Three stale claims in this file and docs/seo.md were corrected in three days** (item-page sibling rails, and twice on what facet pages server-render: they render 35–40 links, not zero). **Check the code before planning work around a documented gap.**

## ⚡ The daily snapshots (2026-08-26)

**`home_snapshot` (migration 21) and `calendar_snapshot` (migration 22) each hold a whole page, built once a day, so a visitor or a crawler costs zero provider calls.** The rules each builder holds are stated in [AGENTS.md](AGENTS.md) and commented in `src/lib/homeSnapshot.ts` / `src/lib/calendarSnapshot.ts`. Measured:

| Surface | before | after |
|---|---|---|
| `/` server-rendered internal links | 74 | **94** |
| 6 loads of `/` | a fan-out per cold cache entry | **0 provider calls** |
| paging 11 calendar months, signed in | 10.4 s, 33 calls | **1.3 s, 0 calls** |
| a month, first hit on a fresh process | 1.24 s | **12–20 ms** |
| linkable items on `/calendar/2026-09` | 8 of 15 | **15 of 15** |

## ⚠️ Scalability: provider quotas are the ceiling, and CRAWLERS spend them

**Measured, not estimated** → [docs/scalability.md](docs/scalability.md) · per-platform cost and licence → [PLATFORMS.md](PLATFORMS.md). `/api/health` reports **`providerCalls`** per host, which is what makes any of this answerable.

**Money: going commercial is ~$298/mo minimum** (TMDB $149 + RAWG $149) against a model of ~€150 per 1,000 monthly actives. ⚠️ **RAWG's paid tier does not fix RAWG** (2.5× the free quota). OMDb was **removed** rather than paid for. **The cheapest real fix is engineering, not payment.**

⚠️ **~20 module-level caches beyond `http.ts` plausibly duplicate per bundle, and that is NOT yet measured.** If they do, retained memory is a multiple of the budgeted figure and hit rates are lower than assumed.

## 🗺️ Roadmap

| Area | Status |
|------|:--|
| Hosting + deploy (Railway) | ✅ built · 🟢 up since 2026-08-12 |
| Domain + OAuth + email (fandex.org) | ✅ |
| Backups (Litestream → Railway bucket) | ✅ 24h retention, v0.3.13 |
| Observability (`/api/health`, structured logs) | ✅ incl. `openProviderCircuits` + `providerCalls` |
| Security (S1–S13, CSP enforced) | ✅ |
| Sync completeness + TMDB enrichment | ✅ |
| SEO: public item pages (P13) + facet pages (P17) | ✅ live + fully indexed |
| **H1** UI/UX overhaul (mobile-first) | ✅ 2026-07-27. Direction 2a "Ticket · Calm" → [docs/design/fandex-handoff/](docs/design/fandex-handoff/) |
| **H2** data-model hardening | ✅ |
| **H5** Fandex Score | ✅ 2026-07-27 incl. calibration; franchise/IP added 2026-08-14 → [docs/fandex-score.md](docs/fandex-score.md) |
| **H4** legal & compliance | ✅ 2026-08-03, epic closed |
| **H3** monetization | 🔵 ads-first since 2026-08-19; donations live, affiliate built + dark + demoted |
| **PL** platform capability sweep | ✅ all six shipped 2026-08-23 |
| **MB** mobile batch | ✅ 15/15, 2026-08-17 |
| **AN** anonymous surface | ✅ 2026-08-18 |
| Android TWA (P15/P16) | ⏸️ built + running on-device; paused on the account upgrade → [docs/twa-play-store.md](docs/twa-play-store.md) |
| **SEO / organic reach** | 🔵 open since 2026-08-20; one hole left (facet under-linking) → [docs/seo.md](docs/seo.md) |

## ✅ Quality bar (re-run and confirmed 2026-08-26)

**1,049 tests pass** (101 files, 1 skipped) · `npx tsc --noEmit` clean · `npm run lint` **0 errors** · `npm run build` clean · `npm audit` 0 vulnerabilities. **This is the standing bar. Don't land work below it.**

⚠️ **Expect `npm audit` to go red again on an UNCHANGED tree.** It has happened twice, both times an advisory published after the last green run widening to cover the exact version an override pinned, and **it silently blocks the Railway deploy**. The current fix uses two *nested* overrides (`1.1.18` under `eslint`, `5.0.9` under `@typescript-eslint/typescript-estree`) because the two consumers need different major lines and one flat override cannot satisfy both. **Pinning an exact version is a bet that the next advisory won't include it.**

**Dependencies were current as of 2026-08-14**: `next` 16.3.0, `react` 19.2.8, `jose` 6.2.8, `@types/node` 26, CI on `actions/checkout@v7` + `setup-node@v7`. Merged after a full local bar *plus* a real JWT sign/verify round-trip, because `jose` is the session library and the suite never exercises a live token.

**`simple-icons` is a devDependency and nothing in the shipped app imports it.** It feeds `scripts/gen-brand-marks.mjs`, which extracts 11 brand paths into the committed `src/lib/brandMarks.ts`. Re-run it after adding a store-link name; it throws on an unknown slug rather than silently skipping a brand.

---
_✅ done · 🔵 needs input / in progress · ⏸️ blocked · 🟢 later · 🔴 broken_
