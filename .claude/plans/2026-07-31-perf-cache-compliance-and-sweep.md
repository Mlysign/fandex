---
plan_id: 2026-07-31-perf-cache-compliance-and-sweep
created: 2026-07-31
status: in_progress
branch: current
---

# Shared facet cache, TMDB attribution, SM33 tap targets, More-like-this, and the 7th sweep

## Objective

Clear the actionable backlog left after the 2026-07-30 batch (`R1`–`R10`, commit `c36f602`). Six
independent bodies of work: the **safe half** of the deferred perf fix (a shared derived-facet cache;
the pool-signature split is deliberately NOT in scope), the **missing TMDB/JustWatch attribution**
which is a live compliance gap, **SM33**'s undersized tap targets, the now-cheap **More-like-this**
rail the item-detail mockup left as a placeholder, a cleanup of the dead `--color-media-*` tokens, and
a **7th smoke sweep** over everything the last batch shipped. Plus one conditional task: probe whether
Railway is back and, if it is, run as much of the pre-written PR17 checklist as an unattended session
can reach.

Tasks are ordered so dependencies flow forward, but T1–T6 are otherwise independent: if one gets
blocked, the rest still run.

## Decisions

- **How much of the discovery-cache perf work?** → **Safe half only: the shared derived-facet cache.
  Do NOT touch `catalogSignature()` or `POOL_WHERE`.** The signature split fails *silently* (a newly
  wishlisted item could miss the pool until a TTL expiry) and is reserved for a supervised Opus
  session. The cache alone removes the duplicate parses, which is most of the win at a fraction of
  the risk.
- **Cache the derived facets, never the parsed `raw_data`.** → Parsed JS objects for 30 MB of blobs
  are several times that on the heap, and this container has OOM history
  (`image-optimizer-native-memory`). The derived `facets` array is ~5 MB for the whole pool.
- **P18 timing?** → **Attribution NOW, clickable links LATER.** The TMDB watch-provider terms require
  crediting JustWatch and we currently don't — that's a live compliance gap fixable with pure markup
  and no data change. The clickable links need a `PROJECTION_VERSION` bump and a full-catalog
  re-projection, which is the same class of heavy operation that blew the Railway compute budget and
  took prod down for 8 days. It waits until PR17 confirms prod is healthy.
- **PR17?** → **Conditionally.** Probe `https://fandex.org/api/health` first. If it answers, run
  checklist steps 1–3 and record; if it's still Railway's edge 404, log "still down" and move on.
  **Steps 4–5 need the Railway console and are out of reach for an unattended session** — log them as
  still requiring Nils either way.
- **Smaller items in scope?** → All four: SM33 tap targets, the 7th sweep, the dead `--color-media-*`
  tokens, and the More-like-this rail.
- **More-like-this is a new user-facing feature, not a fix.** → Nils accepted that after it was
  flagged. Build it behind a client island so it cannot compromise the item page's SSR guarantee, and
  keep it visually conservative — he reviews the result.
- **`--color-media-*`: move, don't delete.** → Relocating the three tokens from `@theme` to the plain
  `:root` block makes them actually work, which is less churn than deleting and removes the trap. The
  AGENTS.md invariant and the `tailwind-theme-tree-shaking` memory both currently cite them as broken
  and must be corrected in the same task.
- **The sweep observes, it does not fix.** → Log findings as `SM34+` in TASKS.md. Fixing them is a
  separate session, so this one ends deterministically.

## Out of scope

- The pool-signature split / `catalogSignature()` / `POOL_WHERE` changes (see Decisions).
- P18's clickable JustWatch links, the `PROJECTION_VERSION` bump, and any catalog re-projection.
- The item-detail mockup's "Stream · included" availability line — same projection blocker as P18.
- The two H5 open questions (`priorStrength`/class-weight re-tune, and the `capped` treatment). Both
  are explicitly time-gated on "a few weeks of real scores"; attempting either now fits noise.
- H4.0 / H4.2 / H3.* — all gated on Nils obtaining legal advice.
- P15 / P16 (TWA) — gated on Nils building and signing the TWA.
- WAL / checkpoint tuning and the 2.5 GB prod-DB investigation (schema-adjacent, own pass).
- Fixing anything the sweep finds.

## Do not touch

- `src/lib/migrations.ts` — no new migration is needed by any task here.
- `src/lib/matcher.ts` write paths, `src/lib/sync/`, and every provider adapter's pull/push logic —
  the prune invariant lives there and nothing in this plan requires a change.
- `src/lib/discovery.ts`'s `catalogSignature()`, `POOL_WHERE`, and `getCache()` invalidation logic.
- `src/lib/sources/project.ts` and `normalize.ts` — touching either implies a `PROJECTION_VERSION`
  bump, which is out of scope.
- `data/rr.db` beyond ordinary app reads/writes. Never bulk-delete; never run a VACUUM.
- `.claude/worktrees/` — another session's work may live there.
- `/api/auth/logout` — calling it bumps `session_epoch` and kills Nils's own browser session.

## Verification commands

- tests: `npx vitest run`
- lint: `npm run lint`
- typecheck: `npx tsc --noEmit`
- build: `npm run build` — **stop the dev server first**; a build over a running `next dev` corrupts
  `.next` and produces 404s that read as product bugs. If `.next/turbopack` throws `EBUSY`, that's
  OneDrive/Defender holding it: retry the `rm -rf .next` a few times with a short wait.

Baseline to beat: **473 tests passing, 0 lint errors, typecheck clean.**

## Tasks

- [x] **T1** — Probe prod; run PR17 steps 1–3 only if it's actually back
  - Files: `TASKS.md`, `STATUS.md`, `docs/archive/history.md` (only if prod is up)
  - Detail: `curl -s -o - -w "\n%{http_code}" https://fandex.org/api/health`. If the body is
    Railway's `{"status":"error","code":404,"message":"Application not found"}`, append one dated
    line to TASKS.md's PR17 readiness-probe paragraph saying it's still down, and STOP this task —
    that is a complete, successful outcome. If it answers for real, run **steps 1, 2 and 3 only** of
    the PR17 checklist in TASKS.md (each has its literal command + expected value inline: `dbsize`
    `fileMb` ≈ 36.5 and `media_items.rows` ≈ 2,012; `/api/health` `cgroupMb.fileMb` plateauing rather
    than climbing; `sitemap.xml` `<url>` count ≈ 2,013) and record actual-vs-expected in
    `docs/archive/history.md`. **Steps 4 and 5 need the Railway console — do NOT attempt them**;
    note in TASKS.md that they still require Nils.
  - Done when: TASKS.md contains a dated line stating either "still down" or the step 1–3 readings,
    and PR17's status reflects reality.
  - Tests: none — this is an observation task.
  - Depends on: none

- [x] **T2** — SM33: give the legal tap targets a 44px hit area, and check the pairs
  - Files: `src/components/legal/LocaleToggle.tsx`, `src/components/legal/LegalFooter.tsx`
  - Detail: Both are well under the app's own 44×44 convention — `LocaleToggle`'s EN/DE links measure
    **39×24**, `LegalFooter`'s four links **~45×16**. Add **`.tap-44-y`** (height-only) to the links
    in both, matching the precedent SubBar's segmented toggle already set: two pills packed side by
    side cannot each claim 44px of *width* without overlapping.
    **The trap, and the reason this is not a one-line change:** `LegalFooter` is a wrapping flex row
    at `gap-y-2` (8px). Two 16px-tall links in adjacent wrapped rows, each expanded to 44px, extend
    14px beyond their box in both directions — so they need **≥28px** of vertical gap or the
    expansions overlap and steal each other's taps, which is worse than the small target being fixed.
    Raise `gap-y-2` → **`gap-y-8`** (32px) and re-measure.
  - Done when: at 375px, every link in both components has an effective hit box ≥44px tall, **and** a
    pairwise overlap check over all rendered links in each component finds zero overlaps. Verify with
    `getBoundingClientRect()` in the browser pane on `/legal/en/privacy` and `/profile`, computing the
    effective rect as `max(rect, 44)` on the height axis only.
  - Tests: none — geometry, verified by measurement (see `smoketest.md` item 28 for the method).
  - Depends on: none

- [x] **T3** — Add the TMDB/JustWatch watch-provider attribution
  - Files: `src/components/item/LowerSections.tsx`
  - Detail: TMDB's watch-provider terms require crediting JustWatch as the source of that data, and
    we currently display the providers with no attribution at all — a live compliance gap. Add a
    single attribution line directly under the "Where to watch" provider rows: the text
    **"Streaming availability data by JustWatch"**, with "JustWatch" linking to
    `https://www.justwatch.com` (`target="_blank"`, `rel="noopener noreferrer"`). Style it
    `font-mono text-meta text-text-secondary` to match the section's existing metadata lines. Render
    it **only when `streamingProviders.length > 0`**, so an item with no availability doesn't credit a
    source it never used.
    Do **not** make the provider rows themselves clickable — that's P18, out of scope, and needs a
    projection change.
  - Done when: an item page with streaming providers shows the attribution line with a working
    external link; an item page with none shows no attribution.
  - Tests: none — static markup, verified in the browser pane.
  - Depends on: none

- [x] **T4** — Move `--color-media-*` out of `@theme` so the tokens actually resolve
  - Files: `src/app/globals.css`, `src/components/item/ItemView.tsx`, `AGENTS.md`, and the memory file
    `~/.claude/projects/C--Users-n-mly-.../memory/tailwind-theme-tree-shaking.md`
  - Detail: `--color-media-game/-movie/-show` sit in `@theme` and are only ever read through inline
    `var()`, so Tailwind v4 tree-shakes them and they resolve to an **empty string** at runtime.
    Nothing looks broken today only because `Logo.tsx` passes a fallback (`var(--color-media-show,
    #a78bfa)`). **Move** the three declarations into the plain `:root` block that already holds
    `--color-game/-movie/-show` (same file, ~line 245) — do not delete them, and do not remove the
    older duplicates. Then verify with
    `getComputedStyle(document.documentElement).getPropertyValue('--color-media-game')` that it
    returns a real hex.
    **Then correct the now-stale claims:** AGENTS.md's new invariant and the
    `tailwind-theme-tree-shaking` memory both say these tokens are still broken and that components
    read `TYPE_COLORS` *because* of it. Reword both to say the trap was fixed by relocating them, and
    keep the general rule (inline-only tokens belong in plain `:root`). Leave `ItemView.tsx` reading
    `TYPE_COLORS` — it's correct either way — but update its comment so it doesn't cite a bug that no
    longer exists.
  - Done when: the three tokens return real hex values at runtime, and no doc or comment still claims
    they're tree-shaken.
  - Tests: none — verified by the runtime probe above.
  - Depends on: none

- [x] **T5** — Shared derived-facet cache (the safe half of the perf fix)
  - Files: new `src/lib/facetCache.ts` + `src/lib/facetCache.test.ts`; edit
    `src/lib/libraryAnalysis.ts`, `src/app/api/library/route.ts`, `src/app/api/calendar/route.ts`
  - Detail: The same `raw_data` blobs are parsed by several call sites per request — see the table in
    `docs/performance-audit.md` §A. One signed-in `/library` request parses the library's blobs at
    least twice (the route, and `analyzeLibraryFacets` via `buildProfile`); `/calendar` does the same
    for the wishlist. Note `buildProfile` itself does **not** parse — it reads the cached
    `getLibraryFacetAnalysis`.
    Build a module exposing something like
    `getDerivedForItems(rows, type, region) -> Map<mediaItemId, { facets, merged }>`, backed by a
    `BoundedCache` keyed on `mediaItemId + MAX(last_synced) + region + scoringConfigSignature()`
    (facets depend on tag aliases and category overrides, both folded into that signature).
    **Cache the DERIVED `facets`/`merged` only — never the parsed `raw_data`.** Parsed blobs for
    30 MB of JSON are several times that on the heap and this container has OOM history; the derived
    facets are ~5 MB for the whole pool. Give the cache an explicit `max` and say why in a comment.
    Wire it into `analyzeLibraryFacets`, `loadMembershipGroups`, and the two routes. **Do not wire it
    into `discovery.ts`'s `buildCache`** — that's the pool, and it's coupled to the signature work
    that is out of scope.
  - Done when: `npx vitest run` is green with new tests covering (a) a second call with an unchanged
    `last_synced` returns the cached object, (b) bumping `last_synced` invalidates it, (c) a tag-alias
    or category-override change invalidates it, and (d) a mutation of a returned `facets` array does
    not corrupt the next caller's result (freeze or copy). Plus: `/library` and `/calendar` still
    render correctly in the browser pane with the same item counts as before.
  - Tests: `src/lib/facetCache.test.ts` — the four cases above.
  - Depends on: none

- [x] **T6** — "More like this" rail on the item detail page
  - Files: new `src/app/api/detail/similar/route.ts`, new
    `src/components/item/SimilarRail.tsx`; edit `src/components/item/ItemView.tsx`
  - Detail: The mockup draws this rail but marked the logic out of scope (05-DELTA b). It's cheap now:
    `itemsWithFacet()` and `computeFandexScore()` are both pure in-memory reads of the catalog cache.
    Build a **public** route `GET /api/detail/similar?id=<uuid>&type=<type>` that takes the item's own
    facets (`getCatalogFacets(id)`), finds catalog items sharing the most facets — weight rarer
    facets higher using `getCatalogIdf()`, which is what stops generic genres dominating — excludes
    the item itself, and returns the top 12. When a session exists, additionally attach
    `fandexScore`/`fandexCenter` via `computeFandexScore` so the cards match every other surface.
    Cap the candidate scan so a very common facet can't walk the whole catalog.
    Render it with a **client island** (`SimilarRail`) fetched on mount, mounted at the very bottom of
    `ItemView`'s shared content tree — **exactly once**, not per breakpoint. This is load-bearing:
    ItemView's rule is that nothing above `<PersonalSection>` may depend on a session, and the
    2026-07-30 rebuild already proved that two CSS-hidden trees both mount and double every fetch.
    Reuse `Rail` + `PosterCard` so it looks identical to Home's rails; render nothing at all when
    fewer than 3 similar items resolve.
  - Done when: an item page shows a "More like this" rail of real, linkable, non-self titles; the page
    still makes exactly **one** `/api/detail` call and mounts **one** rail at both 375px and 1280px
    (check `document.querySelectorAll` counts); and an anonymous view renders the rail without any
    Fandex Score badge rather than erroring.
  - Tests: a unit test for the similarity ranking — an item sharing a rare facet must outrank one
    sharing only a common facet.
  - Depends on: none

- [x] **T7** — Run the 7th smoke sweep; log findings only
  - Files: `TASKS.md` (a new dated "Smoke test — 2026-07-31" section), `smoketest.md` (only if a step
    needs correcting)
  - Detail: Run the `/smoketest` skill against the local dev server, logged in via
    `GET /api/dev/login`. **Never call `/api/auth/logout`.** Prioritise what the last batch shipped
    and what this session changes: Home's three rails (Popular right now must contain *released*
    titles and differ from Upcoming; rails stable within a day), the combined stat strip + the two
    rotating highlight panels, the rebuilt item detail at **375px and 1280px** (against
    `docs/design/fandex-handoff/04-pages/item-detail.html`), the 4-colour facet palette (at most four
    distinct facet colours across Insights, an item page and a facet page), unrate, wishlist-on-rate,
    and **section F's tag-taxonomy round trip end to end including the revert**.
    Log findings as `SM34+` with severity, repro and evidence. **Fix nothing** — this task ends with a
    written record.
  - Done when: TASKS.md has a dated sweep section listing every finding (or explicitly recording a
    clean sweep), and the working tree contains no source changes from this task.
  - Tests: none — this is the test.
  - Depends on: T2, T3, T4, T5, T6 (sweep what shipped)

- [ ] **T8** — Update the docs and memory, then commit and push
  - Files: `STATUS.md`, `TASKS.md`, `docs/performance-audit.md`, and the memory files under
    `~/.claude/projects/C--Users-n-mly-.../memory/` (`perf-audit-2026-07-30.md`,
    `item-detail-mockup-rebuild.md`, `tailwind-theme-tree-shaking.md`, plus `MEMORY.md` if a new file
    is added)
  - Detail: Add a dated STATUS.md entry and a TASKS.md section for this batch. In
    `docs/performance-audit.md`, move the shared-facet-cache item from "measured but NOT fixed" into
    the fixed list with before/after numbers from `node scripts/perf-probe.mjs --cookie "…"`, and
    leave the pool-signature split clearly still open. Update the memory files whose claims this
    session changes.
    **Keep TASKS.md under 200 lines** (CI warns above it): archive a finished section into
    `docs/archive/history.md` with a one-line pointer left behind, per the convention in TASKS.md's
    own header.
    Then run the full gate — `npx vitest run`, `npx tsc --noEmit`, `npm run lint` (**0 errors**), and
    `npm run build` with the dev server stopped, confirming `/legal/[locale]/[doc]`, `/api/home`,
    `/robots.txt` and `/sitemap.xml` are all still `ƒ (Dynamic)`. Commit with a message that explains
    root causes rather than listing files, and **push**.
  - Done when: all four gate commands pass, the working tree is clean, and `git push` has succeeded.
  - Depends on: T7

## Blockers log

(Left empty by the planner. The work skill appends here.)

## Session log

(Left empty by the planner. The work skill appends here.)
