-- 2026-11-06: three main tags the sweep had placed where their bundled spelling (and the Other brief) says they do not belong.
-- A bundle counts under its main tag's category, so these decide where the whole bundle counts. Undo: 2026-11-06-bundle-cats-undo.sql.
UPDATE tag_category_override SET category_id = 'character', updated_at = 1793997282 WHERE tag_key = 'african americans' AND category_id = 'theme' AND source = 'sweep';
UPDATE tag_category_override SET category_id = 'character', updated_at = 1793997282 WHERE tag_key = 'refugees' AND category_id = 'theme' AND source = 'sweep';
UPDATE tag_category_override SET category_id = 'mode', updated_at = 1793997282 WHERE tag_key = 'nonlinear' AND category_id = 'mechanics' AND source = 'sweep';
DELETE FROM kv WHERE key IN ('taxonomy','taxonomy_etag');
