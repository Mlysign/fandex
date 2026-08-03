---
plan_id: 2026-08-03-p18-streaming-links-boot-prune-omdb-guard
created: 2026-08-03
status: in_progress
branch: current
---

# P18 streaming links (via lazy self-heal, NOT a re-projection), boot prune, OMDB guard

## Objective

Ship P18 — clickable "Where to watch" rows plus the offer-type second line — by
correcting a wrong premise in `TASKS.md:26`. P18 was deferred because it
"needs a `PROJECTION_VERSION` bump + full-catalog re-projection, the same class
of heavy op that blew the Railway compute budget." Two findings (2026-08-03)
overturn that: (a) a *local* re-projection cannot deliver P18 at all, because
`project.ts` drops the JustWatch `link` **before** storage so it is not in the
stored blob to recover; and (b) the lazy, network-backed, self-healing refetch
path in `enrich.ts:134-192` already exists and is load-bearing — 36% of
`media_links` run below the current version in the dev DB today with no ill
effect. So the correct shape is: bump the constant, add a *metadata-only*
migration that pre-stamps non-TMDB rows forward, and let TMDB rows heal one
detail read at a time. Alongside: a boot-time prune for the browsed tail, an
`omdbConfigured()` short-circuit, and a drift assertion that lets PR17 confirm
on prod whether the `user_library`/`user_watchlist` cache tables can be dropped.

## Decisions

- **What should the streaming rows do?** → **Region JustWatch link + offer-type
  line, both.** TMDB's `watch/providers` carries one `link` per REGION (a
  JustWatch title page), not per provider. Per-provider deep links to
  Netflix/Prime would need the JustWatch Content Partner API, and a JustWatch
  revenue-share deal was declined 2026-07-18. Both features are blocked on the
  same version bump, so they ship together.
- **How is staleness scoped?** → **Pre-stamp non-TMDB rows forward in a
  migration.** A bare constant bump makes *every* row stale, so game detail
  reads would refetch IGDB **and** RAWG for nothing (RAWG detail = 4
  sub-requests each). The migration is an integer-column `UPDATE` — no
  `JSON.parse`, no blob rewrite, no network. A different cost class entirely
  from migration 7, which is the one that hurt.
- **Which rows get stamped forward?** → **Only non-TMDB rows already at the
  current version.** Rows sitting at 0 or 1 are legitimately stale for other
  reasons and must keep their refetch-on-read behaviour.
- **Boot prune default?** → **ON by default**, with an env off-switch.
  *Planner's recorded objection: this ships an unattended delete path to a prod
  nobody can currently observe (deployments paused since 2026-07-22, PR17
  unrun). Nils chose on-by-default knowingly.* Mitigated by hard guardrails
  below rather than by changing the default.
- **Boot prune bounds?** → Conservative and non-blocking: `batchSize: 1000`,
  `budgetMs: 5000`, a free-space precheck via `volumeInfo()`, skipped entirely
  under test, and **never** a VACUUM. Steady progress per restart, never a burst
  — `dbPrune.ts:183` measures ~40 MB of volume per 1,000 rows deleted, and the
  binding constraint is Litestream's replication RATE, not total disk.
- **OMDB** → **Code guard only.** Add `omdbConfigured()` matching the existing
  `igdbConfigured`/`traktConfigured` pattern. Obtaining a valid `OMDB_API_KEY`
  stays with Nils; the executor cannot get one.
- **Cache contraction** → **Prep only, do NOT drop the tables.** Add a drift
  assertion + expose the drift counts so PR17 can read them on prod. Dropping
  `user_library`/`user_watchlist` stays gated on that reading, exactly as
  `dbPrune.ts:14-26` argues.
- **Off-platform backup replica** → **Excluded.** Needs a bucket and credentials
  only Nils can create; a scaffold with no credentials is dead config.

## Out of scope

- Per-provider deep links to Netflix/Prime (needs the JustWatch Content Partner API).
- Dropping the `user_library` / `user_watchlist` cache tables, or removing
  `dbPrune`'s defensive triple `NOT IN` predicate.
- Obtaining or setting `OMDB_API_KEY`, or any other credential/env value on Railway.
- The off-platform Litestream replica.
- Any delta/incremental sync work — it conflicts head-on with the prune
  invariant and needs its own design session.
- Anything requiring a reachable production deployment (PR17 verification,
  affiliate signups, the TWA build).
- Re-running or regenerating the Miro diagrams.

## Do not touch

- `data/rr.db`, `data/rr.db-wal`, `data/rr.db-shm`, `data/backups/`, and the
  `*.bak-pre-h2b-*` sidecars — **copy the DB to the scratchpad to test the
  migration; never migrate the real file in place.**
- `src/lib/affiliate.ts` and the `MONETIZATION_ENABLED` gate — H3 stays dark.
- `src/lib/legal/content/**` and `src/app/legal/**` — H4 is closed and filled.
  In particular do not add the imprint to `sitemap.ts` or relax its robots directives.
- `.claude/worktrees/**` and any worktree you did not create.
- `src/lib/sync/index.ts`'s prune-on-absence behaviour and every adapter's
  throw-on-failed-pull. The prune invariant is untouched by this session.
- Existing `eslint-disable-next-line` comments (several are justified —
  see AGENTS.md).

## Verification commands

- tests: `npm test`
- lint: `npm run lint`
- typecheck: `npx tsc --noEmit`
- build: `npm run build`
- standalone migration path: `node scripts/migrate.mjs` **against a copy of
  `data/rr.db` placed in the scratchpad** (in-process green tests do NOT prove
  this path — see AGENTS.md)

The standing bar is 544 tests passing, `tsc` clean, lint 0 errors, build clean.
Do not land below it.

## Tasks

- [x] **T1** — Keep the JustWatch region link + offer type in the projection; bump `PROJECTION_VERSION` to 3
  - Files: `src/lib/sources/project.ts`
  - Detail: In `projectWatchProviders`, stop discarding the per-region `link`
    (currently dropped as trim #2, "an ~87-char JustWatch URL per region that
    nothing reads" — it is about to be read). Keep the existing behaviour of
    storing only the ONE winning bucket from `PROVIDER_PRIORITY`, but also
    record **which** bucket won as an `offerType` field on the region object.
    That preserves the current lossless property and the size discipline —
    it adds roughly one URL plus one short string per region, not four extra
    provider arrays. Set `PROJECTION_VERSION = 3`. Update the explanatory
    comment block above `PROVIDER_PRIORITY` so trims (2) and (3) describe what
    the code now actually does.
  - Done when: a projected TMDB payload retains `link` and a valid `offerType`
    (one of flatrate/free/ads/rent/buy) for each kept region, and
    `PROJECTION_VERSION === 3`.
  - Tests: update `src/lib/sources/projection.lossless.test.ts` to assert `link`
    and `offerType` survive projection, and that non-curated regions are still dropped.
  - Depends on: none

- [x] **T2** — Migration 12: pre-stamp non-TMDB rows forward (metadata only, no blob rewrite)
  - Files: `src/lib/migrations.ts`
  - Detail: Add migration `version: 12`, named for what it does. Body is exactly
    one statement in shape:
    `UPDATE media_links SET projection_version = 3 WHERE source != 'tmdb' AND projection_version = 2`.
    No `JSON.parse`, no re-projection, no network — that is the whole point, and
    the migration comment must say so and reference migration 7 as the pattern
    being deliberately avoided. Rows at version 0 or 1 are left alone on purpose
    so they keep their existing refetch-on-read behaviour. Note `db.ts`'s schema
    block runs BEFORE migrations, so add nothing there.
  - Done when: after migrating a copy of the real DB, TMDB rows previously at 2
    read 2 while every non-TMDB row previously at 2 reads 3; rows at 0/1 are unchanged.
  - Tests: a migration test in the style of `src/lib/migration9.test.ts`
    asserting the version spread before/after, including that a non-TMDB row at
    version 0 stays at 0.
  - Depends on: T1

- [x] **T3** — Run the standalone migration path against a DB copy
  - Files: none (verification only)
  - Detail: `cp data/rr.db <scratchpad>/rr-migrationtest.db`, point `DB_PATH` at
    the copy, run `node scripts/migrate.mjs`. This is the second apply path and
    green in-process tests do not exercise it; it resolves neither the `@/*`
    alias nor extensionless specifiers, which is why every type-only import in
    the touched files must be `import type`.
  - Done when: the script exits 0 against the copy and the version spread matches T2's expectation.
  - Tests: none — this IS the test
  - Depends on: T2

- [x] **T4** — Surface `link` + `offerType` through normalize and the types
  - Files: `src/lib/sources/normalize.ts`, `src/types/index.ts`
  - Detail: `streamingByRegion` currently maps a region to a bare provider
    array. Extend each region's value to carry the JustWatch `link` and the
    `offerType` alongside its providers, and extend the derived
    `streamingProviders` selection (`m.DE ?? m.US ?? first`) so the chosen
    region's link and offer type reach the client too. Update the
    `streamingProviders` type at `src/types/index.ts:170`. Every export of
    `src/types/index.ts` is type-only — importers must use `import type`
    (enforced as an eslint ERROR).
  - Done when: an `EnrichedItem` for a movie with availability exposes the
    region's JustWatch URL and its offer type; `npx tsc --noEmit` is clean.
  - Tests: extend the existing normalize/merge tests to cover a payload with
    availability in a kept region.
  - Depends on: T1

- [x] **T5** — Make the "Where to watch" rows clickable and render the offer-type line
  - Files: `src/components/item/LowerSections.tsx`
  - Detail: Wrap each provider row in a direct outbound
    `<a href={regionLink} target="_blank" rel="noopener noreferrer">` — a plain
    anchor, no Fandex-hosted redirect and no click pixel. Render the mockup's
    second line from `offerType` (e.g. flatrate → "Stream · included", rent →
    "Rent", buy → "Buy"); do **not** invent a price, TMDB does not provide one
    here. Keep the JustWatch attribution paragraph — it is mandated by TMDB's
    watch-provider terms. **Delete the two now-false comments** at roughly
    `:154` ("needs a normalize + re-projection pass") and `:165` ("NOT the
    clickable P18 links … deferred"), since this task is what they describe.
    Preserve the single-render rule: this content must not be duplicated across
    a `lg:hidden` / `hidden lg:block` pair.
  - Done when: a movie with availability renders rows that navigate to
    JustWatch and each shows an offer-type line; an item with no availability
    renders neither the section nor the attribution.
  - Tests: none — covered by T7's manual verification
  - Depends on: T4

- [ ] **T6** — Boot-time prune of the browsed tail
  - Files: `src/lib/dbPrune.ts`, `src/instrumentation.ts`
  - Detail: Add an exported `bootPrune()` to `dbPrune.ts` that (1) returns
    immediately if `process.env.NODE_ENV === "test"` or `process.env.VITEST`,
    (2) returns immediately if `PRUNE_ON_BOOT` is explicitly `0`/`false` — the
    default when unset is ON, per the decision above, (3) checks `volumeInfo()`
    and skips with a structured log line when free space is tight, (4) calls the
    existing `runPrune({ batchSize: 1000, budgetMs: 5000 })`, and (5) logs the
    result via the existing `log.info`. It must **never** call `runVacuum()`.
    Reuse `runPrune` as-is — it already batches, bounds by wall clock, re-checks
    the guard rails at run time, and shouts `prune_touched_user_rows` if a
    cascade ever reaches user data. In `instrumentation.ts`, call it from
    `register()` inside the existing `NEXT_RUNTIME === "nodejs"` guard, via a
    dynamic import, **after** `validateEnv()`, and **without awaiting** it into
    the boot path — a slow prune must not delay serving. Catch and log its
    rejection so a prune failure can never crash boot.
  - Done when: booting the dev server logs one prune result line and serves
    normally; `NODE_ENV=test` performs no deletes; setting `PRUNE_ON_BOOT=0`
    skips it; no VACUUM is ever issued.
  - Tests: unit tests for `bootPrune()` covering the test-env skip, the
    `PRUNE_ON_BOOT=0` skip, the tight-volume skip, and the happy path.
  - Depends on: none

- [ ] **T7** — `omdbConfigured()` short-circuit
  - Files: `src/lib/sources/omdb.ts`, `src/lib/detail/enrich.ts`
  - Detail: `omdb.ts:4` does a bare `process.env.OMDB_API_KEY!` with no guard,
    so with the key currently invalid every movie/show detail read still makes
    doomed calls. Add an exported `omdbConfigured()` mirroring
    `igdbConfigured`/`traktConfigured`, and have `fetchOmdbScores` /
    `fetchOmdbByImdbId` return their empty result immediately when it is false.
    Guard the two call sites in `enrich.ts:7`. Read the key lazily inside the
    functions rather than at module load, so importing the module never throws.
    Do not change any behaviour for a correctly configured key.
  - Done when: with `OMDB_API_KEY` unset, a movie detail read issues zero OMDB
    HTTP calls and still renders; with a key set, behaviour is unchanged.
  - Tests: unit tests asserting no fetch when unconfigured, and the existing
    path when configured.
  - Depends on: none

- [ ] **T8** — Cache-contraction PREP: drift assertion + prod-readable drift counts
  - Files: `src/lib/dbSize.ts`, plus a new test beside `src/lib/userItemState.test.ts`
  - Detail: `user_library` / `user_watchlist` are caches rebuilt from
    `user_item_state` (`matcher.ts:309 rebuildCaches`), and the contraction half
    of migration 3's expand-then-contract never happened. Measured drift on the
    dev DB today is 0 and 0. Add (a) a test asserting `user_item_state` is a
    strict superset — every `user_library` row has a matching
    `(user_id, media_item_id, relation='library')` state row and every
    `user_watchlist` row a `relation='wishlist'` one — and (b) two counts in the
    `DbSizeReport` (`libRowsWithoutState`, `wishRowsWithoutState`) so PR17 can
    read the same numbers off prod through `/api/dev/dbsize`. **Do not drop the
    tables and do not touch `dbPrune`'s predicate** — that is what these numbers
    are meant to unblock, later.
  - Done when: the test passes on a seeded DB, and `/api/dev/dbsize` returns
    both counts in its cheap (non-`?deep=1`) tier.
  - Tests: the drift assertion described above
  - Depends on: none

- [ ] **T9** — Verify P18 in the running app, logged in
  - Files: none (verification only)
  - Detail: Start the dev server, sign in via `GET /api/dev/login` (the local
    `.env` already points at the real account — do **not** hand-mint a JWT and
    do **not** call `/api/auth/logout`, which bumps `session_epoch` and kills
    Nils's own browser session). Open a movie known to have availability. First
    load should refetch from TMDB and heal the row; confirm via the projection
    version advancing to 3 for that TMDB link. Confirm the rows link out to
    JustWatch, the offer-type line renders, and the attribution is intact. Then
    reload and confirm no second TMDB refetch — the heal is durable. Also open a
    GAME detail page and confirm it triggers **no** IGDB/RAWG refetch, proving
    T2's pre-stamp worked.
  - Done when: both observations hold — TMDB heals once, games never go stale.
  - Tests: none — this IS the test
  - Depends on: T3, T5

- [ ] **T10** — Update the docs and memory to match reality
  - Files: `TASKS.md`, `STATUS.md`, `docs/archive/history.md`, and the memory
    directory's `MEMORY.md` + relevant note files
  - Detail: In `TASKS.md`, close P18 and **correct the record** — its stated
    blocker ("needs the JustWatch Content Partner API" and "a full-catalog
    re-projection") was wrong on both counts; say what was actually true so a
    future session does not re-derive it. Move the finished P18 section to the
    archive the same session, leaving at most a one-line pointer (the doc
    convention; CI warns when `TASKS.md` passes 200 lines). Update `STATUS.md`'s
    open table. Record the boot prune and its ON-by-default choice, including
    the planner's objection, so the decision is auditable. Update memory:
    `data-model-gaps-and-plan` (the lazy self-heal path is the cheap
    alternative to a mass re-projection) and `provider-config-gaps` (OMDB now
    fails closed rather than making doomed calls). Add a memory note if the
    "re-projection is always heavy" misconception deserves its own hook.
  - Done when: no doc still claims P18 is blocked, and `TASKS.md` is under 200 lines.
  - Tests: none
  - Depends on: T9

- [ ] **T11** — Full verification sweep, commit, push
  - Files: none
  - Detail: Run all four verification commands plus the standalone migration
    check from T3. Fix anything red before committing. `git fetch` first —
    more than one Claude session pushes to this repo. Commit in logical units
    (projection+migration, UI, boot prune, OMDB, prep, docs) rather than one
    blob, then push.
  - Done when: 544+ tests pass, `tsc` clean, lint 0 errors, build clean, and
    the work is pushed to `main`.
  - Tests: none
  - Depends on: T1-T10

## Blockers log

## Session log
