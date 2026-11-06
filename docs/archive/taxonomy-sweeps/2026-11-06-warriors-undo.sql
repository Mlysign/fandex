-- Undo for 2026-11-06-warriors.sql: the alias back as it was (hand, 2026-10-27 19:34:33 UTC), the no taken back.
INSERT INTO ip_alias (alias_key, canonical_key, updated_at, source) VALUES ('the warriors', 'warriors', 1793129673, 'hand') ON CONFLICT (alias_key) DO NOTHING;
DELETE FROM taxonomy_suggestion_dismissed WHERE kind = 'franchise-merge' AND ref = 'the warriors>warriors' AND created_at = 1793988175;
DELETE FROM kv WHERE key IN ('taxonomy', 'taxonomy_etag');
