-- 2026-11-06, by hand in a Review pass: "The Warriors" (Rockstar's 2005 game) was bundled into the Warriors cat books on 2026-10-27.
-- Applied with: npx wrangler d1 execute fandex --remote --file ../docs/archive/taxonomy-sweeps/2026-11-06-warriors.sql (from worker/).
DELETE FROM ip_alias WHERE alias_key = 'the warriors' AND canonical_key = 'warriors';
INSERT INTO taxonomy_suggestion_dismissed (kind, ref, created_at) VALUES ('franchise-merge', 'the warriors>warriors', 1793988175) ON CONFLICT (kind, ref) DO NOTHING;
DELETE FROM kv WHERE key IN ('taxonomy', 'taxonomy_etag');
