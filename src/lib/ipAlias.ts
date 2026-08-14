// Franchise / IP bundling + per-item corrections (2026-08-14) — the same
// canonicalization layer tagAlias.ts provides for tags, plus a second layer tags
// don't need: an override that ATTACHES or DETACHES a franchise on one item.
//
// Two distinct problems, deliberately two mechanisms:
//
//   ip_alias          — the providers NAME one franchise several ways. The real
//                       catalog carries "metal gear solid" and "metal gear" as
//                       separate facets with 5 rated titles each. Bundling folds
//                       them into one average. Chains flatten on write, so
//                       canonicalIpKey() is always a single lookup.
//
//   item_ip_override  — the providers have no franchise DATA for this item.
//                       TMDB has no collection concept for shows and IGDB covers
//                       only games, so nothing links Andor or The Mandalorian to
//                       Star Wars. An 'add' attaches; a 'remove' detaches a wrong
//                       one (a title-match suggestion that guessed wrong).
//
// Both are GLOBAL catalog corrections, not per-user taste — same as
// tag_category_override. See the migration for why item_ip_override must never
// grow a `user_id` column.
//
// ⚠️ Where this gets applied is the whole correctness story. A franchise the
// PROFILE learned under a canonical key only matches an ITEM whose facet carries
// that same key, so resolution has to happen on both sides or the facet silently
// never matches and the score is quietly wrong. Profile side:
// analyzeLibraryFacets + buildCache (the two aggregation chokepoints, where
// applyTagAliases already runs). Item side: computeFandexScore itself, which is
// the one function every scoring surface funnels through — see its `mediaItemId`
// option. Do not resolve at an extractFacets() call site instead: there are nine
// of them and the four per-item ones are exactly where tag bundling already
// drifted.

import { get, query, run, transaction } from "@/lib/db";
import { type Facet, facetId, ipKey } from "@/lib/facets";

// ── ip_alias ──────────────────────────────────────────────────────────
let _aliasCache: { sig: string; value: Map<string, string> } | null = null;

export function ipAliasSignature(): string {
  const r = get<{ n: number; mx: number }>(
    `SELECT COUNT(*) n, COALESCE(MAX(updated_at),0) mx FROM ip_alias`
  );
  return `${r?.n ?? 0}:${r?.mx ?? 0}`;
}

export function getIpAliases(): Map<string, string> {
  const sig = ipAliasSignature();
  if (_aliasCache && _aliasCache.sig === sig) return _aliasCache.value;
  const rows = query<{ alias_key: string; canonical_key: string }>(
    `SELECT alias_key, canonical_key FROM ip_alias`
  );
  const value = new Map(rows.map((r) => [r.alias_key, r.canonical_key]));
  _aliasCache = { sig, value };
  return value;
}

export function canonicalIpKey(key: string): string {
  return getIpAliases().get(key) ?? key;
}

// ── item_ip_override ──────────────────────────────────────────────────
export interface ItemIpOverride { ipKey: string; label: string; mode: "add" | "remove" }

let _overrideCache: { sig: string; value: Map<string, ItemIpOverride[]> } | null = null;

export function itemIpOverrideSignature(): string {
  const r = get<{ n: number; mx: number }>(
    `SELECT COUNT(*) n, COALESCE(MAX(updated_at),0) mx FROM item_ip_override`
  );
  return `${r?.n ?? 0}:${r?.mx ?? 0}`;
}

// mediaItemId → its overrides. Loaded whole: the table is admin-curated and
// bounded by how many items someone corrects by hand, so one map beats a query
// per item inside the scoring loop.
export function getItemIpOverrides(): Map<string, ItemIpOverride[]> {
  const sig = itemIpOverrideSignature();
  if (_overrideCache && _overrideCache.sig === sig) return _overrideCache.value;
  const rows = query<{ media_item_id: string; ip_key: string; label: string; mode: string }>(
    `SELECT media_item_id, ip_key, label, mode FROM item_ip_override`
  );
  const value = new Map<string, ItemIpOverride[]>();
  for (const r of rows) {
    const arr = value.get(r.media_item_id) ?? [];
    arr.push({ ipKey: r.ip_key, label: r.label, mode: r.mode === "remove" ? "remove" : "add" });
    value.set(r.media_item_id, arr);
  }
  _overrideCache = { sig, value };
  return value;
}

// ── the shared resolver ───────────────────────────────────────────────

// Alias + override an item's facet list in one pass. Non-ip facets pass through
// untouched, so this is safe to run over a whole facet array.
//
// Order matters and is deliberate: REMOVE is matched against the CANONICAL key,
// so detaching a franchise works whichever member spelling the provider used.
// An 'add' is aliased too, so attaching "metal gear solid" by hand lands on the
// bundle canonical rather than re-creating the split this module exists to fix.
export function applyIpFacets(
  facets: Facet[],
  mediaItemId?: string | null,
  pre?: { aliases?: Map<string, string>; overrides?: Map<string, ItemIpOverride[]> }
): Facet[] {
  const aliases = pre?.aliases ?? getIpAliases();
  const mine = mediaItemId
    ? (pre?.overrides ?? getItemIpOverrides()).get(mediaItemId)
    : undefined;
  if (aliases.size === 0 && !mine) return facets;

  const removed = new Set(
    (mine ?? []).filter((o) => o.mode === "remove").map((o) => aliases.get(o.ipKey) ?? o.ipKey)
  );

  const out: Facet[] = [];
  const idx = new Map<string, number>();
  const push = (f: Facet) => {
    const id = facetId(f);
    const at = idx.get(id);
    if (at === undefined) {
      idx.set(id, out.length);
      out.push(f);
    }
  };

  for (const f of facets) {
    if (f.kind !== "ip") { out.push(f); continue; }
    const canonical = aliases.get(f.key) ?? f.key;
    if (removed.has(canonical)) continue;
    push(canonical === f.key ? f : { ...f, key: canonical });
  }
  for (const o of mine ?? []) {
    if (o.mode !== "add") continue;
    const canonical = aliases.get(o.ipKey) ?? o.ipKey;
    if (removed.has(canonical)) continue; // an explicit remove wins over an add
    push({ kind: "ip", role: "ip", key: canonical, label: o.label });
  }
  return out;
}

// ── grouped views for the admin UI ────────────────────────────────────
export interface IpBundle { canonical: string; members: string[] }

export function listIpBundles(): IpBundle[] {
  const byCanonical = new Map<string, string[]>();
  for (const [alias, canonical] of getIpAliases()) {
    const arr = byCanonical.get(canonical) ?? [];
    arr.push(alias);
    byCanonical.set(canonical, arr);
  }
  return [...byCanonical.entries()]
    .map(([canonical, members]) => ({ canonical, members: members.sort() }))
    .sort((a, b) => a.canonical.localeCompare(b.canonical));
}

export interface ItemIpOverrideRow extends ItemIpOverride {
  mediaItemId: string;
  title: string | null;
  type: string | null;
}

export function listItemIpOverrides(): ItemIpOverrideRow[] {
  return query<{ media_item_id: string; ip_key: string; label: string; mode: string; title: string | null; type: string | null }>(
    `SELECT o.media_item_id, o.ip_key, o.label, o.mode, mi.title, mi.type
       FROM item_ip_override o
       LEFT JOIN media_items mi ON mi.id = o.media_item_id
      ORDER BY o.ip_key, mi.title`
  ).map((r) => ({
    mediaItemId: r.media_item_id,
    ipKey: r.ip_key,
    label: r.label,
    mode: r.mode === "remove" ? "remove" : "add",
    title: r.title,
    type: r.type,
  }));
}

// ── writes ────────────────────────────────────────────────────────────

// Identical chain-flattening contract to setTagAlias: the target resolves to its
// own canonical first, and any bundle currently canonicalized ON `alias` folds
// into the target.
export function setIpAlias(alias: string, canonical: string): void {
  const aliases = getIpAliases();
  const target = aliases.get(canonical) ?? canonical;
  if (alias === target) throw new Error("A franchise cannot be an alias of itself.");

  transaction(() => {
    run(`UPDATE ip_alias SET canonical_key = ?, updated_at = strftime('%s','now') WHERE canonical_key = ?`, [target, alias]);
    run(
      `INSERT INTO ip_alias (alias_key, canonical_key, updated_at) VALUES (?, ?, strftime('%s','now'))
       ON CONFLICT(alias_key) DO UPDATE SET canonical_key = excluded.canonical_key, updated_at = excluded.updated_at`,
      [alias, target]
    );
  });
  _aliasCache = null;
}

export function deleteIpAlias(alias: string): void {
  run(`DELETE FROM ip_alias WHERE alias_key = ?`, [alias]);
  _aliasCache = null;
}

export function deleteIpBundle(canonical: string): void {
  run(`DELETE FROM ip_alias WHERE canonical_key = ?`, [canonical]);
  _aliasCache = null;
}

// Attach or detach one franchise on one item. `label` is only meaningful for an
// add; a remove keeps it for the admin list's readability.
export function setItemIpOverride(
  mediaItemId: string,
  rawKeyOrLabel: string,
  mode: "add" | "remove",
  label?: string
): { ipKey: string } {
  const key = canonicalIpKey(ipKey(rawKeyOrLabel));
  if (!key) throw new Error("Empty franchise key.");
  run(
    `INSERT INTO item_ip_override (media_item_id, ip_key, label, mode, updated_at)
     VALUES (?, ?, ?, ?, strftime('%s','now'))
     ON CONFLICT(media_item_id, ip_key) DO UPDATE SET
       label = excluded.label, mode = excluded.mode, updated_at = excluded.updated_at`,
    [mediaItemId, key, (label ?? rawKeyOrLabel).trim(), mode]
  );
  _overrideCache = null;
  return { ipKey: key };
}

export function deleteItemIpOverride(mediaItemId: string, rawKey: string): void {
  run(`DELETE FROM item_ip_override WHERE media_item_id = ? AND ip_key = ?`, [
    mediaItemId,
    canonicalIpKey(ipKey(rawKey)),
  ]);
  _overrideCache = null;
}

export function invalidateIpCaches(): void {
  _aliasCache = null;
  _overrideCache = null;
}
