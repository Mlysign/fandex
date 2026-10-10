# The Fandex Worker and D1

_Phase 1 of [app-plan.md](app-plan.md), built 2026-10-04. This is the reference for `worker/`: what
runs there, what it costs, and the rules that are specific to it. The reasons behind the direction
are in app-plan.md; the settled calls are in [decisions.md](decisions.md)._

## What exists

| Thing | Where | Notes |
|---|---|---|
| Worker `fandex-api` | `https://fandex-api.fandex-worker.workers.dev`, and `https://fandex.org/v1/*` | Free plan. The Android app uses the first address. The website's Worker hands `/v1/*` to this one through a service binding ([website.md](website.md)), so a browser on fandex.org calls its own origin. |
| D1 database `fandex` | id `6daba7e4-ea55-4c72-b297-eb92ada8c581`, EU jurisdiction | 110 MB of a 500 MB cap after the seed. |
| R2 `fandex-backups` (EU) | bound as `BACKUPS` | `railway/` holds snapshots of the old database, `d1/{day}/` the nightly export. |
| R2 `fandex-litestream` (EU) | not bound | Empty and no longer needed: Railway was stopped on 2026-10-05 before the replica was switched on. Safe to delete. |
| Cloudflare access | Wrangler, by OAuth | Logged in from Nils's machine through his browser. No API token exists, and none should be minted for a session. |

Everything is created with `--jurisdiction eu`. An EU bucket has its own S3 endpoint
(`https://<account>.eu.r2.cloudflarestorage.com`) and every `wrangler r2` command needs
`--jurisdiction eu`, or it answers "bucket not found".

## Routes

Public, no session:

| Route | Does |
|---|---|
| `GET /v1/health` | D1 answers, plus today's two budget counters. |
| `GET /v1/catalog/delta?since&after&limit&count` | The scoring pool as a delta, oldest change first. The app's on-device catalog is built from this. |
| `GET /v1/taxonomy` | Tag categories, overrides, both alias tables, franchise overrides, display names, scoring config. ETag. |
| `GET /v1/items/{id}` and `/v1/items/{type}/{slug}` | One item: vector, raw facets, merged detail. `?region=` re-merges for that country. |
| `GET /v1/resolve/{tmdb\|igdb}/{type}/{id}` | The item a provider id maps to. Fetches it from the provider if nobody holds it. |
| `POST /v1/lookup` | Up to 2,000 provider ids at once: which are held. Never fetches. A library sync calls this, then `resolve` for the misses. |
| `GET /v1/shows/{id}/episodes` | Stored seasons and episodes. |
| `GET /v1/search/games?q` | IGDB search. The Twitch secret stays on the Worker. |
| `GET /v1/calendar/{YYYY-MM}?region` | The month's popular releases, 40 cards. |
| `POST /v1/catalog/release-dates` | `{region, ids}`, up to 200 item ids: the films among them whose date in that country differs from the catalog's one date. The calendar places your own films with it. |

Sign-in: `POST /v1/auth/google {idToken}`, `POST /v1/auth/trakt {accessToken}`,
`POST /v1/auth/merge {mergeToken, resolution}`, `POST /v1/auth/logout`.

Your rows, session required: `GET /v1/me`, `PUT /v1/me/prefs`,
`GET /v1/me/state/{items|episodes|hidden|counts}`, `PUT /v1/me/state`, `GET /v1/me/export`,
`DELETE /v1/me`, `DELETE /v1/me/identities/{provider}`.

`GET /v1/catalog/platforms?region=` lists, for every pool title, the game platforms or the
streaming services of one country, as names. Built once a day per country and kept in `kv`
(`platforms:games`, `platforms:streaming:{REGION}`), so a request after the first is two row reads.
A build is under a second and about 5,000 rows read; the same answer with the item page's last
fallback step (any country TMDB lists) read 179,000, which is why that step is left out. A build
meets the rate limiter and a cap of 40 a day; reading a built one meets neither.

**A film has one date in the catalog and another per country.** The catalog's date (`media_items`,
the vector, every list on a device) is TMDB's worldwide one. A country's date is picked by
`pickRegionalReleaseDate` in `src/lib/sources/normalize.ts`: the earliest cinema date, limited or
wide, then digital, then a premiere. That is the date TMDB's regional discover answers with, so the
calendar's popular cards, the item page (`?region=`) and `release-dates` agree. Checked on the live
Worker 2026-10-10: 12 of 12 held calendar films for Germany and 12 of 12 for the US. ⚠️ All three
must go through that one function. Before it, the item page took the earliest date of any kind and
showed a festival screening as the release (7 of 48 German calendar films). Of 200 pool films, 136
have a German date that is not the catalog's, so the lists are a day or more off for most films;
whether they should follow the country is an open question in TASKS.md.

`POST /v1/t/pv` is the pageview beacon (`src/telemetry.ts`): `{path, ref}` from a page on fandex.org. It keeps a
daily total per kind of page, signed in or not, and per class of referrer, and nothing that identifies anybody.
A request that is not a browser on our own origin (by `Origin` or `Sec-Fetch-Site`, then by user agent) is counted
only as a crawler turned away. A counted view is three row writes, capped at 5,000 views a day
(`DAILY_PAGEVIEW_CAP`), and it answers 200 whatever it decided. ⚠️ The privacy policy's "Usage statistics" section
describes exactly this. Change one and the other is wrong.

Admin, session required and the user id in `ADMIN_USER_IDS`, 404 otherwise: `GET /v1/admin/analytics`, `GET /v1/admin/users`,
`PUT /v1/admin/scoring`, `PUT`, `POST` and `DELETE /v1/admin/categories[/{id}]`, `POST` and `DELETE`
on `/v1/admin/tag-overrides`, `/v1/admin/tag-aliases`, `/v1/admin/ip-aliases`, `/v1/admin/ip-overrides`
and `/v1/admin/labels`. Every write answers with the taxonomy as stored. An alias is stored flat:
the target is resolved to its own canonical first and whatever pointed at the alias is re-pointed.
A franchise attach by name goes through `ipKey` and then through the bundles. `/v1/me` carries `admin: true` for an admin.

`DELETE /v1/me/identities/{provider}` removes one way of signing in and the wishlist and library
rows that came from it (episode rows stay, as on the site). It refuses the last identity with
`409 only-login`. It ends every session and answers with a new token, minted from an identity that
is still there, so the caller stays signed in. The rows it deletes are charged to the day's
`user_writes` budget before anything is deleted.

A session is a JWT. The app sends it as `Authorization: Bearer`; a browser on an allowed origin
also gets it as an `HttpOnly` cookie. A state-changing request on a cookie session must carry an
`Origin` we serve.

## What it reuses

Sixteen of the site's modules run in the Worker unchanged, imported from `../src/lib`: the
normalisers, the projection, the merge, the facet extraction, the tag categoriser, the slug rules,
the HTTP helper with its circuit breaker, the TMDB and IGDB clients, the month feed and its
ranking. None of them imports `@/lib/db`.

`node worker/scripts/verify-derive.mjs <snapshot.db>` proves the port: it derives every pool item
with the Worker's code and compares the result byte for byte with what the site stored. On the
2026-10-04 snapshot, 4,506 of 4,507 were identical. The one that differed was the site's own cache
being behind (a vote count that changed without changing the blob's length).

Two things were split out of the site for this, with no behaviour change there:
`src/lib/matcherPure.ts` (cross ids and the raw-data merge, out of `matcher.ts`) and
`setIgdbTokenStore` in `sources/igdb.ts` (so every isolate shares one Twitch token through D1).
`httpFetch` now returns `HttpResponse`, a `Response` whose `json()` is typed `any`, because the
Workers runtime types it `unknown`.

## Limits, and what was measured against them

Free plan, read 2026-10-04: 100,000 requests a day, **10 ms of CPU per request and per cron run**,
50 subrequests and 50 D1 queries per invocation, 100 bound parameters per statement, 100 KB per
statement, 2 MB per value. D1: 500 MB per database, 5 million rows read a day, **100,000 rows
written a day**, and past either daily figure every query fails until midnight UTC.

**Row writes are the scarce thing.** Every index a write touches is one more row written. The
schema is built around that: a natural key is the primary key of a `WITHOUT ROWID` table (one
write) where the site had a uuid plus a `UNIQUE` index (three). The seed's cost was predicted at
79,770 writes and D1 reported 79,770.

| What | Row writes |
|---|--:|
| A new catalog item | about 12 |
| A re-sync of an existing item | 3, plus any cross id that changed |
| One user state row | 1 |
| A calendar month | 1 |
| Each `spend()` on a budget | 1 |

Three budgets stop a stranger spending the day's writes: `fetch` (new titles, 2,000 a day),
`user_writes` (40,000 rows a day across everyone), `calendar` (150 month builds a day). They live
in `daily_budget` and are read at call time.

**CPU, measured on the live Worker with `wrangler tail`:**

| Request | CPU |
|---|--:|
| Item detail, lookup, state read, stored calendar month | 1 to 4 ms |
| Release dates for 200 films | 0 to 2 ms |
| Catalog delta, 150 rows | 3 ms |
| Catalog delta, 200 rows | 5 to 8 ms |
| Resolve that fetches from TMDB or IGDB | 4 to 7 ms warm, up to 19 ms on a fresh isolate |
| Calendar month build | 4 to 5 ms warm, up to 20 ms on a fresh isolate |

⚠️ **The fetch paths run past 10 ms on a cold isolate.** Cloudflare tolerates a Worker that goes
over infrequently and terminates one that does it consistently (error 1102). In about fifty
requests none was terminated. The reads, which are nearly all the traffic, are far inside the
limit. If 1102 ever shows up in the logs, the answer is Workers Paid at $5 a month, which lifts
the limit to 30 seconds; the plan already names that as the fallback for the website.

The read paths stay cheap because **nothing is parsed on a read**. An item's vector, facets and
merged detail are serialised when the row is written, and a read splices those strings into the
response. Lists are aggregated to JSON inside SQLite.

## Rules specific to the Worker

Each of these is a way the Worker differs from the site, and each has a test.

- **D1 has no interactive transaction.** A read followed by a write is two round trips. The guard
  is the schema: creating an item is one batch whose link insert is a plain `INSERT` on the
  provider identity, so of two requests resolving the same new title one batch commits and the
  other re-reads. `db.batch()` is atomic; use it for anything that must apply whole.
- **A user_id column is what makes a table personal**, as on the site. `userScopedTables()` reads
  it out of the `CREATE TABLE` text, because D1 refuses `pragma_table_info()` as a table function.
  Erasure and merge both use that list. A catalog table must never have the column.
- **No provider token is stored.** `user_identities` has no token column. The Trakt token a client
  sends to sign in is used for one request to Trakt and dropped.
- **The Google ID token's audience is pinned to our client id.** Without that, a token a user gave
  any other site would sign that site's operator into their Fandex account.
- **The prune invariant lives on the client.** `PUT /v1/me/state` takes explicit upserts and
  explicit deletes and never infers one from the other. There is no "replace everything from
  source X" call, on purpose.
- **A resolved title is not in the pool.** `/v1/resolve` creates rows with `browsed = 1`. Writing
  state for a title promotes it to `browsed = 0` and bumps `updated_at`, which is what carries it
  to every device on the next delta sync.
- **The delta cursor is `(updated_at, id)` as a row value**, not `a > ? OR (a = ? AND b > ?)`. Only
  the row-value form is a range seek on the partial index; the other reads the whole pool on every
  sync, and D1 bills each row. A final page hands back a cursor a few seconds in the past so a
  write in the same second is not skipped.
- **The cron is a state machine.** One trigger, every ten minutes, a few steps each run, cursors
  in the `kv` table. Four jobs: the nightly export to R2, the TMDB refresh (links older than 150
  days, inside TMDB's six-month cap), the upcoming refresh, one calendar month. IGDB is not
  refreshed on a timer; its retention question is open.
- **A pool title that is not out yet is refetched daily when near and weekly when far**
  (`runUpcomingRefreshStep`). Near is from 30 days after its date to 90 days before it; far is
  later than that or undated. Measured 2026-10-10: 63 such titles of 1,674 TMDB links, 11 of them
  near, so about 18 fetches and 55 row writes a day, and one scan of 1,741 rows read when it looks.
  A run fetches two titles at most across both refreshes, the 150-day one first, so 288 a day is
  the ceiling and past it the cadence stretches instead of the cost growing. ⚠️ A failed fetch
  here never moves `last_synced`: the six-month cap is counted from that column. The title goes
  on a skip list in `kv` for three days. Not covered: a title nobody acted on (`browsed = 1`),
  any game, and a running show's next season, whose first air date is long past.
- **A changed merge rule is true on the next item read, and nothing re-derives on a timer.**
  `DERIVE_VERSION` (`catalog/derive.ts`) stamps every stored doc. An item read re-merges a doc with
  an older stamp from its blobs, whatever the region, and the next write of the item re-stamps it.
  ⚠️ That heals `merged` only. A bump that changes the vector or the facets reaches a device as
  rows are refreshed, which is 150 days for a TMDB link.
- **`kv` holds the Twitch app token and is never exported.** The export skips tables by name and a
  test fails if `kv` reaches the bucket.
- **Tests run inside workerd against a local D1.** That is the same SQLite build as production,
  which matters because the SQL leans on row values, `json_each` and `WITHOUT ROWID`. The
  compatibility date must not be newer than the workerd the test pool bundles.

## Commands

Run from `worker/` unless a path says otherwise.

| Task | Command |
|---|---|
| Tests | `npm test` |
| Typecheck | `npx wrangler types` once, then `npx tsc --noEmit` |
| Deploy | `npx wrangler deploy` |
| Apply a migration | `npx wrangler d1 migrations apply fandex --remote` |
| Query D1 | `npx wrangler d1 execute fandex --remote --command "…"` |
| Logs with CPU time | `npx wrangler tail fandex-api --format json` |
| Set secrets from `.env` | `node worker/scripts/push-secrets.mjs` (from the repo root) |
| Snapshot Railway to R2 | `node scripts/snapshot-prod-to-r2.mjs` (from the repo root) |
| Build the D1 seed | `node worker/scripts/build-seed.mjs data/prod-snapshots/rr-YYYY-MM-DD.db` |
| Check the port against the site | `node worker/scripts/verify-derive.mjs <snapshot.db>` |

`push-secrets.mjs` reads `.env` and pipes the values to Wrangler on stdin. It prints names and
lengths, never a value. `JWT_SECRET` is generated there once and is not the Railway site's.

The seed is `data/d1-seed/*.sql`, applied in filename order with
`npx wrangler d1 execute fandex --remote --file=… --yes`. It holds one person's library, so it
lives under `data/`, which git ignores.

## Backup and restore

Railway was deleted on 2026-10-05, so D1 is the only live copy of the library. Three things stand
behind it:

| Copy | Covers | Where |
|---|---|---|
| D1 Time Travel | The last 7 days, any minute. The answer to a bad write or a bad migration. | Cloudflare, built in |
| The nightly export | Every row of every table that cannot be rebuilt, as of about 01:20 UTC. No provider blobs, no derived docs. | R2 `fandex-backups/d1/{day}/` |
| The base | The catalog's content as of 2026-10-04: every blob and doc. | `data/d1-seed/`, rebuilt from `rr-2026-10-04.db` (R2 `railway/` and `data/prod-snapshots/`) with `build-seed.mjs` |

⚠️ **The base is part of the backup set for good. Never delete `rr-2026-10-04.db`.** The export
leaves the blobs out because TMDB and IGDB can serve them again. RAWG, Steam and Trakt blobs
cannot be refetched (RAWG is retired, the Worker holds no Steam or Trakt credential), and they
exist only in that snapshot.

**The drill: `node worker/scripts/restore-drill.mjs`** (from the repo root). It downloads a day,
applies the base to a local scratch SQLite, lays the export over it, and checks keys, foreign
keys, the manifest's row total and the personal tables against live D1. `--emit-sql` also writes
the files a real restore would apply and loads them into an empty database to prove they do.
It is local on purpose: a scratch D1 would spend the day's row writes, which the live database
shares.

**Passed 2026-10-05** on that day's export: 52 objects, 37,610 rows, all 18 tables restored to
the exported count, no duplicate keys, no broken foreign key, and `user_item_state` (2,482),
`user_episode_state` (12,411) and `user_hidden_items` (1) identical to live row for row.

What it showed a real restore still needs:

- **A refetch for titles newer than the base.** 14 items (8 TMDB links, 6 IGDB) came back as rows
  with no blob and no doc, 2 of them in the pool. All refetchable; nothing does it yet. The
  number grows with every title somebody resolves.
- **A day of row writes.** Applying the emitted files to a new D1 is about what the seed cost
  (80,000), so on the free plan a restore is a day on which nothing else may write.
- ⚠️ The export pages by `OFFSET` across cron runs ten minutes apart, so a write in between can
  export a row twice or skip one. The drill counts duplicates (none so far) and compares the total
  with the manifest; a skipped row would only show against live.
- ⚠️ `wrangler r2 object list` returned nothing useful, so the drill walks each table's chunks by
  key until one is missing. A failed download throws; it is never read as the end of a table.

## Not built yet

- **The telemetry beacon and App Links.** The API is on fandex.org since 2026-10-10; these two parts of phase 3 are not.
- **Steam**: sign-in and the owned-games proxy. Phase 5 by decision.
- **Episode fill on demand.** Seeded shows have their episodes. A show resolved later does not;
  the plan has the client take episodes from Trakt.
- **Dropping stale rows.** A `browsed = 1` row nobody acted on should be dropped, not refreshed,
  once it is 150 days old. The first such row is due in March 2027. Needs the same schema-derived
  "is anything pointing at this" check erasure uses, before anything deletes.
- **`franchise_members`**: 10,841 rows, built as `data/d1-seed/90_franchise_members.deferred.sql`
  and not applied. The franchise rail is phase 5.
- **The refetch step of a restore.** See "Backup and restore" below: titles added after the base
  come back as rows without content, and nothing refetches them yet. 14 on 2026-10-05.
