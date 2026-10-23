# The API Worker and D1

Routes, limits, commands and the test accounts are in `docs/worker.md`. The incidents behind these rules are in memory [[cloudflare-worker-d1]].

## The budget

- **A D1 row WRITE is the budget, and every index is one more.** D1 Free stops every query, reads included, for the rest of the UTC day past 100,000 rows written. A natural key is the PRIMARY KEY of a `WITHOUT ROWID` table; an index exists only where a request path needs it. Price a new table or index in writes per row first. Anything a stranger can trigger that writes goes behind `spend()` in `budget.ts`.
- **A row READ is a budget too: MEASURE a new query's `rows_read`, never estimate it.** Free stops every query past 5 million rows read a day, `/v1/health` included. One join left to the planner read every TMDB link per call and spent the day in 35 calls (2026-10-10). Pin the join order (`CROSS JOIN`, `INDEXED BY`) and assert the plan and `meta.rows_read` in a test.
- **An index whose aggregate reads a column must COVER it**, or the query fetches each whole row (a `media_links` row carries kilobytes of `raw_data`).
- **A route anybody can call that reads many rows needs a limiter AND a daily cap**, like a write. `/v1/lookup` and `/v1/catalog/delta` sit behind `RL_READ` and `spend()` since 2026-10-23. Per user too: one account spends at most `DAILY_USER_WRITE_CAP_PER_USER` of the shared write cap (`me.ts`).
- **Two counts are KEPT, and the statement that changes what one counts drops it in the same batch** (`keptCounts.ts`): a user's state counts on the `users` row, the pool's size in `kv`. A new write to `user_item_state`, `user_episode_state`, `user_hidden_items`, or to a title's `browsed`, owes a drop; `keptCounts.test.ts` fails until it is listed. The pool's size must never be answered too LOW, or every device re-downloads its catalog. No triggers: D1 adds a trigger's changes to the firing statement's `meta.changes`. After SQL by hand or a rollback, NULL the three `counted_*` columns and delete `pool_count`.
- **Nothing is parsed on a read.** A request has 10 ms of CPU. Docs are serialised at write time and spliced into responses as strings; lists are aggregated to JSON inside SQLite. A `JSON.parse` on a list path is the regression.
- **`caches.default` does nothing on workers.dev.** That is why the API is `api.fandex.org`; workers.dev stays on for old APKs. An edge-cache hit goes out with the short `Cache-Control` (`cachedAnswer`), never the edge's week-long one.

## Writes and identity

- **D1 has no interactive transaction, so the schema is the lock.** `db.batch()` is atomic; a read then a write is not. Creating an item is ONE batch whose link insert is a plain `INSERT`, so a lost race fails the batch and leaves no orphan. Don't "simplify" it into `ON CONFLICT`.
- **A discover-time write is insert-only and stamps `browsed = 1`.** It never overwrites or degrades a synced or ingested row.
- **An item's slug is assigned once and never changes** (`ensureItemSlug` in `catalog/ingest.ts`). The public address is `/{type}/{slug}`; a collision within a type gives the newcomer `-{year}`. The old `/{type}/{uuid}` addresses 308 to it, and every link shared before 2026-08-21 depends on that. Thread `slug` into any new card payload. → [[item-urls-are-slugs]]
- **`PUT /v1/me/state` never infers a delete.** Explicit upserts and deletes, no "replace this source": a server-side replace turns a client's failed pull into a wiped library.
- **A `user_id` column is what makes a table personal.** Erasure finds its targets by reading `sqlite_master` for that literal name (`account.ts`), so a personal table named otherwise is skipped and a CATALOG table must not have one. The export uses explicit column lists: a new personal table needs a block added there by hand. → [[account-erasure-and-export]]
- **A sign-in that finds an EXISTING identity checks who owns it.** No session: sign in as the owner. Same user: refresh. Another user: offer the merge, where a conflict is settled by the side the user picks (`mergeSide`), never by `OR IGNORE`, which silently drops somebody's ratings. The rows move through `userScopedTables()`, the list erasure uses. → [[account-merge-and-identity-ownership]]

## Auth and secrets

- **A Google ID token is accepted only with the secret behind its nonce, and the argument is never optional.** Scope stays `openid profile`: adding `email` is a new category of personal data and a privacy-policy change. → [[google-sign-in-new-stack]]
- **`DEV_LOGIN` lives in `worker/.dev.vars` and nowhere else.** It is one of the two gates on `POST /v1/dev/login` (the other is a loopback host). Never a `vars` entry, never a pushed secret. The test pool reads `.dev.vars`, so a test of a DEPLOYED Worker's behaviour passes its own environment. → [[new-stack-test-accounts]]
- **No provider token is stored in D1, and `kv` is never exported.** `user_identities` has no token column by design; the nightly export skips `kv` (the Twitch app token) by name, and a test fails if it reaches R2.
- **A Cloudflare credential never passes through a session.** Wrangler is logged in by OAuth. Secrets go from `.env` to the Worker through `scripts/push-secrets.mjs`, which prints names and lengths only.

## Providers on the Worker

- **A file a stranger can make the Worker fetch is checked by its BYTES.** `covers.ts` keeps JPEG, PNG and WebP by magic number and sends a sandbox CSP: an SVG is an `image/*` that runs script on the site's origin.
- **BoardGameGeek only with `BGG_TOKEN`, and a page showing their data credits BGG.** Without the token the Worker answers 503 `not-configured` and `/v1/features` hides the type; never work around it with an unauthenticated call. A shelf answer (`shelves.ts`) is edge-cached a day: bump `CACHE_VERSION` when what it answers changes. → [[books-and-boardgames]]
- **Hardcover is FACTS ONLY, and a cover is copied, never linked.** No Hardcover rating, review, list or reader count is asked for, stored or shown; `src/lib/sources/hardcoverPure.ts` is the guarantee and its test proves `rating`, `users_count` and `lists_count` never survive parsing. Covers go through `/v1/cover/hardcover/` and R2; a record never carries an `assets.hardcover.app` address. Every call goes through `hardcoverHalf` (`hardcover.ts`), which spends the 5,000-a-day budget first and answers nothing, never a 502, when it is gone. With the token unset or `HARDCOVER_ENABLED=0`, every book route behaves as before Hardcover existed. Open Library's work stays a book's identity; ISBNs are not cross ids. → [[books-and-boardgames]]
- **A module the Worker imports stays free of Node-only APIs**, transitively. `npx wrangler deploy --dry-run` fails the bundle if one slips in.
