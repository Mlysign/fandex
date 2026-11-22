# Launch-day runbook: Tuesday 16 February 2027

Open this when something looks wrong. Each part stands alone.

Three things are live: the API (`fandex-api`, `api.fandex.org`, a Worker on D1), the website (`fandex-web`, fandex.org, static files plus a small Worker) and the Android app. All of it runs on Cloudflare's free plan, and stays there: Nils decided against Workers Paid (no added cost). **Nothing in this runbook buys a limit back.** Every fix is a switch, a lower cap, or waiting for the day to turn.

**Every free-plan daily limit, every daily cap and every D1 daily allowance resets at midnight UTC. In February that is 01:00 in Germany.**

Run every `npx wrangler` command from `worker/` unless the step says otherwise. Run every `node` command from the repo root.

Sources: `docs/worker.md`, `docs/website.md`, `docs/play-store.md`, `STATUS.md`, `worker/wrangler.jsonc` and the Worker's source, as of 2026-11-22. A number is quoted with its date and the database it came from.

---

## 1. The day before (Monday 15 February)

### Deployed

- [ ] Open `STATUS.md`. Check that the "Deployed" line for `fandex-api` names the commit you expect.
- [ ] List the API's recent versions and write down the ID of the current one. You need it to roll back.

```
npx wrangler versions list
```

- [ ] List the API's deployments too. The current one is the top row.

```
npx wrangler deployments list
```

- [ ] Check that every migration is applied on the live database. The newest file in `worker/migrations/` on 2026-11-22 is `0009_show_seasons_air_date.sql`.

```
npx wrangler d1 migrations list fandex --remote
```

- [ ] Ask the API whether it answers.

```
curl https://api.fandex.org/v1/health
```

  Normal: `"ok":true`, and `today` shows small numbers. `openProviderCircuits` is `{}` (this is one isolate's view only).

### The free plan

- [ ] Check in the Cloudflare dashboard that the account is on the Workers Free plan, as decided. Nothing below assumes anything else.
- [ ] Write down a normal day's numbers from the dashboard, so launch day has something to compare with: Workers requests for the whole account (all three Workers together), D1 rows read and D1 rows written. None of the three has a measured normal day except reads (about 290,000, live D1, 2026-10-15).
- [ ] Read part 3, "What breaks first". On launch day the daily limits are the risk, not the code.
- [ ] Cloudflare emails the account when D1's daily read or write limit is reached (Cloudflare's D1 changelog, 2026-09-01). Check that the account's address is one you will see on the day.

### Backups

- [ ] Check that last night's export reached R2. It runs at about 01:20 UTC to `fandex-backups/d1/{day}/`, and its `manifest.json` is written last, so a day with a manifest is complete. The restore drill reads the newest complete day, locally, and changes nothing live:

```
node worker/scripts/restore-drill.mjs
```

- [ ] Confirm `rr-2026-10-04.db` is still in `data/prod-snapshots/` and in R2 `fandex-backups/railway/`. Never delete it.
- [ ] D1 Time Travel covers the last 7 days on its own. Nothing to run.

### The website build

- [ ] Open `C:\fx\site-logs`. Monday's log should end with a publish. If `LAST-RUN-FAILED.txt` is there, the night failed.
- [ ] If it failed, run the nightly task by hand:

```
Start-ScheduledTask "Fandex nightly site"
```

- [ ] If the log says Wrangler's login lapsed, log in again from `worker/`:

```
npx wrangler login
```

- [ ] Remember: the nightly task publishes only the newest commit on `origin/main` whose CI passed. A fix that is not pushed, or pushed with red CI, is not on the site.
- [ ] Do not let the PC sleep through 06:30 on launch day. The site is rebuilt by that task on this PC.

### Tabs to have open

| Tab | Address or place |
|---|---|
| The API's health | `https://api.fandex.org/v1/health` |
| The website | `https://fandex.org` |
| The website's second address (if the domain fails) | `https://fandex-web.fandex-worker.workers.dev` |
| Cloudflare: `fandex-api` | Workers and Pages, `fandex-api`, its Metrics and Logs |
| Cloudflare: `fandex-web` | Workers and Pages, `fandex-web` |
| Cloudflare: D1 `fandex` | Storage and Databases, D1, `fandex`, Metrics |
| Fandex admin: pageviews | `https://fandex.org/dev/analytics` (signed in as admin) |
| Fandex admin: score | `https://fandex.org/dev/score` |
| Play Console | the `org.fandex.app` entry |
| A terminal in `worker/` | for `wrangler tail` and `d1 insights` |

**Do not keep `/dev/users` open or refresh it.** It read 30,597 rows a view with one account (live D1, 2026-10-11), and it grows with every account. 160 views would have spent a whole day's reads then (`docs/worker.md`); with launch-day accounts it costs far more.

---

## 2. What to watch during the day

| Signal | Where to look | Normal | Act at |
|---|---|---|---|
| API answers | `curl https://api.fandex.org/v1/health` | `"ok":true` | Any non-200, or a D1 error in the body |
| **Requests today, whole account** | Dashboard, Workers and Pages overview (all three Workers count against one 100,000) | Not measured | 60,000. Past 100,000 every Worker answers error 1027 until 01:00 (part 3). |
| **D1 rows written today** | Dashboard D1 Metrics | No measured normal day. The seed cost 79,770 (D1's own count, 2026-10-04). | 60,000. Past 100,000 every query fails until 01:00. |
| **D1 rows read today** | `npx wrangler d1 insights fandex --time-period 1d --sort-type sum --sort-by reads --limit 15 --json` (works while D1 refuses queries); dashboard D1 Metrics | About 290,000 rows in a day (live D1, 2026-10-15) | 2.5 million (half of the 5 million). Find the top query in the insights output. |
| CPU over the limit | `npx wrangler tail fandex-api --format json`: look for `"outcome":"exceededCpu"`; error 1102 in a browser | Reads 1 to 8 ms; fetch paths 4 to 7 ms warm, up to 19 to 20 ms cold (live Worker, `wrangler tail`, `docs/worker.md`). About fifty cold requests, none terminated. | 1102 on more than the odd request. Part 3, "CPU", says what to turn down. |
| Daily budgets spent | `curl https://api.fandex.org/v1/health` shows `fetches`, `userWrites`, `hardcover`, `covers`. For every budget, see the query below. | Far under each cap (STATUS.md) | 75% of any cap in part 3 |
| A provider failing | `/v1/health` `openProviderCircuits`; `wrangler tail` | `{}` | A host listed there is being refused by this isolate |
| Rate limiting (429) | `wrangler tail`: status 429 with `rate-limited` | Rare | Many 429s from different users, which means shared IPs are hitting a limit |
| Budget refusals (503) | `wrangler tail`: status 503 with `budget-exhausted` | None | The first one. Part 3 says which cap and what raises it. |
| Pageviews | `/dev/analytics` | Not measured for a launch | Counting stops at 5,000 views a day (`DAILY_PAGEVIEW_CAP`). Harmless: the beacon still answers 200. |
| Website up | Open `https://fandex.org` and one item page | Loads, no 404 | Any error page. See part 6. |
| App crashes and ratings | Play Console, the app's entry | Not measured | Not verified; see part 7 |

Every budget spent today, from the live database. It reads one small table:

```
npx wrangler d1 execute fandex --remote --command "SELECT kind, n FROM daily_budget WHERE day = date('now') ORDER BY n DESC"
```

A row named `user_writes:{id}` is one account's share.

---

## 3. The limits

### What breaks first on the free plan

Three daily limits can each stop Fandex for the rest of the UTC day, and none of them can be raised while Nils stays on the free plan. All three are **per account**, shared by the API, the website's Worker and the www redirect. Watch these three before anything else.

1. **Workers requests: 100,000 a day, the whole account** (Cloudflare limits page, read 2026-11-22; `worker/wrangler.jsonc` lines 3 to 7). Past it, a Worker answers **error 1027** until 01:00. What still works: fandex.org's static pages, because a request that matches a file never runs the Worker (`mobile/web/wrangler.jsonc` has no `run_worker_first`; Cloudflare: "Requests to static assets are free and unlimited"). What stops: every API call from the app, every `/v1/*` call from the website (sign-in, ratings, search beyond the device), and the pageview beacon. What spends it:
   - every app start and sync (several API calls each; never counted),
   - every website pageview, which sends one beacon to `/v1/t/pv` even after `DAILY_PAGEVIEW_CAP` stops counting (`PV_SCRIPT` in `mobile/web/build.mjs`),
   - the two cron triggers, about 1,584 runs a day (`worker/wrangler.jsonc:42`, every minute and every ten minutes), if cron runs count. [not verified]
   Lowering a cap does not save requests: a refused call is still a request. The only lever is fewer calls, and there is no switch for that.
2. **D1 rows written: 100,000 a day.** Past it **every query fails until 01:00, reads included**, `/v1/health` too. The caps inside the API do NOT add up to less than this. At their defaults: new titles about 24,000 (2,000 × about 12), user writes 40,000, counted pageviews 15,000 (5,000 × 3), plus one counter write for every capped call that fits (up to 4,000 catalog pages, 4,000 Hardcover calls, 3,000 covers, 150 calendar builds, one per lookup call). That is about 90,000 before the cron and before any sign-up, which no cap covers. **If writes pass 60,000 by the afternoon, lower `DAILY_PAGEVIEW_CAP` first** (it costs only statistics), then `DAILY_COVER_CAP` and `HARDCOVER_DAILY_CAP`.
3. **D1 rows read: 5,000,000 a day.** Past it every query fails until 01:00 (this happened on 2026-10-10). The two open read routes are capped at about 2.2 million together (`DAILY_DELTA_CAP` and `DAILY_LOOKUP_CAP`, in the caps table below). Not capped: a signed-in device's state pull (up to 4,000 rows a page, `worker/src/index.ts:752`, rate limited only), the admin pages and the nightly export.
4. **CPU: 10 ms a request and a cron run.** Not a daily limit, but the one that can fail single requests all day. Reads are far inside it. Fetching a new title from TMDB or IGDB and building a calendar month reach 19 to 20 ms on a cold isolate. Cloudflare tolerates the odd one and terminates a Worker that does it consistently (error 1102). If 1102 shows up often: set `IGDB_ENABLED` to `0` if the 1102s are on game routes, and lower `DAILY_CALENDAR_CAP` if they are on calendar months. New films and shows have no switch of their own: `DAILY_FETCH_CAP` needs a deploy (part 4).

### Platform limits (Cloudflare free plan)

Read 2026-10-04 for the repo (`worker/wrangler.jsonc` lines 3 to 7, `docs/worker.md` "Limits") and checked against Cloudflare's limits page on 2026-11-22.

| Limit | Value | What users see when it is hit | What you can do on the free plan |
|---|---|---|---|
| Requests per day, whole account | 100,000 | Error 1027 from every Worker path until 01:00. Static pages on fandex.org still load. | Nothing until 01:00 |
| D1 rows written per day | 100,000 | **Every query fails until 01:00, reads included.** | Lower the caps early (above). Nothing once it is hit |
| D1 rows read per day | 5,000,000 | **Every query fails until 01:00, `/v1/health` included.** The static website keeps serving. | Lower `DAILY_DELTA_CAP` and `DAILY_LOOKUP_CAP` early. Nothing once it is hit |
| CPU per request and per cron run | 10 ms | Error 1102 on a request Cloudflare terminates | Turn the fetching route down (above) |
| Subrequests per invocation | 50 | That request fails | Nothing |
| D1 queries per invocation | 50 | That request fails | Nothing |
| D1 database size | 500 MB (110 MB after the seed, 2026-10-04) | Writes fail | Not a launch-day risk |
| Website files per deploy | 20,000 (10,101 in the build of 2026-11-21) | The publish fails | Not a launch-day risk |
| R2 free tier | 10 GB, 1 million writes, 10 million reads a month (Cloudflare's figures, not in the repo) | Not verified | Not a launch-day risk |

### Daily caps inside the API (reset 01:00)

A refused cap answers **503 `budget-exhausted`**. Each is read at call time, so a new value set as in part 4 applies to the next request.

| Cap (variable) | Default | Read in | Counts | When hit, users see | Cost of raising it |
|---|---|---|---|---|---|
| `DAILY_DELTA_CAP` | 4,000 pages | `worker/src/index.ts:146` | Catalog sync pages, any caller | "The catalog cannot be synced again until tomorrow (UTC)." A device keeps the copy it has. A new website visitor still gets the catalog from the `/catalog/` files. | Up to ~400 rows read a page: 4,000 pages is up to 1.6M reads |
| `DAILY_LOOKUP_CAP` | 300,000 refs | `worker/src/index.ts:229` | Provider ids looked up, mostly library syncs (up to 2,000 a call) | "Fandex cannot look up more titles until tomorrow (UTC)." A library import stops. | Two primary-key reads a ref: 300,000 refs is about 600,000 reads |
| `DAILY_FETCH_CAP` | 2,000 new titles | `worker/src/catalog/resolve.ts:142` | New catalog titles fetched from a provider | "The catalog cannot fetch new titles until tomorrow (UTC)." Titles Fandex already holds still open. | About 12 row writes a title: 2,000 is ~24,000 writes |
| `DAILY_USER_WRITE_CAP` | 40,000 rows | `worker/src/me.ts:377`, `worker/src/index.ts:772` | Every account's state writes together | "Fandex cannot save more changes until tomorrow (UTC)." Ratings, wishlist and ticks stop saving for everybody. | One row write each, out of D1's 100,000 |
| `DAILY_USER_WRITE_CAP_PER_USER` | 15,000 rows | `worker/src/me.ts:374`, `worker/src/index.ts:743` | One account's share of the above | The same message, for that account only. **A large Trakt import can reach this**: Nils's own account held 12,411 episode rows (2026-10-05). | Within the shared cap |
| `DAILY_CALENDAR_CAP` | 150 builds | `worker/src/calendar.ts:255`, `:264`, `:330` | Calendar month builds | 503 on a month not built yet. Built months still serve. | 1 row write a month |
| `DAILY_STEAM_CAP` | 2,000 units (2 per sync, so 1,000 syncs) | `worker/src/steam.ts:52` | Steam library reads | Steam sync fails for the day | Steam allows 100,000 calls a day |
| `HARDCOVER_DAILY_CAP` | 4,000 | `worker/src/hardcover.ts:48` | Requests to Hardcover (their free plan: 5,000 a day, 60 a minute) | Nothing visible: book routes answer Open Library's half alone | Do not pass 5,000 |
| `HARDCOVER_WALK_DAILY_CAP` | 600 | `worker/src/hardcoverWalk.ts:93` | The cron's share of the above | Nothing visible | Comes out of the 4,000 |
| `DAILY_COVER_CAP` | 3,000 | `worker/src/covers.ts:92` | Book covers copied from Hardcover | "No more covers can be copied today." Covers already copied still serve. | R2 writes |
| `DAILY_BASELINE_CAP` | 2,500 | `worker/src/baseline.ts:94` | The baseline walk (finished for draw 1) | Nothing; the walk is parked | Not a launch-day concern |
| `DAILY_PAGEVIEW_CAP` | 5,000 | `worker/src/telemetry.ts:159` | Website pageviews counted | Nothing: the beacon answers 200 and stops counting | 3 row writes a view |
| `platform_builds` | 40 (in code) | `worker/src/index.ts:163` | Per-country platform list builds | "This country's line-up is not built yet." | Code change |
| `baseline_builds` | 24 (in code) | `worker/src/index.ts:173` | Baseline list rebuilds | "The baseline list is not built yet." | Code change |

The defaults are the `DEFAULT_*` constants beside each line. `DAILY_FETCH_CAP` is also set in `worker/wrangler.jsonc` (`"2000"`); the others are not set anywhere and use the default.

**Before raising a read cap, add up the reads.** Delta at 4,000 pages (1.6M) plus lookup at 300,000 refs (0.6M) is already under half of the 5M on purpose (`docs/worker.md`). Raising both can let the open routes spend the whole day's reads.

**Do not raise a write cap on the free plan.** Fetch (~24,000), user writes (40,000) and counted pageviews (15,000), with the counter writes, are already about 90,000 of D1's 100,000 before the cron ("What breaks first", above).

### Rate limits (per Cloudflare location, not exact)

Set in `worker/wrangler.jsonc` lines 45 to 52. **Changing one needs an edit of that file and a deploy.** A refused request answers **429 `rate-limited`**.

| Binding | Limit | Keyed by | Guards |
|---|---|---|---|
| `RL_READ` | 120 a minute | IP (IPv6 by its /64); signed-in state pages by user | `/v1/catalog/delta`, `/v1/lookup`, state reads |
| `RL_RESOLVE` | 30 a minute | IP | Resolve that fetches, game search, browse, facets, book and board-game search, release dates, covers, platform and baseline builds |
| `RL_AUTH` | 10 a minute | IP | Sign-in |
| `RL_WRITE` | 30 a minute | user | State writes, score report |

Many people behind one address (a university, a mobile carrier's shared IP) share one IP's limit.

### Provider quotas

| Provider | Quota (from `PLATFORMS.md` and the code) | When hit |
|---|---|---|
| TMDB | No monthly cap, 50 requests a second by IP | That isolate's circuit opens; resolves of new films and shows fail |
| IGDB | No monthly cap, 4 requests a second | Game search, browse and new games fail. A refused IGDB query counts toward shutting game search for everybody (`docs/worker.md`). |
| Hardcover | 5,000 a day, 60 a minute, burst of 10 | Capped at 4,000 here; books fall back to Open Library |
| Steam | 100,000 calls a day | Capped at 1,000 syncs here |
| Open Library, BGG | Not stated in the repo | Not verified |

---

## 4. Switches

Every switch below is read at call time, so it needs no code change. **Only what was found in the code is listed.**

### How to set one

These names are not in `worker/wrangler.jsonc` (except `DAILY_FETCH_CAP`, below), so a plain dashboard variable would be wiped by the next `wrangler deploy`. Set them as Worker secrets instead, which a deploy keeps. From `worker/`:

```
npx wrangler secret put IGDB_ENABLED
```

Wrangler asks for the value. Type it (for example `0`) and press Enter. The value is not secret; a secret is just the binding that survives a deploy. To undo, delete it:

```
npx wrangler secret delete IGDB_ENABLED
```

Replace `IGDB_ENABLED` with the switch's name. `wrangler secret put <key>` and `wrangler secret delete <key>` exist in the repo's Wrangler (4.162.0, `--help` read 2026-11-22). `push-secrets.mjs` uses `wrangler secret bulk` instead (`worker/scripts/push-secrets.mjs:7`).

### The switches

| Switch | Value to turn down | Read in | What users then see | Turn it back on |
|---|---|---|---|---|
| `IGDB_ENABLED` | `0` (or `false`) | `src/lib/sources/igdb.ts:43`, declared `worker/src/env.ts:63` | No IGDB call anywhere. Games' browse and search are empty. Games already stored still open. The cron's IGDB step stops. | `npx wrangler secret delete IGDB_ENABLED` (default is ON) |
| `HARDCOVER_ENABLED` | `0` (or `false`) | `src/lib/sources/hardcover.ts:67`, passed in at `worker/src/hardcover.ts:22` | Books come from Open Library alone, as before Hardcover. `/v1/features` says `hardcover: false` (`worker/src/shelves.ts:113`). A cover not copied yet answers 404 (`worker/src/covers.ts:90`); copied covers still serve. The Hardcover walk stops. | `npx wrangler secret delete HARDCOVER_ENABLED` |
| `DAILY_DELTA_CAP` | a lower number, `0` to stop | `worker/src/index.ts:146` | Catalog sync answers 503 (part 3). Website visitors still start from `/catalog/` files. | Delete the secret (default 4,000) |
| `DAILY_LOOKUP_CAP` | lower, `0` to stop | `worker/src/index.ts:229` | Library imports stop with 503 | Delete (default 300,000) |
| `DAILY_USER_WRITE_CAP` | lower or higher | `worker/src/me.ts:377`, `worker/src/index.ts:772` | Saving stops for everybody with 503 once reached | Delete (default 40,000) |
| `DAILY_USER_WRITE_CAP_PER_USER` | lower or higher | `worker/src/me.ts:374`, `worker/src/index.ts:743` | One heavy importer stops with 503 sooner | Delete (default 15,000) |
| `DAILY_CALENDAR_CAP` | lower, `0` to stop | `worker/src/calendar.ts:255` | Unbuilt months answer 503 | Delete (default 150) |
| `DAILY_STEAM_CAP` | lower, `0` to stop | `worker/src/steam.ts:52` | Steam sync fails with an error | Delete (default 2,000) |
| `HARDCOVER_DAILY_CAP` | lower | `worker/src/hardcover.ts:48` | Books fall back to Open Library sooner | Delete (default 4,000) |
| `HARDCOVER_WALK_DAILY_CAP` | lower, `0` to stop | `worker/src/hardcoverWalk.ts:93` | Nothing; the cron walk spends less | Delete (default 600) |
| `DAILY_COVER_CAP` | lower, `0` to stop | `worker/src/covers.ts:92` | New book covers do not appear | Delete (default 3,000) |
| `DAILY_PAGEVIEW_CAP` | lower, `0` to stop | `worker/src/telemetry.ts:159` | Nothing; fewer pageviews counted | Delete (default 5,000) |
| `DAILY_BASELINE_CAP` | `0` | `worker/src/baseline.ts:94` | Nothing; the walk is already parked | Delete (default 2,500) |

How a cap works (`worker/src/budget.ts:19` and `:52`): any whole number from `0` up is taken; `0` refuses the first call. Anything else that is not a number falls back to the default, so a typo leaves the default in place. A cap already exceeded today stays refused in that isolate until midnight UTC, even if you raise it, until the isolate is replaced (a secret change creates a new version, which should replace them; not measured).

### Switches that need the token again to undo

| Switch | Read in | What users then see | Turn it back on |
|---|---|---|---|
| Delete `BGG_TOKEN` | `worker/src/shelves.ts:47` and `:64` | Already the state today: board games are not live because no token is set (`docs/app.md` line 30). Without it the type is hidden (`/v1/features` false, `worker/src/shelves.ts:113`) and routes answer 503 `not-configured` | `node worker/scripts/push-secrets.mjs` (from the repo root; pushes every secret from `.env`, prints names and lengths only) |
| Delete `STEAM_API_KEY` | `worker/src/steam.ts:41`, `worker/src/cron.ts:536` | Steam sync answers 503 "Steam sync is not switched on." The Steam tags walk stops. | `node worker/scripts/push-secrets.mjs` |

`HARDCOVER_TOKEN` works the same way, but use `HARDCOVER_ENABLED` instead: it keeps the token in place.

### `DAILY_FETCH_CAP` is different

It is a plain variable in `worker/wrangler.jsonc` line 60 (`"2000"`). To change it, edit that line and deploy:

```
npx wrangler deploy
```

**That deploys the code in this checkout too.** Check `git status` and `git log -1` first, so you deploy exactly what is live plus this one line. Whether a secret of the same name can override it is not verified (part 7).

### Not switches

- The rate limits: an edit of `worker/wrangler.jsonc` and a deploy.
- `platform_builds` (40) and `baseline_builds` (24): numbers in the code.
- The website has no switch. It is files.

---

## 5. Rolling back

### The API

1. List the recent versions. Find the one before the bad deploy (you wrote its ID down on Monday).

```
npx wrangler versions list
```

2. Roll back to it. Replace the ID.

```
npx wrangler rollback 12345678-1234-1234-1234-123456789abc --message "launch rollback"
```

   `wrangler rollback` takes the version ID, `--message` and `--yes` (Wrangler 4.162.0 in `worker/node_modules`). With no ID it offers the previous version.

3. **Then reset the kept counts.** The old code may write without dropping them, and a count answered too low makes every device download its catalog again. Both are safe at any time (`docs/worker.md`):

```
npx wrangler d1 execute fandex --remote --command "UPDATE users SET counted_items = NULL, counted_episodes = NULL, counted_hidden = NULL"
```

```
npx wrangler d1 execute fandex --remote --command "DELETE FROM kv WHERE key = 'pool_count'"
```

4. A rollback does not undo a migration. If the bad deploy came with a migration, the old code runs against the new schema. Check with `npx wrangler d1 migrations list fandex --remote` before you roll back.

### The website

There is no documented rollback for `fandex-web`. What the docs give:

- A publish that failed part way leaves the last good build in `mobile/web/dist/`. Republish it:

```
node mobile/web/publish.mjs --skip-build
```

  This republishes whatever build is in `dist/` on the machine you run it on. If the bad build finished, `dist/` holds the bad one.

- To go back to an earlier commit: revert the commit on `main`, push, wait for CI, then run the nightly task.

```
Start-ScheduledTask "Fandex nightly site"
```

- A Wrangler rollback of `fandex-web` is possible in principle (part 7). Never `wrangler deploy` the website by hand.

Stop the `app-web` dev server before any publish.

### The database

**D1 Time Travel**: any minute of the last 7 days. It restores the database in place, so every write after that minute is lost: ratings, accounts, everything.

1. Get the bookmark for the minute before the damage (UTC, RFC3339):

```
npx wrangler d1 time-travel info fandex --timestamp=2027-02-16T10:00:00Z
```

2. Restore to it, using the bookmark the first command printed:

```
npx wrangler d1 time-travel restore fandex --bookmark=BOOKMARK
```

   `--timestamp` works in place of `--bookmark`; never both.

3. Reset the kept counts (the two commands under "The API" above).

**The R2 export**: the nightly export plus the base (`data/d1-seed/`, from `rr-2026-10-04.db`). Rebuilt locally by the drill:

```
node worker/scripts/restore-drill.mjs --emit-sql
```

That writes the files a real restore would apply, under `data/d1-restore/`. Applying them to D1 costs about 80,000 row writes: **a day on which nothing else may write**. Titles resolved after the base come back with no content (14 on 2026-10-05) and nothing refetches them yet. Use Time Travel first; the export is for damage older than 7 days.

### The app on Google Play

What cannot be undone:

- A `versionCode` Play has seen can never be used again.
- The package name `org.fandex.app` can never change.
- A build installed on a phone stays until the user updates.

What you can do: ship a new build with a **higher** `version` and `android.versionCode` in `mobile/app.json`, built from the last good commit (`docs/play-store.md`, "Building the bundle"):

```
npx expo prebuild --platform android --no-install
```

```
./gradlew.bat bundleRelease -PfandexPlay
```

Both run in the short-path copy, not in the repo: `expo prebuild` in `C:\fx\mobile` after copying `mobile/` and `src/` there, `gradlew.bat` in `C:\fx\mobile\android` (`docs/play-store.md` "Building the bundle", `docs/app.md` "Building the APK"; the repo's path is too long for the native build). Then upload `android/app/build/outputs/bundle/release/app-release.aab` in Play Console. A cold build took 8 min 17 s (2026-10-23), plus Play's review.

Most app problems on launch day are API problems. Fix the API, and every installed app is fixed with it.

---

## 6. If it goes down anyway

1. **Is it the API or the website?** Open `https://fandex.org`. If it loads, the files are fine. Then run `curl https://api.fandex.org/v1/health`.
2. **If the website does not load**, open `https://fandex-web.fandex-worker.workers.dev`. If that works, the domain is the problem, not the build. If neither works, check the last log in `C:\fx\site-logs` and part 5, "The website".
3. **If health answers error 1027**, the account is past 100,000 Worker requests today. Nothing brings it back before 01:00. Static pages on fandex.org still load. Post a short note where launch traffic comes from, so people try again tomorrow.
4. **If health fails with a D1 error**, D1 is out of daily reads or writes (Cloudflare's email says which). Run `npx wrangler d1 insights fandex --time-period 1d --sort-type sum --sort-by reads --limit 15 --json` (it works while D1 refuses queries; use `--sort-by writes` for writes). Nothing brings D1 back before 01:00. Find the top reader or writer and switch its route down (part 4) so it does not happen again tomorrow.
5. **If health works but users report errors**, run `npx wrangler tail fandex-api --format json` and look at the status codes: `exceededCpu` means the 10 ms limit (part 3, "What breaks first", item 4); 503 `budget-exhausted` means a cap (part 3); 429 means a rate limit; 502 means a provider.
6. **If one provider is failing** (games or books only), switch it off: `IGDB_ENABLED` or `HARDCOVER_ENABLED` to `0` (part 4). The rest keeps working.
7. **If it started right after a deploy**, roll back the API (part 5), then reset the kept counts.
8. **If data is wrong or missing**, stop writing first: set `DAILY_USER_WRITE_CAP` to `0`. Then decide on Time Travel (part 5). Do not run SQL by hand that takes titles out of the pool: every device would download its catalog again.
9. **Write down** the time, what you saw and what you changed. Every switch you set today has to be deleted again.

---

## 7. Not verified

Things this runbook could not confirm from the repository:

- **The Cloudflare dashboard paths** (Workers and Pages, D1 Metrics, plan page, the account's request count). The repo documents only one dashboard path (SSL/TLS, Edge Certificates). Check them on Monday.
- **What a request past 100,000 looks like on `api.fandex.org` and `fandex.org`.** Cloudflare's limits page says error 1027, with a fail open or fail closed choice on a *route*. Both Workers are on custom domains, not routes, and no doc says which applies there. The static files should keep serving either way (no `run_worker_first`).
- **Whether cron runs and service-binding calls count toward the 100,000.** The two crons fire about 1,584 times a day. Every `/v1/*` call on fandex.org runs `fandex-web` and then `fandex-api` through the binding; Cloudflare's pricing page says a binding call is not billed as a second request on the paid plan, and says nothing for the free plan's daily count.
- **How many requests one app start makes.** Never counted, so the number of daily users the 100,000 allows is unknown. Count it on Monday with `wrangler tail` and one cold start of the app.
- **A normal day's row writes and requests.** Never measured; only a day's reads (about 290,000, 2026-10-15) is on record.
- **The cron's daily row writes** (the export, the walks). Not measured, and they come out of the same 100,000.
- **That `wrangler secret put` is the right way to set a switch.** The repo never does it for a switch; `push-secrets.mjs` uses `wrangler secret bulk`. Confirm on Monday with a harmless one (`DAILY_PAGEVIEW_CAP`), then delete it. Also not measured: how fast a secret reaches every isolate.
- **That `process.env.IGDB_ENABLED` sees a secret.** `igdb.ts` reads `process.env`, filled from bindings by `nodejs_compat` (comment in `worker/wrangler.jsonc`). `TMDB_API_KEY` is a secret read the same way, so it should hold; it was not tested.
- **Whether a secret named `DAILY_FETCH_CAP` can override the variable of the same name.** It may be refused as a duplicate binding.
- **A rollback of the website Worker** (`npx wrangler rollback --name fandex-web` from `worker/`). The command takes `--name`, but no doc says whether it brings back the files of that version.
- **Switching the cron off without a deploy** (the triggers in the dashboard). Not documented, and a deploy restores them from `wrangler.jsonc`.
- **The exact steps to apply an R2 export to the live D1.** Only the local drill is documented.
- **What the app shows on a 503 `budget-exhausted` or a 429.** The API's messages are in the code; how the app displays them was not checked.
- **Play Console**: where crash and ANR numbers live, staged rollout, and whether a rollout can be halted. Not in the docs. The app was not yet on Play on 2026-11-22 (paused on the account upgrade; trader status due 2027-02-01).
- **Open Library and BGG rate limits.** Not stated in the repo.
- **`--time-period`.** The help of Wrangler 4.162.0 spells the flag `--time-period`; `docs/worker.md` writes `--timePeriod`. Both are probably accepted (yargs), but only the first was read.
- **For the record:** `docs/worker.md` still says Workers Paid lifts CPU to 30 seconds. Cloudflare's limits page now says 5 minutes. It does not matter while the plan is Free.

## Checked on 22 Nov 2026

Commands checked with `npx wrangler <cmd> --help` in `worker/` (Wrangler 4.162.0). Nothing was run against the live site or the live database.

| Claim | Where it is proven | Verdict |
|---|---|---|
| The account stays on the free plan | Nils's decision, 22 Nov 2026 | Rewritten around it: the "decide on Workers Paid" step, "Go to Workers Paid" and every "What raises it: Workers Paid" are gone |
| Free plan: 100,000 requests a day, 10 ms CPU, 50 subrequests, 50 D1 queries | `worker/wrangler.jsonc` lines 3 to 7; `docs/worker.md` "Limits"; Cloudflare limits page | Confirmed. The 100,000 is per account (Cloudflare), which the draft did not say |
| Past 100,000 requests: "not verified" | Cloudflare limits page: error 1027 until midnight UTC | Now known in general; the custom-domain case stays open |
| D1 5,000,000 reads and 100,000 writes a day, then every query fails | `docs/worker.md` "Limits"; `worker/src/budget.ts:3-7`; Cloudflare D1 changelog 2026-09-01 | Confirmed |
| Static pages keep serving when the Worker is refused | `mobile/web/wrangler.jsonc` (no `run_worker_first`); `docs/app-plan.md:54` | Confirmed by docs; not seen happen |
| CPU 1 to 8 ms on reads, up to 19 to 20 ms cold on fetch paths, about fifty requests none terminated | `docs/worker.md` "CPU, measured on the live Worker" | Confirmed |
| Workers Paid lifts CPU to 30 seconds | Cloudflare limits page: 5 minutes | **Out of date**, and removed with the paid plan |
| Newest migration `0009_show_seasons_air_date.sql` | `worker/migrations/` | Confirmed |
| `versions list`, `deployments list`, `d1 migrations list fandex --remote`, `rollback [id] --message --yes`, `secret put/delete <key>`, `tail [worker] --format json`, `d1 time-travel info/restore --timestamp/--bookmark` | `--help` of each | Confirmed |
| `d1 insights ... --timePeriod 1d` | `--help`: the flag is `--time-period` | **Fixed** to `--time-period` |
| `/v1/health` returns `ok`, `today` (`fetches`, `userWrites`, `hardcover`, `covers`), `openProviderCircuits` (one isolate's view) | `worker/src/index.ts:343-356` | Confirmed |
| Nightly export about 01:20 UTC to `fandex-backups/d1/{day}/`, manifest written last | `docs/worker.md` "Backup and restore"; `worker/src/cron.ts:191-194` | Confirmed |
| Restore drill, `--emit-sql`, output under `data/d1-restore/` | `worker/scripts/restore-drill.mjs:24`, `:101`, `:298` | Confirmed |
| `rr-2026-10-04.db` must never be deleted | `STATUS.md` line 32; `docs/worker.md` | Confirmed |
| Time Travel, last 7 days | `docs/worker.md` "Backup and restore" | Confirmed |
| Nightly site task, 06:30, `C:\fx\site-logs`, `LAST-RUN-FAILED.txt`, newest green commit on main, `wrangler login` in `worker/` | `docs/website.md` "The nightly rebuild" | Confirmed |
| `fandex-web.fandex-worker.workers.dev` as the second address | `docs/website.md` line 31 | Confirmed |
| `/dev/users` read 30,597 rows a view | `docs/worker.md` (live D1, 2026-10-11) | Confirmed; "160 views spent a day" was "would spend", fixed |
| Every cap's default and file:line | `grep` of `worker/src` on 2026-11-22 (list in the caps table) | Confirmed, except `platform_builds` and `baseline_builds`: **lines 163 and 173**, not 162 and 172, fixed |
| A cap takes any whole number from 0; anything else falls back to the default; a refused kind stays refused in that isolate until the day turns | `worker/src/budget.ts:19-35` and `:52-55` | Confirmed |
| Every capped call costs one row write | `worker/src/budget.ts:3-7` and `:25-31` | Confirmed; added to the write arithmetic |
| A counted pageview is three row writes | `worker/src/telemetry.ts:14` and `:26` | Confirmed |
| `DAILY_FETCH_CAP` set in `worker/wrangler.jsonc` line 60 | `worker/wrangler.jsonc:60` | Confirmed |
| Rate limits `RL_READ` 120, `RL_RESOLVE` 30, `RL_AUTH` 10, `RL_WRITE` 30 a minute, lines 45 to 52 | `worker/wrangler.jsonc:45-52` | Confirmed |
| Two cron triggers | `worker/wrangler.jsonc:42` (every ten minutes and every minute) | Confirmed; the draft did not mention them |
| `IGDB_ENABLED` and `HARDCOVER_ENABLED`: `0` or `false` turns off, default on | `src/lib/sources/igdb.ts:42-45`; `src/lib/sources/hardcover.ts:66-69`; `worker/src/env.ts:63` and `:65` | Confirmed |
| `HARDCOVER_ENABLED=0` refuses a new cover copy | `worker/src/covers.ts:90` | Confirmed; it answers 404, now said |
| Deleting `BGG_TOKEN` hides board games | `worker/src/shelves.ts:47`, `:64`, `:113` | Confirmed; it is already the state today, now said |
| Deleting `STEAM_API_KEY` answers 503 and stops the tags walk | `worker/src/steam.ts:41`; `worker/src/cron.ts:536` | Confirmed |
| `push-secrets.mjs` uses "the same `secret` commands" | `worker/scripts/push-secrets.mjs:7` (`secret bulk`) | **Wrong**, fixed |
| Reset of the kept counts after a rollback | `docs/worker.md` lines 319 and 320; `worker/CLAUDE.md` | Confirmed |
| `publish.mjs --skip-build` republishes the last good build | `docs/website.md` lines 84 and 150 | Confirmed |
| Play bundle commands | `docs/play-store.md` "Building the bundle" | Confirmed; the draft left out that they run in `C:\fx\mobile`, added |
| A cold bundle build took 8 min 17 s | `docs/play-store.md` line 20 | Confirmed |
| Provider quotas: TMDB 50 a second, IGDB 4 a second, Hardcover 5,000 a day, Steam 100,000 a day | `PLATFORMS.md` lines 22, 23, 41 and 111 | Confirmed |
