-- Taxonomy sweep 2026-11-06-180229 (scripts/taxonomy-sweep). Applied with: npx wrangler d1 execute fandex --remote --file ../docs/archive/taxonomy-sweeps/2026-11-06-180229.sql (from worker/).
INSERT INTO ip_alias (alias_key, canonical_key, updated_at, source) VALUES ('my little pony equestria girls', 'my little pony', 1793988149, 'sweep') ON CONFLICT (alias_key) DO NOTHING;
INSERT INTO facet_label_override (kind, key, label, updated_at, source) VALUES ('ip', 'my little pony', 'My Little Pony', 1793988149, 'sweep') ON CONFLICT (kind, key) DO NOTHING;
INSERT INTO taxonomy_suggestion_dismissed (kind, ref, created_at) VALUES ('franchise-merge', 'monster prom>monster', 1793988149) ON CONFLICT (kind, ref) DO NOTHING;
INSERT INTO taxonomy_suggestion_dismissed (kind, ref, created_at) VALUES ('franchise-merge', 'the secret garden>the secret', 1793988149) ON CONFLICT (kind, ref) DO NOTHING;
INSERT INTO taxonomy_suggestion_dismissed (kind, ref, created_at) VALUES ('franchise-member', '6101a905-7463-45de-b4bd-031a4c6a1e54>late night', 1793988149) ON CONFLICT (kind, ref) DO NOTHING;
DELETE FROM kv WHERE key IN ('taxonomy', 'taxonomy_etag');
