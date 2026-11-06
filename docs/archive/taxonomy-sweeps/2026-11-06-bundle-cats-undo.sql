UPDATE tag_category_override SET category_id = 'theme', updated_at = 1793605349 WHERE tag_key = 'african americans' AND updated_at = 1793997282;
UPDATE tag_category_override SET category_id = 'theme', updated_at = 1793605349 WHERE tag_key = 'refugees' AND updated_at = 1793997282;
UPDATE tag_category_override SET category_id = 'mechanics', updated_at = 1793605349 WHERE tag_key = 'nonlinear' AND updated_at = 1793997282;
DELETE FROM kv WHERE key IN ('taxonomy','taxonomy_etag');
