# Fandex Score — Scope & Design

> Per-user, per-item **taste-match score** shown on every media item, click-to-expand into a full "why". Deterministic and tunable. Status: scoping (drafted 2026-07-18). Epic **H5**.

## 1. What it is

A number (target scale **0–100**) on every game / movie / show that answers "how well does this match *my* taste?" — not "is this good?". Clicking it reveals exactly which facets pushed it up or down. Two hard properties:

- **Deterministic** — same profile + same config + same item ⇒ same score, every time. No randomness, no time-dependence.
- **Explainable** — the score is a sum of named, signed facet contributions; the breakdown *is* the computation, not a post-hoc rationalization.

It is a **personalized** score (depends on the logged-in user's ratings), not a global quality metric.

## 2. What already exists (reuse, don't rebuild)

The "Taste Match" discovery engine already implements most of the machinery — this feature productizes it into a visible score plus a config backend.

- `src/lib/libraryAnalysis.ts` — aggregates the rated library into per-facet stats (`count` / `sum` / `avg`) + the user's rating `baseline`. This is the raw material for the Bayesian averages.
- `src/lib/discovery.ts` — `buildProfile()` (per-facet weights, cached per user, signature-invalidated), `scoreFacets()` (per-item scoring + a `reasons[]` array carrying `kind/role/label/category/contribution`), and `ROLE_WEIGHT` (director 1.3, cast 0.6, developer 1.2, …).
- `src/lib/tags.ts` — the tag taxonomy: `CATEGORIES` (genre, source, setting, artstyle, mood, theme, audience, other, meta) + `categorizeTag()`. `meta` is already a `defaultIgnored` category.
- `src/components/discovery/MatchReasons.tsx` — renders the reasons. The explainability UI primitive already exists.

**The three real gaps** this design fills: (1) a clean **Bayesian average** per facet, (2) a stable **0–100 normalization** for a value users see, and (3) a **developer backend** that moves weights + taxonomy out of hardcoded TS into tunable, DB-backed config.

## 3. Scoring model

### 3.1 Per-facet taste value — Bayesian average

For each facet `f` (a director, a studio, a tag) the user has exposure to via rated library items:

- `n_f` = number of the user's rated items carrying `f`
- `m` = the user's global rating baseline (mean personal rating across their rated library)
- `C` = prior strength (tunable; the current code uses an implicit `K_SHRINK = 5`)

```
BA_f = (C · m + Σ ratings_f) / (C + n_f)
dev_f = BA_f − m           // signed taste deviation from your own norm
```

`dev_f > 0` ⇒ you like this facet more than your average; `< 0` ⇒ less. This is what makes **dislikes emerge automatically** and stops a single 9/10 outlier on a one-off facet from dominating — a facet seen once is pulled most of the way back to your baseline until evidence accumulates. This replaces the current `raw · shrink` shortcut in `buildProfile()` with a textbook Bayesian (shrinkage) average.

### 3.2 Weight classes

Every facet maps to one **weight class** with a tunable weight `W`:

- **People roles:** director, creator, writer, cast, developer, publisher, studio, network
- **Tag categories:** genre, setting, mood, theme, artstyle, source, audience, + any custom category (mood, characters, "Modes & Perspectives", …)
- **Ignored classes** (weight = 0, excluded entirely): `meta`/noise and **platform tags** ("PC", "PS5", "Windows", "co-op-as-a-store-facet", etc.).

Director outweighs a setting tag because `W(director) > W(setting)`, all set from the backend — no code change to rebalance.

### 3.3 Item aggregate → an unbounded raw sum over a top-N selection

**Revised 2026-07-29 (T1–T2, `.claude/plans/2026-07-29-tag-admin-and-score-rework.md`) — replaces the weighted-mean model below.** The weighted mean + per-category cap made a facet's *displayed* contribution item-dependent (the same tag's impact shrank or grew depending on how many other facets the item carried and which category cap it competed inside), and divided the visible spread down to a 40–80 range that read as "everything scores about the same." Both are fixed by switching to a **raw sum over a fixed top-N selection**, with density bias controlled structurally (by the selection count) instead of by a divisor:

```
kept = topTagsPositive(5) ∪ topTagsNegative(3) ∪ topPeople(3) ∪ topCompanies(2)   // sorted by |dev·W|, counts tunable in /dev/scoring
rawSum = Σ_f∈kept [ dev_f · W(class_f) ]                          // sum, not mean — no divisor
center = baseline · 10                                           // your own mean rating, 0–10 → 0–100
gain   = rawSum >= 0 ? mappingConstantUp : mappingConstantDown    // asymmetric gain
FandexScore = center + gain · rawSum                              // NO clamp — fully unbounded by design
```

- **People and companies get their own separate top-N buckets**, not lumped in with tags — a director doesn't compete with a genre tag for a slot.
- **No clamping or damping anywhere in this formula** (explicit user decision, 2026-07-29): the visible spread is whatever the selected facets' real deviations produce. `K` (`mappingConstantUp`/`Down`) was recalibrated from 10 to **25.4** for this shape (`scripts/calibrate-fandex.mjs`, T3) against the real 3,848-item catalog, landing a distribution of 46.4–97.1 with zero clamping.
- A facet outside the top-N for a given item is `capped: true` in the breakdown — still shown (greyed), with its real would-be impact number, not a flat "—".
- Because the sum no longer divides by anything, **a tag's contribution is the same number everywhere it's shown** — the item breakdown, the tag facet page, and every tag chip's hover picker all read `facetImpact()` (§3.4), not a per-item recomputation.
- **Q19 (2026-07-19, still holds):** the center is your own mean rating (the same number Insights shows as "your average"), not a fixed 50 — a fixed center meant roughly half of any library scored below 50 by construction, reading as "you won't like most things." The center is **derived, never a config knob**.
- Everything here (`C`, all `W`, `mappingConstantUp/Down`, and the four top-N counts) except the center is developer-tunable in `/dev/scoring`'s Weights & Tuning panel.
- **Open question, not yet revisited:** `priorStrength` (`C`) and the per-role class weights were tuned against the old weighted-mean's compression — nobody has re-validated them against this raw-sum shape yet. See TASKS.md's 2026-07-29 section.

### 3.4 Explainability payload

**Revised 2026-07-29 (T10):** each reason now also carries a canonical `impact` number, computed by `facetImpact(id, profile, config) = gain · profile.w.get(id)` — item-independent (it doesn't matter which item you're looking at a facet from), and equal to `contribution` for any facet that made the top-N cut. This is the number now shown on the item breakdown, the tag facet page, and the hover tooltip alike — previously these three surfaces each computed their own version and disagreed (a real `classWeight`-missing bug in `/api/facet/mine`, and a plain-mean-vs-Bayesian-average mismatch in `facetDetail.ts`, were both root causes, now fixed).

The existing `reasons[]` already carries `label / kind / role / category / contribution`. Extend each with `BA_f` and `n_f` so the expanded view can read:

> **Director — Denis Villeneuve:** you rate his films **8.9** avg over **4** titles → +6.2
> **Setting — space:** 6.1 avg over 12 titles, low weight → +0.4
> **Ignored:** platform · meta tags (3)

Show top positive contributors, top negative contributors, and an explicit "ignored facets" line for transparency.

## 4. Hard exclusions (enforced by test)

The score must **never** read: community / cross-platform ratings (IMDb, Rotten Tomatoes, Steam, Metacritic), item popularity or `browsed` counts, or release date / recency. Add a regression test that mutates each of those fields on an item and asserts the score is **unchanged**. (Note: the current `scoreFacets()` is already pure-facet — but the Discover *sort* uses `communityAvg` as a tiebreaker; the visible **score** must not.)

## 5. Developer backend

A gated `/dev/scoring` route (admin-only — see open decision D5). Two panels:

**Weights & tuning.** Number/slider inputs for every role weight, every category weight, the prior strength `C`, the mapping constant `K`, and per-category caps. A live preview scores a sample item as you drag, showing the breakdown update in real time.

**Taxonomy editor.** CRUD for tag categories (id, label, color, `weight`, `ignored`); assign/reassign individual tag keys to a category. **Rebuilt 2026-07-29 (T5–T7)** as a single searchable/filterable tag table (tag, catalog count, category dropdown, aka) replacing the old triage-view-plus-separate-bundle-UI: aliasing a tag into another folds both into one row and removes it from the count of distinct tags; category reassignment here is the same `TagCategoryPicker` control that now also appears inline on every tag chip across the app (item page, facet pages, Insights) — reassigning a tag's category from *any* of those surfaces updates the same override. Creating a "Modes & Perspectives" category and dropping `co-op` into it happens here, no deploy.

All config lives in the DB and cache-busts the profile/score caches on save.

## 6. Data-model changes

- `scoring_config` — single-row JSON blob: role weights, category weights, `C`, `K`, caps, mapping constants. Versioned.
- `tag_category` — custom categories (id, label, color, weight, ignored). Seeded from the current `CATEGORIES` so nothing regresses.
- `tag_category_override` — `tag_key → category_id`, so backend assignments win over the code heuristic. `categorizeTag()` becomes: **DB override → fall back to the existing code sets**. The hardcoded word-sets in `tags.ts` stay as the seed + fallback.

⚠️ Follow the repo's migration invariants (`AGENTS.md`): index a new column **in the same migration** that adds it, and test **both** apply paths (in-process `getDb()` *and* `node scripts/migrate.mjs`) — green Vitest only proves the fresh-DB path.

## 7. Where it surfaces

- **Cards** (`PosterCard` / `ListCard`, via `cardItem.ts`): a compact score badge. `cardItem.ts` must start carrying the computed score.
- **Detail page**: prominent score + expandable breakdown (extend `MatchReasons` / `RatingsSection`).
- Computed server-side off the cached per-user profile — the engine already scores the whole catalog per user with a `BoundedCache`, so marginal cost is bounded.

## 8. Cold-start

A personalized score needs signal. If `profile.hasSignal` is false or below a threshold (e.g. `< N` rated items or `< M` distinct facets), **show no score** with a "rate a few titles to unlock your Fandex Score" nudge — rather than a misleading number. No popularity fallback (that would break §4). This also cleanly handles logged-out visitors on public/SEO pages: no profile, no score.

## 9. Phased build — ✅ ALL PHASES DONE (H5.1–H5.7, closed 2026-07-27)

The five phases below are the original scoping and are kept for the rationale, not as a
status board. All shipped; phase 5 (calibrate) landed as H5.5 — `K` 10→25 and bands
re-anchored to `center ± 8`, verified against the real 1,855-item library (spread
46.4–97.1, zero clamping). Per-phase changelog is in `docs/archive/history.md`.
A future pass could still tune `C` / role weights now that the spread is legible.


1. **Config core** (~20k) — `scoring_config` + `tag_category` + override tables, migration, config loader with cache-bust, seeded from current `tags.ts` / `ROLE_WEIGHT`.
2. **Bayesian rescore** (~15k) — swap `buildProfile()` to the Bayesian average; refactor `scoreFacets()` to weighted-mean + 0–100 map reading config; extend `reasons[]` with `BA_f`/`n_f`. Add the §4 exclusion test.
3. **Dev backend** (~30k) — `/dev/scoring` weights panel + taxonomy editor + live preview.
4. **Surfaces** (~20k) — score badge on cards, breakdown on detail, cold-start states.
5. **Calibrate** (~10k) — tune `C`/`K`/weights against your own library so the numbers feel right; write down the chosen defaults.

**Est. ~95k.** Order: 1 → 2 → 4 (ship a visible score early) → 3 → 5.

## 10. Decisions (locked 2026-07-18)

- **D1 — Score semantics: FIXED TRANSFORM.** `FandexScore = center + gain·rawSum`. Deterministic; center matches your baseline exactly. No percentile (a percentile number would drift as the catalog grows). **Revised by Q19 (2026-07-19):** center is your own mean rating (×10), not a fixed 50 — see §3.3. **Revised again 2026-07-29 (T2):** the clamp is gone — fully unbounded by explicit user decision — and `K` is now `mappingConstantUp`/`Down`, still asymmetric, still deterministic.
- **D2 — Facet rarity (IDF): DROP from the visible score.** The score is purely *your taste × facet weights* — fully transparent. IDF may remain only as a Discover-*sort* signal, never in the number shown. (`scoreFacets()` must stop applying `idf` when computing the Fandex Score.)
- **D3 — Aggregate: WEIGHTED MEAN + per-category cap.** ~~Divide by total weight; count at most the top few tags per category. Facet-dense items can't inflate themselves.~~ **Superseded 2026-07-29 (T2):** replaced by a **raw sum over a fixed top-N selection** (5 tags-up / 3 tags-down / 3 people / 2 companies) — a divisor made a facet's displayed impact item-dependent, which a fixed selection count doesn't. See §3.3.
- **D4 — Prior anchor: USER'S OWN BASELINE.** Each facet's Bayesian average shrinks toward the user's personal mean rating `m`. Single-user-clean, no cross-user coupling.
- **D5 — Admin gate: ENV USER-ID ALLOWLIST.** `/dev/scoring` gated by an env var of allowed user IDs. No schema change; expand later if needed.
- **D6 — Taxonomy: ONE SHARED taxonomy.** Backend category edits / tag reassignments apply to both scoring and the Insights page — one source of truth. No scoring-only override layer.
