import { query } from "@/lib/db";

// "Where can this be watched?", read from what we ALREADY hold — no provider
// call, no merge, no JSON.parse of a 7 KB blob per item.
//
// ── Why this exists (2026-08-27, catalog-growth phase 1) ────────────────────
// Discover's browse feed is built from provider LIST payloads, which carry no
// watch providers, so the "Available on" filter's streaming half counted zero
// on every chip and read as broken. The data was there the whole time: 1,536
// tmdb links in the local DB hold a `watch/providers` blob, and 23 of 40
// past-window browse items are among them (58%; upcoming is 8 of 40, which is
// not a gap but the truth — an unreleased film streams nowhere).
//
// ⚠️ This is the free half of the fix. Getting availability for a title we do
// NOT hold costs one provider call per title, which is 21× a browse page's
// current cost, and is what `docs/catalog-growth.md` §2 rules out.
//
// ── Two stored shapes, one reader ───────────────────────────────────────────
// `raw_data["watch/providers"].results[ISO]` is either the raw TMDB object
// (buckets only) or a projected v3+ one (buckets plus `offerType` and `link`).
// Measured on the live DB, both are present, and both spell a provider
// `provider_name`. Read the bucket named by `offerType` when it is there, else
// the first non-empty bucket in TMDB's own precedence order.
//
// ⚠️ The region fallback MUST stay in step with `mergeLinks`/`pickRegion`
// (merge.ts): country, then US, then GB, then the first key TMDB returned.
// `json_each`'s `id` column preserves JSON insertion order, which is what
// "first key" means in JS. If these two disagree, the filter and the item page
// disagree about where the same title streams.

export interface StoredAvailability {
  name: string;
  providerId: number | null;
}

/** TMDB's own precedence. Subscription first: it is what "can I watch this tonight" means. */
const BUCKETS = ["flatrate", "free", "ads", "rent", "buy"] as const;

// One row per item: the winning region's blob, which is small (a handful of
// providers). Pulling the region out in SQL rather than the whole payload is
// the point — SQLite walks the blob in C and hands back ~200 bytes instead of
// 7 KB per link for V8 to parse.
const SQL = (n: number) => `
WITH picked AS (
  SELECT l.media_item_id AS id, r.value AS blob,
         ROW_NUMBER() OVER (
           PARTITION BY l.media_item_id
           ORDER BY CASE r.key WHEN ? THEN 0 WHEN 'US' THEN 1 WHEN 'GB' THEN 2 ELSE 3 END, r.id
         ) AS rank
    FROM media_links l, json_each(l.raw_data, '$."watch/providers".results') r
   WHERE l.source = 'tmdb'
     AND l.media_item_id IN (${Array(n).fill("?").join(",")})
     AND json_valid(l.raw_data)
     AND json_type(l.raw_data, '$."watch/providers".results') = 'object'
)
SELECT id, blob FROM picked WHERE rank = 1
`;

// SQLite takes far more parameters than this, but a chunked IN list keeps the
// statement cache from holding one prepared statement per distinct batch size.
const CHUNK = 200;

/**
 * The providers we hold for each of these items, in the viewer's region.
 * Items with nothing stored are simply absent from the map — never an empty
 * array, which would read as "we know it is on nothing".
 */
export function availabilityForItems(
  ids: readonly string[],
  region: string
): Map<string, StoredAvailability[]> {
  const out = new Map<string, StoredAvailability[]>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;

  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const rows = query<{ id: string; blob: string }>(SQL(chunk.length), [region, ...chunk]);
    for (const row of rows) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(row.blob) as Record<string, unknown>;
      } catch {
        continue;
      }
      const named = typeof parsed.offerType === "string" ? parsed.offerType : null;
      const bucket =
        (named && Array.isArray(parsed[named]) ? (parsed[named] as unknown[]) : null) ??
        BUCKETS.map((b) => parsed[b]).find((v): v is unknown[] => Array.isArray(v) && v.length > 0);
      if (!bucket?.length) continue;

      const seen = new Set<string>();
      const providers: StoredAvailability[] = [];
      for (const p of bucket as { provider_name?: unknown; provider_id?: unknown }[]) {
        const name = typeof p?.provider_name === "string" ? p.provider_name : null;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        providers.push({ name, providerId: typeof p.provider_id === "number" ? p.provider_id : null });
      }
      if (providers.length) out.set(row.id, providers);
    }
  }
  return out;
}
