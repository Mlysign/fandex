# The Fandex Worker and D1

_Phase 1 of [app-plan.md](app-plan.md), built 2026-10-04. This is the reference for `worker/`: what
runs there, what it costs, and the rules that are specific to it. The reasons behind the direction
are in app-plan.md; the settled calls are in [decisions.md](decisions.md)._

## What exists

| Thing | Where | Notes |
|---|---|---|
| Worker `fandex-api` | `https://api.fandex.org` (custom domain, 2026-10-23), `https://fandex-api.fandex-worker.workers.dev`, and `https://fandex.org/v1/*` | Free plan. The Android app uses `api.fandex.org` from 0.3.11; older APKs use the workers.dev address, which stays on. ⚠️ `caches.default` does nothing on workers.dev, which is why the custom domain exists: every edge-cached route (game search, browse and facets, shelves, covers) went to the provider on every call from the app. The website's Worker hands `/v1/*` to this one through a service binding ([website.md](website.md)), so a browser on fandex.org calls its own origin. |
| D1 database `fandex` | id `6daba7e4-ea55-4c72-b297-eb92ada8c581`, EU jurisdiction | 110 MB of a 500 MB cap after the seed. |
| R2 `fandex-backups` (EU) | bound as `BACKUPS` | `railway/` holds snapshots of the old database, `d1/{day}/` the nightly export. |
| R2 `fandex-covers` (EU) | bound as `COVERS` | Book covers copied from Hardcover (2026-10-17), under `hardcover/{path}`, served at `/v1/cover/hardcover/{path}`. Not exported: every object can be fetched again. R2's free tier is 10 GB, 1 million writes and 10 million reads a month; a cover is 50 to 150 KB, so about 100,000 of them fit. |
| Cloudflare access | Wrangler, by OAuth | Logged in from Nils's machine through his browser. No API token exists, and none should be minted for a session. |

Everything is created with `--jurisdiction eu`. An EU bucket has its own S3 endpoint
(`https://<account>.eu.r2.cloudflarestorage.com`) and every `wrangler r2` command needs
`--jurisdiction eu`, or it answers "bucket not found".

## Routes

Public, no session:

| Route | Does |
|---|---|
| `GET /v1/health` | D1 answers, plus today's budget counters (`fetches`, `userWrites`, `hardcover` against Hardcover's 5,000 a day, `covers` copied today) and `openProviderCircuits`: which providers this isolate has stopped asking. ⚠️ Per isolate, so an empty list is no proof a provider is up. Answers `HEAD` too. |
| `GET /v1/catalog/delta?since&after&limit&count` | The scoring pool as a delta, oldest change first. The app's on-device catalog is kept current with this. A device with nothing starts from the website's `/catalog/` files instead ([website.md](website.md)), so a first visit is one call here and not thirty-one. |
| `GET /v1/taxonomy` | Tag categories, overrides, both alias tables, franchise overrides, display names, scoring config. ETag. Served from a copy kept in `kv` (`taxonomy`, `taxonomy_etag`): an unchanged device gets a 304 for one row read, where building it reads about 8,300 rows. An admin write keeps it again, the sweep script drops it, and it expires after an hour, which bounds SQL run by hand. `Cache-Control: no-cache`. |
| `GET /v1/items/{id}` and `/v1/items/{type}/{slug}` | One item: vector, raw facets, merged detail. `?region=` re-merges for that country. |
| `GET /v1/resolve/{tmdb\|igdb\|openlibrary\|hardcover\|bgg}/{type}/{id}` | The item a provider id maps to. Fetches it from the provider if nobody holds it. Each provider takes only its own types and id shape (`TARGETS` in `catalog/resolve.ts`): an Open Library work is `OL…W`, a BGG or Hardcover id is digits. A Hardcover id is asked at Open Library by its ISBNs first: a work found there is the item, with the Hardcover link attached to it; only a book Open Library has no edition of is created under the Hardcover id ([decisions.md](decisions.md), 2026-10-17). 404 while Hardcover is off. |
| `POST /v1/lookup` | Up to 2,000 provider ids at once: which are held, with each held title's `slug` since 2026-10-17 (one primary-key read each), so a card links `/{type}/{slug}`. Never fetches. A library sync calls this, then `resolve` for the misses. |
| `GET /v1/shows/{id}/episodes` | Stored seasons and episodes. 404 for an id that is not a show. |
| `GET /v1/browse/games?page[&window=recent]` | Upcoming games, most anticipated first, 40 a page, pages 1 to 10: the Search feed. With `window=recent`, the last sixty days' games, most rated first: Home's trending. Card fields only. Edge-cached six hours per page and day; an empty page is never cached. Measured 2026-10-15: 4 ms CPU on a miss. Reads and writes no D1 row. |
| `GET /v1/facet/games?kind=tag|studio|franchise&q` | A tag's games (theme, keyword or genre containing it), a studio's (company name containing it), or a franchise's (IGDB franchise or collection named exactly that, since 2026-10-17: a game page's "More from" rail), most rated first, 40. The old site's tag query took 4.3 to 4.7 s at IGDB and still does (4.8 s measured), so the answer is edge-cached a week, empty ones included. A failed IGDB call is a 502 and never cached. 4 ms CPU. |
| `GET /v1/search/games?q` | IGDB search. The Twitch secret stays on the Worker. `<` and `>` are dropped from the query: IGDB refuses them, and a refusal counts toward shutting game search for everybody. |
| `GET /v1/features` | Which provider-fed types and sources this Worker can serve: `{"books":true,"boardgames":<BGG_TOKEN set>,"hardcover":<HARDCOVER_TOKEN set and not switched off>}`. The app hides a type answered false. Not cached. |
| `GET /v1/search/{books,boardgames}?q` | Open Library search (filtered by `relevantBooks`: every typed word in the title or authors, no summaries or study guides) or BGG search. Card fields, rating on 0-100, authors since 2026-10-17. Edge-cached a day under `CACHE_VERSION` (bump it when what a shelf answers changes); an empty answer is never cached. Board games answer 503 `not-configured` without `BGG_TOKEN`. Rate-limited on `RL_RESOLVE`. **With `HARDCOVER_TOKEN`, Hardcover's search is asked alongside** (one request) and its cards follow Open Library's, less the books Open Library already answered with (the same ISBN-13, or the same title and author: `mergeBookCards` in `src/lib/sources/bookPure.ts`). A Hardcover card carries no votes and no rating (its readers' numbers are theirs) and a cover served by this Worker. Hardcover failing, off, or over its day's budget leaves Open Library's answer as it is; Open Library failing answers Hardcover's alone. |
| `GET /v1/browse/{books,boardgames}` | Open Library's weekly trending, or BGG's hot list: Home's and Search's popular books and board games. Same caching. Open Library only. |
| `GET /v1/facet/books?kind=tag|person|studio|franchise&q` | A subject's, an author's, a publisher's or a series' books: the book half of a tag, person, studio and franchise page. Same caching. A series (`franchise`) also asks Hardcover, which holds every member in order including the ones not out yet: two requests (find the series by search, then its books), merged the same way, oldest first and an undated book last. Hardcover files a translation, a limited edition or a box set as a book of its own at the SAME position as the original (twelve members at positions 0.6 to 1.1 for the Kingkiller Chronicle, probed 2026-10-17), so one book per position is kept, the one with the most editions (108 against 1). Every Hardcover list card needs a cover: a record without one was always one of those copies. |
| `GET /v1/cover/hardcover/{folder}/{id}/{file}` | A book cover copied from Hardcover, whose rules forbid hot-linking (`src/covers.ts`). The first request fetches it from `assets.hardcover.app`, puts it in R2 `fandex-covers` and counts one against `cover` (3,000 a day); every later one is served from R2, a year in the edge cache, `immutable`. Only Hardcover's own path shape is accepted (a folder, a numeric id, a hashed file name), only an `image/*` under 3 MB is kept, and a new copy is refused while Hardcover is off; a held one still serves. Rate-limited on `RL_RESOLVE`. Answers `HEAD`. |
| `GET /v1/calendar/{YYYY-MM}?region` | The month's popular releases, 40 cards, plus up to 5 of the month's books when the ranking placed none (`BOOK_FLOOR`, 2026-10-18: a book's reach is a tiny bucket, so no book ever placed and Home's Upcoming never showed one). |
| `POST /v1/catalog/release-dates` | `{region, ids}`, up to 200 item ids: the films among them whose date in that country differs from the catalog's one date. The calendar places your own films with it. |

A real route asked with the wrong method answers 405 with an `Allow` header (the `PUBLIC_ROUTES`
table in `src/index.ts`); an address that is no route at all stays 404.

Sign-in: `POST /v1/auth/google {idToken, nonce}`, `POST /v1/auth/trakt {accessToken}`,
`POST /v1/auth/discord {accessToken}` (since 2026-10-17: Discord's `/oauth2/@me` must name our `DISCORD_CLIENT_ID` as the application; no client secret),
`POST /v1/auth/merge {mergeToken, resolution}`, `POST /v1/auth/logout` (bumps `session_epoch`: every
device signs out; what "Sign out everywhere" and apps before 0.3.15 send) and
`POST /v1/auth/logout?scope=device` (since 2026-10-23: clears this browser's cookie only; the app's
"Sign out"). A token a device forgot stays valid until it expires, 30 days.
A route that answers GET answers HEAD the same, without the body (2026-10-23).

### The test accounts (a developer's machine only)

`POST /v1/dev/login {account?}` signs in as one of three fixed accounts, `smoketest` (the default),
`plain` or `third`, creating it on first use (`src/devLogin.ts`). `third` signs in "with Discord"
so it can be joined to the others: `{account, connect: true}` with a session adds that account's way
in to the signed-in one through the real `signIn()`, which is how joining accounts is tried here. It exists so a rating, a hide, a changed
setting, a download or a deleted account can be tried without touching a real one. Their identity
is `google` with a made-up id, so they hold no Trakt and nothing they do leaves the machine.

Two gates, and both must hold or the route is a 404:

1. `DEV_LOGIN` is `"1"`. ⚠️ **It lives in `worker/.dev.vars` and nowhere else.** `wrangler dev`
   reads that file and `wrangler deploy` never does. It must never be a `vars` entry in
   `wrangler.jsonc` and never be pushed as a secret; `push-secrets.mjs` does not know the name.
2. The request's host is `localhost`, `127.0.0.1` or `[::1]`. Checked on both live hosts on
   2026-10-11, with and without a forged `Host` header: 404 and 403, never a session.

`node worker/scripts/dev-stack.mjs` prepares everything: `.dev.vars` (the flag, the first test
account as the only admin, a session secret of this machine's own, the provider keys copied from
`.env` with names and lengths printed and never a value), the migrations on the LOCAL D1, and the
catalog from `data/d1-seed` without the files that hold anybody's library. Then `npm run dev:local`
here and `npm run web:local` in `mobile/`, or the launch configurations `worker-local` and
`app-web-local`, and "Test account" on a sign-in card. The app shows that button only when its API
address is a loopback one (`LOCAL_API` in `mobile/src/lib/config.ts`).

⚠️ **The test pool reads `.dev.vars` too.** After `dev-stack.mjs` has run, every test's `env`
carries `DEV_LOGIN=1`. A test of what a deployed Worker does must build its own environment
(`{ ...env, DEV_LOGIN: undefined }`), or it passes in CI and fails here.

Your rows, session required: `GET /v1/me`, `PUT /v1/me/prefs`,
`GET /v1/me/state/{items|episodes|hidden|counts}`, `PUT /v1/me/state`, `GET /v1/me/export`,
`DELETE /v1/me`, `DELETE /v1/me/identities/{provider}`, `GET /v1/me/steam`.

**Steam** (2026-10-23, `src/steam.ts`): `GET /v1/me/steam` reads the account's owned games and
wishlist from the Steam Web API with the Worker's `STEAM_API_KEY` (a Web API key may never ship
in the app) and answers `{library:[{appid,playtime,lastPlayed}], wishlist:[{appid,addedAt}]}`.
Whole or an error: either Steam call failing is a 502, and a **private profile** (no `games` in
Steam's answer) is a 409 `steam-private`, never an empty library, because the device deletes what
the answer leaves out. Rate-limited per account, `spend("steam", …)` per call pair.
`GET /v1/resolve/steam/game/{appid}` answers a Steam app with the IGDB game IGDB's
`external_games` maps it to, and keeps the app id in `provider_aliases`; an app IGDB has no game
for is a 404.

`GET /v1/catalog/platforms?region=` lists, for every pool title, the game platforms or the
streaming services of one country, as names. Built once a day per country and kept in `kv`
(`platforms:games`, `platforms:streaming:{REGION}`), so a request after the first is two row reads.
A build is under a second. **Measured on live D1 on 2026-10-11: 5,800 rows read for the games and
13,853 for one country's streaming** (an earlier "about 5,000" here was the first version of the
query). The same answer with the item page's last fallback step (any country TMDB lists) read
179,000, which is why that step is left out. A build meets the rate limiter and a cap of 40 a day,
so the most a day of builds can read is about 560,000 rows; reading a built one meets neither.

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

⚠️ **`release-dates` took the API down on its first day (2026-10-10).** Its join, left to the
planner, read every TMDB link in the catalog on each call: 110,394 rows a call and 3.86 million in
35 calls, which with the day's other traffic passed D1's 5 million. Every query then failed until
midnight UTC. The query now names its join order and its index (`RELEASE_DATES_SQL`), and a test
holds the plan and the count. **Measured on live D1 on 2026-10-11: 438 rows for 50 films with DE,
975 with a country none of them lists**, so 9 to 20 rows a film (the country's place in TMDB's list
is what varies; the local D1 said four) and at most about 3,900 for a full call of 200.

`POST /v1/t/pv` is the pageview beacon (`src/telemetry.ts`): `{path, ref}` from a page on fandex.org. It keeps a
daily total per kind of page, signed in or not, and per class of referrer, and nothing that identifies anybody.
A request that is not a browser on our own origin (by `Origin` or `Sec-Fetch-Site`, then by user agent) is counted
only as a crawler turned away. A counted view is three row writes, capped at 5,000 views a day
(`DAILY_PAGEVIEW_CAP`), and it answers 200 whatever it decided. ⚠️ The privacy policy's "Usage statistics" section
describes exactly this. Change one and the other is wrong.

⚠️ `GET /v1/admin/users` groups every row of `user_item_state` several times over. **Measured on live D1 on 2026-10-11:
30,597 rows read per view** with one account of 2,484 state rows, so about twelve rows read per state row, and it grows
with every account. 160 views would spend the day. Fine for one admin and one account; before there are more accounts it
needs one pass over the table instead of four, or an answer kept in `kv`. Keep the page off any timer.

Admin, session required and the user id in `ADMIN_USER_IDS`, 404 otherwise: `GET /v1/admin/analytics`, `GET /v1/admin/users`,
`PUT /v1/admin/scoring`, `PUT`, `POST` and `DELETE /v1/admin/categories[/{id}]`, `POST` and `DELETE`
on `/v1/admin/tag-overrides`, `/v1/admin/tag-aliases`, `/v1/admin/ip-aliases`, `/v1/admin/ip-overrides`
and `/v1/admin/labels`, and `GET`, `POST` and `DELETE /v1/admin/suggestions/dismissed`: the Review section's
proposals somebody said no to (`taxonomy_suggestion_dismissed`, migration 0003, one row write a denial), answered
as the whole list of `[kind, ref]`. The proposals themselves are worked out on the device and stored nowhere.
Every other write answers with the taxonomy as stored. An alias is stored flat:
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

Five budgets stop a stranger spending the day's writes, or a provider's day: `fetch` (new titles,
2,000 a day), `user_writes` (40,000 rows a day across everyone), `calendar` (150 month builds a
day), `hardcover` (requests to Hardcover, 4,000 a day of the 5,000 their free plan allows, one
per top-level query field; `HARDCOVER_DAILY_CAP`) and `cover` (covers copied from Hardcover,
3,000 a day; `DAILY_COVER_CAP`). They live in `daily_budget` and are read at call time. Over the
Hardcover budget, a book route answers Open Library's half alone and says nothing.

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

- **The open routes that read many rows have a limiter and a daily cap** (2026-10-23,
  `test/hardening.test.ts`). `POST /v1/lookup` takes up to 2,000 refs with no sign-in and
  `GET /v1/catalog/delta` up to ~400 rows a page; both sit behind `RL_READ` (120 a minute per IP,
  an IPv6 caller keyed by its /64) and `spend()` (`DAILY_LOOKUP_CAP` 300,000 refs,
  `DAILY_DELTA_CAP` 4,000 pages), together under half of D1's 5M reads. A signed-in state page is
  limited per user. A refused budget is remembered in the isolate, so a burst past a cap costs
  no row writes. **One account's share of the day's state writes** is
  `DAILY_USER_WRITE_CAP_PER_USER` (15,000 of the shared 40,000).
- **A provider id that answered as another is kept in `provider_aliases`** (migration 0004): an
  Open Library work merged into another, a Hardcover duplicate, an IGDB port opened as its main
  game. Resolve writes it, and resolve and lookup read it, so a library sync stops fetching it.
- **A link write is guarded against a second writer** (`writeLinkAndRederive` in
  `catalog/ingest.ts`): the write batch opens with a statement that fails it when the item's
  links moved since they were read, and the read and derive run again (three tries).
- **Covers are checked by their bytes** (JPEG, PNG, WebP) and served with a sandbox CSP; the
  `users/` folder (member uploads) is refused.
- **Sign-in:** a Trakt identity is keyed on Trakt's `ids.uuid` from `/users/settings`, and a row
  still keyed by username moves to it on its owner's next sign-in. A join that would fold away an
  account holding any titles always answers `merge-required`, overlap or not.
- **Taxonomy rows say who made them** (migration 0005): `source` is `'hand'` on every admin
  write and by default, `'sweep'` on the weekly sweep's inserts, and the sweep's undo deletes
  only `'sweep'` rows carrying its run's stamp.
- **A projection bump is walked by the cron** (`runProjectionRefreshStep`): v4 (2026-10-23) keeps
  every TMDB writer job (`src/lib/crewJobs.ts`), and the TMDB links stored before it are refetched
  four a run in key order until `kv` `tmdb_projection_cursor` reads `done:4`. A future bump that
  changes what TMDB blobs keep needs only the version raised: the cursor carries its version, so
  the walk starts over by itself.
- **`wrangler dev` sends every request under the first `routes` host** (`api.fandex.org`), which
  the test login's loopback gate refuses; `npm run dev:local` passes `--local-upstream
  localhost:8787` for that reason.
- **The cron's housekeeping** drops `daily_budget` rows older than 30 days and calendar months
  outside what a request may ask for, once a UTC day. A failed TMDB refresh no longer moves
  `last_synced` (the stored copy's age, which TMDB's six-month cap counts from); the link is set
  aside in `kv` for a week instead, and a failure past 180 days logs `tmdb_retention_overdue`.

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
- **A Google ID token is accepted only with the secret behind its nonce** (2026-10-11). The token
  comes back from Google in the browser's address and is good for an hour, so on its own it proves
  too little. The client makes a secret, has Google write its SHA-256 into the token, and sends
  both; `verifyGoogleIdToken` refuses a token without a matching one, and the route answers 400
  when no nonce is sent at all. Do not make the argument optional: `publish.mjs` reads that 400 as
  "this API checks the nonce" before it publishes a Google button.
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
- **Two counts are kept, and whatever changes what they count drops them** (`src/keptCounts.ts`,
  migration 0002). A device asks for its state counts before every pull and for the pool's size at
  the end of every catalog sync, nearly always to hear "nothing changed". Counting each time read
  14,899 and 4,561 rows a call (2026-10-10: 1.33 million and 611,000 in the day). Now each is
  counted once and kept: the state counts on the user's row (`counted_items`, `counted_episodes`,
  `counted_hidden`, as `count:newest`, NULL for "count again"), the pool's size in `kv` under
  `pool_count` with a day's expiry. Measured on the local D1 at the real sizes: **1 row** for an
  ask when nothing changed; 14,896 for the first ask after all three tables changed, 12,414 after
  one episode is ticked; 4,563 for the first sync after the pool changed. A device is sent the
  same numbers as before, because a kept number is always one the old COUNT produced.
  - The drop rides in the writer's own batch. A state write adds at most one row write (none if
    the count was already dropped) and, when a pool count is kept, a look-up of 3 rows per title
    written to ask whether the write will promote one (6,001 rows for 2,000 titles, the same as
    the promotion itself).
  - ⚠️ **A statement that writes `user_item_state`, `user_episode_state`, `user_hidden_items`, or
    that puts a title into the pool or takes one out, must drop the count in the same batch.**
    `test/keptCounts.test.ts` lists every such statement in `src/` and fails on a new one.
  - ⚠️ **The pool's size must never be answered too low.** A device holding more titles than the
    number it is given throws its catalog away and downloads it again, on every sync while the
    number stays low. An addition that forgets `DROP_POOL_COUNT_SQL` is that bug.
  - ⚠️ **The same goes for SQL run by hand**, and for a rollback: the old code writes without
    dropping. After either, run `UPDATE users SET counted_items = NULL, counted_episodes = NULL,
    counted_hidden = NULL` and `DELETE FROM kv WHERE key = 'pool_count'`. Both are safe at any time
    and cost one recount each.
  - Not triggers, though a trigger could not be forgotten: D1 reports a trigger's row changes as
    the changes of the statement that fired it (an upsert of two rows reported three), and the
    state write tells the client what it applied and skipped from that number. A test pins it.
  - The count is asked for on the LAST page of a sync only, and always was (`done && withCount`).
    For a device that is up to date the first page is the last, so asking on the first page only
    would have saved nothing: the 134 counts on 2026-10-10 were 134 syncs, not 134 pages.
- **The cron is a state machine.** One trigger, every ten minutes, a few steps each run, cursors
  in the `kv` table. Four jobs: the nightly export to R2, the TMDB refresh (links older than 150
  days, inside TMDB's six-month cap), the upcoming refresh, one calendar month. IGDB is not
  refreshed on a timer; its retention question is open.
- **A one-off that rides the same slots: the books stored before their series was read**
  (`runOpenLibraryRefetchStep`, 2026-10-17). Every Open Library link last synced before the series
  fix (`OPENLIBRARY_REFETCH_BEFORE`) is fetched again once, through the same upsert a resolve
  uses, so its facets and doc gain the franchise. Two a run at most, before the upcoming refresh,
  so 181 books take most of a day. A failure keeps the stored row and moves the link past the
  cutoff; when none is due the step parks for six hours and costs one kv read a run. Delete
  `ol_refetch_idle` from `kv` to make it look again.
- **A pool title that is not out yet is refetched daily when near and weekly when far**
  (`runUpcomingRefreshStep`). Near is from 30 days after its date to 90 days before it; far is
  later than that or undated. Measured 2026-10-10: 63 such titles of 1,674 TMDB links, 11 of them
  near, so about 18 fetches and 55 row writes a day, and one scan of 1,741 rows read when it looks.
  A run fetches two titles at most across both refreshes, the 150-day one first, so 288 a day is
  the ceiling and past it the cadence stretches instead of the cost growing. ⚠️ A failed fetch
  here never moves `last_synced`: the six-month cap is counted from that column. The title goes
  on a skip list in `kv` for three days. Not covered: a title nobody acted on (`browsed = 1`),
  any game, and a running show's next season, whose first air date is long past.
- **Games stored before 2026-10-18 get their IGDB collections from a cron walk**
  (`runIgdbCollectionsStep`). 2,788 IGDB links had none; a run takes the next 12 by `source_id`
  after the `igdb_collections_cursor` row in `kv`, asks IGDB for all of them in one call, and
  stores each again with `collections` merged in, which re-derives its facets (the franchise
  facet's `series`) and moves it in the delta sync. Past the last id the cursor reads `done` and
  the step costs one kv read. A failed IGDB call leaves the cursor, so the batch is asked again.
  Delete the `kv` row to walk again.
- **A changed merge rule is true on the next item read, and nothing re-derives on a timer.**
  `DERIVE_VERSION` (`catalog/derive.ts`) stamps every stored doc. An item read re-merges a doc with
  an older stamp from its blobs, whatever the region, and the next write of the item re-stamps it.
  ⚠️ That heals `merged` only. A bump that changes the vector or the facets reaches a device as
  rows are refreshed, which is 150 days for a TMDB link.
- **`kv` holds the Twitch app token and is never exported.** The export skips tables by name and a
  test fails if `kv` reaches the bucket.
- **The export pages by key, and must never page by `OFFSET`.** An offset is read past, so chunk
  k cost k chunks and a table cost the square of its size. On 2026-10-15 it was the biggest reader
  of the day: about 230,000 of 290,000 rows, 109,000 of them to export 12,414 episode rows. At ten
  accounts with that history it would have spent the whole 5 million on its own. Measured on live
  D1 after the change: a chunk 9,000 rows in reads 1,001. ⚠️ How the chunk's last key is taken
  matters as much: a window function over the chunk read 3,002 and an `ORDER BY` inside the
  aggregate 2,001, because D1 counts every row through a temporary table. `cron.test.ts` asserts
  the total.
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
| A Worker and database on this machine, with test accounts | `node worker/scripts/dev-stack.mjs` (from the repo root, `--reseed` to start over), then `npm run dev:local` |
| Query the local database | `npx wrangler d1 execute fandex --local --json --command "…"` |
| Apply a migration | `npx wrangler d1 migrations apply fandex --remote`, and BEFORE the deploy that needs it |
| What read the most rows today | `npx wrangler d1 insights fandex --timePeriod 1d --sort-type sum --sort-by reads --limit 15 --json` (answers while D1 refuses queries) |
| Query D1 | `npx wrangler d1 execute fandex --remote --command "…"` |
| Fold duplicate titles into the one they duplicate | `node worker/scripts/fold-items.mjs <pairs.json> --local\|--remote [--apply]`. Refuses if a user row sits on a duplicate; with `--move-user-rows` it moves a library or wishlist row the kept title lacks and drops one it already has word for word, and still refuses two that disagree. Backs every deleted row up to `data/backups/`, drops the kept counts. Rehearse with `--local` first. Then add each old address to `mobile/web/folded.json` and publish the site, or the old address opens "not found". |
| Rows a query reads | the same with `--json`: `meta.rows_read`. ⚠️ Not with `--file`, which reports the upload and not the query. |
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
- The export pages by KEY since 2026-10-15 (it was `OFFSET`), so a write between two cron runs
  can no longer export a row twice or skip one: a chunk starts after the last key written,
  whatever was inserted or deleted before it. A row added behind the cursor is simply not in that
  day's export. The drill still counts duplicates and compares the total with the manifest.
- ⚠️ `wrangler r2 object list` returned nothing useful, so the drill walks each table's chunks by
  key until one is missing. A failed download throws; it is never read as the end of a table.

## Not built yet

- **The telemetry beacon and App Links.** The API is on fandex.org since 2026-10-10; these two parts of phase 3 are not.
- **Steam**: sign-in and the owned-games proxy. Phase 5 by decision.
- **Episode fill on demand.** Seeded shows have their episodes. A show resolved later does not;
  the plan has the client take episodes from Trakt.
- **Dropping stale rows.** A `browsed = 1` row nobody acted on should be dropped, not refreshed,
  once it is 150 days old. The first such row is due in March 2027. Needs the same schema-derived
  "is anything pointing at this" check erasure uses, before anything deletes. ⚠️ Two costs to
  price first. Deleting ONE title read 24,834 rows on the local D1 with 12,411 episode rows in
  the table (2026-10-10): the cascade looks through every state row, because no index on the
  state tables leads with `media_item_id`. And a deleted pool title has to drop `pool_count`.
- **`franchise_members`**: 10,841 rows, built as `data/d1-seed/90_franchise_members.deferred.sql`
  and not applied. The franchise rail is phase 5.
- **The refetch step of a restore.** See "Backup and restore" below: titles added after the base
  come back as rows without content, and nothing refetches them yet. 14 on 2026-10-05.
