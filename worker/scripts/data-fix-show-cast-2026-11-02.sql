-- Shows stored with no cast (2026-11-02). A show's TMDB `credits` lists only
-- the latest season's regulars, so a miniseries whose actors are filed as guest
-- stars (Adolescence) was stored with an empty cast: no Cast rail, no cast
-- facet. `getTmdbShow` now fills it from `aggregate_credits`
-- (src/lib/sources/tmdb.ts), but only on a fetch, and a stored copy is fetched
-- again only after 150 days.
--
-- This puts those shows at the front of the retention refresh
-- (runTmdbRefreshStep, oldest `last_synced` first, two a run), so the cron
-- refetches them within about a day. No PROJECTION_VERSION bump: that walk
-- refetches every TMDB link, and the projection did not change.
--
-- 50 pool shows had no cast facet on 2026-11-02, out of 1,706. A show that
-- truly has no cast is refetched once and stamped fresh, so this cannot loop,
-- and a second run changes only rows that are still empty.
--
-- ⚠️ ORDER: deploy the Worker with the getTmdbShow change FIRST. Run against
-- the old Worker, this refetches the same empty cast and stamps it fresh.
--
-- Run from worker/:
--   npx wrangler d1 execute fandex --remote --file scripts/data-fix-show-cast-2026-11-02.sql
UPDATE media_links SET last_synced = 0
 WHERE source = 'tmdb' AND media_type = 'show'
   AND json_type(raw_data, '$.credits') = 'object'
   AND COALESCE(json_array_length(raw_data, '$.credits.cast'), 0) = 0;
