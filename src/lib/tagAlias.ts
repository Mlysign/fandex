// Tag bundling (H5.6) — a canonicalization layer over tag facet keys, mirroring
// the tag_category_override machinery in scoringConfig.ts. A tag_alias row maps
// one member spelling → a canonical key; canonicalTagKey() resolves any key to
// its bundle canonical (or itself). Applying that remap at the two facet
// aggregation chokepoints (analyzeLibraryFacets, buildCache) makes every
// downstream consumer — Fandex Score, Insights, the facet page's personal
// overlay, the catalog vocab — treat a bundle as one tag automatically, with the
// average computed across all members.
//
// Chains are flattened on write (setTagAlias), so the map is always one level
// deep and canonicalTagKey is a single lookup.

import { get, query, run, transaction } from "@/lib/db";
import { Facet, facetId } from "@/lib/facets";

// ── cache ─────────────────────────────────────────────────────────────
let _aliasCache: { sig: string; value: Map<string, string> } | null = null;

// Same COUNT/MAX(updated_at) shape as scoringConfig.ts's signatures — cheap to
// check, changes on any insert/update/delete.
export function tagAliasSignature(): string {
  const r = get<{ n: number; mx: number }>(
    `SELECT COUNT(*) n, COALESCE(MAX(updated_at),0) mx FROM tag_alias`
  );
  return `${r?.n ?? 0}:${r?.mx ?? 0}`;
}

// alias_key → canonical_key. The canonical never has its own row (it maps to
// itself implicitly via canonicalTagKey's ?? fallback).
export function getTagAliases(): Map<string, string> {
  const sig = tagAliasSignature();
  if (_aliasCache && _aliasCache.sig === sig) return _aliasCache.value;

  const rows = query<{ alias_key: string; canonical_key: string }>(
    `SELECT alias_key, canonical_key FROM tag_alias`
  );
  const value = new Map(rows.map((r) => [r.alias_key, r.canonical_key]));
  _aliasCache = { sig, value };
  return value;
}

export function canonicalTagKey(key: string): string {
  return getTagAliases().get(key) ?? key;
}

// The shared remap helper both aggregation chokepoints call. Rewrites each tag
// facet's key to its canonical, dedupes by the new facetId (so an item carrying
// two members of the same bundle counts once), and prefers the label whose
// original key IS the canonical (else keeps first-seen). People/company facets
// pass through untouched. `aliases` may be pre-fetched by loop callers to avoid a
// signature check per item.
export function applyTagAliases(facets: Facet[], aliases?: Map<string, string>): Facet[] {
  const map = aliases ?? getTagAliases();
  if (map.size === 0) return facets;

  const out: Facet[] = [];
  const idx = new Map<string, number>(); // facetId → index in `out`
  for (const f of facets) {
    if (f.kind !== "tag") { out.push(f); continue; }
    const canonical = map.get(f.key) ?? f.key;
    const remapped: Facet = canonical === f.key ? f : { ...f, key: canonical };
    const id = facetId(remapped);
    const at = idx.get(id);
    if (at === undefined) {
      idx.set(id, out.length);
      out.push(remapped);
    } else if (f.key === canonical) {
      // The canonical spelling itself appeared — its label wins over a member's.
      out[at] = { ...out[at], label: f.label };
    }
  }
  return out;
}

// ── grouped view for the admin UI ─────────────────────────────────────
export interface TagBundle { canonical: string; members: string[] }

export function listTagBundles(): TagBundle[] {
  const byCanonical = new Map<string, string[]>();
  for (const [alias, canonical] of getTagAliases()) {
    const arr = byCanonical.get(canonical) ?? [];
    arr.push(alias);
    byCanonical.set(canonical, arr);
  }
  return [...byCanonical.entries()]
    .map(([canonical, members]) => ({ canonical, members: members.sort() }))
    .sort((a, b) => a.canonical.localeCompare(b.canonical));
}

// ── writes (chain-flattening) ─────────────────────────────────────────

// Point `alias` at `canonical`. Flattens chains so canonicalTagKey stays a
// single lookup:
//   • the target is resolved to ITS own canonical first (so a→b when b→c becomes a→c);
//   • if `alias` is itself an existing canonical, all its current members are
//     re-pointed to the resolved target too (folding one bundle into another).
// Rejects a self-alias (key === its own resolved canonical).
export function setTagAlias(alias: string, canonical: string): void {
  const aliases = getTagAliases();
  const target = aliases.get(canonical) ?? canonical; // resolve target's own canonical
  if (alias === target) throw new Error("A tag cannot be an alias of itself.");

  transaction(() => {
    // Fold any bundle currently canonicalized ON `alias` into `target`.
    run(`UPDATE tag_alias SET canonical_key = ?, updated_at = strftime('%s','now') WHERE canonical_key = ?`, [target, alias]);
    run(
      `INSERT INTO tag_alias (alias_key, canonical_key, updated_at) VALUES (?, ?, strftime('%s','now'))
       ON CONFLICT(alias_key) DO UPDATE SET canonical_key = excluded.canonical_key, updated_at = excluded.updated_at`,
      [alias, target]
    );
  });
  _aliasCache = null;
}

// Remove one member from its bundle (reverts to its raw key).
export function deleteTagAlias(alias: string): void {
  run(`DELETE FROM tag_alias WHERE alias_key = ?`, [alias]);
  _aliasCache = null;
}

// Dissolve a whole bundle — every member reverts to its raw key.
export function deleteTagBundle(canonical: string): void {
  run(`DELETE FROM tag_alias WHERE canonical_key = ?`, [canonical]);
  _aliasCache = null;
}

// Exposed for tests / write routes to force a re-read without waiting on the
// next signature check.
export function invalidateTagAliasCache(): void {
  _aliasCache = null;
}
