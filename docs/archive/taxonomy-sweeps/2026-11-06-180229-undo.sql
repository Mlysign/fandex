-- Undo for 2026-11-06-180229.sql: the sweep's rows out, the rows it changed back as they were.
DELETE FROM ip_alias WHERE alias_key = 'my little pony equestria girls' AND canonical_key = 'my little pony' AND updated_at = 1793988149 AND source = 'sweep';
DELETE FROM facet_label_override WHERE kind = 'ip' AND key = 'my little pony' AND label = 'My Little Pony' AND updated_at = 1793988149 AND source = 'sweep';
DELETE FROM taxonomy_suggestion_dismissed WHERE kind = 'franchise-merge' AND ref = 'monster prom>monster' AND created_at = 1793988149;
DELETE FROM taxonomy_suggestion_dismissed WHERE kind = 'franchise-merge' AND ref = 'the secret garden>the secret' AND created_at = 1793988149;
DELETE FROM taxonomy_suggestion_dismissed WHERE kind = 'franchise-member' AND ref = '6101a905-7463-45de-b4bd-031a4c6a1e54>late night' AND created_at = 1793988149;
DELETE FROM kv WHERE key IN ('taxonomy', 'taxonomy_etag');
