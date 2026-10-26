-- Taxonomy sweep 2026-10-26 (scripts/taxonomy-sweep). Applied with: npx wrangler d1 execute fandex --remote --file ../docs/archive/taxonomy-sweeps/2026-10-26.sql (from worker/).
INSERT INTO item_ip_override (media_item_id, ip_key, label, mode, source, updated_at) VALUES ('a663437a-c17d-4215-a127-be1a49d5010c', 'unbreakable', 'unbreakable', 'add', 'sweep', 1792998879) ON CONFLICT (media_item_id, ip_key) DO NOTHING;
INSERT INTO item_ip_override (media_item_id, ip_key, label, mode, source, updated_at) VALUES ('32b70004-36e5-44ad-b94a-099e6e41de2e', 'unbreakable', 'unbreakable', 'add', 'sweep', 1792998879) ON CONFLICT (media_item_id, ip_key) DO NOTHING;
INSERT INTO item_ip_override (media_item_id, ip_key, label, mode, source, updated_at) VALUES ('daa168ef-4d86-4646-a7bc-ba6a41e3e379', 'looney tunes', 'looney tunes', 'add', 'sweep', 1792998879) ON CONFLICT (media_item_id, ip_key) DO NOTHING;
INSERT INTO item_ip_override (media_item_id, ip_key, label, mode, source, updated_at) VALUES ('952d24d1-3f18-4466-a428-09f9780b761b', 'evil dead', 'evil dead', 'add', 'sweep', 1792998879) ON CONFLICT (media_item_id, ip_key) DO NOTHING;
INSERT INTO item_ip_override (media_item_id, ip_key, label, mode, source, updated_at) VALUES ('f939d538-2cf6-461e-96a8-2e17eb62bf7b', 'evil dead', 'evil dead', 'add', 'sweep', 1792998879) ON CONFLICT (media_item_id, ip_key) DO NOTHING;
INSERT INTO item_ip_override (media_item_id, ip_key, label, mode, source, updated_at) VALUES ('9a871c1f-89e8-45d9-9394-ea437f1b10fa', 'hulk', 'hulk', 'add', 'sweep', 1792998879) ON CONFLICT (media_item_id, ip_key) DO NOTHING;
INSERT INTO item_ip_override (media_item_id, ip_key, label, mode, source, updated_at) VALUES ('9a871c1f-89e8-45d9-9394-ea437f1b10fa', 'marvel', 'marvel', 'add', 'sweep', 1792998879) ON CONFLICT (media_item_id, ip_key) DO NOTHING;
INSERT INTO item_ip_override (media_item_id, ip_key, label, mode, source, updated_at) VALUES ('7cc12520-4f22-40fd-862d-7cee21e5b25e', 'system shock', 'system shock', 'add', 'sweep', 1792998879) ON CONFLICT (media_item_id, ip_key) DO NOTHING;
INSERT INTO item_ip_override (media_item_id, ip_key, label, mode, source, updated_at) VALUES ('b19ab949-68a6-47de-bce2-fd8778d46b4e', 'tony hawk s', 'tony hawk s', 'add', 'sweep', 1792998879) ON CONFLICT (media_item_id, ip_key) DO NOTHING;
INSERT INTO ip_alias (alias_key, canonical_key, updated_at, source) VALUES ('mario bros', 'mario', 1792998879, 'sweep') ON CONFLICT (alias_key) DO NOTHING;
INSERT INTO facet_label_override (kind, key, label, updated_at, source) VALUES ('ip', 'civilization', 'Civilization', 1792998879, 'sweep') ON CONFLICT (kind, key) DO NOTHING;
INSERT INTO facet_label_override (kind, key, label, updated_at, source) VALUES ('ip', 'baldur s gate', 'Baldur''s Gate', 1792998879, 'sweep') ON CONFLICT (kind, key) DO NOTHING;
INSERT INTO tag_alias (alias_key, canonical_key, updated_at, source) VALUES ('cooperative', 'co op', 1792998879, 'sweep') ON CONFLICT (alias_key) DO NOTHING;
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('4 player local', 'mode', 1792998879, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('subtitles', 'meta', 1792998879, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
DELETE FROM kv WHERE key IN ('taxonomy', 'taxonomy_etag');
