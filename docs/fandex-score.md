# Fandex Score: scope and design

> **Since 2026-10-27 the score is ONE NUMBER that means one thing: what you would probably rate this, times ten** (Nils: "a flat number is just so much more intuitive"; the measurements are in memory `fandex-score-pull-vs-fit`, round 8, and §3.11). It starts from your average rating for the title's medium (§3.3) and moves by the **taste** axis (§3.1 to §3.6, your ratings), with the gain fitted to your own ratings so that 72 means about a 7 (§3.11). **Pull** (§3.7, what you seek out) is said beside the number and is not in it. The label of 2026-10-25 is gone (`docs/archive/history.md`); the band (§3.8) colours a badge. The picture of all this is `public/score-how-it-works.svg`, served at fandex.org/score-how-it-works.svg and shown on `/dev/score`; **change it whenever the score changes.**

> **Since 2026-10-23 the score runs only in the app**, `mobile/src/lib/fandexScore.ts`, a port that gave the old site's exact numbers before the 2026-10-25 change. The file names cited below (`libraryAnalysis.ts`, `discovery.ts`, `MatchReasons.tsx`, the calibration scripts) are the old site's, at the tag `old-site-final`; the live harness is `scripts/score-backtest.mjs` (§11).

> Per-user, per-item **taste-match**, shown on every media item, with a "Why?" that opens the whole sum. Deterministic and tunable. Epic **H5** (2026-07-18), reworked 2026-10-25.

## 1. What it is

A number on every title that answers "what would I probably rate this?", times ten, never "is this good?". Nils (2026-10-27): the assumption "a score of 82 means I would rate it 8" is one to accept and get as close to as the data allows. The 2026-10-27 measurements (§3.11) say how close: on 939 rated films the number lands within one point of his rating 44% of the time, where guessing his average does it 41%; when it said 70 to 75 he gave 7.5, and 80 or more on games 8.5. It is a weak predictor on films and a fair one on games, and it says so in the Why sheet ("How right it has been", from the device's own measurement). The price of honesty is spread: most unseen films read 47 to 68, and none reaches 80. The "Why?" sheet shows exactly which rows moved it. Two hard properties:

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
kept = topTagsPositive(12) ∪ topTagsNegative(2) ∪ topPeople(1) ∪ topCompanies(1) ∪ topIps(1)   // sorted by |dev·W|, counts tunable in /dev/scoring
rawSum = Σ_f∈kept [ dev_f · W(class_f) ]                          // sum, not mean — no divisor
center = centreFor(medium) · 10                                  // since 2026-10-27: your mean rating FOR THE MEDIUM, 0–10 → 0–100
gain   = rawSum >= 0 ? mappingConstantUp : mappingConstantDown    // fitted to your ratings by least squares (§3.11), one each way
FandexScore = center + softRange(center, gain · rawSum)           // since 2026-10-23: 0 to 100, see §1
```

**The centre is per medium since 2026-10-27** (`centreFor`, `mobile/src/lib/fandexScore.ts`): you rate games 7.3 and films 6.4, and one centre for both read every game half a point low (games' bias −0.47 with the overall centre, +0.23 with their own). A medium with fewer than `MIN_RATED_FOR_MEDIUM_CENTRE` (10) ratings, or a title without a medium, starts from your overall average. A title you rated is left out of its own centre. The facets' deviations are still measured from the offset overall average (§3.1): the offset keeps a medium's gap out of every tag it carries, and the centre puts it back where it belongs, on the whole medium.

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

### 3.7 Pull: "do you seek this out?" (added 2026-10-25, rebuilt 2026-10-26)

The taste axis above learns from RATINGS, and the owner's ratings turned out to be mostly about quality, not taste (rounds 1 to 7 in memory `fandex-score-pull-vs-fit`). The signal for "my taste" as people mean it is in what they CHOOSE. That is this axis. Its first version (2026-10-25) counted, per facet, the share of the pool's titles carrying it that you had been through, against your usual share; it is in `docs/archive/history.md`. It failed because **the pool was mostly the owner's library**, so it counted itself: on 2026-10-26 firefighter, on 3 of his films, out-pulled anime, on 88 (×2.25 against ×1.7), a Why row read "you've seen 4 of 4", and 362 facets tied at the ceiling a pool that is 43% yours allows. Nils also ruled out the two cheaper fixes: counting only what a provider can count (it drops the tags fetched from Steam, Wikidata and the anime rule), and filling every facet to fifty titles (every tag then looks equally common).

**The baseline.** Ordinary titles drawn at random, per medium, from everything a provider knows above a vote floor (`scripts/baseline-draw.mjs`): 2,500 of TMDB's 15,101 films with 200+ votes, 1,500 of its 4,440 shows with 100+, 2,500 of IGDB's 10,839 main games with a rating count of 10+, 1,000 of Open Library's 8,108 works with 100+ reading-log entries (draw 1, 2026-10-26). The floors were picked to cover what the owner actually picks: 98% of his films, 96% of his shows, 82% of his games, 13 of his 14 books clear them. Uniform, not the top N: his library reaches far past the 2,000 most-voted films, and against those a niche tag looks rarer than it is. The draw goes into the pool through the normal resolve (`worker/src/baseline.ts`, migration 0008, the every-minute cron), so a drawn title is tagged exactly like any other, Steam's tags and Wikidata's people included. A device learns which pool titles are the baseline from `GET /v1/catalog/baseline`; the website gives a title only the draw added no page (§7 of `docs/website.md`).

**The model** (`mobile/src/lib/pullModel.ts`). One weighted logistic regression of "is this one of your picks or a baseline title?" over the facets the titles carry: your library at weight 1, your wishlist at `WISHLIST_WEIGHT` (0.5), each medium's baseline weighted to equal your picks in that medium, one unpenalised intercept per medium, so how much of a medium you pick is not read as pull for every facet it carries. Facets are pooled across media. A coefficient is the log of how much more often a title with the facet is one of your picks, every other facet held equal. That is what keeps a tag that only rides along out: firefighter is on three of his films, all anime, and gets nothing.

- **The features:** every facet the taxonomy resolves (`pullFacetIds`), except tags in an IGNORED category. Category, role and tier weights are taste's: the model weighs each facet itself, and anime is filed under art style, which weighs 0 for taste. A TAG must also be on at least two of the titles the draw itself added (`fresh`, the Worker's `added`): a tag the drawn titles never show is one whose source they lack. RAWG's genres sit on titles stored before RAWG was retired and never on a drawn one; with every baseline title vouching (drawn titles already in the pool carry RAWG too), "singleplayer" read as 17 times his usual. People, studios and franchises come from the same provider records for a drawn title as for yours, so they need no such check: rarity is what makes "five of his films" telling.
- **The evidence (`pullL1`, a z-score, 1.5):** a lasso whose penalty per facet scales with the square root of the weight it sits on, so a facet enters once (picked − expected) / √(picked + expected) passes `pullL1`. A franchise you finished four of four (0.1 expected) does; three firefighter films against 1.75 expected does not. A small ridge (`pullL2`, 0.5) keeps facets that always come together steady.
- **Your own picks** are scored by a model fitted without them: five folds by a hash of the id (`foldFor`), each refitted from the whole fit in a few sweeps. The whole fit with its folds took about half a second on a desktop for 2,000 picks and 6,500 baseline titles.
- **A follow** sets a facet's coefficient to the strongest in the model (never under a doubling), an avoid to its negative. Nothing on the taste axis moves.

**What a row says.** "You pick it 5 times more often than average (88 of your films)" (Nils's wording, 2026-10-26): the times come from the plain counts, your picks carrying the facet against what the baseline says they would, medium by medium, with half a title added to both sides (`timesAverage`); the count is your picks carrying it, named by medium when they share one. **A row shows, and counts, only when the model weighs the facet and the plain count agrees on its direction** (Nils: "don't let firefighter influence the pull if it's explained by anime, therefore don't show it either"). There is no top-N for pull: the model has already chosen.

**Points, beside the number and not in it (2026-10-27).** `pullGain` (3.5) × Σ coefficient ÷ ln 2, so the gain is points per doubling; `times` is e to the sum, "You pick films like this 3 times more often than average" (`pullLine`). Pull left the number on 2026-10-27 (§3.11): every title the owner rated is one he picked, so on rated titles pull read high almost by construction and added an offset, not information (films off by 1.63 with it, 1.40 without; as an extra regression feature it added nothing either). The per-medium `pullWeight` went with it. A pull row carries `contribution: 0` and its points in `impact`; the band (`pullBandMargin`, 6) and the bar are its own. A device with no baseline for a medium yet has no pull axis there, and the Why sheet says so. **What pull still does:** the item page's line, the Why sheet's "What you pick" group, the facet pages' Pull pill and the follows. What it no longer does: rank Home's Recommended rail, which cost films' wishlist bar twelve points (82% → 70%), accepted by Nils.

**Measured on the owner's library, provisionally (2026-10-26).** The baseline was still being walked into the pool, so it was fetched here from the providers (`extractFacets` over TMDB, IGDB and Open Library, as the Worker derives a title), without Steam's tags or Wikidata's people, which were taken off both sides for the test. The pool was mid re-derive: its tags gained the tier the same tag carries on the fetched titles, or today's pull would score its keywords in full and the fetched ones at 0. The fair test is the wishlist, held out, against ordinary titles the owner never touched; "today, filled" is the old pull with the baseline added to its pool, what it would see after the fill.

| | films: pairs · ρ · wishlist | shows: pairs · wishlist (8 titles) | games: pairs · ρ · wishlist |
|---|---|---|---|
| today | 63% · 0.320 · 67% | 56% · 47% | 60% · 0.230 · 94% |
| today, filled | 60% · 0.262 · 71% | 55% · 51% | 61% · 0.255 · 97% |
| **the model, z 1.5** | **60% · 0.249 · 82%** | **55% · 56%** | **64% · 0.318 · 94%** |
| the model, z 1 / z 2 | 60% · 86% / 60% · 79% | 55% · 61% / 55% · 53% | 64% · 95% / 64% · 93% |

A search over the gain and the per-medium weights (on half the titles, checked on the other half) settled on the stored ones, gain 3.5 and films 1.5, shows 0.5, games 0.5, and z 1.5 (z 1 lets twice the facets through, 880 against 355; z 2 drops del Toro and four points of films' wishlist bar). Labels on rated titles: a safe-bet film was rated 8+ 1.65× as often as usual, a hidden-gem film 1.64×, a skip film 0.41×, a bycatch film 0.65×; `DEFAULT_LABEL_ODDS` was re-seeded from that run (labels and odds gone 2026-10-27). The facets with the most weight, both ways, read like the owner: Telltale, Bethesda, A24, Studio Ghibli, neo-noir, supernatural horror, father-daughter stories, Tim Burton (×16, 19 films) and Johnny Depp, Tarantino as a writer, steampunk (×4.4, 46 titles); Nintendo, Atari and Konami away. Anime reads ×2 on 220 titles and carries little weight, because the facets that always come with it (animation, the Japanese voice cast) share its credit. **The real test runs once the baseline is in the pool** (TASKS.md).

### 3.8 The band (rewritten 2026-10-27; the label of 2026-10-25 is in `docs/archive/history.md`)

The score's band (`FandexScore.band`, `ScoreBand`) is where the number sits against the centre: `high` at or above `tasteBandMargin` (4) over your average for the medium, `low` at or below, else `usual`. It reads the bent points, the ones the number shows, so a green badge always sits at least four points over the centre. It colours the badge (green, grey, orange: the old site's ramp, re-anchored per medium) and fills Home's Recommended rail, which carries `high` only. Four points means "you would give it about half a point more than usual". Measured 2026-10-27 on rated titles: films the score put in the high band he gave 7.12 (44% an 8 or more) against 6.34 in the usual band and 5.38 in the low; games 8.05 (73%) against 6.84 and 5.96. On unseen titles 7% of films, 13% of shows and 17% of games read high. At 5 no show did; at 3 the films' high band dropped to 6.91.

The pull axis has a band of its own (`pullBandMargin`, 6, on its own points) for its bar; it names nothing on its own since 2026-10-27.

### 3.9 Tag tiers: where a tag came from (added 2026-10-25)

The first of the score's data fixes. Until this, a title's tags were one flat union in `merge.ts`'s source order (RAWG, Steam, TMDB, Trakt, Letterboxd, IGDB, …), deduped and cut at 30, so provenance died there: a game's 278 IGDB keywords filled its facets (a median of 5, p90 49), RAWG's voted tags were never read, and Steam's were not fetched at all on this stack. Measured 2026-10-24: the score's games ranked by tag count (ρ 0.39), and the formula was not the limit, the facets were.

Every tag facet now carries a **tier** and a **rank** (`src/types` `TagTier`, `src/lib/facets.ts`):

| tier | what it is | sources | cap per title |
|---|---|---|---|
| `genre` | the provider's own classification | TMDB, IGDB, RAWG, Trakt and Letterboxd genres, BGG categories | 12 |
| `theme` | its second one | IGDB themes, Trakt subgenres, BGG mechanics | 12 |
| `voted` | what a crowd put on the title and ranked | Steam's store tags (by votes), RAWG's tags (English only), Hardcover's | 20 |
| `keyword` | the long editorial tail | TMDB and IGDB keywords, a book's subjects, BGG theme families | 8 |

The normalizers (`sources/normalize.ts`) emit each source's tags with their tier in the source's own order, noise (`meta`) last; `mergeLinks` files every tag under the best tier any source gave it, orders a tier by source then rank, caps it (`TIER_CAPS`), numbers it 1 first, and lets a tag the cap leaves out fall back to the next tier that lists it (Steam's fifteenth tag is often the specific one). `extractFacets` reads that list (`merged.tagTiers`), and `merged.tags`, the display list, is the same tags in tier order, so the chips on a page are the facets the score reads.

**Steam's voted tags** come from `IStoreBrowseService/GetItems` (`src/lib/sources/steam.ts`, the Web API terms cover it), written by the cron (`runSteamTagsStep`) onto the IGDB payload as `steamTags` for every pool game that names a Steam page, the way `collections` were: not a Steam link, which would also make Steam's header the game's backdrop. 1,218 of 1,313 such games answered with tags on 2026-10-25, 17 each.

**The score weighs an occurrence by its tier**, on both axes, the way it weighs a cast occurrence by its billing (`occurrenceWeight`, `tagTierWeights` in the scoring config, admin-tunable): genre, theme and voted in full, keyword 0.5. A facet derived before tiers existed carries none and counts in full. The Why sheet marks a tag row "core" or "detail".

Measured on the owner's library (`scripts/score-backtest.mjs`, taxonomy version 9), before → after:

| | films: pairs right · ρ · wishlist | games: pairs right · ρ · wishlist · held | books ρ |
|---|---|---|---|
| before | 62% · 0.313 · 82% | 59% · 0.198 · 90% · 76% | −0.38 |
| tiers and caps, no weights | 62% · 0.310 · 83% | 60% · 0.231 · 88% · 80% | 0.04 |
| keyword 0.5 (shipped), no Steam | 62% · 0.295 · 85% | 59% · 0.205 · 89% · 81% | 0.16 |
| plus Steam's voted tags, cap 20 (shipped) | 62% · 0.296 · 85% | 59% · 0.195 · 87% · 79% | 0.23 |

Keyword at 0.25 pushed films' wishlist to 87% at ρ 0.288; at 0.75, 84% and 0.305: a trade between the two bars, left at 0.5. Steam's tags cost the games wishlist bar three points whatever their weight (0.5, 0.75 and 1 measured) and whatever the cap (12 was worse than 20); zeroing the `mode` category they mostly file under changed nothing. They stay on: the measurement is one library, and "Tower Defense", "Roguelike Deckbuilder" and "Story Rich" exist nowhere else.

**People on games** (data fix c, same day). IGDB has no credits, so 0 of 2,709 games carried a person while every film had a director and a cast. The Worker's cron asks Wikidata (`src/lib/sources/wikidata.ts`, `runWikidataPeopleStep`), joining a game on its Steam app id (P1733) and its IGDB slug (P5794) in one SPARQL request per batch, and stores director (P57) as `director`, game designer (P287) as `creator` (the role a show's creator and a board game's designer share) and writer (P50, P58) as `writer`, four names a role at most, on the IGDB payload as `wikidata`; `extractFacets` reads them. Measured on the pool before building anything on it: Wikidata knows 1,998 of 2,675 games (1,126 through Steam, 872 through the slug) and lists a person for **418** (256 directors, 165 designers, 114 writers); Kojima on 18 games, Miyamoto 9, Druckmann 8, Todd Howard 8. Backtest with them in: games order his ratings right 59% of pairs, ρ 0.195 → **0.211** (taste axis 0.330 → 0.337), wishlist 87% and held-unrated 79% unchanged; films untouched. No new surface: the Why sheet, the facet pages and `roleWeights` already handle the three roles.

**The anime facet** (data fix b, same day). A film or show whose genres include Animation and whose TMDB `original_language` is `ja` carries the tag `anime` (category `artstyle`, the tier and weight of a genre), pushed before the tag list so TMDB's own `anime` keyword dedups into it (`extractFacets`; the merged `originalLanguage` is a display name, "Japanese", so the rule reads TMDB's code first). Measured on the pool: 242 of 1,671 films and shows qualify, 235 of them already carried the keyword, but the keyword tier is capped at eight and counts half. ⚠️ On prod the `artstyle` category weighs 0 since 2026-10-25 (TASKS.md, "the seven no-signal categories"), and a category at weight 0 is out of BOTH axes (`classWeightOf` gates `facetPull` too), so the facet shows on the page and counts nothing in the score until `artstyle` has a weight again or `anime` is filed elsewhere. Measured with `artstyle` at 1, with and without the rule: nothing the two bars can see (films 62% · 0.293 · 85% both ways; shows ρ 0.089 both ways, 0.097 with `artstyle` at 0). The owner rates anime at his average; its signal is pull, and pull reads the device's catalog, which is why fix d matters more.

### 3.10 The tuned config (2026-10-26)

Nils (2026-10-26): "set the scoring to the best possible value… feel free to override my settings". Done by a coordinate search over every knob, on the pool with all five data fixes in (version 4 facets, Steam's tags, Wikidata's people, the reference population), against his library:

- **The objective is the two bars of §11 per medium, as concordances above chance**: films' rating pairs ordered right plus films' wishlist above untouched, the same two for games, and shows' rating pairs at half weight (the pool holds one untouched show). Books (13 rated) and the held-unrated bar (mostly bundles) are reported, not optimised. Equal weight to the two bars is a judgment: the number ranks the rails, which is "would you pick it", and the label reads the taste axis on its own band, which is "would you love it".
- **Checked held out**: titles split into two halves by id; tuned on one half, the other half's objective rose 0.82 → 0.99 and 0.90 → 1.11 (from the live config). The gain is real on titles the search never saw. The final config is the search over all titles, which beat its gentler variants (prior 2 or 3, the old taste gains) on both halves.
- **Band margins** are chosen per axis by the two-proportion z of what the axis is about: taste, 8 or more among rated films and games in the high band against the low; pull, wishlisted among unseen films and games, high against low. Taste peaks at 3 (its gain is lower now), pull at 6.
- **The odds per label** (`DEFAULT_LABEL_ODDS`) were re-seeded from the same run (`--ladder`). Both gone 2026-10-27 with the labels.

| knob | was (prod) | now |
|---|---|---|
| `priorStrength` · `mappingConstantUp` · `mappingConstantDown` | 2 · 2.5 · 4 | 1 · 1 · 6 |
| role weights director, creator, writer, cast, developer, publisher, studio, network, ip | 2, 1, 1, 1, 1, 0.5, 1, 0.5, 3 | 1, 3, 0.5, 0.5, 1, 0, 0, 0.5, 1 |
| top tags up, down, people, companies, franchises | 5, 3, 3, 2, 1 | 12, 3, 1, 3, 2 |
| categories genre, setting, mood, theme, mode, mechanics | 0.7, 2, 1, 1, 1, 1 | 0.35, 1, 1, 0.5, 2, 0.5 |
| categories audience, other, character (artstyle, object, perspective stay 0) | 0, 0, 0 | 1, 1, 0.5 |
| tag tiers genre, theme, voted, keyword | 1, 1, 1, 0.5 | 0.25, 1.5, 1, 0 |
| `pullPrior` · `pullGain` · pull top tags, people | 5 · 3.5 · 5, 3 | 2 · 3.5 · 3, 1 |
| `pullWeight` films, shows, games, books | 1, 1, 0.5, 1 | 1.5, 0.5, 0.5, 1 |
| `pullReferenceBlend` · `tasteBandMargin` · `pullBandMargin` | 1 · 10 · 10 | 0.35 · 3 · 6 |

| owner's library | films: pairs · ρ · wishlist | shows: pairs · ρ | games: pairs · ρ · wishlist · held |
|---|---|---|---|
| before (prod config, fixes in, reference alone) | 61.5% · 0.288 · 79% | 54% · 0.10 | 62% · 0.279 · 82% · 69% |
| tuned | 61% · 0.265 · **97%** | **56% · 0.16** | 62% · 0.279 · **95%** · 75% |

The trade, said plainly: films give up one point of rating order for eighteen points of wishlist. Labels on rated titles: a safe-bet film was rated 8+ 1.52× as often as usual, a skip film 0.15×, a bycatch film 0.60×; games' hidden gems 1.27×, safe bets 1.21×, skips 0.59×. Keywords now count nothing, IGDB themes half again; IGDB genres a quarter: a genre is what every title of its kind carries, so it says little about one person. The pool's wishlist bar runs on a pool that is mostly one person's library, so the blend's weight should be re-measured once other people's titles are a real share of the pool. Harness: the session scratchpad's `tune-lib.mjs` and `tune-search.mjs` (not in the repo: they read one person's library). **Superseded for pull on 2026-10-26** (§3.7): `pullPrior`, the pull top-N and `pullReferenceBlend` are gone with the counting they tuned; pull has `pullL1` (1.5) and `pullL2` (0.5), and the wishlist bar runs against the baseline, so its numbers above are not comparable with §3.7's. **Superseded for taste on 2026-10-27** (§3.11): the objective changed from the two bars to the rating error, and every taste knob was searched again.

### 3.11 The calibrated number (2026-10-27)

Nils (2026-10-27): bring the number back, make "82 means I'd rate it 8" as true as the data allows, use only his own picks and ratings, drop what is not necessary, apply statistics where they make sense, keep it transparent. Everything below is out of fold (five folds by a hash of the id) on his 1,696 rated titles, with the pool of 2026-10-27 (6,281 titles) and the stored taxonomy; harness in the session scratchpad (`calib.mjs`, `tune2.mjs`, `show2.mjs`, not in the repo: they read one person's library). The repo's `scripts/score-backtest.mjs` reproduces the shipped numbers (its measures are §11's).

**What was tried, films (939 rated): off by · within one point · ρ.**

| | off by | within 1 | ρ |
|---|---|---|---|
| guessing his films average | 1.51 | 41% | 0 |
| the number of 2026-10-26 (taste + pull, labels) | 1.63 | 40% | 0.24 |
| taste only, the 2026-10-26 weights | 1.40 | 44% | 0.27 |
| ridge regression over every facet, per-medium intercepts, λ by CV | 1.41 | 43% | 0.28 |
| the same with pull as a feature, or L1, or medium-specific terms | 1.41 to 1.42 | 43% | 0.28 to 0.29 |
| **taste only, weights re-tuned for the rating error (shipped)** | **1.40** | **44%** | **0.29** |

Games (467): the average 1.81 / 38%; shipped 1.63 / 38% / ρ 0.37 (the regression 1.72 / 0.30, worse). Shows (276): nothing predicts them (ρ 0.00 to 0.17 under every method), shipped 1.69 against 1.73. Books (14): too few to say; the overall centre put them 2.8 points low, their own centre fixes that.

**Three things fell out.** Pull leaves the number (§3.7). The centre is per medium (§3.3). The transparent Bayesian average stays: the regression that shares credit between facets ties it on films and loses on games and shows, and a formula a person can read beats one they cannot by nothing. Crowd ratings, the only input that reached 45% in earlier rounds, are ruled out by "do not rely on user ratings".

**The gains are fitted, not chosen.** With both gains at 1 the taste points are the raw sum; the fit is `rating − mediumAverage = b_up · max(sum, 0) + b_down · min(sum, 0)` by least squares, two one-variable fits since the two never overlap. On his library: 0.124 up, 0.528 down per rating point, so `mappingConstantUp` 1.2 and `mappingConstantDown` 5.3 (`scripts/score-backtest.mjs --fit-gains` prints the pair the current weights imply; a weight change needs a refit). A sum below zero predicts more strongly per point than one above.

**The weights** were searched by coordinate descent on the rating error, tuned on half the titles by id hash and checked on the other half (1.495 → 1.479 there: real). Shipped (`DEFAULT_SCORING_CONFIG`, the stored config and the category rows): roles director 1, creator 1.3, writer 0, cast 0, developer 2, publisher 1, studio 0.7, network 1, ip 1.5; top 12 tags up, 2 down, 1 person, 1 company, 1 franchise; tiers genre 0.5, theme 1, voted 1, keyword 0.5; categories genre 0, setting 1.5, artstyle 0, mood 1, theme 1, audience 0.25, other 0.5, character 1.5, object 0.25, mode 1.5, mechanics 0, perspective 0. The prior is 2 rather than the 0.5 the search picked: it costs nothing on films (1.40 / 44% / 0.293 either way, games ρ 0.379 → 0.366) and stops a facet rated once from driving a title (Joe Johnston, one film, put Jurassic Park III at 73). Cast and writers predict nothing; developers double; a genre is what every title of its kind carries.

**The ladder, shipped config, the app's own maths** (`score-backtest.mjs`, 2026-10-27): films under 50 → 4.5 (18 titles), 50 to 60 → 5.6 (93), 60 to 65 → 6.0 (225), 65 to 70 → 6.6 (517), 70 to 75 → 7.5 (80), 75 to 80 → 7.8 (6), none 80 or more; games 70 to 75 → 6.7 (138), 75 to 80 → 7.7 (193), 80 and up → 8.5 (76); shows 65 to 70 → 6.6 (192). Within two points: films 75%, games 71%, shows 65%.

**The spread, unseen titles:** films p10 47, p50 64, p90 67, max 75; shows 53 to 68; games p10 66, p50 74, p90 78, 158 of 3,868 at 80 or more; books 86 to 91. The band margin of 4 reads 7% of unseen films, 13% of shows and 17% of games as high. Stretching the number to make films spread wider would be lying about the error; the spread the data supports is the spread.

**Presentation** (§7), so that nobody over-reads the number: the medium average beside it ("You give films 6.4 on average"), the sentence in plain words ("You'd probably give this a 7, above your usual for films"), no decimals, colour by distance from the medium's average, and in the Why sheet the device's own measurement ("On the 939 films you rated, it was within one point of your rating 44% of the time, and within two 75%. When it said 70 to 75, you gave 7.5 on average (80 films)."). No percent sign: "82%" is a different claim.

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

**Weights & tuning.** Number/slider inputs for every role weight, every category weight, the prior strength `C`, the mapping constant `K`, and per-category caps. A live preview scores a sample item as you drag, showing the breakdown update in real time. Since 2026-10-25 also the tag tiers (§3.9) and the pull axis's knobs (§3.7: `pullGain`, `pullPrior`, `pullWeight` per medium, the pull top-N, `tasteBandMargin`, `pullBandMargin`, and `pullReferenceBlend`); the preview builds both axes, with the device's consumed titles and catalog counts, so a pull knob shows its effect.

**Taxonomy editor.** CRUD for tag categories (id, label, color, `weight`, `ignored`); assign/reassign individual tag keys to a category. **Rebuilt 2026-07-29 (T5–T7)** as a single searchable/filterable tag table (tag, catalog count, category dropdown, aka) replacing the old triage-view-plus-separate-bundle-UI: aliasing a tag into another folds both into one row and removes it from the count of distinct tags; category reassignment here is the same `TagCategoryPicker` control that now also appears inline on every tag chip across the app (item page, facet pages, Insights) — reassigning a tag's category from *any* of those surfaces updates the same override. Creating a "Modes & Perspectives" category and dropping `co-op` into it happens here, no deploy.

All config lives in the DB and cache-busts the profile/score caches on save.

## 6. Data-model changes

- `scoring_config` — single-row JSON blob: role weights, category weights, `C`, `K`, caps, mapping constants. Versioned.
- `tag_category` — custom categories (id, label, color, weight, ignored). Seeded from the current `CATEGORIES` so nothing regresses.
- `tag_category_override` — `tag_key → category_id`, so backend assignments win over the code heuristic. `categorizeTag()` becomes: **DB override → fall back to the existing code sets**. The hardcoded word-sets in `tags.ts` stay as the seed + fallback.

⚠️ Follow the repo's migration invariants (`AGENTS.md`): index a new column **in the same migration** that adds it, and test **both** apply paths (in-process `getDb()` *and* `node scripts/migrate.mjs`) — green Vitest only proves the fresh-DB path.

## 7. Where it surfaces (rewritten 2026-10-27)

The number, everywhere, as a whole number: it is right to about a point, and "72.4" would claim a tenth. The four levels, each one tap deeper and each one checkable:

1. **The card** (`FandexScoreBadge` in `components/kit.tsx`, drawn by `cardFace.tsx`): the number in its band's colour on a faint fill (`bandColor`: green above your usual for the medium, grey about it, orange below). `RowScore` (`ScoreProvider.scoresFor`) and `CardMatch` carry `{score, band}`; `fandexScore` on a `CardItem` ranks, `match` is what the card shows.
2. **The item page's panel** (`FandexScorePanel.tsx`): the number in the display face, the sentence (`scoreSentence`: "You'd probably give this a 7, above your usual for films"), the anchor (`centreSentence`: "You give films 6.4 on average"), and the pull line when the device has a baseline for the medium (`pullLine`: "You pick films like this 3 times more often than average"). States: anon, settling, cold, none, scored. The wording lives in `lib/scoreReasons.ts`.
3. **The Why sheet** ("Why 72?"): the centre line, then "What you rate", every taste row one sentence with a count ("you rate it 7.6 over 41 titles") and its contribution, headed by the points; then "What you pick", marked "not in the number", the pull line and the pull rows ("you pick it 5 times more often than average (88 of your films)", Nils's wording of 2026-10-26) with **Follow**; the taste rows that matched but did not count, greyed with their would-be value; "How this works" in plain words; and "How right it has been": the device's own measurement (`lib/scoreCalibration.ts`, `calibrationLine` and `rungLine`), the medium's own when it rests on 30 rated titles, else every medium's. With no baseline for the medium on the device yet, the pull group says so instead of vanishing.
4. **The facet page** (`FacetScreen.tsx`): two pills, "Taste +4.2" with its sentence and "Pull +3.1" with "You pick steampunk 5 times more often than average (46 of your titles)"; **Follow** and **Not interested** controls, keyed by the profile's own facet ids when you have rated the facet and by the catalog's ids otherwise.

The card's explainer (`ScoreExplainer.tsx`) shows the number, the sentence, the three strongest taste rows and the one pull row that stands out most. Home's Recommended rail filters by the score's band (`FandexScore.band`, `homeFeed.recommend`), so "Recommended" never carries a title it would paint orange.

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

Every change to the score is measured before it ships, per medium, on an exported library against a catalog folder and a taxonomy file (`scripts/score-backtest.mjs`). Since 2026-10-27 the first measure is the rating one, because that is what the number claims: for every rated title, scored with its own rating left out, how far the score ÷ 10 sits from the rating given (off by, within one point, within two), against the floor of guessing the person's average for the medium; then the rank order, the ladder (what each band of the score meant), the bands (what a green badge earned, as 8-or-more shares), the spread over unseen titles, and pull's own bar, whether what they wishlisted ranks above what they never touched, by the number and by the pull axis alone. `--fit-gains` prints the two gains the current weights imply (§3.11). Judged by rating correlation alone, a score that gave anime −0.1 passed review (2026-10-23); that is why the wishlist bar stays in the print-out even though pull is out of the number.

In production the same check runs on every device: `calibrate` (`lib/scoreCalibration.ts`) scores every rated title with its own rating left out after each profile build (chunked, yielding between chunks), which feeds the Why sheet's honesty lines, and `sendScoreReport` (`ScoreProvider.tsx`) sends, about once a day, twelve counts of (rating − score ÷ 10) per medium and, per band, how many rated titles the score put there and how many of those were an 8 or more (`PUT /v1/me/score-report`, table `score_report`, migration 0006; the bands' counts sit in the column named `labels`, `SCORE_VERSION` 3). Counts only: no title and no rating leaves the device, the privacy policy says so, the export carries the rows. `/dev/score` draws the sum over everybody (`GET /v1/admin/score`) as the goalpost chart, with what each band earned, and shows the how-it-works picture under it. Nils (2026-10-25): one chart for all users on the backend, not a page per user.

## 13. Decisions (2026-10-27, the calibrated number)

- **One number, read as the rating you would give, times ten.** Nils: the labels were ambiguous, a flat number is intuitive, and "82 means I'd rate it 8" is an assumption to accept and get as close to as the data allows. The 2026-10-25 call below ("no number") is superseded; its reasons were right about the width of the band and are now said in the interface instead of hidden by a label.
- **Pull is beside the number, never in it.** On rated titles it is an offset, not information (§3.7, §3.11). Its sentence, rows, pills and follows stay.
- **The centre is the medium's average** (§3.3). The facets' deviations still use the offset overall average.
- **The gains are fitted by least squares to the person's own ratings**, one up and one down, and refitted after any weight change (`--fit-gains`). The weights are tuned for the rating error, checked on held-out titles (§3.11). The prior is 2, not the 0.5 the search picked.
- **The transparent Bayesian average stays over a regression.** Measured a tie on films, a loss on games.
- **No crowd ratings in the number** (Nils: "do not rely on user ratings"), although they were the only input that reached 45% in earlier rounds.
- **Honesty is in the interface**: the medium average beside the number, a whole number, the device's own "within one point X% of the time" and the rung the score sits on, in the Why sheet. No percent sign. No stretching of the spread.
- **The band is four points over the medium's average**, and fills Recommended (§3.8); films' wishlist bar dropped from 82% to 70% with pull out of the ranking, accepted.

## 12. Decisions (2026-10-25)

- **~~One label, no number in the interface.~~ Superseded 2026-10-27 (§13).** The badge reads as a rating whatever it says (Nils: "if it says 80 I'll probably rate it 8"), and a calibrated predicted rating would be true but sit in a 16-point band. That band is now what is shown, with its width said.
- **Two axes, pooled across media.** Facets are learned across every medium (a book is scored from your films and games: 99% of the evidence behind an unrated book is another medium). The one per-medium step is invisible: each rating is moved by the gap between its medium's average and your overall average before a facet learns from it, so "I rate games higher" does not leak into every game tag (books went from reversed to right on the owner's 14).
- **~~Pull weighs per medium, with games at half.~~ Gone 2026-10-27**: pull is not in the number.
- **Follows feed pull only; no taste override; no implicit ratings** (§3.7, §4).
- **The goalpost is one admin chart over all users** (§11); the odds line it fed is gone with the labels.
- **~~The labels are Nils's matrix~~ (§3.8): gone 2026-10-27**, with the odds line; `docs/archive/history.md` keeps the matrix.
- D2 ("rarity out of the visible score") holds for the taste axis. Pull compares against a baseline, so how common a facet is among ordinary titles is what pull is made of (§3.7, 2026-10-26); "a tag's contribution is the same everywhere" holds for taste rows, and for pull rows on titles of one medium.

## 10. Decisions (locked 2026-07-18)

- **D1 — Score semantics: FIXED TRANSFORM.** `FandexScore = center + gain·rawSum`. Deterministic; center matches your baseline exactly. No percentile (a percentile number would drift as the catalog grows). **Revised by Q19 (2026-07-19):** center is your own mean rating (×10), not a fixed 50 — see §3.3. **Revised again 2026-07-29 (T2):** the clamp is gone — fully unbounded by explicit user decision — and `K` is now `mappingConstantUp`/`Down`, still asymmetric, still deterministic. **Revised 2026-10-23:** bounded again, by `softRange`, not a clamp (§1).
- **D2 — Facet rarity (IDF): DROP from the visible score.** The score is purely *your taste × facet weights* — fully transparent. IDF may remain only as a Discover-*sort* signal, never in the number shown. (`scoreFacets()` must stop applying `idf` when computing the Fandex Score.)
- **D3 — Aggregate: WEIGHTED MEAN + per-category cap.** ~~Divide by total weight; count at most the top few tags per category. Facet-dense items can't inflate themselves.~~ **Superseded 2026-07-29 (T2):** replaced by a **raw sum over a fixed top-N selection** (5 tags-up / 3 tags-down / 3 people / 2 companies) — a divisor made a facet's displayed impact item-dependent, which a fixed selection count doesn't. See §3.3.
- **D4 — Prior anchor: USER'S OWN BASELINE.** Each facet's Bayesian average shrinks toward the user's personal mean rating `m`. Single-user-clean, no cross-user coupling.
- **D5 — Admin gate: ENV USER-ID ALLOWLIST.** `/dev/scoring` gated by an env var of allowed user IDs. No schema change; expand later if needed.
- **D6 — Taxonomy: ONE SHARED taxonomy.** Backend category edits / tag reassignments apply to both scoring and the Insights page — one source of truth. No scoring-only override layer.
