# Fandex: Status

_Your index of every game, movie & show._ · **This file is current STATE only.** Open work in detail → [TASKS.md](TASKS.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it, don't read it). Every load-bearing rule → [AGENTS.md](AGENTS.md).

_Last updated: 2026-08-29. **Discover's search could not find a new title by name, and now can.** Two independent faults on one path, either of which alone hid it. The search branch of `/api/discover` was the ONLY feed that never ran `decorateSection`, so every provider result reached the client with no `communityVotes`; the Popularity sort tied them all at zero and, being stable, served `sortByDate`'s ASCENDING order — an oldest-first list under a control reading Popularity. And `dedupeWeb` keyed titles with no year, so a second work sharing a name was dropped silently, always the newer one because the list arrives oldest-first. Searching "Lucky" therefore put a 1959 show in slot one and discarded the 2026 one before rendering. ⚠️ **Not verified against live providers** — the container had no provider keys, so "it now ranks near the top" is a prediction from a mocked path; one search on prod settles it. What is left is a ranking call for you: there is still no relevance term anywhere in search. Also 2026-08-29: **Fandex can now report its own KPIs to the portfolio hub.** `GET /api/telemetry/kpi` is a second, narrow door beside the session-gated `/dev/analytics`: a key in `X-BW-Admin`, compared in constant time, 404 for everybody without `KPI_READ_KEY`, which is set in Railway as of today. The gate was re-verified from outside AFTER a valid key existed, which is the check that actually proves it: no header, a wrong key and an empty header value all still 404. The one judgement call in it is worth knowing: `runsTotal` counts only from 2026-08-21, the first whole day the crawler filter was running, and reports the ~80%-bot era before it as `simRuns`. Previously (2026-08-28): **The Filters sheet works on all three My Stuff tabs now.** Wiring the Progress tab's toolbar exposed that person, studio and franchise pills had matched NOTHING on Library and Wishlist since July: both routes now ship server-computed `facetIds` and the client-side derivation is deleted, so "Rebecca Ferguson" goes from 0 titles to 5. Pricing that payload turned up the bigger thing — **`/api/*` responses are not compressed at all**, so `/api/library` is 8.63 MB where it could be ~2.0 MB (see the table). **Catalog growth is DONE and the backfill is RUNNING on prod.** All five phases shipped over 2026-08-27/28; the plan doc is now a short runbook → [docs/catalog-growth.md](docs/catalog-growth.md), with every measurement and the phase history in [the archive](docs/archive/history.md). Nothing on a request path scales with the catalog any more: `find()` warm 384–610 → 32 ms, a warm request's heap 109.6 → 39.9 MB. **The only thing left is waiting** for the browse windows to fill. Also 2026-08-27: the 12th smoke test worked through, the filter sheet rebuilt, and the Your platforms / What you track settings._

> **Ten decisions were locked on 2026-08-17.** Impressum approved, affiliate signups unparked (**superseded 2026-08-19: ads-first, affiliate demoted**), H3.0 closed as won't-do, the Score's 0–100 range relabelled as a target rather than re-tuned, H3.8 approved, `PRUNE_ON_BOOT` stays on, Score tuning approved as-is. **They are settled: see the top of [TASKS.md](TASKS.md) and don't re-open them.**

---

## ▶ What's open

| | Item | Blocked on |
|--|------|--|
| 🟡 | **IGDB runs behind a kill switch while the licence question is open** | **You, when they reply.** The provider terms were read 2026-08-28 from the primary sources (§17). TMDB is fine — its cap is on cache AGE (six months), which a refresh tier satisfies, and **nothing was enforcing it** until today (`lib/retention.ts`; the first silent breach would have been ~2026-12-02). Steam states no limit. **IGDB does not resolve on its own**: the Twitch DSA allows a 24-hour cache or prior written authorization, and we already hold 1,008 igdb links indefinitely — yet IGDB's own API ships webhooks whose only purpose is keeping your copy current. **Nils's call 2026-08-28: keep going, with a switch.** `IGDB_ENABLED=0` stops every IGDB call at once (default ON) and `scripts/purge-igdb.mjs` removes what is stored — proven on a copy: 1,008 links and 908 projections gone, **all 2,770 items and all 2,482 user rows untouched**, 100 items would be left source-less and none of them are acted on. Still worth asking `partner@igdb.com` whether a webhook-refreshed local mirror is covered by the free tier. → [TASKS.md](TASKS.md) "Needs Nils" item 1, [docs/catalog-growth.md](docs/catalog-growth.md) |
| 🟢 | **The portfolio hub's KPI feed is LIVE and keyed** | **Nobody.** `GET /api/telemetry/kpi` answers the shared contract; `KPI_READ_KEY` was set in Railway 2026-08-29 and the URL and var name went back to the Gets session, which writes the PHP proxy. Gate re-verified from outside AFTER the key existed: no header, wrong key and empty header value all 404, so a valid key did not open the door for everybody. ⚠️ `runsTotal` deliberately excludes the pre-2026-08-21 counters (the ~80%-bot era) and reports them as `simRuns`, so the hub's total reads smaller than `/dev/analytics`. That is the honest number, not a bug. → [the archive](docs/archive/history.md), "The portfolio KPI route" |
| 🟠 | **SM50's data repair has not run on PROD** | **Nobody, but it needs a shell on the Railway box.** The code fix is in (migration 23 makes the merge impossible), so nothing NEW can merge there once it deploys. The rows already merged do not fix themselves: run `node scripts/repair-cross-type-links.mjs data/rr.db` (report), then `--apply`. Locally it moved 4 links and scrubbed 4 payloads. ⚠️ **A restore drill is due**: this session added migrations **23, 24 and 25**, and 23 rebuilds a table. → [TASKS.md](TASKS.md) item 7 |
| 🟠 | **`/api/*` responses are not compressed, and `/api/library` is 8.63 MB** | **Nobody.** Found 2026-08-28 while pricing the facet fix. Railway's edge gzips a PAGE and leaves a route handler alone (`GET /discover` → `Content-Encoding: gzip`; `GET /api/discover/facets` → no encoding header), and `next start` locally does the same, so Next's `compress: true` covers pages and static only. **8.63 MB raw → ~2.0 MB gzipped: a 6.6 MB saving on one request**, 5.7× the whole facet fix and more than every field-trimming idea combined. Not bundled into the facet fix because it needs its own verification (streaming, `Content-Length`, Railway re-buffering). → [TASKS.md](TASKS.md) |
| 🟡 | **The Fandex Score's colours disagree between the card and the tooltip** | **Nobody.** `Tooltip.tsx:99` hardcodes gold where the card and the item page both call `fandexScoreColor()`, so the tooltip's number is score-INDEPENDENT: an 88 and a 30 render identically. The last open item from the 12th smoke test. ⚠️ Not purely a bug fix, and the `--color-score-*` tokens are defined but unreferenced. → [TASKS.md](TASKS.md) |
| 🔵 | **Search has no relevance term** (the *Lucky* follow-up) | **Your call**, plus one check on prod. The two real faults are fixed and merged 2026-08-29, but nothing anywhere scores a title against what was TYPED: `find()` is `title.includes(q)` then a global sort, so an exact match on *Lucky* still ranks below *Mr. Lucky* when *Mr. Lucky* has more votes. "Exact match first" overrides all four sorts on the page, so it is a ranking decision rather than a bug fix. ⚠️ **The fix itself is unverified against live providers** — search "Lucky" on prod and confirm the new show is near the top. → [TASKS.md](TASKS.md) item 9 |
| 🔵 | **Calendar filter bar: 22% of a fixed height budget** (SM53) | **Your call.** Not broken, and deliberately unchanged: it is a visual decision on a page already waiting for your eyes. Three options, cheapest first, in [TASKS.md](TASKS.md) item 8. |
| 🟡 | **`/library` + `/wishlist` + `/settings` + facet pages dead under `next dev`** | **Your call** which fix (see TASKS.md). Prod is unaffected; verify those pages on the `prod` launch config meanwhile. ⚠️ **Still reproducing 2026-08-27**, and `/settings` joined the list that day (`main` 0 React fibers, `body` 2, so anon and authed both render the signed-in chrome with everything empty). The 2026-08-18 "may be fixed" note is settled: it is not. |
| 🔵 | **H3: monetization, now ADS-FIRST** | **Nobody, yet.** The next move is traffic, not a signup. Affiliate demoted; GOG is one optional email. → [docs/monetization-go-live.md](docs/monetization-go-live.md) |
| ⏸️ | **P15/P16: Android TWA, built and installed, then PAUSED** | ⏸️ **Nils, 2026-08-23**, until the developer account is upgraded Personal → Business. ⚠️ The 12-testers/14-days gate applies to **PERSONAL** accounts only, so a closed test now is likely throwaway work: upgrade first, then re-check whether the gate applies at all. → [TASKS.md](TASKS.md) item 2 |
| 🟢 | **Catalog growth is DONE; the backfill is running** | **Nobody, just time.** All five phases shipped. Request cost and memory stopped scaling with the catalog: `find()` warm **384–610 → 32 ms**, first request after a rating **397 → 117 ms**, a warm request's heap **109.6 → 39.9 MB**, a 10-item ingest **87 ms rebuild → 5 ms patch**. All output verified byte-identical. **Live on prod since 2026-08-28**: `BACKFILL_ENABLED=1`, `BACKFILL_MAX_ITEMS=15000`, first pass confirmed ingesting. **The next action is one env var**: watch `/api/health` → `catalog.browse.windows` and set `CATALOG_BROWSE=1` per type once its `future` count reaches 200 (was 49/49/29), after which that section costs **zero** provider calls. → [docs/catalog-growth.md](docs/catalog-growth.md) |
| 🟡 | **IGDB RECOVERED; RAWG is still quota-latched** | **Nobody.** Re-measured 2026-08-28 on prod: `api.igdb.com` 9 requests, 8 ok, `lastStatus 200`, circuit closed — so the 2026-08-27 "both games providers down" reading was a transient, not a standing outage. RAWG is unchanged (5 requests, 5 × 401, 277 blocked), which is the known quota latch and no longer touches the facet paths. Games are arriving again. → [TASKS.md](TASKS.md) "Needs Nils" item 3 |
| 🟡 | **RAWG monthly quota exhausted** | **Nobody.** PL3 shipped 2026-08-23, so the facet paths no longer touch RAWG. ⚠️ **Re-measure when the window resets**: a cold `/tag/` page should now cost 10 provider calls, not 14. ⚠️ **What SPENT the quota is still unidentified**, and the obvious answer is unproven, because every RAWG figure we hold was measured *after* the quota was gone. The 401/403 latch makes next month's counter readable. |
| 🟡 | **Facet pages link only titles we already hold** | **Nobody.** `/person/christopher-nolan` links 13 of 60. That is UNDER-LINKING, not a rendering bug, and facet pages stay out of the sitemap until it is fixed. → [docs/seo.md](docs/seo.md) |
| 🟡 | **The list import's CSV headers are unconfirmed** | **Nobody**, but it wants a REAL Letterboxd export. The parser is header-driven and fails loudly rather than silently, so a rename is survivable; the names came from secondary sources. → [docs/letterboxd-import.md](docs/letterboxd-import.md) |

## 🟢 Prod

fandex.org is **up, serving, and running `main`'s HEAD**, continuously since **2026-08-12**.

- **Litestream is the ONLY copy of the database.** Railway volume backups are Pro-plan only (re-confirmed 2026-08-20: the Backups tab reads "No Backups"). There is no second net.
- **The restore drill PASSED 2026-08-23**, `ALL TABLES MATCH` on all eight, including the 10,841 `franchise_members` rows written the same day. ⚠️ **IT IS DUE NOW.** 2026-08-27 added three migrations — 23 (`media_links` rebuilt with `media_type`), 24 (`users.platforms`), 25 (`users.media_types`) — and a drill proves the backup you had that day, not the one you have now. Both apply paths were verified from the pre-23 backup (in-process and `node scripts/migrate.mjs`, idempotent, `integrity_check ok`), which is not the same thing as proving the backup restores.
- **No prod sweeps are outstanding.** Steam cross-link ran 2026-08-17, Wikidata franchise 2026-08-14. `PRUNE_ON_BOOT=0` is a preference now, not a precaution: the guard has held three times.
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

## ✅ Quality bar (re-run and confirmed 2026-08-27, end of session)

**1,105 tests pass** (105 files, 1 skipped) · `npx tsc --noEmit` clean · `npm run lint` **0 errors** · `npm run build` clean · `npm audit` 0 vulnerabilities. **This is the standing bar. Don't land work below it.**

⚠️ **Expect `npm audit` to go red again on an UNCHANGED tree.** It has happened twice, both times an advisory published after the last green run widening to cover the exact version an override pinned, and **it silently blocks the Railway deploy**. The current fix uses two *nested* overrides (`1.1.18` under `eslint`, `5.0.9` under `@typescript-eslint/typescript-estree`) because the two consumers need different major lines and one flat override cannot satisfy both. **Pinning an exact version is a bet that the next advisory won't include it.**

**Dependencies were current as of 2026-08-14**: `next` 16.3.0, `react` 19.2.8, `jose` 6.2.8, `@types/node` 26, CI on `actions/checkout@v7` + `setup-node@v7`. Merged after a full local bar *plus* a real JWT sign/verify round-trip, because `jose` is the session library and the suite never exercises a live token.

**`simple-icons` is a devDependency and nothing in the shipped app imports it.** It feeds `scripts/gen-brand-marks.mjs`, which extracts 11 brand paths into the committed `src/lib/brandMarks.ts`. Re-run it after adding a store-link name; it throws on an unknown slug rather than silently skipping a brand.

---
_✅ done · 🔵 needs input / in progress · ⏸️ blocked · 🟢 later · 🔴 broken_
