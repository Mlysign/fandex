-- Undo for 2026-11-06-2034.sql: the sweep's rows out, the rows it changed back as they were.
DELETE FROM tag_category_override WHERE tag_key = 'android' AND category_id = 'character' AND updated_at = 1793997271 AND source = 'sweep';
DELETE FROM tag_category_override WHERE tag_key = 'astronaut' AND category_id = 'character' AND updated_at = 1793997271 AND source = 'sweep';
DELETE FROM tag_category_override WHERE tag_key = 'criminal' AND category_id = 'character' AND updated_at = 1793997271 AND source = 'sweep';
DELETE FROM tag_category_override WHERE tag_key = 'knight' AND category_id = 'character' AND updated_at = 1793997271 AND source = 'sweep';
DELETE FROM tag_category_override WHERE tag_key = 'mercenary' AND category_id = 'character' AND updated_at = 1793997271 AND source = 'sweep';
DELETE FROM tag_category_override WHERE tag_key = 'monster' AND category_id = 'character' AND updated_at = 1793997271 AND source = 'sweep';
DELETE FROM tag_category_override WHERE tag_key = 'orphan' AND category_id = 'character' AND updated_at = 1793997271 AND source = 'sweep';
DELETE FROM tag_category_override WHERE tag_key = 'prince' AND category_id = 'character' AND updated_at = 1793997271 AND source = 'sweep';
DELETE FROM tag_category_override WHERE tag_key = 'princess' AND category_id = 'character' AND updated_at = 1793997271 AND source = 'sweep';
DELETE FROM tag_category_override WHERE tag_key = 'scientist' AND category_id = 'character' AND updated_at = 1793997271 AND source = 'sweep';
DELETE FROM tag_category_override WHERE tag_key = 'soldier' AND category_id = 'character' AND updated_at = 1793997271 AND source = 'sweep';
DELETE FROM tag_category_override WHERE tag_key = 'warrior' AND category_id = 'character' AND updated_at = 1793997271 AND source = 'sweep';
DELETE FROM tag_category_override WHERE tag_key = 'graphic novels' AND category_id = 'audience' AND updated_at = 1793997271 AND source = 'sweep';
DELETE FROM tag_category_override WHERE tag_key = 'road trip' AND category_id = 'theme' AND updated_at = 1793997271 AND source = 'sweep';
DELETE FROM tag_category_override WHERE tag_key = 'spin off' AND category_id = 'source' AND updated_at = 1793997271 AND source = 'sweep';
DELETE FROM kv WHERE key IN ('taxonomy', 'taxonomy_etag');
