-- Who made a taxonomy row: 'hand' (the admin pages, /dev/scoring) or 'sweep'
-- (the weekly taxonomy sweep, scripts/taxonomy-sweep). The sweep must never
-- change a row a person made (AGENTS.md); until this it could only infer that
-- from a timestamp. item_ip_override has had the column since 0001.
--
-- Every row already here is 'hand', the safe reading: the sweep leaves a 'hand'
-- row alone, so a row it wrote before this is only protected more than it needs.
-- ADD COLUMN with a constant default rewrites no row, so this costs no row writes.
ALTER TABLE tag_category ADD COLUMN source TEXT NOT NULL DEFAULT 'hand';
ALTER TABLE tag_category_override ADD COLUMN source TEXT NOT NULL DEFAULT 'hand';
ALTER TABLE tag_alias ADD COLUMN source TEXT NOT NULL DEFAULT 'hand';
ALTER TABLE ip_alias ADD COLUMN source TEXT NOT NULL DEFAULT 'hand';
ALTER TABLE facet_label_override ADD COLUMN source TEXT NOT NULL DEFAULT 'hand';
