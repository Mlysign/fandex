import { get, query, run } from "@/lib/db";

// Which spelling of a facet people actually see (2026-09-03).
//
// Nils: "when i bundle franchises or tags, i need an option to choose which
// version i want to use as display name on fandex. the other name should then
// never be displayed again."
//
// ── The gap this fills ──────────────────────────────────────────────────────
//
// `tag_alias` and `ip_alias` map a member KEY to a canonical KEY. Neither maps a
// LABEL, and `applyTagAliases` rewrites the key while keeping whatever label
// arrived on the facet. So a bundle rendered under whichever spelling the item
// in front of you happened to carry, and the catalog vocab's label was whichever
// member was folded first, which depends on catalog order. Bundling "rpg" into
// "role playing (rpg)" therefore did NOT stop "RPG" being displayed.
//
// ── Why it is not just "bundle the other way round" ─────────────────────────
//
// The canonical key is persisted (`tag_category_override`, `tag_alias`, every
// facet url), so re-keying a bundle and relabelling one are different operations
// with very different blast radii. This is the small one, and it is reversible
// with a DELETE.
//
// ── Where it has to be applied ──────────────────────────────────────────────
//
// Wherever a label is READ, which is not the same set as where a key is
// resolved. Three places matter, and the third is the one that would be missed:
//
//   1. `applyTagAliases` / `applyIpFacets` — the aggregation chokepoints. Covers
//      the catalog vocab, every Fandex Score reason, Insights and the filter
//      pills, because all of them are built from post-alias facets.
//   2. `surveyFranchises` — the admin's own list, so the panel shows what the
//      site shows.
//   3. The ITEM PAGE's tag chips, which read `enriched.tags`: raw merged
//      strings that never went through an alias layer at all. Missing this one
//      would leave the rejected spelling on the single most-read surface.

export type LabelKind = "tag" | "ip";

/** kind|key → chosen label. */
export type LabelOverrides = Map<string, string>;

const cacheKey = (kind: LabelKind, key: string) => `${kind}|${key}`;

let _cache: { sig: string; value: LabelOverrides } | null = null;

/**
 * Same COUNT/MAX(updated_at) shape as every other taxonomy signature.
 *
 * ⚠️ Folded into BOTH `scoringConfigSignature` (so a cached profile busts) and
 * `getCache`'s `aliasSig` (so the catalog pool's vocab does). A label lives in
 * the pool's `vocabMap`, so without the second one an edit would appear to do
 * nothing for up to the five-minute TTL — the same trap the ip signatures hit in
 * 2026-08-21.
 */
export function facetLabelSignature(): string {
  const r = get<{ n: number; mx: number }>(
    `SELECT COUNT(*) n, COALESCE(MAX(updated_at),0) mx FROM facet_label_override`
  );
  return `${r?.n ?? 0}:${r?.mx ?? 0}`;
}

export function getFacetLabelOverrides(): LabelOverrides {
  const sig = facetLabelSignature();
  if (_cache && _cache.sig === sig) return _cache.value;
  const rows = query<{ kind: string; key: string; label: string }>(
    `SELECT kind, key, label FROM facet_label_override`
  );
  const value = new Map(rows.map((r) => [cacheKey(r.kind as LabelKind, r.key), r.label]));
  _cache = { sig, value };
  return value;
}

/**
 * The label to show for one facet.
 *
 * `overrides` may be pre-fetched by a loop caller. That is not a micro-
 * optimisation: `getFacetLabelOverrides` signature-checks its cache, and a
 * helper that does that must be called once per PASS rather than once per item
 * — the same rule that made Fandex Score scoring 5.1x faster.
 */
export function displayLabel(
  kind: LabelKind,
  key: string,
  fallback: string,
  overrides?: LabelOverrides,
): string {
  return (overrides ?? getFacetLabelOverrides()).get(cacheKey(kind, key)) ?? fallback;
}

/** The stored choice for one facet, or null when it is showing its raw label. */
export function getFacetLabel(kind: LabelKind, key: string): string | null {
  return getFacetLabelOverrides().get(cacheKey(kind, key)) ?? null;
}

export function setFacetLabel(kind: LabelKind, key: string, label: string): void {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("A display name cannot be blank.");
  run(
    `INSERT INTO facet_label_override (kind, key, label, updated_at)
     VALUES (?, ?, ?, strftime('%s','now'))
     ON CONFLICT(kind, key) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at`,
    [kind, key, trimmed],
  );
  _cache = null;
}

/** Revert to whatever the providers call it. */
export function clearFacetLabel(kind: LabelKind, key: string): void {
  run(`DELETE FROM facet_label_override WHERE kind = ? AND key = ?`, [kind, key]);
  _cache = null;
}

/** Test seam, and for a write route that wants an immediate re-read. */
export function invalidateFacetLabelCache(): void {
  _cache = null;
}
