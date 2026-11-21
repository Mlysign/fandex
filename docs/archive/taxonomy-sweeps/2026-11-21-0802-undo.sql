-- Undo for 2026-11-21-0802.sql: the sweep's rows out, the rows it changed back as they were.
DELETE FROM taxonomy_suggestion_dismissed WHERE kind = 'franchise-new' AND ref = 'perfetti sconosciuti' AND created_at = 1795248127;
DELETE FROM kv WHERE key IN ('taxonomy', 'taxonomy_etag');
