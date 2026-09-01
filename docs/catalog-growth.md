# Catalog growth: the running jobs

**All five phases shipped 2026-08-27/28.** The design, every measurement and the
phase-by-phase history are in [docs/archive/history.md](archive/history.md) — grep it
for `media_item_projection`, `unfoldEntry`, `retention`, `backfill` or any number you
are about to quote. This file is only what is still live.

Fandex now keeps its own copy of the catalog and treats providers as something it syncs
from on a schedule. Five background jobs do that, all on one 30-minute timer in
`instrumentation.ts`, in this order:

| job | module | what it does |
|---|---|---|
| **retention** | `lib/retention.ts` | Queues links approaching TMDB's six-month cache cap for re-fetch |
| **fill** | `lib/catalogFill.ts` | Enriches thin rows (list payload → full projection) |
| **backfill** | `lib/catalogBackfill.ts` | Adds new titles, six lanes, paced |
| **housekeeping** | `lib/catalogHousekeeping.ts` | Drops redundant `raw_data` blobs above a size threshold |
| **projection sweep** | `lib/facetCache.ts` | Bounds `media_item_projection` by row count |

The order is deliberate: a contract deadline outranks an enrichment, enriching what you
have outranks adding more, and reclaiming bytes goes last so it sees the growth the
backfill just caused.

## The switches

All off or inert by default. Set them in Railway → `releaseradar` → Variables.

| variable | default | what it does |
|---|---|---|
| `BACKFILL_ENABLED` | off | `1` starts the paced ingest. **ON in prod since 2026-08-28.** |
| `BACKFILL_MAX_ITEMS` | 50000 | Stop growing here. **Prod is set to 15000.** |
| `BACKFILL_PAGES` | 2 | Provider pages per pass. ⚠️ See the warning below. |
| `CATALOG_BROWSE` | off | `1` lets a ready (type, window) serve browse from the DB at zero provider calls |
| `CATALOG_BROWSE_MIN` | 200 | Stored rows in a window before it goes local |
| `HOUSEKEEPING_START_MB` | 1200 | Reclaim `raw_data` above this file size |
| `IGDB_ENABLED` | on | `0` stops every IGDB call at once → see the open question below |

⚠️ **`BACKFILL_PAGES` is the one dial that can hurt.** 30–50k titles is 60–120k provider
calls, and every row written is WAL that Litestream ships to S3. That combination blew
the Railway spend cap and took the site down on 2026-07-22 (PR16: 546,754 rows, 12.8 GB
of WAL). **The pacing is the safety feature, not a conservative default.** Check the
Railway usage page before raising it, and raise it a little rather than a lot.

## What to watch

`GET /api/health` → `catalog`:

- **`browse.windows`** — the number that decides the next action. When a type's `future`
  count reaches `browse.min`, set `CATALOG_BROWSE=1` and that section stops costing
  provider calls. It is per type, so movies can go local while games are still filling.

  ⚠️ **Measured 2026-09-01: it will not get there by waiting, and that is structural.**
  All three `:future` lanes are `exhausted: true`, so nothing refills them, while the
  future window is a rolling **18 months that DRAINS** as release dates pass. Movie went
  **49 → 35** and show **49 → 26** in four days, against a `min` of 200; game is 74, up
  from 29, and also retired. **A one-shot paginated sweep cannot fill a window that
  empties itself.** This is a design decision now, not a watch item → [TASKS.md](../TASKS.md)
  "Needs Nils" item 1. ⚠️ Note also that `resetBackfill()` (`catalogBackfill.ts:222`) is
  exported and wired to NOTHING: no route, no script, so a retired lane cannot currently
  be revived on prod at all.
- **`retention.expired`** — must stay 0. ⚠️ **Not a threshold: a provider term being
  breached.** TMDB's API Terms §1.C cap caching at six months. It is logged as an
  `error`, not a warning, and should be unreachable while the fill job drains.
- **`backfill.lanes[].strikes`** — a lane needs three consecutive empty pages to retire.
  One lane striking is normal (`game:past` will, while RAWG is quota-latched); every
  lane striking means providers are failing, not that the windows are finished.

  ⚠️ **`game:past` did retire, at page 1 with 0 added, and three strikes did not save it.**
  The counter buys three cheap empty pages against a TRANSIENT outage. RAWG's quota latch
  is not transient, so the lane still retired permanently, silently, and for the whole
  month. `EMPTY_STRIKES` raises the cost of a false retirement; it does not make one
  impossible, and a `exhausted: true` on a lane whose provider is latched should be read
  as "provider down", not "window finished". Cross-check against `providerCalls` before
  believing a lane is done.
- **`backfill.lanes[].page` / `.added`** — climbing means it is working. `items` against
  `backfill.maxItems` is the runway.
- **`housekeeping.fileMb`** — inert until it passes `HOUSEKEEPING_START_MB`.

## The one open question: IGDB

**The licence and the product contradict each other, and it is not resolvable by reading
harder.** The Twitch Developer Services Agreement, which IGDB's own docs name as its
licence, permits storing copies only with prior written authorization or a **24-hour**
cache. Fandex holds ~1,000 IGDB links indefinitely, so on a literal reading it is
already outside that. But IGDB's own API ships **webhooks whose only purpose is keeping
your copy of their data current**, and it offers a commercial partnership.

Nils's call 2026-08-28: **carry on, behind a kill switch.** One email to
`partner@igdb.com` settles it. Until then:

- `IGDB_ENABLED=0` stops every IGDB call at once. Pinned by `igdbKillSwitch.test.ts`,
  which asserts no `fetch` happens at all and fails any new function that skips the
  guard.
- `node scripts/purge-igdb.mjs data/rr.db` reports; `--apply` deletes. It removes
  **links, never items** — proven on a copy: 1,008 links and 908 projections gone, all
  2,770 items and all 2,482 user rows untouched. It reports the set that matters first
  (items where IGDB is the only source; 100 of them, none acted on).
- ⚠️ Set `IGDB_ENABLED=0` and deploy it **before** purging, or the app refills what you
  deleted and burns quota doing it.

## Where the other providers stand

Read from the primary sources 2026-08-28. ⚠️ Not legal advice; the wording matters more
than this table.

| provider | on storing data |
|---|---|
| [TMDB](https://www.themoviedb.org/api-terms-of-use) | Cache capped at **six months** (§1.C). An AGE cap, not a size one, which is why a stored catalog is fine and an unrefreshed one is not. Enforced by `lib/retention.ts`. Free tier is **non-commercial** — unchanged by scale, and already tracked against H3. |
| [Twitch/IGDB](https://legal.twitch.com/legal/developer-agreement/) | 24 hours, or prior written authorization. See above. |
| [Steam](https://steamcommunity.com/dev/apiterms) | Contemplates storage (declare it, name the country); **no retention limit**. |

## Tools

| command | what for |
|---|---|
| `BENCH_DB=<copy> node scripts/probe-score.mjs` | Scoring cost per item. Run after **any** change to the scoring path. |
| `node --expose-gc scripts/probe-memory.mjs` | Retained heap per structure. ⚠️ The only honest way to size a memory fix; `JSON.stringify` estimates got the ranking wrong by 7×. |
| `node scripts/capture-find.mjs <out>` | Full `find()` output, for proving a change byte-identical either side of a `git stash`. |
| `BENCH_DB=<copy> node scripts/probe-pool.mjs` | Pool rebuild cost and its breakdown. |

⚠️ **Point every probe at a COPY, and copy the `-wal` too.** A WAL-mode database is the
`.db` file plus its `-wal`; copying only the `.db` gives a valid, stale snapshot. It
reported 1,580 projection rows against the 908 actually there.
