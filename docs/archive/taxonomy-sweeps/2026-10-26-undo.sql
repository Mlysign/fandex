-- Undo for 2026-10-26.sql: the sweep's rows out, the rows it changed back as they were.
DELETE FROM item_ip_override WHERE media_item_id = 'a663437a-c17d-4215-a127-be1a49d5010c' AND ip_key = 'unbreakable' AND source = 'sweep' AND updated_at = 1792998879;
DELETE FROM item_ip_override WHERE media_item_id = '32b70004-36e5-44ad-b94a-099e6e41de2e' AND ip_key = 'unbreakable' AND source = 'sweep' AND updated_at = 1792998879;
DELETE FROM item_ip_override WHERE media_item_id = 'daa168ef-4d86-4646-a7bc-ba6a41e3e379' AND ip_key = 'looney tunes' AND source = 'sweep' AND updated_at = 1792998879;
DELETE FROM item_ip_override WHERE media_item_id = '952d24d1-3f18-4466-a428-09f9780b761b' AND ip_key = 'evil dead' AND source = 'sweep' AND updated_at = 1792998879;
DELETE FROM item_ip_override WHERE media_item_id = 'f939d538-2cf6-461e-96a8-2e17eb62bf7b' AND ip_key = 'evil dead' AND source = 'sweep' AND updated_at = 1792998879;
DELETE FROM item_ip_override WHERE media_item_id = '9a871c1f-89e8-45d9-9394-ea437f1b10fa' AND ip_key = 'hulk' AND source = 'sweep' AND updated_at = 1792998879;
DELETE FROM item_ip_override WHERE media_item_id = '9a871c1f-89e8-45d9-9394-ea437f1b10fa' AND ip_key = 'marvel' AND source = 'sweep' AND updated_at = 1792998879;
DELETE FROM item_ip_override WHERE media_item_id = '7cc12520-4f22-40fd-862d-7cee21e5b25e' AND ip_key = 'system shock' AND source = 'sweep' AND updated_at = 1792998879;
DELETE FROM item_ip_override WHERE media_item_id = 'b19ab949-68a6-47de-bce2-fd8778d46b4e' AND ip_key = 'tony hawk s' AND source = 'sweep' AND updated_at = 1792998879;
DELETE FROM ip_alias WHERE alias_key = 'mario bros' AND canonical_key = 'mario' AND updated_at = 1792998879 AND source = 'sweep';
DELETE FROM facet_label_override WHERE kind = 'ip' AND key = 'civilization' AND label = 'Civilization' AND updated_at = 1792998879 AND source = 'sweep';
DELETE FROM facet_label_override WHERE kind = 'ip' AND key = 'baldur s gate' AND label = 'Baldur''s Gate' AND updated_at = 1792998879 AND source = 'sweep';
DELETE FROM tag_alias WHERE alias_key = 'cooperative' AND canonical_key = 'co op' AND updated_at = 1792998879 AND source = 'sweep';
DELETE FROM tag_category_override WHERE tag_key = '4 player local' AND category_id = 'mode' AND updated_at = 1792998879 AND source = 'sweep';
DELETE FROM tag_category_override WHERE tag_key = 'subtitles' AND category_id = 'meta' AND updated_at = 1792998879 AND source = 'sweep';
DELETE FROM kv WHERE key IN ('taxonomy', 'taxonomy_etag');
