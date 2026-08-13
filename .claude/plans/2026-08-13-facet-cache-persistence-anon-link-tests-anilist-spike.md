---
plan_id: 2026-08-13-facet-cache-persistence-anon-link-tests-anilist-spike
created: 2026-08-13
status: ready
branch: current
---

# Persist the facet cache, pin the anon link graph, and settle AniList's terms

## Objective

Close the last open engineering item from the 2026-08-12 session: public facet pages
(`/person`, `/tag`, `/studio`) are `force-dynamic` and fan out to providers on every
cold render — measured on prod at **59.8 s** for `/tag/telepathy` — and the only
mitigation is an in-process `BoundedCache` that a crawl sweep misses ~100% of the
time. That is both a compute cost and a **third-party quota exposure (RAWG's free
tier is 20k req/mo)**. This session moves that cache into SQLite so it survives
restarts and isn't bounded by heap. It also pins yesterday's SM38 fix with the two
regression tests it still lacks, and does the decision-free half of the AniList
evaluation (its usage terms — the exact thing that parked both Backloggd and
Hardcover).

## Decisions

- **What is in scope?** → **All four areas Nils named** ("all of the above"), with one
  safety carve-out recorded below under T7.
- **How to bound the facet-page cost?** → **Persist the cache in SQLite.** Chosen over
  warming the top-N slugs (only covers the head; a crawl sweep hits the long tail,
  which is what actually costs money) and over a bare quota guard (protects RAWG but
  leaves the 59.8 s render). Already rejected in earlier sessions and still rejected:
  dropping `force-dynamic` (re-creates PR14's auth-state caching hazard) and
  `Disallow`-ing the facet paths (throws away the P17 SEO surface).
- **New table via `migrations.ts`?** → **No — put it in `db.ts`'s
  `CREATE TABLE IF NOT EXISTS` block.** A brand-new table with its own indexes in that
  block is the documented-safe pattern: additive, idempotent, and valid against an old
  pre-migration schema. This is what keeps the task delegable at all; see "Do not touch".
- **SM39 (Fandex Score renders −362.3 to +557.4)?** → **Leave it. Do not clamp, do not
  re-tune, do not relabel.** Nils's call: decide after more data. The unbounded range is
  pinned by two dated tests (`fandexScore.test.ts:239`, `:280`) and clamping would break
  `center + Σ(uncapped reasons) = headline`, itself a previously-fixed bug.
- **AniList scope?** → **Terms and auth model only, written into PLATFORMS.md.** No
  adapter, no schema, no UI. The repo's own lesson is "check a provider's USAGE TERMS
  before its capabilities" — that, not OAuth, is what parked Backloggd and Hardcover.
- **Cache-table drop (`user_library`/`user_watchlist`)?** → **In the plan, but NOT to be
  executed by this session.** See T7.

## Out of scope

- **Any change to the Fandex Score** — formula, clamp, badge label. See Decisions.
- **The `user_library`/`user_watchlist` cache-table drop** — written up in T7, not executed.
- **An AniList adapter, schema, or UI** — T6 is a written evaluation only.
- **H3 affiliate signups, `MONETIZATION_ENABLED`, the TWA (P15/P16), H3.0's upkeep
  number** — all blocked on Nils personally.
- **Re-opening the performance audit.** It is closed; this is one specific item that
  post-dates it.

## Do not touch

- `src/lib/migrations.ts` and the ordering of `db.ts`'s existing schema block. Adding a
  NEW `CREATE TABLE IF NOT EXISTS` + its indexes at the end of that block is the only
  DB change permitted here.
- `src/lib/matcher.ts` write paths, `src/lib/sync/index.ts`, `src/lib/sources/adapters/**`
  — the prune invariant (a failed pull must THROW, never return `[]`).
- `src/app/api/dev/login/route.ts` and its three fail-closed gates.
- `src/lib/facets.ts`'s `tagKey()` — its keys are persisted in `tag_category_override`
  (84 rows on prod) and `tag_alias`.
- `export const dynamic = "force-dynamic"` on `src/app/{tag,person,studio}/[slug]/page.tsx`.
- `src/app/robots.ts` — the facet surfaces stay crawlable.
- `MONETIZATION_ENABLED` and anything that would make an affiliate link live.
- The cache KEY composition in `publicFacetDetail.ts`: `persist` and
  `scoringConfigSignature()` must both stay in it (PR14 — without `persist`, an
  anon-built payload can be served to a logged-in viewer and vice versa).
- Prod data. No `POST /api/dev/prune` with `prune`, `prune-job` or `vacuum`.

## Verification commands

- tests: `npm test`
- lint: `npm run lint`
- typecheck: `npx tsc --noEmit`
- build: `npm run build`

Standing bar: **577 tests passing, tsc clean, lint 0 errors, build clean.** Do not land
below it. **Never run `npm run build` while `npm run dev` is running** — it overwrites
`.next` and the running dev server starts returning 404 HTML, which reads as a product bug.

## Tasks

- [ ] **T1** — Measure where the facet render time actually goes, before changing anything
  - Files: `scripts/probe-facets.ts` (exists — extend it rather than writing a new probe)
  - Detail: This repo has been burned twice by optimising before measuring (perf §A was
    mis-sized by 100×; the 58 s Discover load was blamed on the pool cache for days and
    was a dead provider). Instrument ONE cold `buildPublicFacetDetail` call per kind
    (`person`, `tag`, `company`) against the real local `data/rr.db` and record: total ms,
    ms spent in provider fan-out vs. local scoring/sort, and the number of outbound
    provider calls per kind. Run each against a slug NOT already in the in-memory cache.
    Check `/api/health`'s `openProviderCircuits` first — if a provider is down, the
    numbers are meaningless; note it and re-run when `{}`.
  - Done when: the three per-kind measurements are written into the task's commit message
    AND summarised in the code comment added by T3. If provider fan-out turns out NOT to
    dominate, **stop and record that in the Blockers log** — the premise of T2/T3 is wrong
    and a persisted cache is the wrong fix.
  - Tests: none — measurement task.
  - Depends on: none

- [ ] **T2** — Add a persisted facet-payload cache table
  - Files: `src/lib/db.ts`, `src/lib/facetCacheStore.ts` (new), `src/lib/facetCacheStore.test.ts` (new)
  - Detail: Append to `db.ts`'s `CREATE TABLE IF NOT EXISTS` block (NOT `migrations.ts`):
    a table `facet_page_cache` with `key TEXT PRIMARY KEY`, `payload TEXT NOT NULL`,
    `created_at INTEGER NOT NULL`, plus an index on `created_at` for expiry sweeps. Create
    the index in the same block as the table — never split a new table from its indexes.
    Then write `facetCacheStore.ts` with `readFacetCache(key, maxAgeMs)` →
    `payload | null` (returns null past maxAge, never throws) and
    `writeFacetCache(key, payload)` (best-effort — a cache write must NEVER fail a page
    render, so wrap in try/catch and `log.warn`), plus `sweepFacetCache(maxAgeMs, limit)`
    deleting expired rows in a bounded batch.
  - Done when: the table exists on a fresh DB AND on a copy of the real `data/rr.db`;
    `node scripts/migrate.mjs` against a COPY of `data/rr.db` still runs clean (the
    standalone path resolves neither the `@/*` alias nor extensionless specifiers, so a
    bad import here fails only there, never in tests). Unit tests cover: round-trip,
    expiry past `maxAgeMs`, a write failure not throwing, and the bounded sweep.
  - Tests: `src/lib/facetCacheStore.test.ts` as above.
  - Depends on: T1

- [ ] **T3** — Make `buildPublicFacetDetail` read through the persisted cache
  - Files: `src/lib/detail/publicFacetDetail.ts`
  - Detail: Keep the existing in-memory `BoundedCache` as the L1 (it is faster and its
    sizing comment is current). Add the SQLite store as L2: on a miss, check L2 before
    fanning out to providers; on a successful build, write BOTH. **The key must be the
    exact same string the in-memory cache uses** — including `persist` and
    `scoringConfigSignature()`. Do not change the key composition. Use the same 24 h TTL.
    A failed provider build (`buildFailed`) must NOT be cached in either layer — the
    existing code already declines to cache failure payloads; preserve that.
    Update the SIZING comment block (lines ~415-445) to describe the two layers and fold
    in T1's measurements.
  - Done when: a cold build populates both layers; clearing only the in-memory cache and
    rebuilding serves from SQLite with **zero** provider calls (assert by spying on the
    `tmdbJson`/`rawgJson` seams the existing tests already mock); a `scoringConfigSignature`
    change still busts both immediately.
  - Tests: extend `src/lib/detail/publicFacetDetail.test.ts` — add an L1-miss/L2-hit case
    asserting zero provider calls, and one asserting a failed build is not persisted.
  - Depends on: T2

- [ ] **T4** — Verify the cache against real data and a real crawl shape
  - Files: none (verification; record findings in T8's commit message)
  - Detail: Production build only (`npm run build` then `preview_start {name:"prod"}`,
    port 3100 — stop any dev server FIRST). Using the real local `data/rr.db`: hit ~10
    distinct facet slugs anonymously with a Googlebot UA, twice each. Record cold vs warm
    ms for each, and confirm the second pass is warm **after a server restart** — that
    restart is the whole point of the change and the in-memory cache cannot survive it.
    Also confirm the anon write gate still holds: `media_items` / `media_links` /
    `media_external_ids` counts byte-identical before and after the crawl (baseline
    2026-08-12 on the local DB was 2531 / 4147 / 4158 — re-read rather than assuming).
  - Done when: a cold/warm table for ~10 slugs exists, warm-after-restart is demonstrated,
    and the three row counts are unchanged. If row counts move, **stop and log a Blocker** —
    that is the PR13–PR15 gate breaking and it outranks any performance win.
  - Tests: none — verification task.
  - Depends on: T3

- [ ] **T5** — Pin the anon link graph for Home and Discover (SM38 regression)
  - Files: `src/lib/annotateDiscover.test.ts` (create if absent)
  - Detail: 2026-08-12 fixed SM38 — the whole logged-out surface rendered zero clickable
    items because the anon branches returned an empty uuid map. Only the FACET half got a
    regression test (`publicFacetDetail.test.ts`). `persistDiscoverBatch` has none. Add
    tests asserting, for `userId: null`: (a) an item whose `(source, source_id)` already
    exists in `media_links` comes back with the real uuid as its `id` and WITHOUT
    `linkable: false`; (b) an unknown item still comes back `linkable: false`; (c)
    `persistDiscoverItems` is never called. Mock `@/lib/discoverPersist` partially
    (`...actual`) so the real read-only `lookupExistingUuids` runs — copy the mock shape
    from `publicFacetDetail.test.ts`.
  - Done when: the three assertions pass, and flipping `lookupExistingUuids` back to an
    empty map makes (a) fail. Verify that inversion locally before finishing — a
    regression test that passes against the bug is worthless.
  - Tests: this task IS the test.
  - Depends on: none

- [ ] **T6** — Settle AniList's USAGE TERMS before anything else about it
  - Files: `PLATFORMS.md`
  - Detail: AniList is the lead platform candidate. **Terms first, capabilities second** —
    that ordering is the repo's own hard-won lesson: Hardcover was verified on auth and
    then parked anyway because its docs say the API is "only for offline use at this time",
    and Backloggd went the same way. Answer, with a source link and a quote for each:
    (1) does AniList permit a hosted, multi-user, third-party client; (2) commercial /
    donation-funded use; (3) rate limits; (4) does it offer real third-party OAuth (shipped,
    not promised) and what is the token lifetime/refresh story; (5) is there an app-level
    credential for metadata-only use without a user login; (6) are the write mutations
    documented. Write a **verdict**: viable / parked / needs-Nils, in the same shape as
    the Hardcover and Backloggd deep dives already in that file.
  - Done when: PLATFORMS.md has the AniList section with all six answers, each sourced,
    and an explicit verdict. **Do not start an adapter regardless of the verdict** —
    a "viable" verdict is an input to Nils's next decision, not a green light.
  - Tests: none — research task.
  - Depends on: none

- [ ] **T7** — Write up the cache-table drop; DO NOT EXECUTE IT
  - Files: `TASKS.md`
  - Detail: `libRowsWithoutState` / `wishRowsWithoutState` both read **0/0 on prod**
    (2026-08-12), which was the stated precondition for dropping the `user_library` /
    `user_watchlist` cache tables (they are rebuilt from `user_item_state` by
    `matcher.ts`'s `rebuildCaches`). **This session must NOT attempt it.** AGENTS.md:
    anything touching `migrations.ts` or `matcher.ts`'s write paths must be done in the
    main loop at full effort, never delegated — the failure mode is silent user-data loss,
    and every DB test starts from a fresh database so none of them exercise the upgrade
    path production actually takes. Instead, record in TASKS.md: the precondition is met,
    what the drop involves, why it is reserved for a main-loop Opus session, and the
    verification it would need (a standalone `scripts/migrate.mjs` run against a copy of
    the real prod-shaped DB, plus before/after `user_library`/`user_watchlist` counts).
  - Done when: TASKS.md carries that entry, clearly marked as not-started and
    not-delegable. No code, schema, or migration change in this task.
  - Tests: none.
  - Depends on: none

- [ ] **T8** — Quality bar, docs, memory, commit and push
  - Files: `STATUS.md`, `TASKS.md`, `smoketest.md`, memory dir
    `C:\Users\n-mly\.claude\projects\C--Users-n-mly-OneDrive-Documente-09-Projects-Personal-ReleaseCalendar-releaseradar2\memory\`
  - Detail: Run all four verification commands green. Then:
    - `STATUS.md` / `TASKS.md`: close the "Facet-page compute + provider-quota exposure"
      item with T1's and T4's real numbers, or narrow it to whatever genuinely remains.
      Keep TASKS.md under the **200-line CI guard** (`wc -l`); move anything fully done to
      `docs/archive/history.md` the same session, leaving a one-line pointer.
    - `smoketest.md`: add a check that a facet page is warm after a server restart.
    - Memory: update `perf-audit-2026-07-30` (or add a new file) with the two-layer cache
      and its measured effect; add the AniList verdict to `platform-integration-architecture`.
      Add one-line pointers to `MEMORY.md` for anything new.
    - `git fetch` first (more than one session pushes here), commit per task, then push.
      Do not amend. End every commit message with
      `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
    - **After pushing, confirm CI is green** (`gh run list --workflow=ci.yml --limit 1`)
      and that prod's `/api/health` `uptime` RESETS. Railway auto-deploy has Wait-for-CI ON,
      so a red run blocks the deploy silently and `uptime` climbing straight through a push
      means nothing shipped. `npm audit` can go red with no commit of yours causing it.
  - Done when: bar green, docs and memory updated, work pushed, CI green, deploy confirmed.
  - Depends on: T1, T2, T3, T4, T5, T6, T7

## Blockers log

## Session log
