-- Books whose stored date is wrong (2026-11-13). Der Kanon mechanischer Seelen
-- was held as "0030": Hardcover gave year 30 before `hardcoverDate` refused it
-- (2026-10-23), and the canonical merge (`mergeForCanonical`, the row every card
-- and the device's catalog copy read) put Hardcover's date first without the
-- book rule the doc already had, so the row kept "0030" while the doc said 2017.
-- Search showed the book twice. Both are fixed in src/lib (merge.ts `primaryDate`,
-- normalize.ts reading a stored Hardcover year before 1450 as none).
--
-- This marks the books it touches as behind on DERIVE_VERSION and starts the
-- re-derive walk (runRederiveStep, cron.ts) over them: ten a run, three row
-- writes each, re-derived from the links they already hold. No provider call,
-- no DERIVE_VERSION bump (that would walk all 11,500 pool titles).
--
-- Which books: a stored year before printing, and every book whose Open Library
-- and Hardcover links name different years (the canonical row took Hardcover's,
-- the rule takes Open Library's). The walk covers pool rows only (browsed = 0);
-- a browsed row heals on its next write.
--
-- ⚠️ ORDER: deploy the Worker with the src/lib change FIRST. Run against the old
-- Worker, the walk derives the same wrong date again.
--
-- Run from worker/, the count first:
--   npx wrangler d1 execute fandex --remote --command "SELECT COUNT(*) FROM media_items mi WHERE mi.type = 'book' AND ((mi.release_date GLOB '[0-9][0-9][0-9][0-9]*' AND CAST(substr(mi.release_date, 1, 4) AS INTEGER) < 1450) OR EXISTS (SELECT 1 FROM media_links o JOIN media_links h ON h.media_item_id = o.media_item_id AND h.source = 'hardcover' WHERE o.media_item_id = mi.id AND o.source = 'openlibrary' AND substr(o.release_date, 1, 4) <> substr(h.release_date, 1, 4)))"
--   npx wrangler d1 execute fandex --remote --file scripts/data-fix-book-dates-2026-11-13.sql
-- Then `SELECT value FROM kv WHERE key = 'rederive_cursor'` reads 'done:4' when the walk is through.

UPDATE item_doc SET derive_version = 3
 WHERE derive_version >= 4
   AND media_item_id IN (
     SELECT mi.id FROM media_items mi
      WHERE mi.type = 'book'
        AND ((mi.release_date GLOB '[0-9][0-9][0-9][0-9]*' AND CAST(substr(mi.release_date, 1, 4) AS INTEGER) < 1450)
          OR EXISTS (
            SELECT 1 FROM media_links o
              JOIN media_links h ON h.media_item_id = o.media_item_id AND h.source = 'hardcover'
             WHERE o.media_item_id = mi.id AND o.source = 'openlibrary'
               AND substr(o.release_date, 1, 4) <> substr(h.release_date, 1, 4))));

-- The walk parked at 'done:4' after the last re-derive; clearing the cursor starts it again.
DELETE FROM kv WHERE key = 'rederive_cursor';
INSERT INTO kv (key, value) VALUES ('rederive_go', '4')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
