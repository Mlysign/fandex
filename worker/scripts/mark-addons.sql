-- Marks every stored game that is a DLC, bundle, mod, episode, season, fork,
-- pack or update (IGDB game_type 1, 3, 5, 6, 7, 12, 13, 14) with `addon: true`
-- in its vector, the field derive.ts sets on every write since 2026-10-23.
-- Rows written before that carry no flag, and nothing re-derives a stored row
-- on a timer (derive.ts, DERIVE_VERSION).
--
-- Moves `updated_at` on the same rows, so every device and the next site build
-- fetch them again through the catalog delta. Idempotent: a row already marked
-- is left alone. Touches no user row and no `browsed`, so no kept count moves.
--
-- Run from worker/, after the Worker that sets the flag is deployed:
--   npx wrangler d1 execute fandex --remote --file scripts/mark-addons.sql
-- Measured 2026-10-23: 656 of 2,791 IGDB games.

UPDATE media_items SET updated_at = unixepoch()
 WHERE id IN (
   SELECT l.media_item_id FROM media_links l
     JOIN item_doc d ON d.media_item_id = l.media_item_id
    WHERE l.source = 'igdb'
      AND json_extract(l.raw_data, '$.game_type') IN (1, 3, 5, 6, 7, 12, 13, 14)
      AND json_extract(d.vector, '$.addon') IS NULL
 );

UPDATE item_doc SET vector = json_set(vector, '$.addon', json('true'))
 WHERE json_extract(vector, '$.addon') IS NULL
   AND media_item_id IN (
     SELECT media_item_id FROM media_links
      WHERE source = 'igdb' AND json_extract(raw_data, '$.game_type') IN (1, 3, 5, 6, 7, 12, 13, 14)
   );
