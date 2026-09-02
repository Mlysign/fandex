# Fandex: Status

_Your index of every game, movie & show._ · **This file is current STATE only.** Open work in detail → [TASKS.md](TASKS.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it, don't read it). Every load-bearing rule → [AGENTS.md](AGENTS.md).

_Last updated: **2026-09-02**. State only, per the doc conventions in AGENTS.md: what is true now, not what happened when. The session-by-session story lives in git log and [the archive](docs/archive/history.md)._

> **Settled calls and standing constraints → [docs/decisions.md](docs/decisions.md).** Every line there is closed; re-opening one wastes Nils’s time. A decision is not a task, which is why they no longer live in TASKS.md.

---

## ▶ What's open

| | Item | Blocked on |
|--|------|--|
| 🟠 | **Games are now IGDB-ONLY, and IGDB is the one with the open licence question** | **Nobody today, but know the shape.** RAWG was **retired 2026-09-02** after answering `401` continuously since 2026-08-20 (its monthly quota never reset), so the second games provider is gone and the "two providers per medium" invariant is deliberately retreated from. ⚠️ **That makes `IGDB_ENABLED=0` a bigger lever than it was**: flipping it now takes games' browse to nothing rather than halving it. `withCatalogFallback` serves stored rows during an outage, which is what makes it survivable. The licence question itself is **parked** (Nils, 2026-09-02: revisit only if Fandex monetizes) — the Twitch DSA allows a 24-hour cache or prior written authorization while IGDB ships webhooks for keeping your copy current. `scripts/purge-igdb.mjs` is proven on a copy. ⚠️ RAWG's own 603 stored links stay: 16 games are RAWG-only and all 16 are in the library, so nothing deletes them. → [docs/decisions.md](docs/decisions.md), [PLATFORMS.md](PLATFORMS.md) |
| 🟢 | **The filter groups collapse now (SM53)** | **Nobody. 2026-09-02.** The calendar's sticky bar went **175px → 65px** at 375×812 (22% of the viewport → 8%). Three groups, one 40px chip each, expanding on tap: `TypeFilter` **site-wide** (it renders from one place, which is what made Nils's consistency requirement one change rather than five), `ScopeFilter`, and the calendar's view toggle — which stopped being a labelled pill in SubBar's sort row and took that whole row with it. Hit-tested at 320 and 375, one outcome per target, page still never scrolls. ⚠️ **The type filter now costs a tap on Home and Discover too**; whether desktop should stay expanded is the one open question → [TASKS.md](TASKS.md) item 2. |
| 🟡 | **`/library` + `/wishlist` + `/settings` + facet pages dead under `next dev`** | **Your call** which fix (see TASKS.md). Prod is unaffected; verify those pages on the `prod` launch config meanwhile. ⚠️ **Still reproducing 2026-08-27**, and `/settings` joined the list that day (`main` 0 React fibers, `body` 2, so anon and authed both render the signed-in chrome with everything empty). The 2026-08-18 "may be fixed" note is settled: it is not. |
| 🔵 | **H3: monetization, now ADS-FIRST** | **Nobody, yet.** The next move is traffic, not a signup. Affiliate demoted; GOG is one optional email. → [docs/monetization-go-live.md](docs/monetization-go-live.md) |
| ⏸️ | **P15/P16: Android TWA, built and installed, then PAUSED** | ⏸️ **Nils, 2026-08-23**, until the developer account is upgraded Personal → Business. ⚠️ The 12-testers/14-days gate applies to **PERSONAL** accounts only, so a closed test now is likely throwaway work: upgrade first, then re-check whether the gate applies at all. → [TASKS.md](TASKS.md) item 3 |
| 🟢 | **`CATALOG_BROWSE=1` is ON, and the catalog feed is now sortable** | **Nobody. 2026-09-02.** ⚠️ **The switch is INERT today and that is expected**: the gate is `window >= 200` and the real counts are `past` **114 / 22 / 196**, `future` **37 / 25 / 72**. (An earlier reading of 426/342/199 in this session was WRONG; the exact query the gate runs was re-checked against prod.) Games is closest. It engages by itself when a window crosses, which is why it is set in advance rather than watched. **Migration 27 is the substantive half**: `media_items.vote_count` / `vote_average` / `stats_at`, filled by a bounded background pass from links already on disk at **zero provider calls**, so a catalog-served card carries real crowd numbers instead of `voteCount: 0`. Without it the client's Popularity sort would have tied every catalog row at zero and shown arrival order under a control labelled "Popularity", the 2026-08-29 search bug again. Watch `/api/health` → `catalog.stats` `{total, computed, stale}`. → [AGENTS.md](AGENTS.md), `src/lib/itemStats.ts` |
| 🟠 | **The catalog's FUTURE windows can never fill. Needs a decision** | **You.** Catalog growth itself is done and its wins hold: `find()` warm **384–610 → 32 ms**, a warm request's heap **109.6 → 39.9 MB**, a 10-item ingest **87 ms rebuild → 5 ms patch**, all byte-identical. What is dead is "just wait, then flip one env var": `future` is **37 / 25 / 72** against a `min` of 200 and all three lanes are `exhausted`. Structural, not stalled — TMDB is asked with `region=DE` **and** `with_release_type=2\|3`, so it genuinely ran out at 409, and the backfill queries the provider's REGIONAL date while the catalog stores the MERGED one, so items fetched as "future" land in the past window. **Resetting the lanes re-walks the same set.** Three options in [TASKS.md](TASKS.md) item 1. ⚠️ Two loose ends: `game:past` retired at page 1 with 0 added (RAWG quota-latched), and **`resetBackfill()` is wired to nothing**, so no lane can be revived on prod at all. |
| 🟡 | **Facet pages link only titles we already hold** | **Nobody.** `/person/christopher-nolan` links 13 of 60. That is UNDER-LINKING, not a rendering bug, and facet pages stay out of the sitemap until it is fixed. → [docs/seo.md](docs/seo.md) |
| 🟡 | **The list import's CSV headers are unconfirmed** | **Nobody**, but it wants a REAL Letterboxd export. The parser is header-driven and fails loudly rather than silently, so a rename is survivable; the names came from secondary sources. → [docs/letterboxd-import.md](docs/letterboxd-import.md) |

## 🟢 Prod

fandex.org is **up, serving, and running `main`'s HEAD**, continuously since **2026-08-12**.

- **Litestream is the ONLY copy of the database.** Railway volume backups are Pro-plan only (re-confirmed 2026-08-20: the Backups tab reads "No Backups"). There is no second net.
- **The restore drill PASSED 2026-09-01 and is NOT due.** Run over `railway ssh`, so any future session can repeat it without Nils. Generation `c62d7dc17a0fd0cb`, replication lag **369 ms**, snapshot + **475 WAL files** replayed, restored file **byte-for-byte the size of live**, `integrity_check ok` on both, **all eight tables identical**. Covers migrations 23–26. ⚠️ **Re-run it after the next schema change** — a drill proves the backup you had that day. Commands → [TASKS.md](TASKS.md), the SM50 item.
  - Two checks that need no container and catch the way this has actually broken: **the schema carries nothing Litestream's older SQLite would reject** (zero aggregate-with-`ORDER BY`, no `string_agg`/`concat()`/`jsonb_*`/`GENERATED`/`STRICT`; all four schema `ORDER BY`s sit in a subquery), and **the real upgrade path applies clean** (a July backup copy went `user_version` **6 → 28** via `node scripts/migrate.mjs`, `integrity_check ok`). Green tests never exercise the second, since every DB test starts fresh.
- **No prod sweeps are outstanding.** Steam cross-link ran 2026-08-17, Wikidata franchise 2026-08-14. ⚠️ **`PRUNE_ON_BOOT` is NOT SET on Railway**, checked 2026-09-02, so the boot prune runs on every deploy at its default. That is the locked decision working as intended, not a gap — but this line used to imply the switch was set to 0, which it is not. Measured the same day: **0 rows prunable right after a boot** (4,266 `browsed = 0`, and all 259 `browsed = 1` rows pinned by user state or a snapshot), so it is not eating the backfill. The real cost is deploy churn: rows added and not yet enriched when a restart lands are swept.
- **A push that doesn't reach prod is a CI problem until proven otherwise.** Railway has Wait-for-CI ON, so a red CI silently blocks every deploy and `uptime` climbs straight through it. Check `gh run list --workflow=ci.yml` first. This has bitten twice, both times `npm audit` going red against an **unchanged** dependency tree.
- **Watch that it STAYS up.** The app never crashed in either historical outage: `uptime` climbed monotonically, so it was **un-routed**, which reads as a billing action rather than a technical one.

## 🟡 `/library`, `/wishlist`, `/settings` and the FACET pages do not work under `next dev` (DEV ONLY)

**Production is unaffected** and this was never user-facing. It does mean **those pages cannot be developed or verified against the dev server**, which is why it went unnoticed: the smoke sweeps run against prod.

Under `next dev` the pages render their toolbar server-side and then sit on "Loading…" forever: React never hydrates the `<main>` subtree, no effect runs, and clicking a tab does nothing. For `/library` and `/wishlist` the cause is measured: `useSearchParams()` postpones the Suspense boundary (React comment marker `$~`) and the dev client never resumes it.

⚠️ **It is wider than that, and the cause is NOT established.** `/tag/cyberpunk` behaves identically under `next dev` (zero item links, no `__react*` keys on `<main>`) while the same page on a `next start` build renders 60, and that page never calls `useSearchParams()`. Recorded as a measurement, not a diagnosis.

⚠️ **A contradicting observation, 2026-08-18: `/wishlist` hydrated and rendered real items under `next dev`.** One page, one session, and that session also added a state branch to `MyStuffView`. **Re-check both pages under `next dev` before spending any time on the three options in TASKS.md**: the bug may be gone, or intermittent, which would change which fix is right.

⚠️ **`/settings` joined the list on 2026-08-27** (`main` 0 React fibers, `body` 2, `nav` 2), and it has a second symptom worth knowing: the effect never runs, so the page renders the SIGNED-IN chrome with every field empty — four "Connect" buttons and "Watchlist items 0" for an account that has all four providers connected and 95 items. **That reads as data loss, not as a dead page.** It is the same `useSearchParams()` + Suspense shape as `/library` and `/wishlist`, and prod is correct (verified the same day, both auth states). `/insights` and `/profile` hydrate fine under dev.

**The practical rule, unchanged and now wider: verify any page whose content is client-rendered against the `prod` launch config (:3100), not the dev server.**

## 🎛️ Two per-user preferences, and the line they must not cross (2026-08-27)

**Settings → What you track** (`users.media_types`, migration 25) and **Settings → Your platforms**
(`users.platforms`, migration 24). Both filter what a person SEES.

- **What you track** hides a media type from the chip row and from every list that reads it. One
  injection point (`availableTypes`) covers Home, Discover, Calendar, Library and Wishlist, because
  they already share one `rr_type_filter` key. Measured with Games off: 0 game links on all four,
  Library 1,942 → 1,212; back on restores 239 links and 1,942.
- **Your platforms** narrows the "Available on" filter to what you own: **185 chips to 2** on the
  live library. Its option list is surveyed from the user's OWN catalog, because a curated global
  list misses every regional service he actually subscribes to. That survey now also FEEDS the
  filter sheet, so a service with nothing loaded on it shows a **0** instead of disappearing —
  which is what made Discover look like it had lost its streaming half.
  → [docs/advanced-filters.md](docs/advanced-filters.md) §6.

⚠️ **THREE LAYERS MUST NEVER SEE EITHER**, and each fails differently: a **sync pull** (the prune
invariant would DELETE every matching row), the **snapshots** (viewer-independent by contract, and
they feed the SSR'd `/`), and the **Fandex Score** (every facet weight is a deviation from the
global rating baseline, so dropping a type moves the score of everything else). Public item and
facet pages render normally for a disabled type: a per-user 404 would 200 for a crawler and 404 for
a visitor. → [[user-display-preferences]]

⚠️ **`NULL` / `[]` means NOT CONFIGURED for both**, which yields everything. "Owns nothing" and
"uses no media type" are deliberately inexpressible.

**Built for the next media type.** `MEDIA_TYPES` is derived from a `Record<MediaType, string>`, so
adding `"book"` is a build error rather than a silently-empty chip. The full enumeration-point map
and the per-surface provider cost are in [docs/advanced-filters.md](docs/advanced-filters.md).


## 🧭 Monetization: ads-first since 2026-08-19

**Nils's call: go live → wait for traction → ads → premium (ad-free + extras).** Affiliate is **demoted, not cancelled**, and the code stays built and dark behind `MONETIZATION_ENABLED`. The old plan (seven affiliate signups, GOG first) is retired.

The model that decided it, per **1,000 monthly active users**: **ads ~€150 · premium ~€60 · donations ~€14 · affiliate ~€3.** Affiliate is last by 20 to 50 times for reasons specific to this app: Fandex is **past-tense** (a buy link arrives after the purchase decision), only **GOG** appears in the catalog at all (295 of 1,033 games; six of seven programs appear on **zero** items), and Amazon pays **1%** on video games. The settling argument: covering upkeep once TMDB's $149/mo commercial tier applies takes ~1,000 users on ads and **~45,000 on affiliate**, so affiliate is the only method that cannot clear its own cliff.

Both H3.8 gates are measurable now rather than theoretical. Full reasoning and the standing guard against self-referring → [docs/monetization-go-live.md](docs/monetization-go-live.md).

**Two admin dashboards are live and self-hosted**, behind the `SCORING_ADMIN_USER_IDS` allowlist: `/dev/analytics` (pageviews/30d vs the 10,000 ads gate, signed-in WAU vs the 3,500 freemium gate, the anon-vs-signed-in split) and `/dev/users` (audience, read from rows that already exist and storing nothing). No Google Analytics, no third-party script, no cookie, no IP stored. ⚠️ **Counts before 2026-08-21 are excluded, not merely "not comparable"** (2026-08-31): the beacon read ~80% crawler until it was filtered by user agent, and every read on the page now starts at the first clean day. That moved the ads gate from **62% to 4%** without a single counter changing, because 5,792 of prod's 6,208 pageviews were pre-filter and 5,769 of those were one crawl day. The excluded figure is still shown, labelled. `/dev/analytics` and the hub's `runsTotal` now agree. A **crawler-rejection counter** (migration 26) sits beside the pageview count so the filter is falsifiable: a share near 0 means it stopped matching, near 100 means it is eating real visitors. "How often do they use the app" has **no exact answer in this schema**, so `/dev/users` reports three labelled proxies rather than inventing a frequency.

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

**Money: going commercial is ~$149/mo minimum** (TMDB), against a model of ~€150 per 1,000 monthly actives. ⚠️ **Was ~$298 until 2026-09-02**, when RAWG was retired and its $149 tier stopped being a future cost. OMDb was **removed** rather than paid for, and RAWG went the same way. **The cheapest real fix is engineering, not payment.**

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

## ✅ Quality bar (re-run and confirmed 2026-09-01, end of session)

**1,347 tests pass** (127 files, 1 skipped) · `npx tsc --noEmit` clean · `npm run lint` **0 errors** · `npm run build` clean. **This is the standing bar. Don't land work below it.**

⚠️ **`npm audit` is RED again as of 2026-09-01, and CI is green, and both are correct.** Third instance of the pattern below: two new advisories against `browserslist <=4.28.6` (GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g) on a tree nobody changed. **It does NOT block the deploy**, verified rather than assumed by running CI's exact command: `npm audit --audit-level=high --omit=dev` answers `found 0 vulnerabilities`, because browserslist reaches this repo only as `eslint-config-next → eslint-plugin-react-hooks → @babel/core → browserslist`, which is entirely devDependency. **So check with CI's flags before reacting**: a bare `npm audit` includes dev and will read red while the deploy is perfectly fine.

⚠️ **Expect `npm audit` to go red again on an UNCHANGED tree.** It has now happened three times, and the two before this one were an advisory published after the last green run widening to cover the exact version an override pinned. Those two **did silently block the Railway deploy**; this one does not. The current fix uses two *nested* overrides (`1.1.18` under `eslint`, `5.0.9` under `@typescript-eslint/typescript-estree`) because the two consumers need different major lines and one flat override cannot satisfy both. **Pinning an exact version is a bet that the next advisory won't include it.**

**Dependencies were current as of 2026-08-14**: `next` 16.3.0, `react` 19.2.8, `jose` 6.2.8, `@types/node` 26, CI on `actions/checkout@v7` + `setup-node@v7`. Merged after a full local bar *plus* a real JWT sign/verify round-trip, because `jose` is the session library and the suite never exercises a live token.

**`simple-icons` is a devDependency and nothing in the shipped app imports it.** It feeds `scripts/gen-brand-marks.mjs`, which extracts 11 brand paths into the committed `src/lib/brandMarks.ts`. Re-run it after adding a store-link name; it throws on an unknown slug rather than silently skipping a brand.

---
_✅ done · 🔵 needs input / in progress · ⏸️ blocked · 🟢 later · 🔴 broken_
