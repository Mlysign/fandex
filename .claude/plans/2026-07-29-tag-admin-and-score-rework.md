---
plan_id: 2026-07-29-tag-admin-and-score-rework
created: 2026-07-29
status: in_progress
branch: current
---

# Tag management UI + Fandex Score raw-sum rework

## Objective

Two coupled bodies of work, plus three standalone UI bugs. **(1)** Replace `/dev/scoring`'s
Taxonomy panel with a single tag table (tag · category dropdown · aka multi-select) and put an
inline admin category picker on every surface that renders a tag. **(2)** Rework the Fandex Score
aggregate from a weighted *mean* to an **unbounded raw sum over a bounded, fixed-size selection**
of facets, so a tag's contribution is item-independent and printable on a chip — which is what
makes "show each tag's score impact" well-defined at all. **(3)** Fix the clipped rate quick
action, add smart back buttons, and rebuild the hover tooltip as a score explainer.

**No migration is required.** Everything maps onto existing tables (`tag_category`,
`tag_category_override`, `tag_alias`) plus the `scoring_config` JSON blob, which merges stored
values over defaults and is therefore forward-compatible with new fields by design
(`scoringConfig.ts:33-46`). The Fandex Score is computed on the fly — there is no stored score
column anywhere in the schema, so there is no rescoring job and no backfill.

## Findings this plan is built on (verified 2026-07-29, do not re-litigate)

- **Categories were never broken.** `saveTagCategory()` works; a probe row created via
  `POST /api/dev/scoring/categories` persisted correctly. Every `tag_category` row still carries
  the original seed timestamp, i.e. no category has ever been successfully created or edited in
  this DB. Root cause: the create form makes you hand-type a machine `id` validated as
  `/^[a-z0-9-]+$/` (`schemas.ts:175`), so typing `People & Characters` returns
  `400 {"error":"id: id must be lowercase-kebab"}`. Reproduced both the failure and the success.
- **Score settings were never reverted.** `scoring_config` holds `K_up = K_down = 25`,
  `priorStrength = 5`, `perCategoryCap = 3` — exactly the H5.5 calibrated values. Measured
  distribution over 1,857 scored items: `min 46.6 · p10 59.1 · median 68.7 · p90 81.2 · max 99.9`.
  The complaint is real but it is *narrowness*, not reversion.
- **One root cause links both score complaints.** The aggregate is a weighted mean
  (`discovery.ts:490`), so (a) it compresses toward zero as facet count grows, and (b) each tag's
  contribution is a *share of the total* (`dev_i·w_i / Σw`) and therefore changes per item.
- **Catalog tag density:** median 10 tags/item, mean 15.6, p75 17, p90 33, **max 300**. This is
  why an unbounded raw sum needs a fixed-size selection rather than a divisor.
- **There is no back-button implementation anywhere** — zero matches for `router.back`,
  `BackButton` or `ArrowLeft` under `src/`.
- **Rate clipping cause:** `PosterCard`'s root element has `overflow-hidden`
  (`PosterCard.tsx:134` and `:147`), clipping the expanding star row.
- Facet kinds are exactly `"tag"`, `"person"`, `"company"`.
- `/100` is rendered in exactly two places: `FandexScoreBadge.tsx:51` (aria-label) and `:84`
  (visible span).

## Decisions

- **Aggregate shape** → **Unbounded raw sum**, no damping, no divisor, no 0–100 clamp. Rationale:
  a divisor of any kind (`/n`, `/√n`) makes per-tag contribution item-dependent, which defeats the
  entire goal. Density bias is controlled structurally by the fixed-size selection below instead.
- **Selection rule** → Count only the **top 5 positive tags, top 3 negative tags, top 3 people,
  top 2 companies**. All four are admin-tweakable in `/dev/scoring`. Rationale: against a median of
  10 tags/item most items keep nearly all real signal, while the 300-tag outliers are bounded.
  This **replaces** `perCategoryCap` — the user's explicit example is "an item with 5 genre tags
  should count all 5", which a per-category cap of 3 forbids.
- **Clamping** → **Removed entirely.** Scores may go below 0 or above 100. This also lets the
  `scale = clampedDelta / rawDelta` fudge (`discovery.ts:513`) be **deleted**, making
  `center + Σ contributions === score` exactly true rather than approximately.
- **Score display** → **Bare number + band word.** Drop `/100` everywhere. The existing
  strong/typical/weak band carries the meaning.
- **Per-tag impact** → Each counted facet's contribution is `K · dev · classWeight`, which no
  longer depends on the item's other facets. The same number is shown on chips, item pages, facet
  pages and insights.
- **K calibration** → Deterministic, not a taste call: compute `rawSum` (with `K = 1`) across the
  owner's whole library, then set `K = 40 / (p90(rawSum) − p10(rawSum))`, rounded to 1 decimal,
  targeting a 40-point p10–p90 spread (up from today's 22). `K` remains a live knob in
  `/dev/scoring`, so this is trivially adjustable afterwards if it feels wrong.
- **Band margin** → Re-anchor deterministically to `round((p75 − p25) / 2)` of the NEW score
  distribution, replacing the hard-coded `BAND_MARGIN = 8`.
- **Tag table** → **Replaces** the existing Taxonomy panel (category list + bundle list are
  absorbed into it), rather than sitting beside it as a second place to edit the same data.
- **aka column** → Alias members do **not** get their own rows; they render as removable chips
  inside their canonical tag's row.
- **Category filter** → Present, but **off by default** (currently it defaults to a filter).
- **Inline category picker** → On every surface rendering a tag: item detail chips, public facet
  pages, insights (already has one), and the tag table. Self-gating via `GET /api/dev/scoring`
  returning 404 for non-admins — reuse the existing pattern in
  `src/components/facet/TagAdminControls.tsx`, do not invent a new admin gate.
- **Facet page load order** → Block rendering until both provider items and `/api/facet/mine` have
  resolved — **for logged-in viewers only**. Anonymous SSR must be completely unchanged, because
  `/person|/tag|/studio` are public SEO surfaces (P17) and anon has no `/api/facet/mine` to await.
- **Back button** → Smart back: `router.back()` when in-app history exists, otherwise a sensible
  parent route. Must never strand the user on a hard-loaded or shared link.
- **Tooltip** → Rebuilt as a **score explainer** (see T15 for the exact spec). The duplicated
  poster image is dropped since the card underneath already shows it.
- **CI audit fix** → Already committed and pushed as `9264a16` before this plan was written.
  Nothing left to do.

## Out of scope

- Any migration or schema change. If a task appears to need one, **stop and log a blocker** —
  the design above was chosen specifically to avoid this.
- Re-tuning `priorStrength` (C) or the per-role weights. Only the four selection counts, `K`, and
  `BAND_MARGIN` change.
- Deploying to Railway. It is still paused until ~2026-08-01 (PR17); all verification is local.
- P15/P16 (Android TWA), P18 (JustWatch), H3 (monetization), H4 legal docs.
- Redesigning `/dev/scoring`'s Weights & Tuning panel beyond adding the four new count inputs.
- Backfilling or rescoring anything — the score is computed on the fly.

## Do not touch

- `src/lib/migrations.ts` — no migration is needed, and AGENTS.md forbids unsupervised sessions
  from touching it.
- `src/lib/sync/**`, any provider pull adapter — the prune invariant lives there.
- `src/lib/session.ts`, `src/lib/withUser.ts`, `src/lib/devAdmin.ts`, `src/app/api/auth/**` —
  auth/session code is main-loop-only per AGENTS.md.
- `data/rr.db.bak*`, `data/*.bak-*` — historical backups, never write to these.
- `.github/workflows/ci.yml`, `package.json`, `package-lock.json` — just fixed in `9264a16`.

## Environment notes for the executor

- **Never run `next build` while `next dev` is running** — it corrupts `.next`. Stop the dev
  server first, or use a separate check.
- To verify any logged-in surface, use **`GET /api/dev/login`** (mints a local session for
  `DEV_LOGIN_USER_ID`). **Never call `/api/auth/logout`** — it bumps `session_epoch` and destroys
  the owner's real browser session, which only a full OAuth round-trip restores.
- The owner's user id is already in `SCORING_ADMIN_USER_IDS` in `.env`, so `/dev/scoring` and all
  `/api/dev/scoring/*` routes are reachable once logged in via the dev-login route.
- Read the DB read-only when inspecting (`new Database(path, { readonly: true })`) — the dev
  server holds it open in WAL mode.

## Verification commands

- tests: `npm test`
- lint: `npm run lint`
- typecheck: `npx tsc --noEmit`

Lint must stay at **0 errors** (385 pre-existing warnings are expected and fine). Tests are at
**385 passing / 1 skipped** as the baseline.

## Tasks

- [x] **T1** — Add the four selection-count knobs to the scoring config
  - Files: `src/lib/scoringDefaults.ts`, `src/lib/schemas.ts`, `src/lib/scoringConfig.ts`
  - Detail: Add `topTagsPositive: 5`, `topTagsNegative: 3`, `topPeople: 3`, `topCompanies: 2` to
    `ScoringConfigValues` and `DEFAULT_SCORING_CONFIG`. Remove `perCategoryCap` from the interface
    and defaults (a stale key may remain in stored blobs — harmless, the merge in
    `getScoringConfig()` tolerates extra keys). Update `ScoringConfigPutSchema` to accept and
    validate the four new fields as non-negative integers, and drop `perCategoryCap` from it.
  - Done when: `npx tsc --noEmit` is clean and `getScoringConfig()` returns the four new fields
    with their defaults against the existing DB row (which predates them).
  - Tests: extend `src/lib/scoringConfig.test.ts` with a case asserting a config blob saved
    *without* the new fields still reads back the four defaults.
  - Depends on: none

- [x] **T2** — Rewrite `computeFandexScore` as an unbounded raw sum over a bounded selection
  - Files: `src/lib/discovery.ts`
  - Detail: Replace the per-category cap block and the weighted-mean block (roughly lines 460–521)
    with:
    1. Partition `matched` by `f.kind` into `"tag"` / `"person"` / `"company"`.
    2. Select: tags with `dev > 0` sorted by `dev` descending, take `topTagsPositive`; tags with
       `dev < 0` sorted by `dev` ascending, take `topTagsNegative`; people sorted by `|dev|`
       descending, take `topPeople`; companies sorted by `|dev|` descending, take `topCompanies`.
       `kept` is the concatenation; everything else goes to `capped`.
    3. `rawSum = Σ over kept of (dev_i × classWeight_i)` — **no division by `totalWeight`**.
    4. `gain = rawSum >= 0 ? cfg.mappingConstantUp : cfg.mappingConstantDown`;
       `score = center + gain × rawSum`. **No `Math.max`/`Math.min` clamp.**
    5. `reasons[i].contribution = Math.round(gain × dev_i × classWeight_i × 10) / 10`.
    6. **Delete `clampedDelta` and `scale` entirely** — they only existed to compensate for
       clamping. Contributions are now exactly additive.
    Keep the `capped` handling (contribution 0, `capped: true`) so the breakdown still explains
    what was excluded — it is now more important, since more facets get excluded.
  - Done when: for any item, `center + Σ(reasons.filter(r => !r.capped).contribution)` equals
    `score` within 0.1, and no facet outside the selection contributes.
  - Tests: rewrite the affected cases in `src/lib/fandexScore.test.ts`. Must include: exact
    additivity; an item with 5 genre tags counting all 5 (the case the old per-category cap
    broke); a 300-tag item counting exactly `topTagsPositive + topTagsNegative` tags; a score
    legitimately exceeding 100 or falling below 0 being returned unclamped.
  - Depends on: T1

- [x] **T3** — Calibrate `K` and re-anchor `BAND_MARGIN` against the real library
  - Files: `scripts/calibrate-fandex.mjs` (new), `src/lib/scoringDefaults.ts`,
    `src/components/FandexScoreBadge.tsx`
  - Detail: Write a script (pattern-match `scripts/rehearse-prune.mjs`; it must open
    `data/rr.db` **read-only** and never write to it) that scores the owner's whole library with
    `K = 1` and reports the `rawSum` distribution. Compute
    `K = round(40 / (p90(rawSum) − p10(rawSum)), 1)` and set
    `mappingConstantUp = mappingConstantDown = K` in `DEFAULT_SCORING_CONFIG`. Then re-score with
    that `K` and set `BAND_MARGIN = Math.round((p75 − p25) / 2)`. Persist the new `K` to the live
    DB through the admin route (`PUT /api/dev/scoring`), not by writing SQL directly.
  - Done when: the script prints before/after `min · p10 · p25 · median · p75 · p90 · max` for the
    full library, the new p10–p90 spread is within 38–42 points, and both constants are updated in
    code. Record the actual numbers in the Session log.
  - Tests: none — covered by T2. The script is a measurement tool, not shipped behaviour.
  - Depends on: T2

- [x] **T4** — Drop the `/100` framing from the score badge
  - Files: `src/components/FandexScoreBadge.tsx`, `src/components/PosterCard.tsx`
  - Detail: Remove the visible `/100` span (`:84`) and change the aria-label (`:51`) from
    `"Fandex Score ${rounded} out of 100 — ${matchStrength(...)}"` to
    `"Fandex Score ${rounded} — ${matchStrength(...)}"`. Update the now-stale comments at
    `FandexScoreBadge.tsx:71` and `PosterCard.tsx:45` that describe the `/100` treatment. Confirm
    nothing renders the score inside a fixed 0–100 progress bar; if anything does, switch it to a
    band-coloured number.
  - Done when: `grep -rn "/100\|out of 100" src/` returns nothing, and a score above 100 or below
    0 renders without visual breakage.
  - Tests: update `src/components/FandexScoreBadge.test.ts` for the new label and add an
    out-of-range (e.g. 104, −3) rendering case.
  - Depends on: T2

- [x] **T5** — Fix category creation: derive the slug from the label
  - Files: `src/app/dev/scoring/TaxonomyPanel.tsx` (or its T7 replacement if T7 landed first)
  - Detail: This is the actual bug behind "my created categories are gone". Remove the hand-typed
    `id` input as a required field. Auto-derive it from the label: lowercase, trim, replace any run
    of non-`[a-z0-9]` with `-`, strip leading/trailing `-`. So `People & Characters` →
    `people-characters`. Show the derived slug as read-only helper text next to the label, with an
    optional "edit" affordance for overriding it. Surface the server's 400 message inline if the
    derived slug still collides or fails validation.
  - Done when: typing only `People & Characters` as a label and clicking Add creates a category
    with id `people-characters` and returns 200, verified against the DB.
  - Tests: add a unit test for the slugify helper (extract it to a testable module, e.g.
    `src/lib/slug.ts`) covering `&`, spaces, punctuation, leading/trailing separators, and
    collapsing repeated separators.
  - Depends on: none

- [ ] **T6** — Add a merged tag-table endpoint
  - Files: `src/app/api/dev/scoring/tags/route.ts` (new)
  - Detail: `GET /api/dev/scoring/tags?category=<id>&q=<search>&limit=<n>`, wrapped in
    `withScoringAdmin`. Returns one row **per canonical tag**: `{ key, label, count, category,
    overridden, aka: [{ key, label, count }] }`. Fold `listTagBundles()` in so alias members are
    nested under their canonical and **excluded as top-level rows**. `count` on a canonical row
    should be the combined count across itself and its aka members. Default to **no category
    filter**. Reuse `getTagVocab()`, `getTagCategoryOverrides()`, `categorizeTag()` and
    `listTagBundles()` — do not duplicate their logic.
  - Done when: `curl` with an admin session returns canonical rows only, with `role playing (rpg)`
    carrying `rpg` in its `aka` array and no separate `rpg` row present.
  - Tests: add a route/unit test asserting alias members are folded and not double-listed, and that
    the combined count is the sum.
  - Depends on: none

- [ ] **T7** — Build the tag table, replacing the Taxonomy panel
  - Files: `src/app/dev/scoring/TagTable.tsx` (new), `src/app/dev/scoring/ScoringAdmin.tsx`,
    `src/app/dev/scoring/TaxonomyPanel.tsx` (removed or reduced to the category CRUD the table
    doesn't cover)
  - Detail: One table, columns **tag · category (dropdown) · aka (searchable multi-select)**,
    backed by T6. Category dropdown writes through `POST /api/dev/scoring/overrides` and updates
    optimistically. The aka cell shows current members as removable chips plus a tag-search
    multi-select that bundles via `POST /api/dev/scoring/aliases`; removing a chip calls
    `DELETE /api/dev/scoring/aliases?alias=`. Selecting a tag as an aka member must remove its own
    row from the table without a full reload. Category filter present but **unset by default**.
    Include a text search over tag labels. The table must stay responsive with the full vocab —
    paginate or windows rows rather than rendering thousands at once (SM19 is the cautionary tale).
    Preserve the category create/edit/delete CRUD from the old panel, with T5's slug fix.
  - Done when: `/dev/scoring`'s Taxonomy tab renders the new table with no category filter applied
    on first load; changing a category persists across reload; bundling a tag as an aka removes its
    row and persists; unbundling restores it.
  - Tests: none — covered by T5/T6 unit tests plus the manual browser verification in T17.
  - Depends on: T5, T6

- [ ] **T8** — Extract a shared inline tag-category picker
  - Files: `src/components/TagCategoryPicker.tsx` (new), `src/components/facet/TagAdminControls.tsx`,
    `src/components/insights/FacetSection.tsx`
  - Detail: Factor the duplicated logic in `TagAdminControls` and `FacetSection`'s
    `TagCategoryHoverPanel` into one component. It must self-gate exactly as `TagAdminControls`
    already does — `GET /api/dev/scoring`, treat 404/error as "not admin", render `null` — and
    write through `POST /api/dev/scoring/overrides`. **Fetch the admin check and category list once
    and share it** (module-level cached promise or a small context), not once per rendered tag; an
    item page with 30 tag chips must not fire 30 identical requests. Refactor both existing call
    sites onto it with no visual regression.
  - Done when: both existing surfaces use the shared component, and an item page with many tags
    issues exactly one `GET /api/dev/scoring` (verify in the network panel).
  - Tests: none — behaviour is admin-gated UI; covered by T17's manual pass.
  - Depends on: none

- [ ] **T9** — Put the category picker on every surface that renders a tag
  - Files: `src/components/item/**` (tag chips on the detail page),
    `src/components/facet/PublicFacetView.tsx`, plus any other tag-chip render site found by
    grepping for `FacetLink` / tag chip rendering
  - Detail: Wire `TagCategoryPicker` (T8) into the item detail page's tag chips and the public
    facet page. Grep for every tag render site before starting and list them in the Session log so
    coverage is auditable. Keep it visually unobtrusive — the existing hover-reveal pattern is the
    reference. It must render nothing at all for non-admins and for anonymous visitors.
  - Done when: as an admin, a tag's category can be changed inline from the item detail page and a
    facet page, and the change is visible in `/dev/scoring`'s table after reload. As an anon
    visitor (verify via cookie-less `curl` of the SSR HTML), no admin markup is present.
  - Tests: none — covered by T17.
  - Depends on: T8

- [ ] **T10** — Show each tag's score impact on its chip, consistently everywhere
  - Files: `src/lib/discovery.ts` (export a per-facet impact helper),
    `src/components/TagCategoryPicker.tsx` or a sibling chip component, item/facet/insights chip
    render sites
  - Detail: Now that contribution is item-independent (T2), define **one** canonical per-tag
    number: `impact = K × dev × classWeight`, i.e. the points that tag adds to any item carrying
    it. Export a single helper that computes it and use it for the chip label, the item breakdown,
    the facet page's "Fandex impact" panel, and insights — so all four agree by construction. Show
    it signed and rounded to 1 decimal (`+3.2` / `−1.4`). Where a tag is present but fell outside
    the selection for that item, show the impact greyed with a "not counted for this title" note
    rather than hiding it.
  - Done when: the same tag shows the identical impact number on an item detail page, its facet
    page and insights. Verify with at least two tags, one positive and one negative, recording the
    numbers in the Session log.
  - Tests: add a test asserting the helper and `computeFandexScore`'s `reasons[].contribution`
    return the same value for the same facet on an item where that facet is counted.
  - Depends on: T2

- [ ] **T11** — Reconcile the facet page's you-vs-crowd average with the item page
  - Files: `src/lib/facetDetail.ts`, `src/app/api/facet/mine/route.ts`, `src/lib/discovery.ts`
  - Detail: An item page and that tag's facet page currently report different averages for the same
    tag because they recompute over different populations. Make both read the **same** Bayesian
    figure from the profile (`profile.meta.get(facetId)` → `BA`, `n`) rather than recomputing from
    whatever items happen to be loaded. Where the facet page genuinely needs a different basis
    (e.g. an average over only the loaded page), label it explicitly — SM22 established that
    unlabelled bases are the actual defect.
  - Done when: for at least three tags, the average shown on the item detail page equals the one on
    the facet page. Record the three tags and their values in the Session log.
  - Tests: add a test pinning the item-page and facet-page averages to the same source value.
  - Depends on: T2

- [ ] **T12** — Facet page: render library items with ratings and scores from the start
  - Files: `src/components/facet/PublicFacetView.tsx`, `src/app/api/facet/mine/route.ts`
  - Detail: For **logged-in viewers only**, do not render the item grid until both the provider
    items and `/api/facet/mine` have resolved; show a skeleton meanwhile. This removes both the
    late-score flicker and the "items appear without my rating" symptom. **Anonymous SSR must be
    byte-for-byte unchanged** — `/person`, `/tag`, `/studio` are public SEO surfaces (P17) and anon
    has no `mine` call to await. Gate on whether a session exists, not on whether the fetch
    happened to fail.
  - Done when: logged in, no item ever paints without its rating/score attached (verify by
    throttling the network and watching the grid). Anonymous `curl` of the same page returns the
    same SSR HTML as before the change — diff it to confirm.
  - Tests: none — covered by T17's manual pass plus the anon curl diff.
  - Depends on: none

- [ ] **T13** — Stop the rate quick action being clipped by the card
  - Files: `src/components/PosterCard.tsx`, `src/components/QuickActions.tsx`,
    `src/components/ActionCells.tsx`
  - Detail: `PosterCard`'s root carries `overflow-hidden` (`:134` and `:147`) to clip the poster's
    corners, which also clips the expanding 10-star row at the card's bottom edge. Fix by moving
    the overflow clip onto the poster wrapper only (the `aspect-[2/3]` div at `:57` already has
    it), or by portalling/floating the star row above the card with a high `z-index`. Do **not**
    just remove `overflow-hidden` from the root without checking the poster's rounded corners still
    clip correctly.
  - Done when: on the bottom row of a grid at both 375px and desktop widths, clicking Rate shows
    all 10 stars fully within the viewport, unclipped. Screenshot both.
  - Tests: none — visual; covered by T17.
  - Depends on: none

- [ ] **T14** — Add smart back buttons to item and facet pages
  - Files: `src/components/ui/BackButton.tsx` (new), item detail page, `/person|/tag|/studio` pages
  - Detail: New client component. Use `router.back()` when in-app history exists, otherwise
    `router.push()` to a sensible parent (`/discover` for an item; the referring item or
    `/discover` for a facet). Detect in-app history without relying on `document.referrer` alone —
    e.g. track a navigation counter in `sessionStorage`, or check `window.history.length > 1`
    combined with a same-origin referrer. It must never be a dead control on a hard-loaded or
    shared link. Place it consistently on both page types; match the existing header treatment.
  - Done when: (a) navigating Discover → item → Back returns to Discover with scroll position
    intact; (b) opening an item URL directly in a fresh tab and clicking Back lands on `/discover`
    rather than doing nothing; (c) same two cases on a facet page.
  - Tests: add a unit test for the target-resolution helper (history present vs absent), keeping
    the DOM interaction out of it.
  - Depends on: none

- [ ] **T15** — Rebuild the hover tooltip as a score explainer
  - Files: `src/components/Tooltip.tsx`
  - Detail: The tooltip currently duplicates the card (poster, title, date, type badge, source
    dots). Replace its body with: **title**; the **Fandex Score** as a bare number plus its band
    word (strong/typical/weak match); **your rating and library status** if any; and the **top 3
    positive and up to 2 negative contributing tags**, each with its signed impact from T10's
    shared helper. **Drop the duplicated poster image** — the card underneath already shows it.
    Keep the current ~260px width and the existing anchor/positioning logic. If the item has no
    score (anon, or below `MIN_RATED_FOR_FANDEX_SCORE`), fall back to title + date + type badge
    rather than rendering an empty shell.
  - Done when: hovering a scored card shows the score, band and contributing tags with impacts
    matching the item's detail page exactly; hovering an unscored card shows the fallback; the
    tooltip does not overflow the viewport at either edge.
  - Tests: none — visual; covered by T17.
  - Depends on: T10

- [ ] **T16** — Log the open questions this session deliberately did not answer
  - Files: `TASKS.md`
  - Detail: Add a dated section for this batch. Record as **open**: whether `priorStrength` (C) and
    the per-role weights want re-tuning now that the aggregate changed shape; and whether the
    `capped`/"not counted for this title" treatment is the right long-term answer once more items
    have facets excluded by the new selection. Keep to the file's 2–4-sentences-per-entry
    convention, and keep the file under its 200-line CI guard — archive a finished section into
    `docs/archive/history.md` if it would push past that.
  - Done when: `TASKS.md` has the new section, is under 200 lines, and STATUS.md's one-line digest
    matches.
  - Tests: none
  - Depends on: none

- [ ] **T17** — Full verification pass, docs, and commit
  - Files: `STATUS.md`, `TASKS.md`, `docs/fandex-score.md`
  - Detail: Run `npx tsc --noEmit`, `npm run lint` (must be 0 errors), `npm test`. Stop the dev
    server, then run a production build to confirm it compiles. Log in via `GET /api/dev/login` and
    manually verify in the browser: the tag table (create `People & Characters`, reassign a
    category, bundle and unbundle an aka), the inline picker on item + facet pages, the rate quick
    action at 375px and desktop, both back-button cases, the new tooltip, and the facet page's
    load behaviour. Update `docs/fandex-score.md` to describe the raw-sum model, the four selection
    counts, the removal of clamping, and the new `K`/`BAND_MARGIN` values with the measured
    distribution from T3. Update `STATUS.md` and `TASKS.md`. Commit in logical chunks (score math,
    tag admin, UI fixes, docs) with the repo's existing commit-message style, then push.
  - Done when: all three verification commands pass, the build succeeds, every manual check above
    is confirmed, and the work is committed and pushed.
  - Tests: none — this is the verification task.
  - Depends on: T1–T16

## Blockers log

## Session log

**T3 finding — systemic `import type` gap (2026-07-29):** writing
`scripts/calibrate-fandex.mjs` surfaced that Node's native type-stripping (used by
`scripts/alias-hooks.mjs` for every `rehearse-*.mjs`/`calibrate-*.mjs` script) only
erases syntactically type-only constructs, not type-directed ones — a plain
`import { Foo } from "mod"` where `Foo` is a type/interface throws
`SyntaxError: does not provide an export named 'Foo'` at load time, even though
tsc/webpack/SWC (and therefore `next dev`/`build`, `tsc --noEmit`, `vitest`) all
elide it correctly and see nothing wrong. Every export of `src/types/index.ts` is a
type with zero runtime presence, so ANY plain `import { X } from "@/types"` has this
latent bug; grepping `^import \{[^}]*\} from "@/types"` across `src/` turns up ~50
files, only 10 of which were on this script's actual import chain (fixed in
`4718d13`). The other ~40 are unaffected today (no script reaches them) but will hit
the identical wall the next time someone writes a `scripts/*.mjs` that imports them.
**Recommendation:** enable `@typescript-eslint/consistent-type-imports` repo-wide (or
at least add it as a `.eslintrc` override for `src/lib/**`) so this is caught at
commit/lint time instead of at the next standalone-script surprise — a bulk fix is a
separate, mechanical PR, not something to bundle into this plan.
