-- Taxonomy sweep 2026-11-06-2034 (scripts/taxonomy-sweep). Applied with: npx wrangler d1 execute fandex --remote --file ../docs/archive/taxonomy-sweeps/2026-11-06-2034.sql (from worker/).
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('android', 'character', 1793997271, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('astronaut', 'character', 1793997271, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('criminal', 'character', 1793997271, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('knight', 'character', 1793997271, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('mercenary', 'character', 1793997271, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('monster', 'character', 1793997271, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('orphan', 'character', 1793997271, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('prince', 'character', 1793997271, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('princess', 'character', 1793997271, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('scientist', 'character', 1793997271, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('soldier', 'character', 1793997271, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('warrior', 'character', 1793997271, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('graphic novels', 'audience', 1793997271, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('road trip', 'theme', 1793997271, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
INSERT INTO tag_category_override (tag_key, category_id, updated_at, source) VALUES ('spin off', 'source', 1793997271, 'sweep') ON CONFLICT (tag_key) DO NOTHING;
DELETE FROM kv WHERE key IN ('taxonomy', 'taxonomy_etag');
