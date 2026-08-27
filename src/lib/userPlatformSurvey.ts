import { query } from "@/lib/db";
import { sharedCache } from "@/lib/boundedCache";
import type { PlatformOption } from "@/lib/platformKeys";
import { platformLabel, platformKey } from "@/lib/platformKeys";

// "Which platforms and services does this user's own catalog touch?" — the
// option list for Settings → Your platforms.
//
// ── Why SQL, not the merge path ─────────────────────────────────────────────
// The obvious implementation is /api/library's: select the user's items with
// their links and run getDerivedForItem over each. Measured on the real
// database (2,022 items, 5,625 links, 41.2 MB of raw_data):
//
//   this query .................... 143 ms, ~1 MB, no JSON.parse
//   load-and-merge, cache WARM .... ~160 ms + 41 MB of string churn
//   load-and-merge, cache COLD .... 0.5–1.5 s + hundreds of MB transient heap
//
// The warm case is no faster and 40× the memory, on a container with a
// documented OOM history. So this reads the four shapes straight out of the
// stored JSON. `ipSurvey.ts` and `franchiseSweep.ts` are the same pattern for
// the same reason.
//
// ⚠️ SQL is NOT the last step. Grouping by raw provider name in SQL gives
// "PC (Microsoft Windows) 631", "windows 584" and "PC 479" as three rows for
// one platform. The fold through platformLabel/platformKey below is what makes
// the server's counts agree with the filter's chips — and it has to happen
// AFTER the distinct-per-item step, or an item listing "Netflix" and "Netflix
// Kids" counts twice.

interface RawPair { grp: "games" | "streaming"; id: string; name: string }

// One row per (namespace, item, raw provider name). DISTINCT because a single
// item can carry the same platform on two different links.
//
// ⚠️ Region: mergeLinks resolves TMDB's providers as `country ?? US ?? GB ??
// first key` (merge.ts pickRegion). A flat `WHERE key = :region` matched only
// 1,176 of this user's TMDB links, so the ranking below reproduces that
// fallback. json_each's `id` column preserves JSON insertion order, which is
// what "first key" means in JS.
//
// ⚠️ `offerType` only exists on projection v3+ rows; older ones yield nothing
// rather than erroring, which is why the guard is a NOT NULL rather than a
// version check (a v2 row that has since healed should still count).
const SURVEY_SQL = `
WITH mine AS (
  SELECT DISTINCT media_item_id AS id
    FROM user_item_state
   WHERE user_id = ? AND relation IN ('library', 'wishlist')
),
links AS (
  SELECT l.media_item_id AS id, l.source, l.raw_data
    FROM media_links l
    JOIN mine ON mine.id = l.media_item_id
   WHERE json_valid(l.raw_data)
),
tmdb_region AS (
  SELECT k.id AS id, r.value AS blob,
         ROW_NUMBER() OVER (
           PARTITION BY k.id
           ORDER BY CASE r.key WHEN ? THEN 0 WHEN 'US' THEN 1 WHEN 'GB' THEN 2 ELSE 3 END, r.id
         ) AS rank
    FROM links k, json_each(k.raw_data, '$."watch/providers".results') r
   WHERE k.source = 'tmdb'
     AND json_type(k.raw_data, '$."watch/providers".results') = 'object'
     AND json_extract(r.value, '$.offerType') IS NOT NULL
)
SELECT DISTINCT 'games' AS grp, l.id AS id, json_extract(p.value, '$.platform.name') AS name
  FROM links l, json_each(l.raw_data, '$.platforms') p
 WHERE l.source = 'rawg' AND json_type(l.raw_data, '$.platforms') = 'array'
   AND json_extract(p.value, '$.platform.name') IS NOT NULL
UNION
SELECT DISTINCT 'games', l.id, json_extract(p.value, '$.name')
  FROM links l, json_each(l.raw_data, '$.platforms') p
 WHERE l.source = 'igdb' AND json_type(l.raw_data, '$.platforms') = 'array'
   AND json_extract(p.value, '$.name') IS NOT NULL
UNION
-- ⚠️ Steam's \`platforms\` is NOT only platforms. The stored object also carries
-- \`vr_support\`, \`steam_deck_compat_category\`, \`steam_os_compat_category\`,
-- \`steam_frame_compat_category\`, \`steam_machine_compat_category\` and
-- \`steamos_linux\` — measured on the live database, 730 rows each for the first
-- few. A truthiness test alone offers "vr_support" and "steamos_linux" as
-- platforms you can own. normalize.ts allowlists exactly windows/mac/linux and
-- requires === true; this has to say the same thing or the settings page and
-- the item page disagree about what a Steam game runs on.
SELECT DISTINCT 'games', l.id, p.key
  FROM links l, json_each(l.raw_data, '$.platforms') p
 WHERE l.source = 'steam' AND json_type(l.raw_data, '$.platforms') = 'object'
   AND p.key IN ('windows', 'mac', 'linux')
   AND p.value IN (1, 'true')
UNION
SELECT DISTINCT 'streaming', t.id, json_extract(o.value, '$.provider_name')
  FROM tmdb_region t,
       json_each(t.blob, '$.' || json_extract(t.blob, '$.offerType')) o
 WHERE t.rank = 1
   AND json_extract(o.value, '$.provider_name') IS NOT NULL
`;

// Invalidation token, same shape as libraryAnalysis's membershipSignature: what
// the user holds, and how fresh the links behind it are. Cheap aggregates only.
function surveySignature(userId: string, region: string): string {
  const row = query<{ items: number; synced: number | null }>(
    `SELECT COUNT(*) AS items, MAX(l.last_synced) AS synced
       FROM user_item_state s
       LEFT JOIN media_links l ON l.media_item_id = s.media_item_id
      WHERE s.user_id = ? AND s.relation IN ('library', 'wishlist')`,
    [userId]
  )[0];
  return `${userId}|${region}|${row?.items ?? 0}|${row?.synced ?? 0}`;
}

// Per-user, so bounded by user count rather than catalog size. Small values
// (a few hundred short strings each).
const _cache = sharedCache<string, PlatformOption[]>("userPlatformSurvey", { max: 200 });

/**
 * Every platform and service this user's library + wishlist touches, with the
 * number of their titles on each, most common first.
 *
 * ⚠️ The counts can exceed what a filter chip shows for the same platform, and
 * that is not a bug to chase: `mergeLinks` caps an item's `platforms` at 10, and
 * this survey does not. It is the more complete number; the chip counts what is
 * loaded on screen. They answer different questions and the settings page never
 * puts them side by side.
 */
export function surveyUserPlatforms(userId: string, region: string): PlatformOption[] {
  const sig = surveySignature(userId, region);
  const hit = _cache.get(sig);
  if (hit) return hit;

  const pairs = query<RawPair>(SURVEY_SQL, [userId, region]);

  // Fold raw names to canonical keys, counting DISTINCT items per key. The
  // per-item Set is what stops "Netflix" + "Netflix Kids" on one title counting
  // twice — the same rule platformOptions() applies client-side.
  const byKey = new Map<string, { label: string; group: "games" | "streaming"; items: Set<string> }>();
  for (const p of pairs) {
    const label = platformLabel(p.name ?? "");
    if (!label) continue;
    const key = platformKey(label, p.grp);
    let hitKey = byKey.get(key);
    if (!hitKey) {
      hitKey = { label, group: p.grp, items: new Set() };
      byKey.set(key, hitKey);
    } else if (label.length < hitKey.label.length) {
      // Two spellings share a key ("Paramount+" / "Paramount Plus"); show the
      // shorter, branded one. Same rule as platformOptions().
      hitKey.label = label;
    }
    hitKey.items.add(p.id);
  }

  const out: PlatformOption[] = [...byKey.entries()]
    .map(([key, v]) => ({ key, label: v.label, group: v.group, count: v.items.size }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  _cache.set(sig, out);
  return out;
}
