---
plan_id: 2026-08-13-heal-budget-and-progressive-reveal
created: 2026-08-13
status: executed
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

- **T0's standalone probe couldn't run at all.** Plain `node` cannot import `src/lib/http.ts`:
  `ProviderUnavailableError`'s constructor uses TypeScript **parameter properties**, which
  Node's strip-only type removal rejects (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). Same class as
  the `import type` rule in AGENTS.md. Worked around by measuring through the dev server.

## Session log

**T0 — baseline (RAWG confirmed down: 522 in 19.70 s; prod `openProviderCircuits: {}` but
uptime was 129 s, so the breakers were simply fresh).** Logged in via `/api/dev/login`,
`POST /api/discover/scores` with 24 thin game uuids:

| condition | wall clock |
|---|---|
| breaker half-open at batch start (one probe paid) | **66.3 s** |
| breaker fully open at batch start | 4.3 s |
| same ids again, now healed | 0.48 s / 0.07 s |
| cold process (breaker closed, derived: 3 × 60 s before it latches) | ~3 min |

**T1/T2 — shipped as `3c2d0ff`.** `healLinks()` + `HealBudget` (whole-request deadline **and**
a per-call cap ≤¼ of it, because with only the deadline the first dead call starves every
healthy provider behind it); `isProviderCircuitOpen()` in `http.ts`, read-only, never consumes
the half-open probe; hosts derived from each source module's BASE. A timed-out host is written
off for the rest of the request, a *throwing* one is not (`rawgGet` throws on a 404 — one bad
id must not blacklist a provider). Deferred is a real third state on both sides, with a
capped exponential backoff client-side. 5 route tests + 6 hook tests + 1 breaker test.

**One design change the live run forced:** `incomplete` first meant "any stale link went
unrefreshed", which deferred every game whose IGDB link had just healed but whose RAWG link
was dead — measured 22 of 24 deferred, strictly worse than before. It now means **"no fresh
link at all"**: games are a two-provider medium, so a dead RAWG beside a live IGDB still
scores. After: **4.1 s**.

**T3 — deployed, CI green, prod `uptime` reset confirmed.** And then the correction:

> **Re-running Nils's exact query on prod, `find()` returns ZERO `fandexPending` items** —
> across every sort and filter tried, games and all types. The heal route was not being
> exercised by advanced search at all. SM44 is a real bug and the 66.3 s → 4.1 s is real, but
> it is **not** what Nils hit.

**What he actually hit (SM45, shipped `3c283bb`).** `DiscoverPageClient.runSearch` calls
`/api/discover/facet-fetch` for the "More from the databases" half — the half a TAG filter
lands in — and `FacetDetailItem` carried **no fandex fields at all**. Prod, his exact query:
69 results, **0 scored, 0 pending**; 29 with an empty badge slot and 40 quietly showing a
*community* score in the Fandex slot. Fixed by extracting `fandexForPage()` as the one shared
classifier. Verified on the `christopher nolan` facet: 11 of 19 results now score
(Oppenheimer 78.9) where none could before.

**T4 — already built, nothing to do.** `runSearch` paints local results first ("Show local
results immediately" is the existing comment), folds `webItems` in when they land, gates the
empty state on `!webLoading` so an intermediate never reads as "No results", and shows
"Pulling more from the databases…". Nils picked scope (a); (a) and (c) both already exist.
The remaining pain is real latency, not a missing affordance: **`facet-fetch` measured 18.8 s
on prod / 68.3 s locally** with RAWG down, and has no `budgetMs` — SM44's shape on another
route, and its `tmdbJson`/`rawgJson` are shared with `publicFacetDetail.ts`, so a fix there
also touches the public SEO facet pages. Logged, not done.

**T5 — Nils's calls this session:** T4 scope = (a); and for RAWG-only thin game rows, **fix
the root cause by cross-linking IGDB** rather than falling back to a depressed score (20 of
24 sampled thin game rows have no IGDB link at all). Both logged in TASKS.md.
