# Bug tracker — archive (fully resolved)

Moved out of the root BUGS.md 2026-07-18. Both logged bugs were triaged and
closed 2026-06-14 (see the changelog entry below and
[completed-phases.md](completed-phases.md)). Bugs are now tracked as tasks
directly in TASKS.md instead of a separate file.

---

# ReleaseRadar — Bug Tracker

This file is the **bug collection** — Claude reads/writes here.

---

## Data Bugs
- ~~Merging wrong movies between databases~~ (Warriors of the Wind, item `17aa124c…`, tmdbId 81) — **NOT A BUG (investigated 2026-06-14).** The item has a single, correct TMDB link (id 81). TMDB itself returns `title: "Warriors of the Wind"` with `original_title: 風の谷のナウシカ` (Nausicaä) and `imdb_id: tt0087544` (Nausicaä) — i.e. one film, with TMDB serving an alternate English title for the configured language. No two movies were merged. → If the localized title is undesirable, that's a TMDB `language`/region concern tied to **T22** (country setting), not the matcher.
- ~~Studio ratings in Insights missing a lot of data (Bethesda Softworks / Fallout 4)~~ — **investigated 2026-06-14; split in two:**
  - **(A) display — FIXED:** Insights "Game studios" column filtered to `role==="developer"` only, so publishers (Bethesda Softworks publishes Fallout 4; dev is Bethesda Game Studios) never showed. [InsightsView.tsx](src/components/insights/InsightsView.tsx) `gameStudios` now includes both `developer` + `publisher` (matches the section subtitle).
  - **(B) data coverage — root cause, → TASKS.md (D9):** only **3% of library games (24/713)** carry any developer/publisher in stored `raw_data`, vs 99% of movies/shows. Game sync persists *list* payloads (Steam owned-games = `appid/name/playtime`; RAWG list lacks `developers/publishers` — those are detail-endpoint-only). Needs the sync/enrich pipeline to fetch+persist game detail (or a backfill). Tracked as **D9**.

## Search Bar Bugs & improvements
> **Triaged 2026-06-14 → TASKS.md.** Consistency + filter pruning + "search on any filter" → **T24**; the sort-options redesign + sort-driven result layout (rating dividers/scrollbar, calendar only for date sorts) → **T8** (rewritten). Both have full spec blocks under the Phase 2 table. No code changed yet.

- Search bar component remains inconsistent:
  - when entering a search query in the discovery version it shows
    - the sort dropdown - sort dropdown not available in wishlist/ library
    - additional filters (in library, year, etc) → these should be always visibile as part of the filter options above (facet filters, type, source)
- some filters can be removed: source filter (tmdb, trakt etc), "Community", Runtime
- the sort options should be adjusted. it should only contain these sort options: 
  - Release date (newest first), 
  - Release date (oldest first)
  - Rating (user rating), 
  - Rating (platform rating): calculates an average score based on data bases (imdb, tmdb, metacritic, etc), 
  - Best Match: validates items in the current list based on how well they match the users preferences (might require a "user preference" analysis if not already existing)
- the sort option should be always available not just after entering a query
- the items results should adjust based on the sort algorithim:
  - release date (newest first): current timeline approach (but reversed)
  - release date (oldest first): current timeline approach
  - rating: replace month scroll bar on the side with a rating scroll bar, replace month dividers with rating dividers (remove calendar view as view option - keep just list and card view)
  - best match: normal scroll bar. best match at the top of the list (remove calendar view as view option - keep just list and card view)
- The search should already start as soon as a filter was applied (remove calendar view as view option - keep just list and card view)


---

## Open decisions
1.

## Changelog
- _2026-06-14_ — Triaged the 2 logged bugs. Bug 1 (Warriors of the Wind) = not a bug (TMDB alt-title; relates to T22). Bug 2 (studios) = display half fixed in InsightsView (publishers now shown); data-coverage half tracked as **D9** in TASKS.md.
- _2026-06-14_ — Triaged the Search Bar section → **T24** (consistency + remove source/Community/Runtime filters + search-on-filter) and **T8** (5-option sort set + new platform-avg & user-rating sorts + sort-driven result layout). Specs in TASKS.md.