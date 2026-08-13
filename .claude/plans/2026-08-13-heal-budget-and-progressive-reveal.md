---
plan_id: 2026-08-13-heal-budget-and-progressive-reveal
created: 2026-08-13
status: ready
branch: current
---

# Bound the Fandex-Score heal against a dead provider, then reveal search results progressively

## Why this exists (read first — the framing matters)

Nils ran an advanced search (tag filters `deckbuilding` + `tower defense`, **no** search
text, sort = Popularity) and **no result showed a Fandex Score**. His words, and they set
the priority: *"the score is a core part of this page to help me find things I would like.
Not showing it while I am actively searching for something is the whole promise failing."*

Two distinct defects sit behind that, and a third thing that is not a defect:

1. **The advanced-search path was never connected to the lazy heal.** `fandexPending` was
   set **only** in `liveDiscover.ts`. `/api/discover/find` → `find()` in `discovery.ts`
   returned `fandexScore: null` for any row too thin to score, *without* the flag — and
   `PosterCard` only registers with `usePendingFandexScore` when that flag is set. So the
   card had no way to ask for a score, and unreleased titles have no `communityScore` to
   fall back on, so the badge vanished completely. Tag filters make it maximally visible:
   a thin `browsed=1` row's tags are the one thing it *does* have, so it matches tag
   queries readily and then scores blank.
   **→ Already fixed and deployed in `f625440` (SM43). Do not redo it.**

2. **`/api/discover/scores` has no latency budget, and that is what is still broken.**
   This is the whole job of this plan. See "The actual bug" below.

3. **RAWG is down** (Cloudflare 522, ~19.8 s/call, breaker open, 8 failures as of
   2026-08-13). Not our bug — but it is the load case that exposed #2, and it may still be
   down when you start. **Do not "fix" RAWG. Do check whether it is up, because it changes
   how you reproduce.**

**Honest note from the previous session, so you don't misread the history:** fix #1 was
correct but shipped *into* the live RAWG outage without checking that the path it feeds
could survive one. It set `fandexPending` on many more items, each of which now triggers a
heal that blocks on a dead provider — so it plausibly made the slowness Nils reported
*worse*. The wiring is right; the thing it feeds is unbounded. That is what you are fixing.
If T1 turns out not to help, reverting `f625440` is a legitimate outcome, not a failure —
but try the budget first, because the badge genuinely is missing without it.

## The actual bug

`src/app/api/discover/scores/route.ts` heals serially with no budget and no breaker check:

```ts
for (const id of ids) {              // MAX_IDS = 24
  const a = await ensureTmdbDetail(links, item.type);
  const b = await ensureGameDetail(links, item.type);   // ← RAWG, ~19.8 s each while down
  ...
}
```

Nils's results were **all games**. 24 of them, serially, against a provider answering in
~19.8 s ⇒ **worst case ~8 minutes for one batch.** The client's `fetch` hangs, no scores
ever paint, and the page feels dead.

This is exactly the repo's standing lesson, one layer down: **per-source FAILURE isolation
is not per-source LATENCY isolation.** `http.ts` already has the tools — a per-host circuit
breaker plus an optional `budgetMs` — and `discoverFeed.ts` opts into degradation via
`bestEffort`. **The heal route passes neither.** It is a browse-shaped path wearing
sync-path clothing: when a provider dies it *waits* instead of giving up.

Read `AGENTS.md`'s "Per-source FAILURE isolation is not per-source LATENCY isolation"
bullet and [[provider-latency-isolation]] before touching this. Note the constraint that
bullet imposes: **the breaker throws `ProviderUnavailableError` and must never fabricate a
Response**, because pull adapters read a synthetic 503 as `!res.ok` and that turns an outage
into an empty library under the prune invariant. Browse code opts into degradation
explicitly; pull code keeps throwing. This route is **browse** code.

## Decisions (made with Nils, don't relitigate)

- **Budget the heal, don't remove it.** The heal is genuinely valuable — it drains as a
  backfill and every healed row is a permanent cache hit for every later reader. It must
  degrade under latency, not be deleted.
- **A heal that can't complete in budget returns "not yet", never a wrong number.** A
  depressed score computed from un-healed thin facets is worse than no badge — that is the
  original reason `fandexPending` exists at all (2026-07-29, `catalogFacets`). Do not
  "solve" this by scoring thin rows anyway.
- **`scores[id] = null` currently means "final, stop asking".** The client treats null as
  terminal and stops the spinner forever. A budget-exhausted item is **not** that — it needs
  a third state, or it will be permanently unscoreable in the client's module-level cache
  until a reload. **This is the single easiest thing to get wrong in this plan.**
- **Progressive reveal is T4+, and it is separate.** Nils asked for it ("can we slowly
  reveal results as we search?") and it is a good instinct — it would have made this outage
  far less painful. But it is a UI/streaming change, not a latency fix, and it must not be
  bundled into the same commit.
- **Don't touch `f625440`'s `fandexPending`/`profileUsable` split** unless T1–T3 prove it
  wrong. It fixed a real bug and is deployed.

## Out of scope

- RAWG's outage itself.
- `MIN_RATED_FOR_FANDEX_SCORE` / `priorStrength` / role-weight re-tuning — that is **SM39**
  (score renders −362 to 557), separately open and deliberately time-gated.
- SM38's anon-linkability work (fixed and deployed).
- Anything in `sync/`, `matcher.ts` write paths, `migrations.ts` — the prune invariant and
  the two-apply-path rule. **Not delegable, not needed here.**
- `MONETIZATION_ENABLED`.

## Do not touch

- `src/lib/sync/index.ts`, `src/lib/sources/adapters/**` — pull code must keep throwing.
- `src/lib/migrations.ts`, `db.ts`'s schema block.
- `src/app/api/dev/login/route.ts`'s three fail-closed gates.
- `http.ts`'s breaker semantics — **use** `budgetMs`, do not change what the breaker throws.

## Tasks

- [ ] **T0** — Establish the baseline before changing anything
  - Check RAWG: `curl -s -o /dev/null -w "%{http_code} %{time_total}\n" --max-time 45 https://api.rawg.io/api/games`
    and `curl -s https://fandex.org/api/health | grep openProviderCircuits`.
  - **If RAWG is UP:** you cannot reproduce naturally. Force it — point `RAWG_API_KEY` at a
    bad value locally, or stub the fetch in a test. **Do not commit that.**
  - Time one real heal batch (logged in, `POST /api/discover/scores` with ~24 game uuids)
    and record the wall-clock. That number is your before/after evidence.
  - Done when: you have a measured "before" figure and know RAWG's current state.

- [ ] **T1** — Give the heal loop a latency budget and a breaker short-circuit
  - Files: `src/app/api/discover/scores/route.ts` (+ `src/lib/detail/enrich.ts` only if
    `ensureTmdbDetail`/`ensureGameDetail` need to accept/forward a budget).
  - Two changes, in this order:
    1. **Whole-request budget.** Track elapsed time across the loop; once it passes the
       budget, stop calling healers and mark every remaining id as *deferred* (T2's third
       state) rather than null. Reuse `BROWSE_BUDGET_MS` if it fits; if a distinct constant
       is clearer, name it and say why in a comment.
    2. **Skip a provider whose breaker is already open** — don't pay the first timeout at
       all when `http.ts` already knows the host is down. Prefer asking the breaker over
       catching `ProviderUnavailableError` after the fact, but either is acceptable if the
       cost is genuinely avoided.
  - **The loop is serial by design** (it was bounded by `MAX_IDS`, not by time).
    Parallelising it is a *separate* judgement call with its own fan-out risk — if you do it,
    cap concurrency (see `mapLimit`/`HYDRATE_CONCURRENCY` in `liveDiscover.ts`) and say so in
    the commit. Budget first; only parallelise if the budget alone leaves it too slow.
  - Done when: with RAWG down (or stubbed), a 24-id all-games batch returns in **well under
    the budget** instead of minutes, TMDB-only items still heal normally in the same batch,
    and no call path fabricates a Response.
  - Tests: a unit/integration test where the game healer is stubbed to hang or throw
    `ProviderUnavailableError` — assert the route returns promptly, returns deferred (not
    null) for the unhealed ids, and still returns real scores for items that didn't need the
    dead provider. **This is the test that would have caught the bug**, so make it explicit.

- [ ] **T2** — Add the third state: "deferred", distinct from "no score, final"
  - Files: `src/app/api/discover/scores/route.ts`, `src/components/usePendingFandexScore.ts`
    (+ `PosterCard.tsx` only if the badge needs to distinguish them visually).
  - Today the client caches `null` as **final** and stops asking. If a budget-exhausted item
    comes back null it is stuck unscoreable until a full reload — which would make this plan
    a *regression* against the bug it is fixing. So the response needs to say which of these
    it means:
    - a real score,
    - `null` = "asked, genuinely no score" (too little metadata even after healing, or cold
      profile) — **final, stop asking**,
    - **deferred** = "couldn't heal in budget / provider down" — **retry later, keep pending**.
  - Client side: do **not** write deferred ids into the terminal `resolved` map. Let them be
    re-requested on the next flush/mount. Add a small backoff or a cap on retries so a
    long outage doesn't become a client-side poll loop.
  - Done when: a deferred id is re-asked on a later flush and resolves normally once the
    provider recovers, without a page reload; a genuine `null` still stops the spinner
    permanently.
  - Tests: cover both — deferred is retried, null is not.

- [ ] **T3** — Verify against the real reported case, then ship T1–T3
  - Reproduce Nils's exact query: logged in, advanced search, include tags `deckbuilding`
    **and** `tower defense`, no search text, sort Popularity.
  - Assert: results render promptly; scored items show a badge; unscoreable-right-now items
    show the pending treatment rather than a blank card; nothing hangs. Compare wall-clock
    against T0's baseline and record both figures.
  - **Verify logged-in** — `/discover`'s advanced search needs a session. Locally use
    `GET /api/dev/login`. On prod, `/api/dev/login` is fail-closed, so use Nils's own Chrome
    (`claude-in-chrome`), which holds a live prod session incl. the admin gate — see
    `smoketest.md`'s corrected Auth section. **Never call `/api/auth/logout`.**
  - Quality bar before commit: `npm test` (≥576) · `npx tsc --noEmit` · `npm run lint`
    (0 errors) · `npm run build`. Never run `build` while `npm run dev` is running.
  - **Commit and push T1–T3 as their own commit** — the latency fix stands alone and is the
    part Nils is waiting on. Watch CI: **a red run silently blocks the Railway deploy**
    (Wait-for-CI is ON) — `gh run list --workflow=ci.yml`. Then confirm prod `uptime`
    **resets**; a monotonically climbing uptime means nothing deployed.
    → [[ci-red-blocks-railway-deploy]]

- [ ] **T4** — Progressive reveal of search results (separate commit, only after T3 is green)
  - Nils's ask, verbatim: *"can we slowly reveal results as we search?"*
  - **Scope it before building it.** Decide and write down which of these it is, because they
    are very different jobs:
    (a) render the local catalog-pool hits immediately, then fold in slower provider results
        as they arrive; (b) stream/paginate the existing result set so first paint is early;
    (c) purely a loading/skeleton affordance so the wait is legible.
    Recommendation: **(a) then (c)** — (a) is the real win here, since the catalog pool is
    local and fast while the providers are what stall. Confirm with Nils before writing code.
  - Hard constraints: **no unbounded provider fan-out** (that cost a Railway outage — PR13–16);
    an empty intermediate state must never render as the *final* "No results" — that is
    precisely the misleading message Nils hit; and keep the anon path honest (SM38: anon
    cards are linkable only where a real row exists).
  - Done when: first meaningful paint happens without waiting on the slowest provider, and a
    still-loading state is visually distinct from a genuinely empty one.

- [ ] **T5** — Close out
  - `TASKS.md`: log this under a dated entry continuing the `SM#` sequence (**next free id is
    SM44**; SM43 was the advanced-search wiring). Note whether the T0 vs T3 timings confirm
    the RAWG-latency diagnosis or contradict it — **if they contradict it, say so loudly**,
    because then the real cause is still unfound.
  - `STATUS.md`: only if the state it shows on one screen actually changed.
  - Memory: extend [[provider-latency-isolation]] with the heal-route instance — the general
    lesson was already recorded and *still* didn't prevent this, because the route reads as a
    scoring endpoint, not a provider path. Worth writing down: **any route that awaits an
    enricher in a loop is a provider path, whatever it is named.**
  - Keep `TASKS.md` under the 200-line CI guard (`wc -l`); archive anything finished the same
    session, per the repo convention.

## Verification commands

```
npm test          # ≥576 passing
npx tsc --noEmit
npm run lint      # 0 errors is the standing bar
npm run build     # never while `npm run dev` is running
```

## Context pointers (don't re-derive these)

- `AGENTS.md` → "Per-source FAILURE isolation is not per-source LATENCY isolation" — the
  breaker must throw, browse opts into degradation, pull keeps throwing.
- [[provider-latency-isolation]] · [[prod-incidents]] (why unbounded fan-out is a red line)
  · [[fandex-score-h5]] · [[ci-red-blocks-railway-deploy]] · [[dev-login-shortcut]]
- `smoketest.md` §H items 49–51 and its corrected Auth section (a live run is **not**
  anon-only; `claude-in-chrome`'s `javascript_tool` returns `{}` for any async result —
  split the probe across two calls via `window.__probe`).
- Prior art for the shape you're adding: `discoverFeed.ts`'s `bestEffort`, `http.ts`'s
  `budgetMs` + per-host breaker, `liveDiscover.ts`'s `mapLimit`/`HYDRATE_CONCURRENCY`.

## Blockers log

## Session log
