// The resumable Wikidata franchise sweep (2026-08-14).
//
// ⚠️ Driven off `wikidata_ip_checked` — what we have ASKED about — never off
// "which items still have no franchise". That second shape is the trap SM48's
// cross-link backfill hit: the items a provider genuinely doesn't know stay
// missing forever, so a sweep selecting them never drains and every run
// re-asks the same rows. A row in wikidata_ip_checked means asked; `found`
// records whether the answer was useful, for reporting only.
//
// Bounded per call in BOTH count and wall clock, like /api/dev/prune and
// /api/dev/crosslink: prod has no shell, so this runs through an admin route
// that has to answer inside one request, and the caller repeats.

import { query, run, get, transaction } from "@/lib/db";
import { setItemIpOverride } from "@/lib/ipAlias";
import { WIKIDATA_BATCH, franchisesByImdbId, franchisesBySteamAppId } from "@/lib/sources/wikidata";

export interface SweepSurvey {
  checked: number;
  found: number;
  eligible: number;   // items carrying a usable external id
  remaining: number;
}

// A joinable item: films/shows need an IMDb id, games a Steam appid. The IMDb
// id lives in the TMDB payload under either shape depending on endpoint.
const ELIGIBLE_SQL = `
  SELECT mi.id, mi.type, mi.title,
         COALESCE(
           json_extract(tm.raw_data, '$.imdb_id'),
           json_extract(tm.raw_data, '$.external_ids.imdb_id')
         ) AS imdb,
         st.source_id AS appid
    FROM media_items mi
    LEFT JOIN media_links tm ON tm.media_item_id = mi.id AND tm.source = 'tmdb'
    LEFT JOIN media_links st ON st.media_item_id = mi.id AND st.source = 'steam'
   WHERE COALESCE(
           json_extract(tm.raw_data, '$.imdb_id'),
           json_extract(tm.raw_data, '$.external_ids.imdb_id'),
           st.source_id
         ) IS NOT NULL`;

interface Row { id: string; type: string; title: string | null; imdb: string | null; appid: string | null }

export function surveyWikidataSweep(): SweepSurvey {
  const eligible = get<{ n: number }>(`SELECT COUNT(*) n FROM (${ELIGIBLE_SQL})`)?.n ?? 0;
  const checked = get<{ n: number }>(`SELECT COUNT(*) n FROM wikidata_ip_checked`)?.n ?? 0;
  const found = get<{ n: number }>(`SELECT COUNT(*) n FROM wikidata_ip_checked WHERE found = 1`)?.n ?? 0;
  const remaining = get<{ n: number }>(
    `SELECT COUNT(*) n FROM (${ELIGIBLE_SQL}) e
      WHERE NOT EXISTS (SELECT 1 FROM wikidata_ip_checked c WHERE c.media_item_id = e.id)`
  )?.n ?? 0;
  return { checked, found, eligible, remaining };
}

export interface SweepResult {
  asked: number;
  attached: number;
  remaining: number;
  examples: { title: string | null; franchise: string }[];
  stoppedBy: "budget" | "maxItems" | "drained";
}

// Wikidata's SPARQL endpoint is a free, anonymous, shared service and it WILL
// throttle: firing five queries back to back timed it out and tripped the
// circuit breaker within seconds on the first real run (2026-08-14). A pause
// between requests is not politeness theatre, it's what makes an unattended
// sweep finish at all. Nothing here is latency-sensitive — no user is waiting.
const PAUSE_BETWEEN_QUERIES_MS = 1_200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runWikidataSweep(opts?: {
  maxItems?: number;
  budgetMs?: number;
}): Promise<SweepResult> {
  const maxItems = Math.min(opts?.maxItems ?? WIKIDATA_BATCH * 2, 500);
  const budgetMs = opts?.budgetMs ?? 25_000;
  const startedAt = Date.now();

  const rows = query<Row>(
    `SELECT * FROM (${ELIGIBLE_SQL}) e
      WHERE NOT EXISTS (SELECT 1 FROM wikidata_ip_checked c WHERE c.media_item_id = e.id)
      ORDER BY e.id LIMIT ?`,
    [maxItems]
  );

  let asked = 0;
  let attached = 0;
  const examples: { title: string | null; franchise: string }[] = [];
  let stoppedBy: SweepResult["stoppedBy"] = "drained";

  // Chunked by BATCH so one SPARQL request covers many items. Films/shows and
  // games use different join keys AND different properties, so they can't share
  // a query — see wikidata.ts.
  for (let i = 0; i < rows.length; i += WIKIDATA_BATCH) {
    if (Date.now() - startedAt > budgetMs) { stoppedBy = "budget"; break; }
    if (i > 0) await sleep(PAUSE_BETWEEN_QUERIES_MS);
    const chunk = rows.slice(i, i + WIKIDATA_BATCH);

    const byImdb = chunk.filter((r) => r.imdb);
    const bySteam = chunk.filter((r) => !r.imdb && r.appid);

    // A throw here aborts the whole call and marks NOTHING checked, which is
    // the point: an outage must not record "we asked and Wikidata said no".
    const imdbHits = byImdb.length
      ? await franchisesByImdbId([...new Set(byImdb.map((r) => r.imdb!))])
      : new Map();
    const steamHits = bySteam.length
      ? await franchisesBySteamAppId([...new Set(bySteam.map((r) => r.appid!))])
      : new Map();

    transaction(() => {
      for (const r of chunk) {
        const hits = (r.imdb ? imdbHits.get(r.imdb) : undefined)
          ?? (r.appid ? steamHits.get(r.appid) : undefined)
          ?? [];
        for (const f of hits) {
          setItemIpOverride(r.id, f.label, "add", f.label, "wikidata");
          attached++;
          if (examples.length < 12) examples.push({ title: r.title, franchise: f.label });
        }
        run(
          `INSERT INTO wikidata_ip_checked (media_item_id, found, checked_at)
           VALUES (?, ?, strftime('%s','now'))
           ON CONFLICT(media_item_id) DO UPDATE SET found = excluded.found, checked_at = excluded.checked_at`,
          [r.id, hits.length ? 1 : 0]
        );
        asked++;
      }
    });
  }

  if (stoppedBy === "drained" && rows.length >= maxItems) stoppedBy = "maxItems";
  return { asked, attached, remaining: surveyWikidataSweep().remaining, examples, stoppedBy };
}
