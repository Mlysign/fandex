-- Taxonomy sweep 2026-11-21-0802 (scripts/taxonomy-sweep). Applied with: npx wrangler d1 execute fandex --remote --file ../docs/archive/taxonomy-sweeps/2026-11-21-0802.sql (from worker/).
INSERT INTO taxonomy_suggestion_dismissed (kind, ref, created_at) VALUES ('franchise-new', 'perfetti sconosciuti', 1795248127) ON CONFLICT (kind, ref) DO NOTHING;
DELETE FROM kv WHERE key IN ('taxonomy', 'taxonomy_etag');
