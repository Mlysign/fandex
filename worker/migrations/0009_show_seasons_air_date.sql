-- The calendar's season premieres (GET /v1/catalog/season-premieres?month=):
-- every season after the first that starts in a month. Without this index the
-- query reads the whole table (5,829 rows on 2026-11-07) to return about ten.
CREATE INDEX idx_show_seasons_air ON show_seasons(air_date);
