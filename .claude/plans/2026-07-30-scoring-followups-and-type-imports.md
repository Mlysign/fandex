---
plan_id: 2026-07-30-scoring-followups-and-type-imports
created: 2026-07-30
status: in_progress
branch: current
---

# Scoring follow-ups + the type-import tech debt

## Objective

Close the three actionable open ends left by the 2026-07-29 tag-admin/score-rework batch and
pay off the one systemic tech-debt item it surfaced. Concretely: (1) the item page's tag-chip
group *headings* ignore the live admin category override, so a reassigned tag renders under its
old heading for every viewer; (2) `/api/detail` scores a freshly-refetched provider payload while
every catalog-backed surface scores the persisted row, so the detail page can disagree with Home,
Library and the facet pages by a point or two; (3) `@typescript-eslint/consistent-type-imports`
is not enabled, so ~50 files carry plain value-imports of type-only symbols that break the
instant a standalone `scripts/*.mjs` reaches them; and (4) Discover's scroll position is not
restored on Back — a pre-existing bug confirmed during T14 and never root-caused.

## Findings this plan is built on (verified 2026-07-30 against the live repo + `data/rr.db`)

- **Working tree is clean, `main` is level with `origin/main`.** The previous plan
  (`2026-07-29-tag-admin-and-score-rework`) is `status: complete` with an empty Blockers log.
- **Prod is still down.** `https://fandex.org/api/health` returns **404** at Railway's edge.
  PR17 remains blocked; nothing in this plan may depend on prod.
- **Baselines to hold:** `npm test` 402 passing / 1 skipped (52 files) · `npm run lint`
  **0 errors**, 383 pre-existing `no-explicit-any` warnings · `npx tsc --noEmit` clean ·
  `npm run build` compiles 61 routes.
- **`LowerSections.tsx` is a `"use client"` component** rendered from the server page
  `src/app/[type]/[id]/[slug]/page.tsx` → `ItemView` → `LowerSections`. It therefore **cannot**
  call `getTagCategoryOverrides()` itself (a DB read). The override map is *session-independent*
  global taxonomy, so resolving it server-side and passing it down does **not** break
  `ItemView.tsx:25`'s "nothing above PersonalSection may depend on a session" SSR guarantee.
  Precedent for the exact read: `src/lib/detail/publicFacetDetail.ts:533`.
- **`tag_category_override` holds 3 rows** (`role playing (rpg)`→genre, `cyberpunk`→setting,
  `on the run`→theme). Passing the whole map as a prop is trivially cheap; do not build an
  endpoint or a client fetch for it.
- **The grouping loop drops unknown categories.** `LowerSections.tsx:132` iterates the *static*
  `CATEGORIES` from `src/lib/tags.ts` (**9** entries). The live `tag_category` table has **10**
  rows — the extra is `people-characters`, created in an earlier session. So a tag overridden
  into an admin-created category would not merely group wrong, it would **disappear from the
  page entirely**. `getTagCategories()` (`scoringConfig.ts:70`) returns
  `{id,label,color,weight,ignored,sortOrder}` — everything the render needs.
- **`/api/detail` never invalidates the discovery cache.** `ensureTmdbDetail` →
  `storeRefreshed()` (`src/lib/detail/enrich.ts:160`) *does* persist the heal via
  `linkSourceToItem`, but unlike `POST /api/discover/scores` (`route.ts:86`) the detail route
  never calls `invalidateDiscoveryCache()`. The cache signature watches `media_items` while the
  heal writes `media_links`, so catalog surfaces keep serving the pre-heal score.
- **`/api/detail` scores mutated in-memory links.** `route.ts:73` scores
  `extractFacets(links, itemType, merged)` *after* `ensureTmdbDetail`/`ensureGameDetail`
  (which mutate `links` in place, e.g. `tmdb.rawData = fresh.rawData`) and after
  `enrichMissingSources` appends live-only sources that are **never persisted**. For a stored
  item, `loadLinks(mediaItemId)` re-read from the DB *after* the heal is exactly the persisted
  facet set every other surface scores.
- **53 files** match `^import \{[^}]*\} from "@/types"` (63 import from `@/types` at all).
  Every export of `src/types/index.ts` is type-only with zero runtime presence.
  `consistent-type-imports` is **auto-fixable and needs no type-aware linting** (it uses scope
  analysis), so the sweep is mechanical. `eslint.config.mjs` already layers
  `eslint-config-next/typescript`, which supplies the `@typescript-eslint` plugin.
- **Nothing in `src/` sets `history.scrollRestoration`.** `useScrollRestore`
  (`src/lib/usePersistedState.ts:48`) is shared by **three** surfaces —
  `DiscoverPageClient.tsx:262`, `MyStuffView.tsx:246`, `PublicFacetView.tsx:141`. Its restore
  rAF loop stops as soon as `|scrollY − target| <= 2`, so anything that scrolls the window
  *after* that (Next's own restoration, a late layout shift) wins uncontested. That is a
  hypothesis, **not** a confirmed root cause.

## Decisions

- **Scope** → The four items above. **`priorStrength` (C) re-tuning and the `capped` treatment
  question stay OUT.** Both were parked in TASKS.md pending weeks of real scores under the new
  raw-sum formula; it has been one day, so re-tuning now would be fitting to noise.
- **Tag-group headings** → Resolve categories **server-side** and pass them down as props.
  Rationale: `LowerSections` is a client component and the data is global, not per-user — a
  prop keeps the SSR guarantee intact and costs one 3-row read.
- **Category list source** → Render groups from the **live** `getTagCategories()`, not the static
  `CATEGORIES` const. Rationale: the static list is missing admin-created categories, which
  today would silently delete tags from the page. Keep the static const only as a colour/label
  fallback for a category id the live table doesn't have.
- **`/api/detail` freshness** → **Heal, then re-read, then score.** Let the existing refresh
  persist as it already does, then re-read the item's links from the DB and score *those*, and
  call `invalidateDiscoveryCache()` when a heal actually wrote. Rationale: the detail page
  becomes consistent-by-construction with every catalog surface *and* keeps the fresh data,
  in the same request. **Known residual:** sources appended live by `enrichMissingSources` are
  not persisted, so they drop out of the score. Measure this and report the real number — do
  not claim the gap is zero.
- **Live-only items** → When there is no `mediaItemId` (a live, not-yet-persisted item), keep
  scoring the in-memory `links` exactly as today. There is nothing persisted to re-read, and
  no catalog surface shows that item to disagree with.
- **`consistent-type-imports`** → Enable as an **error** across `src/`, run `--fix`, commit the
  mechanical diff. Rationale: matches the repo's existing stance that correctness rules are
  errors and lint stays at 0; a warning would be invisible among 383 existing ones.
- **Scroll restoration** → **Diagnose first, fix only if the root cause is confirmed by a
  reproducible measurement.** If it is not nailed down, write the findings into the Blockers
  log and leave the code alone. Rationale: the hook is shared by three pages; a speculative
  patch risks breaking Library and facet scroll restore to fix Discover.
- **Verification** → Local only. Log in with `GET /api/dev/login` for anything behind a session.
- **Commits** → Logical chunks (tag grouping · detail scoring · lint sweep · scroll · docs),
  repo's existing message style, then push.

## Out of scope

- Re-tuning `priorStrength` (C=5) or the per-role class weights — deliberately parked, see above.
- Revisiting whether `capped` / "not counted for this title" is the right long-term treatment.
- Any migration or schema change. The three fixes all read existing tables.
- Deploying to Railway, or anything requiring prod — still 404ing at the edge (PR17).
- P15/P16 (Android TWA), P18 (JustWatch), H3 (monetization), H4 legal docs.
- The 383 pre-existing `no-explicit-any` warnings. Leave them; they are a deliberate stance.
- Redesigning the item page's "Tags & details" section beyond correcting which group a chip
  lands in.

## Do not touch

- `src/lib/migrations.ts` — no migration is needed here, and AGENTS.md forbids unsupervised
  sessions from touching it.
- `src/lib/sync/**` and any provider pull adapter — the prune invariant lives there.
- `src/lib/session.ts`, `src/lib/withUser.ts`, `src/lib/devAdmin.ts`, `src/app/api/auth/**` —
  auth/session code is main-loop-only per AGENTS.md.
- `data/rr.db.bak*`, `data/*.bak-*` — historical backups, never write to these.
- `.github/workflows/ci.yml`, `package.json`, `package-lock.json`.
- `src/lib/tags.ts`'s `categorizeTag()` heuristic itself — this plan changes *who wins* over it,
  not what it computes.

## Environment notes for the executor

- **Never run `next build` while `next dev` is running** — it corrupts `.next`. Stop the dev
  server first.
- To verify any logged-in surface, use **`GET /api/dev/login`** (mints a local session for
  `DEV_LOGIN_USER_ID`). **Never call `/api/auth/logout`** — it bumps `session_epoch` and
  destroys the owner's real browser session, which only a full OAuth round-trip restores.
- Read `data/rr.db` **read-only** when inspecting (`new Database(path, { readonly: true })`) —
  the dev server holds it open in WAL mode.
- The owner's user id is already in `SCORING_ADMIN_USER_IDS` in `.env`, so `/dev/scoring` and
  the `/api/dev/scoring/*` routes are reachable once logged in via the dev-login route.
- Prod is down. Do not try to verify anything against `fandex.org`.

## Verification commands

- tests: `npm test`
- lint: `npm run lint`
- typecheck: `npx tsc --noEmit`
- build: `npm run build` (dev server stopped first)

Lint must end at **0 errors**. Tests must end at **>= 402 passing**, no failures.

## Tasks

- [x] **T1** — Group item-page tag chips by the live category, not the code heuristic
  - Files: `src/app/[type]/[id]/[slug]/page.tsx`, `src/components/item/ItemView.tsx`,
    `src/components/item/LowerSections.tsx`
  - Detail: In the **server** page component, read `getTagCategoryOverrides()` and
    `getTagCategories()` and pass them down as plain serialisable props — e.g.
    `tagOverrides: Record<string, string>` and
    `tagCategories: { id: string; label: string; color: string }[]` — through `ItemView` to
    `LowerSections`. In `LowerSections`' grouping block (`:116-174`) change
    `const cat = categorizeTag(k)` to `overrides[k] ?? categorizeTag(k)`, and change the
    group loop at `:132` to iterate the **passed-in live category list** instead of the static
    `CATEGORIES`. A tag whose resolved category is absent from both lists must fall back to the
    `other` group — **it must never be silently dropped**, which is what today's static loop
    would do for `people-characters`. Keep the static `CATEGORIES` as the colour/label fallback
    for any live category missing a colour. Update the now-stale comment at `:150-154` which
    describes `categoryId` as the code-heuristic guess.
  - Done when: with `role playing (rpg)` overridden to `genre` (already true in `data/rr.db`),
    a game item page renders that chip under the **Genre** heading, not **Other**; the inline
    `TagCategoryPicker` on that same chip shows the same value as the heading it sits under;
    and a tag temporarily overridden to `people-characters` renders under that category's real
    label rather than vanishing (revert the temporary override afterwards).
  - Tests: add a unit test for the resolution helper — extract the
    "tag keys + overrides + live categories → ordered groups" logic into a pure exported
    function (e.g. in `src/lib/tags.ts` or a sibling module) and cover: override wins over
    heuristic; a category present in the live table but not in the static const still renders;
    an override pointing at a nonexistent category falls back to `other` rather than dropping
    the tag.
  - Depends on: none

- [x] **T2** — Make `/api/detail` score the persisted facets it just healed
  - Files: `src/app/api/detail/route.ts` (and `src/lib/detail/enrich.ts` only if a helper needs
    to report whether it wrote)
  - Detail: Today `route.ts:73` scores `extractFacets(links, …)`, where `links` has been mutated
    in place by `ensureTmdbDetail`/`ensureGameDetail` and appended to by `enrichMissingSources`,
    none of which is what the catalog holds. Change the scoring input **for stored items only**
    (`mediaItemId` present): after the heal calls, re-read with `loadLinks(mediaItemId)` and
    score `extractFacets(freshFromDb, itemType, mergeLinks(freshFromDb, itemType, country))`.
    For a live-only item (no `mediaItemId`) keep the current behaviour unchanged. Separately,
    call `invalidateDiscoveryCache()` when a heal actually persisted — `ensureTmdbDetail`
    already returns a boolean; give `ensureGameDetail` the same signal if it does not have one.
    Do **not** change what the *rest* of the response returns: the merged metadata the page
    renders must keep using the live-enriched `links`, because that is the freshness users
    want in the visible fields. Only the **score input** changes.
  - Done when: for at least 3 items that appear on both a Home rail and their own detail page,
    the two scores agree to within 0.1. Record the item titles and both numbers in the Session
    log. Separately, find at least one item where `enrichMissingSources` contributes a source
    that is not persisted, measure how far its detail score sits from the catalog score, and
    record that residual honestly — including "no such item found" if the search comes up empty.
  - Tests: add a test asserting that for a stored item the score is computed from the persisted
    link set, i.e. mutating the in-memory link array after the heal does not change the score.
  - Depends on: none

- [x] **T3** — Enable `consistent-type-imports` as an error and sweep the repo
  - Files: `eslint.config.mjs`, plus whatever `--fix` rewrites under `src/`
  - Detail: Add `"@typescript-eslint/consistent-type-imports": "error"` to the rules block in
    `eslint.config.mjs`, with a comment explaining *why* it is an error here — Node's native
    type-stripping (used by `scripts/alias-hooks.mjs` for every `rehearse-*.mjs` /
    `calibrate-*.mjs`) only erases syntactically type-only constructs, so a plain
    `import { Foo }` of a type throws `SyntaxError: does not provide an export named 'Foo'` at
    load time even though tsc, vitest and Next all elide it silently. Then run
    `npx eslint src --fix` and commit the mechanical diff. Review the diff for anything that is
    **not** a pure `import` → `import type` rewrite and revert such hunks. If the rule's default
    `fixStyle` produces churn you dislike, `{ fixStyle: "separate-type-imports" }` is the
    conservative setting — pick one, do not leave it to chance.
  - Done when: `npm run lint` reports **0 errors** with the rule active, `npx tsc --noEmit` is
    clean, `npm test` still passes at >= 402, `npm run build` compiles, and
    `grep -rnE '^import \{[^}]*\} from "@/types"' src/` returns nothing. Additionally, prove the
    original failure mode is gone: run one existing standalone script that goes through
    `alias-hooks.mjs` (e.g. `node --import ./scripts/alias-hooks.mjs scripts/calibrate-fandex.mjs`
    or `scripts/rehearse-prune.mjs` — read it first and use a read-only/dry invocation) and
    confirm it loads without a `does not provide an export named` error.
  - Tests: none — the lint rule and the standalone-script run above are the verification.
  - Depends on: none (run it **after** T1 and T2 so their edits are swept too, but it does not
    depend on their outcome)

- [x] **T4** — Root-cause Discover's scroll restoration on Back; fix only if proven
  - Files: `src/lib/usePersistedState.ts` (only if the cause is confirmed);
    `src/app/discover/DiscoverPageClient.tsx` (read-only unless the cause is there)
  - Detail: Reproduce in the browser: log in, load `/discover`, scroll to a known offset
    (~600px), open an item, press Back, and measure. Instrument rather than guess — log the
    sessionStorage value at each step, the `ready` flag's transitions, and `window.scrollY` over
    the ~1200ms after the Back navigation, so you can see *whether* the restore fires and
    *what* moves the window afterwards. The leading hypothesis (unconfirmed) is that the rAF
    loop at `usePersistedState.ts:81-87` exits as soon as it reaches the target, and Next's own
    scroll handling then scrolls the window afterwards with nothing left to contest it — but
    treat that as one candidate, not the answer. Only change code if a measurement confirms a
    specific cause. **If you fix it, you must re-verify scroll restore still works on
    `/library` (`MyStuffView.tsx:246`) and on a facet page (`PublicFacetView.tsx:141`)** — they
    share the hook and are the regression risk. If the cause is not confirmed, append the
    measurements and your best analysis to the **Blockers log** and leave the code untouched;
    that is a successful outcome for this task, not a failure.
  - Done when: either (a) Discover → item → Back lands within ~20px of the saved offset, with
    `/library` and a facet page re-verified unbroken; or (b) the Blockers log contains the
    measurement trace, the candidates ruled out, and a concrete proposed fix for Nils to review.
    State plainly in the Session log which of the two happened.
  - Tests: only if a fix lands and the cause is expressible as a pure function — do not write a
    test that merely asserts the current DOM behaviour.
  - Depends on: none

- [ ] **T5** — Verify, document, commit, push
  - Files: `STATUS.md`, `TASKS.md`, `docs/fandex-score.md` (only if T2 changes what it
    describes), this plan file
  - Detail: Run `npx tsc --noEmit`, `npm run lint` (0 errors), `npm test`. Stop the dev server,
    then `npm run build`. Log in via `GET /api/dev/login` and confirm in the browser: an item
    page's tag chips group under the corrected headings (T1); a Home-rail score matches its
    detail page (T2); no console errors and no server errors across the pass. Update `TASKS.md`
    — mark the T9 stale-grouping finding and the `/api/detail` freshness gap **closed** in the
    2026-07-29 section's open-questions list, add a dated section for this batch, and leave the
    two deliberately-parked questions (`priorStrength`, `capped`) open and clearly marked as
    such. **`TASKS.md` is at 159 of its 200-line CI guard** — if the new section would push it
    past, archive a fully-closed section into `docs/archive/history.md` first, per the file's
    own convention. Update `STATUS.md`'s digest to match. Set this plan file's front-matter
    `status:` to `complete`. Commit in logical chunks and push.
  - Done when: all four verification commands pass, both browser checks are confirmed, the docs
    are updated and consistent with each other, `TASKS.md` is under 200 lines, and the work is
    committed and pushed to `origin/main`.
  - Tests: none — this is the verification task.
  - Depends on: T1, T2, T3, T4

## Blockers log

_(none — T4 resolved as not-reproducible rather than blocked; see the Session log.)_

## Session log

**T4 (2026-07-30) — the scroll-restoration bug does not reproduce. It was a
measurement artifact, and no code was changed.** Outcome (a) of the task's two,
not (b).

Measured on `/discover`, logged in, against the real dev server. Scroll to a
known offset → click a card → Back → sample `window.scrollY` every 100ms for
4.5s:

| saved | @500ms | @1000ms | @2000ms | settled |
|------:|-------:|--------:|--------:|--------:|
| 1500  |     56 |      56 |    1500 |    1500 |

**56 is exactly the number T14 recorded** — it is what the page reads *before*
the restore fires, not where it ends up. Repeated at 600 / 2000 / 4000px via
`history.back()` and once more through the real `BackButton`: **4 of 4 landed
on the target exactly, delta 0px.** `sessionStorage` held the correct value
throughout.

Why the delay, from the instrumented trace: on Back the page returns at
`t≈105ms` with `scrollHeight` 1326 (nothing rendered yet) and `scrollY` 56. The
document reaches its full 6371px at `t≈1474ms` — `loadDefault()` re-fetches the
whole saved browse depth on every mount — and the restore lands at `t≈1594ms`.
`useScrollRestore` is gated on `!searchActive && !loading && items.length > 0`,
so it cannot fire earlier than that by construction. T14's control test (native
back showing the same 56) is consistent with this: both paths wait on the same
refetch.

So the hook is correct and was never the problem. `useScrollRestore` is
untouched, which also means `/library` and the facet pages — the two other
consumers, and the stated regression risk — carry no risk from this task.

**One real thing is left behind, smaller and different from the reported bug:**
for ~1.5s after Back the viewer sits at scroll 56 and then jumps to their old
position. That is a visible wart, but it is a *data-loading* problem (Discover
re-fetches its entire browse depth on mount) and not a scroll-restoration one —
fixing it means caching the browse payload across navigation, not touching
`useScrollRestore`. Recording it here rather than acting on it: it is outside
this plan's scope and would be a materially different change.
