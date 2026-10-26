-- The baseline: ordinary titles drawn at random, per medium, from everything a
-- provider knows above a vote floor (scripts/baseline-draw.mjs, 2026-10-26).
-- The score's pull axis compares what a person picks against them, so that it
-- stops comparing a library against itself: the pool was 68% one person's
-- films and 97% his shows (docs/fandex-score.md §3.7).
--
-- A drawn title goes into the pool through the normal resolve, so it carries
-- every tag every other title carries (Steam's, Wikidata's, the anime rule),
-- and the cron walks it like any pool title (runBaselineStep, src/cron.ts).
--
-- `added` = 1 when the draw is what put the title into the pool: the website
-- gives such a title no page of its own (the free plan's 20,000 files), and
-- leaves it off its rails and facet pages. A drawn title that was in the pool
-- already keeps its page.
--
-- A CATALOG table: no user_id column, so erasure and the account export leave
-- it alone (account.ts). The walk reads it in primary-key order behind a kv
-- cursor, so it needs no index of its own.
CREATE TABLE baseline_items (
  source        TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  media_type    TEXT NOT NULL,
  draw          INTEGER NOT NULL,
  media_item_id TEXT,
  added         INTEGER NOT NULL DEFAULT 0,
  -- pending: not walked yet · in: in the pool · missing: the provider has no such title
  state         TEXT NOT NULL DEFAULT 'pending',
  PRIMARY KEY (source, source_id, media_type)
) WITHOUT ROWID;
