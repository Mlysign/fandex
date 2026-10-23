-- Two stored-row fixes from the 2026-10-23 product review (TASKS.md, RV12 and
-- RV14). Each statement only acts on the row as it was found, so a second run
-- changes nothing. Every changed row's `updated_at` moves, so devices and the
-- site build fetch it again; the vector carries the same fields, so it moves too.
--
-- Run from worker/:
--   npx wrangler d1 execute fandex --remote --file scripts/data-fixes-2026-10-23.sql

-- RV12: the three Cyrillic books get the addresses `slugify` makes for them now,
-- in place of /book/untitled-…. An exception to "a slug is assigned once"
-- (worker/CLAUDE.md), taken on purpose: an "untitled" address carries no meaning
-- and no inbound links worth keeping, and the UUID address still 308s to the
-- new slug. The three slugs were checked free on the live catalog the same day.
UPDATE item_doc SET vector = json_set(vector, '$.slug', 'prestuplenie-i-nakazanie') WHERE media_item_id = 'c757628b-97b9-4c35-9de3-0e6d46a9dab2' AND json_extract(vector, '$.slug') = 'untitled-1866';
UPDATE item_doc SET vector = json_set(vector, '$.slug', 'bratya-karamazovy') WHERE media_item_id = '4da7521d-976c-4571-9983-5208ff2e1eae' AND json_extract(vector, '$.slug') = 'untitled-1880';
UPDATE item_doc SET vector = json_set(vector, '$.slug', 'belye-nochi') WHERE media_item_id = '9706fe84-9a4a-4f61-8a67-7482edfe10d8' AND json_extract(vector, '$.slug') = 'untitled-1848';
UPDATE media_items SET slug = 'prestuplenie-i-nakazanie', updated_at = unixepoch() WHERE id = 'c757628b-97b9-4c35-9de3-0e6d46a9dab2' AND slug = 'untitled-1866';
UPDATE media_items SET slug = 'bratya-karamazovy', updated_at = unixepoch() WHERE id = '4da7521d-976c-4571-9983-5208ff2e1eae' AND slug = 'untitled-1880';
UPDATE media_items SET slug = 'belye-nochi', updated_at = unixepoch() WHERE id = '9706fe84-9a4a-4f61-8a67-7482edfe10d8' AND slug = 'untitled-1848';

-- RV14: "Der Kanon mechanischer Seelen" was stored with the year 30 ("0030").
-- No date rather than a wrong one, as the parsers answer since the same day.
UPDATE item_doc SET vector = json_set(vector, '$.releaseDate', NULL, '$.year', NULL)
 WHERE json_extract(vector, '$.releaseDate') = '0030'
   AND media_item_id IN (SELECT id FROM media_items WHERE type = 'book' AND slug = 'der-kanon-mechanischer-seelen');
UPDATE media_items SET release_date = NULL, updated_at = unixepoch()
 WHERE type = 'book' AND slug = 'der-kanon-mechanischer-seelen' AND release_date = '0030';
