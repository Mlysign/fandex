# Fandex Score: scope and design

> **Since 2026-10-25 the score is a LABEL from two axes, and no number is shown** (Nils, after the 2026-10-24/25 measurements in memory `fandex-score-pull-vs-fit`). It answers one question, "how much more likely than usual are you to love this?", from **taste** (§3.1 to §3.6, your ratings) and **pull** (§3.7, what you seek out). Where the two land against your usual is the label (§3.8): *safe bet, hidden gem, tryout, bycatch, skip, your usual* (Nils's matrix). The 0 to 100 number still exists underneath: it ranks rails and feeds the goalpost (§11), and it is never printed in the interface. The picture of all this is `public/score-how-it-works.svg`, served at fandex.org/score-how-it-works.svg and shown on `/dev/score`; **change it whenever the score changes.**

> **Since 2026-10-23 the score runs only in the app**, `mobile/src/lib/fandexScore.ts`, a port that gave the old site's exact numbers before the 2026-10-25 change. The file names cited below (`libraryAnalysis.ts`, `discovery.ts`, `MatchReasons.tsx`, the calibration scripts) are the old site's, at the tag `old-site-final`; the live harness is `scripts/score-backtest.mjs` (§11).

> Per-user, per-item **taste-match**, shown on every media item, with a "Why?" that opens the whole sum. Deterministic and tunable. Epic **H5** (2026-07-18), reworked 2026-10-25.

## 1. What it is

A label on every title that answers "how much more likely than usual am I to love this?", never "is this good?" and never "what number would I give it?". The 2026-10-25 measurements (memory `fandex-score-pull-vs-fit`) settled why: on 942 rated films the number predicted the owner's rating within one point 41% of the time, which is what guessing his average does; a calibrated taste-only score would sit between 52 and 68 for 80% of unseen films. The number is a weak predictor of the rating and a good finder of what a person would pick, so it says the second thing and stops pretending to the first. The "Why?" sheet shows exactly which rows moved it, in two groups, one per axis. Two hard properties:

> **100 is the max, by normalizing, not clamping (Nils, 2026-10-23; supersedes 2026-08-17's "0–100 is a target, not a rule").**
> The raw sum (§3.3) passes through `softRange` (`mobile/src/lib/fandexScore.ts`): unchanged up to halfway between your average and 100 (or 0), then a tanh that meets the edge only in the limit. Nearly every score sits inside the knee, so nearly every score is what it was; the counted rows shrink by the same share past it, so the breakdown still adds up. On his library (2026-10-23): 0 of 4,675 above 100, max 99.2, min 3.9.
> Still settled: **no re-tune.** Measured again 2026-10-23 against his 1,707 ratings, leave-one-out: no prior strength (2 to 20), `ip` weight, minimum count or top-N count beat the live config.

> **A title you rated is scored as if you had not rated it (2026-10-23).** `computeFandexScore` takes its rating out of the baseline and out of every facet it carries; the panel says "Fandex Score, without your rating". Read with it in, the score agreed with his ratings at a rank correlation of 0.84, which was the title quoting itself; honestly it is 0.29. The crowd's rating alone reaches 0.42, and crowd plus taste 0.44, but the score stays taste only (§4, Nils 2026-10-23).

- **Deterministic** — same profile + same config + same item ⇒ same score, every time. No randomness, no time-dependence.
- **Explainable** — the score is a sum of named, signed facet contributions; the breakdown *is* the computation, not a post-hoc rationalization.

It is a **personalized** score (depends on the logged-in user's ratings), not a global quality metric.

## 2. What already exists (reuse, don't rebuild)

The "Taste Match" discovery engine already implements most of the machinery — this feature productizes it into a visible score plus a config backend.

- `src/lib/libraryAnalysis.ts` — aggregates the rated library into per-facet stats (`count` / `sum` / `avg`) + the user's rating `baseline`. This is the raw material for the Bayesian averages.
- `src/lib/discovery.ts` — `buildProfile()` (per-facet weights, cached per user, signature-invalidated), `scoreFacets()` (per-item scoring + a `reasons[]` array carrying `kind/role/label/category/contribution`; since 2026-08-22 `category` is the profile's EFFECTIVE category, the one that supplied the weight, not the item facet's own — they disagree routinely, and `facetColorVar` reads the same field), and `ROLE_WEIGHT` (director 1.3, cast 0.6, developer 1.2, …).
- `src/lib/tags.ts` — the tag taxonomy: `CATEGORIES` (genre, source, setting, artstyle, mood, theme, audience, other, meta) + `categorizeTag()`. `meta` is already a `defaultIgnored` category.
- `src/components/discovery/MatchReasons.tsx` — renders the reasons. The explainability UI primitive already exists.

**The three real gaps** this design fills: (1) a clean **Bayesian average** per facet, (2) a stable, **centred normalization** for a value users see — anchored on the viewer's own mean rating rather than clamped to 0–100 (see the note in §1), and (3) a **developer backend** that moves weights + taxonomy out of hardcoded TS into tunable, DB-backed config.

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
- **Franchise / IP** (`ip`, added 2026-08-14) — see §3.6
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
FandexScore = center + softRange(center, gain · rawSum)           // since 2026-10-23: 0 to 100, see §1
```

- **People and companies get their own separate top-N buckets**, not lumped in with tags — a director doesn't compete with a genre tag for a slot.
- **No clamping or damping in the sum** (explicit user decision, 2026-07-29; since 2026-10-23 the result bends toward 0 and 100, §1, while the sum itself is unchanged): the visible spread is whatever the selected facets' real deviations produce. `K` (`mappingConstantUp`/`Down`) was recalibrated from 10 to **25.4** for this shape (`scripts/calibrate-fandex.mjs`, T3) against the real 3,848-item catalog, landing a distribution of 46.4–97.1 with zero clamping.
- A facet outside the top-N for a given item is `capped: true` in the breakdown — still shown (greyed), with its real would-be impact number, not a flat "—".
- ⚠️ **`sorted by |dev·W|` in the block above is load-bearing, and the CODE did not match it until 2026-08-22.** All five bucket sorts ranked by the raw `dev`, so the selection ignored every class weight while `rawSum` and each reason's printed `contribution` used them. The two orderings coincide only when every `W` is 1, and none of them are: `roleWeights` ships director 1.3 against cast 0.6, prod runs `ip` 3 / `director` 2, and category weights are editable in /dev/scoring. A facet worth more points therefore lost its slot to a lighter one with a bigger raw deviation, and the panel could show a greyed "not counted" row worth twice the counted row above it (found on Mortal Shell II: Souls-like counted at +1.3, Dark Fantasy greyed at +2.6). It hit people and companies hardest, because their weights differ *by design* and only the score ever read them. **This line of the spec was right for three weeks while the code was wrong, and nobody diffed one against the other** — when a formula here is this specific, check it against `computeFandexScore` rather than assuming. The fix also brings cast `prominence` into the selection (`W` in that struct is the per-item `meta.classWeight × f.prominence`), and it MOVES scores wherever a weight is not 1, generally widening the spread. It is not a re-tune and changes no top-N *count*.
- Because the sum no longer divides by anything, **a tag's contribution is the same number everywhere it's shown** — the item breakdown, the tag facet page, and every tag chip's hover picker all read `facetImpact()` (§3.4), not a per-item recomputation.
- **Q19 (2026-07-19, still holds):** the center is your own mean rating (the same number Insights shows as "your average"), not a fixed 50 — a fixed center meant roughly half of any library scored below 50 by construction, reading as "you won't like most things." The center is **derived, never a config knob**.
- Everything here (`C`, all `W`, `mappingConstantUp/Down`, and the four top-N counts) except the center is developer-tunable in `/dev/scoring`'s Weights & Tuning panel.
- **Still open, deliberately time-gated (re-checked 2026-08-02: only 4 days of data, still too soon):** `priorStrength` (`C`) and the per-role class weights were tuned against the old weighted-mean's compression — nobody has re-validated them against this raw-sum shape yet. See TASKS.md's 2026-07-29 section.

### 3.6 Franchise / IP (added 2026-08-14)

A fourth facet **kind** (`ip`), not a company role — a franchise isn't a company, and folding it into `company` would have merged it into `/studio`'s public page. It needs no new maths: `dev_f = BA_f − m` over the user's rated entries in that franchise is the same Bayesian average every other facet uses. What it needed was a source, a normalizer and its own selection bucket.

- **Sources, both already in stored `raw_data`** — TMDB `belongs_to_collection` (movies) and IGDB `franchises` (games). No extra provider call.
- **`ipKey()` is what makes it cross-media.** TMDB suffixes its collections ("Star Wars Collection"); IGDB's franchises are bare ("Star Wars"). `ipKey` peels a trailing franchise word (`collection · series · saga · franchise · trilogy · anthology · universe · cinematic`), so both land on `star wars`. Without that peel the movie and the game sit on two different facets and the whole feature does nothing.
- **Its own top-N bucket** (`topIps`, default **1**) for the same reason people and companies have theirs: a franchise shouldn't have to out-compete a genre tag for a slot. Default 1 because an item belongs to one franchise; the only way to hold two is the providers naming the same one differently enough to survive `ipKey`, in which case counting both double-counts it.
- **Weight `roleWeights.ip`, default 1.3** — peer with `director`. Tunable in `/dev/scoring` like every other role.
- **No migration.** `getScoringConfig()` merges `{...DEFAULT, ...stored}` (and spreads `roleWeights` the same way), so an existing `scoring_config` row picks up `ip`/`topIps` from the defaults on the next read. Verified against the real local row, which predates both.
- **No public page.** `ip` is excluded from `LinkableFacetKind` (`facetUrl.ts`) — a new root-level dynamic segment breaks the lint rule gating CI, and whether franchises become an SEO surface is a separate product decision. The breakdown renders the row as plain text; Insights is unaffected because it renders three explicitly kind-scoped sections.

**Measured on the real 1,921-item library (2026-08-14):** 664 of 2,531 catalog items carry an IP across 401 distinct franchises; 319 of them have enough rated evidence to form an opinion. **516 of 1,903 scored items move.** Biggest movers: Metal Gear Solid **+5.2**, The Lord of the Rings **+5.0**, The Last of Us **+4.7**, Transformers **−8.0**, Assassin's Creed **−6.4**.

#### 3.6.1 The correction layer (migration 13, 2026-08-14)

Both original limits are now editable rather than structural, via two tables and one admin panel (`/dev/scoring` → Taxonomy → Franchises). They fix *different* problems and are deliberately separate mechanisms:

- **`ip_alias` — the providers NAME one franchise twice.** Mirrors `tag_alias` exactly, chains flattened on write. `metal gear solid` + `metal gear` (6 items each in the real catalog) fold into one average.
- **`item_ip_override` — the providers have no franchise DATA for an item.** An `add` attaches, a `remove` detaches. This is the only thing that can put a *show* in a franchise. Global catalog metadata, like `tag_category_override`. **It must never gain a `user_id` column** — that name is what `deleteAccount()` keys on, so naming one would make GDPR erasure drop everyone's corrections.

**Where resolution happens is the correctness story, and it is not where tag bundling put it.** A franchise the *profile* learned under a canonical key only matches an *item* whose facet carries that key, so both sides must resolve. Profile side: `analyzeLibraryFacets` + `buildCache` (where `applyTagAliases` already runs). Item side: **`computeFandexScore` itself**, via a `mediaItemId` option — *not* the nine `extractFacets()` call sites, because the four per-item ones are exactly where tag bundling silently drifted. `applyIpFacets` is idempotent (tested), which is what makes it safe at more than one layer. One trap worth knowing: `catalogFacets()` in `liveDiscover.ts` keys its map by **candidate** id while the media id exists only inside the loop, so resolution has to happen there rather than at the `fandexFor()` call sites downstream.

Both signatures fold into `scoringConfigSignature()`, so an admin edit invalidates every cached profile immediately.

**Title-match suggestions** (`suggestFranchisesByTitle`) are the only automatic show signal: an item whose title exactly matches, or is prefixed by, a franchise the catalog already knows. 31 candidates on the real catalog. Guarded at **4 chars for exact** and **2 words for prefix** — without that the show "X" matched the "X Collection" key, which it did. Never auto-applied; each is accepted or skipped by hand. **The Mandalorian is correctly not suggested** — it has no title signal, which is why the hand-attach exists.

**Measured dead ends, so nobody re-checks them:** TMDB carries franchise names on **2 of 387** show keyword payloads, and has no collection concept for series at all.

#### 3.6.2 Wikidata (2026-08-14) — the third source, and the one that knows about shows

Free, keyless, one SPARQL request per 50 items. `src/lib/sources/wikidata.ts` + the resumable sweep behind `POST /api/dev/scoring/wikidata`.

**The property differs per medium, and both were measured, not assumed.** The obvious pick is `P179` "part of the series" — and for **films and shows it is wrong**: Star Wars (1977) carries both `Star Wars` and `Star Wars original trilogy` under P179, so a sub-series pollutes the facet. `P8345` "media franchise" is clean there. **Games are the reverse**: not one of five sampled Steam titles had P8345 at all, while P179 returned Metal Gear, The Witcher, Half-Life, Portal, Fallout. So: films/shows join on IMDb id (`P345`) → **P8345**; games on Steam app id (`P1733`) → **P179**.

**Labels need `wikibase:language "en,mul,en-gb"`.** Plain `"en"` returns the bare QID for any entity without an English label, which is common for series items — Half-Life, Portal, Fallout and The Last of Us all came back as `Q752241`/`Q7231475`/`Q167835`/`Q28062624`. They carry `mul` labels. Anything still QID-shaped after the fallback is dropped rather than stored as a franchise name.

**Provenance is load-bearing.** `item_ip_override.source` is `manual` or `wikidata`, and `setItemIpOverride`'s upsert carries a `WHERE` clause so **a wikidata write can never overwrite a manual row** — otherwise the next sweep would silently undo a hand correction and the panel would look like it ignored the click. The reverse is allowed.

**The sweep is driven off `wikidata_ip_checked` — what we ASKED — never off "what still has no franchise".** That second shape is the trap SM48's cross-link backfill hit: the items a provider genuinely doesn't know stay missing forever, so the sweep never drains.

**Wikidata throttles, and finding that out was useful.** Firing 250-item batches back to back timed out and tripped the circuit breaker within seconds. Ten consecutive failed calls recorded **zero** rows — the throw-don't-swallow contract holding under a real outage, which is exactly what stops an outage being written down as "Wikidata says no". Fixed with a 1.2 s pause between queries; the sweep then drained all 2,295 eligible items in 11 batches with no failures.

**Result on the real catalog:** 584 items found a franchise → **321 games, 165 movies, 98 shows**. Star Wars spans 11 movies + 6 shows. Links no TMDB collection has: Better Call Saul → Breaking Bad, Puss in Boots → Shrek, Cyberpunk: Edgerunners → Cyberpunk. Franchises with an opinion 319 → **461**; items whose score moves 516 → **713 of 1,903**.

### 3.7 Pull: "do you seek this out?" (added 2026-10-25)

The taste axis above learns from RATINGS, and the owner's ratings turned out to be mostly about quality, not taste: across 558 tags with enough evidence, the tags he consumes most are rated LOWER relative to his average (rank correlation −0.34), because completionism means watching the bad steampunk and only the acclaimed war films. Anime, 220 of 349 catalog titles consumed, rated exactly at his average, got −0.1 points. Every person he named (Burton, Depp, Dafoe, Swinton, del Toro, Shinkai) sat at 100% of the catalog and near zero taste points. The signal for "my taste" as people mean it is in what they CHOOSE. That is this axis.

For every facet with at least `PULL_MIN_CATALOG` (3) catalog titles:

```
usualShare = Σ weights of consumed titles / catalog total          // library 1, wishlist WISHLIST_WEIGHT (0.5)
lift_f     = log2( ((consumed_f + pullPrior·usualShare) / (catalog_f + pullPrior)) / usualShare )
salience_f = clamp( ln(total / catalog_f) / ln(total / 10), 0.15, 1 )   // 1 for ten titles or fewer, a floor for "action"
value_f    = lift_f · salience_f · roleWeight(class)                 // tags 1; people, companies, ip by roleWeights
kept       = top pullTopTags tags ∪ pullTopPeople ∪ pullTopCompanies ∪ pullTopIps, by |value|
pullRaw    = pullGain · pullWeight[medium] · Σ kept value
```

- **The denominator is the catalog copy on the device**, counted once per catalog revision (`catalogCountsFrom`). Known limit, measured: the pool's films are 68% the owner's and its shows 97%, so a broad facet lifts little (anime p52 among tags) while a small one saturates (126 of 1,087 tags at 100%). The lift still ranks a wishlist well because it rides on narrow facets; a reference population per medium from the providers is the fix, and it is a denominator swap, not a maths change. → TASKS.md
- **A title you hold is scored with its own place in the counts left out** (`consumedIds`), as its rating is on the taste axis.
- **A follow sets `lift_f` to the maximum, `log2(1/usualShare)`; an avoid to the minimum.** Nothing on the taste axis moves (`facetPull`, tested). A taste override was measured and rejected: steampunk set to 10 lifted Mortal Engines (rated 3) from 82 to 93.
- **`pullWeight` is per medium** (games 0.5 by default): what the owner plays and what he rates disagree (pull alone ranks his wishlist at 96% and his ratings at −0.12). **The band reads the axis BEFORE this weight** (and before the bend, §3.8): the weight says how much pull counts in the number, not whether you seek games out; with it applied no game was ever a safe bet.
- Both axes are bent together by `softRange` so 100 stays the maximum; every counted row shrinks by the same share and the breakdown still adds up.

### 3.8 The label (added 2026-10-25)

Each axis's raw points land in a band: `high` at or above its margin over your usual (`tasteBandMargin`, `pullBandMargin`, both 10), `low` at or below, else `usual`. Both bands read the axis before the bend and before the medium weight, so neither axis can hide the other.

Nils's matrix (2026-10-25): the label says what to DO with the title.

| | pull low | pull usual | pull high |
|---|---|---|---|
| taste above usual | **hidden gem** | **hidden gem** | **safe bet** |
| taste usual | your usual | your usual | **tryout** |
| taste below usual | **skip** | **skip** | **bycatch** |

Without a catalog count (no pull axis) the taste band alone names it: above usual is a hidden gem, below usual a skip. Measured on the owner's library before the matrix was final, the cells behave as named: films in the taste-high band he gave 7.1 (43% an 8 or more) against 6.0 in the low band; on unseen films the high-pull cells were 23 to 24% wishlisted and the low-pull cells 0%; "hidden gem" games were rated 8.0 (72% an 8+) and 0% wishlisted, which is the Metal Gear and Persona back catalog. The words live in `LABEL_TEXT` (`mobile/src/lib/scoreReasons.ts`) and in the picture; renaming is one edit in each.

**The odds line** under the label ("Films like this: an 8 or more about 1.4× as often as usual") is the one number shown. It is, per label and medium, how much more often than usual titles with that label were rated 8 or more: `DEFAULT_LABEL_ODDS` (`src/lib/scoringDefaults.ts`), seeded from the owner's 1,701 ratings, to be replaced by the goalpost's sums (§11) once there are enough users.

### 3.4 Explainability payload

**Revised 2026-07-29 (T10):** each reason now also carries a canonical `impact` number, computed by `facetImpact(id, profile, config) = gain · profile.w.get(id)` — item-independent (it doesn't matter which item you're looking at a facet from), and equal to `contribution` for any facet that made the top-N cut. This is the number now shown on the item breakdown, the tag facet page, and the hover tooltip alike — previously these three surfaces each computed their own version and disagreed (a real `classWeight`-missing bug in `/api/facet/mine`, and a plain-mean-vs-Bayesian-average mismatch in `facetDetail.ts`, were both root causes, now fixed).

The existing `reasons[]` already carries `label / kind / role / category / contribution`. Extend each with `BA_f` and `n_f` so the expanded view can read:

> **Director — Denis Villeneuve:** you rate his films **8.9** avg over **4** titles → +6.2
> **Setting — space:** 6.1 avg over 12 titles, low weight → +0.4
> **Ignored:** platform · meta tags (3)

Show top positive contributors, top negative contributors, and an explicit "ignored facets" line for transparency.

### 3.5 Which facets get scored — one source, on every surface

**Added 2026-07-30 (F2); the rule itself began with the 2026-07-29 facet-source fix.** The formula above only agrees with itself if every surface feeds it the *same* facets for the same item. Under the old weighted mean this barely mattered — the divisor pulled a thin facet set and a rich one back toward each other — but the raw sum in §3.3 makes score magnitude scale directly with how many facets are loaded, so the input is now part of the contract:

> **The Fandex Score is always computed from an item's PERSISTED `media_links`.** Never from a provider list payload, and never from a live-enriched in-memory link array.

Two ways that was violated, both fixed:

- **Live feed paths** scored `listFacets()` — a provider list payload's *genres only*, missing credits, keywords and studios. Spirited Away read 65.8 on a Home rail against 101.5 on its detail page. Live paths now resolve each candidate to its catalog row (`catalogFacets()` in `liveDiscover.ts`), falling back to a direct `media_links` read for browsed-only rows that `POOL_WHERE` keeps out of the discovery cache. What genuinely needs a provider fetch is hydrated in the background via `POST /api/discover/scores`, behind a pending pip — a card shows *no* score rather than one known to be depressed.
- **`/api/detail`** scored the array it had in hand, which by scoring time differs from the catalog in two ways: `ensureTmdbDetail`/`ensureGameDetail` mutate entries in place, and `enrichMissingSources` **pushes title-matched sources that are never written to the DB**. It now scores `linksForScoring()` — a re-read of `media_links` after the heal, which keeps the freshly-healed data and drops the in-memory-only sources. A live item with no uuid has nothing persisted and nothing to disagree with, so it is unchanged.

Two consequences worth knowing. First, the heal writes `media_links` while the discovery cache's signature watches `media_items`, so **any path that heals a row must call `invalidateDiscoveryCache()`** or the catalog surfaces keep serving the pre-heal score — that was the residual 2.3-point gap on "Hope". Second, the *rendered metadata* on a detail page deliberately still comes from the live-enriched links: freshness is what you want in the visible fields, and only the score has to agree with everyone else.

## 4. Hard exclusions (enforced by test)

The score must **never** read: community / cross-platform ratings (IMDb, Rotten Tomatoes, Steam, Metacritic), item popularity or `browsed` counts, or release date / recency. Add a regression test that mutates each of those fields on an item and asserts the score is **unchanged**. (Note: the current `scoreFacets()` is already pure-facet — but the Discover *sort* uses `communityAvg` as a tiebreaker; the visible **score** must not.)

**Added 2026-10-25 (Nils):** no implicit rating either. Episodes watched, hours played and rewatches never stand in for a rating, although completion predicted his show ratings at 0.31 where facets predicted them at 0.01 (memory `fandex-score-pull-vs-fit`). Only ratings a person typed count on the taste axis; what they hold counts on the pull axis. And no manual taste override (§3.7): a follow is the only thing a person sets by hand, and it moves pull alone.

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

## 7. Where it surfaces (rewritten 2026-10-25)

Nothing prints the number. The four levels, each one tap deeper and each one checkable:

1. **The card** (`MatchLabel` in `components/kit.tsx`, drawn by `cardFace.tsx`): the label in its colour on a faint fill, with two tiny bars, pull then taste. `RowScore` (`ScoreProvider.scoresFor`) carries `{score, label, taste, pull}`; `fandexScore` on a `CardItem` still ranks, `match` is what the card shows.
2. **The item page's panel** (`FandexScorePanel.tsx`): the label in the display face, one sentence that names both axes (`labelSentence`), the odds line (`oddsLine`), two bars that end in a word (`AxisBars wide`), and "Your usual: you rate titles 6.7 on average". States: anon, settling, cold, none, scored.
3. **The Why sheet**: two groups, "You seek this out" and "You rate it well", each headed by its band and its points, every row one sentence with a count ("you've seen 46 of 64", "you rate it 7.6 over 41 titles") and its contribution; **Follow** on the pull rows; the rows that matched but did not count, greyed with their would-be value; a three-sentence "How this works". The same facet can sit in both groups.
4. **The facet page** (`FacetScreen.tsx`): two pills, "Taste +4.2" with its sentence and "Pull +3.1" with "you've been through 46 of the 64 titles with this tag · you seek this out"; **Follow** and **Not interested** controls, keyed by the profile's own facet ids when you have rated the facet and by the catalog's ids otherwise.

The card's explainer (`ScoreExplainer.tsx`) shows the label, the sentence and the two strongest rows of each axis. Home's Recommended rail still filters by the combined score's band (`scoreBand`, `homeFeed.recommend`), so "Recommended" never carries a title it would label bycatch.

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

## 11. The goalpost (added 2026-10-25)

Every change to the score is measured before it ships, per medium, with the wishlist held out, on two bars: does it order a person's own ratings better, and does it rank what they wishlisted above what they never touched. `scripts/score-backtest.mjs` runs both on an exported library against a catalog folder and a taxonomy file, and prints the odds per label. Judged by rating correlation alone, a score that gave anime −0.1 passed review (2026-10-23); that is why there are two bars.

In production the same check runs on every device: `sendScoreReport` (`ScoreProvider.tsx`) scores every rated title with its own rating left out and sends, about once a day, twelve counts of (rating − score ÷ 10) per medium and, per label, how many rated titles got it and how many of those were an 8 or more (`PUT /v1/me/score-report`, table `score_report`, migration 0006). Counts only: no title and no rating leaves the device, the privacy policy says so, the export carries the rows. `/dev/score` draws the sum over everybody (`GET /v1/admin/score`) as the goalpost chart, with the odds each label earned, and shows the how-it-works picture under it. Nils (2026-10-25): one chart for all users on the backend, not a page per user.

## 12. Decisions (2026-10-25)

- **One label, no number in the interface.** The badge reads as a rating whatever it says (Nils: "if it says 80 I'll probably rate it 8"), and a calibrated predicted rating would be true but sit in a 16-point band. The number stays internal.
- **Two axes, pooled across media.** Facets are learned across every medium (a book is scored from your films and games: 99% of the evidence behind an unrated book is another medium). The one per-medium step is invisible: each rating is moved by the gap between its medium's average and your overall average before a facet learns from it, so "I rate games higher" does not leak into every game tag (books went from reversed to right on the owner's 14).
- **Pull weighs per medium, with games at half.** Measured trade-off (§3.7).
- **Follows feed pull only; no taste override; no implicit ratings** (§3.7, §4).
- **The goalpost is one admin chart over all users**, and the odds line comes from a global ladder (§11).
- **The labels are Nils's matrix** (§3.8): hidden gem and skip span pull low and usual, safe bet, tryout and bycatch sit at pull high. A label says what to do, not how good the title is.
- Reopened for the salience share (§3.7 uses specificity as a weight on the pull axis): D2 ("rarity out of the visible score") holds for the taste axis and not for pull, and "a tag's contribution is the same everywhere" holds for taste rows only.

## 10. Decisions (locked 2026-07-18)

- **D1 — Score semantics: FIXED TRANSFORM.** `FandexScore = center + gain·rawSum`. Deterministic; center matches your baseline exactly. No percentile (a percentile number would drift as the catalog grows). **Revised by Q19 (2026-07-19):** center is your own mean rating (×10), not a fixed 50 — see §3.3. **Revised again 2026-07-29 (T2):** the clamp is gone — fully unbounded by explicit user decision — and `K` is now `mappingConstantUp`/`Down`, still asymmetric, still deterministic. **Revised 2026-10-23:** bounded again, by `softRange`, not a clamp (§1).
- **D2 — Facet rarity (IDF): DROP from the visible score.** The score is purely *your taste × facet weights* — fully transparent. IDF may remain only as a Discover-*sort* signal, never in the number shown. (`scoreFacets()` must stop applying `idf` when computing the Fandex Score.)
- **D3 — Aggregate: WEIGHTED MEAN + per-category cap.** ~~Divide by total weight; count at most the top few tags per category. Facet-dense items can't inflate themselves.~~ **Superseded 2026-07-29 (T2):** replaced by a **raw sum over a fixed top-N selection** (5 tags-up / 3 tags-down / 3 people / 2 companies) — a divisor made a facet's displayed impact item-dependent, which a fixed selection count doesn't. See §3.3.
- **D4 — Prior anchor: USER'S OWN BASELINE.** Each facet's Bayesian average shrinks toward the user's personal mean rating `m`. Single-user-clean, no cross-user coupling.
- **D5 — Admin gate: ENV USER-ID ALLOWLIST.** `/dev/scoring` gated by an env var of allowed user IDs. No schema change; expand later if needed.
- **D6 — Taxonomy: ONE SHARED taxonomy.** Backend category edits / tag reassignments apply to both scoring and the Insights page — one source of truth. No scoring-only override layer.
