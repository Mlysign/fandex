// Franchise survey for the /dev/scoring Taxonomy panel (2026-08-14) — what
// franchises exist in the catalog, how big each is, and which items SHOULD
// probably belong to one but carry no provider data.
//
// Reads the two provider fields straight out of `media_links.raw_data` with
// SQLite's json_extract rather than going through extractFacets: this is a
// whole-catalog scan for an admin screen, and it needs the per-item breakdown
// (which titles are in this franchise) that a facet list has already thrown
// away. Read-only — every write goes through ipAlias.ts.

import { query } from "@/lib/db";
import { ipKey } from "@/lib/facets";
import { canonicalIpKey, getIpAliases, getItemIpOverrides } from "@/lib/ipAlias";

export interface FranchiseMember {
  mediaItemId: string;
  title: string | null;
  type: string;
  /**
   * Where this membership came from. Three values, not a boolean: once Wikidata
   * could attach a franchise, a bare `manual` flag labelled all 407 of its rows
   * "attached by hand" in the admin panel, which is both wrong and the opposite
   * of useful — provenance is exactly what you want to see when deciding
   * whether to trust a row.
   */
  source: "provider" | "manual" | "wikidata";
}

export interface FranchiseRow {
  key: string;                 // canonical key
  label: string;               // best display label seen
  members: FranchiseMember[];
  types: string[];             // distinct media types present
  /** member spellings folded into this canonical by ip_alias */
  aliases: string[];
}

interface RawIpRow { id: string; title: string | null; type: string; name: string }

// Both providers, one query each, names already expanded in the stored payloads.
// TMDB's is a single object; IGDB's is an array, so it needs json_each.
function rawIpRows(): RawIpRow[] {
  const tmdb = query<RawIpRow>(
    `SELECT mi.id, mi.title, mi.type,
            json_extract(ml.raw_data, '$.belongs_to_collection.name') AS name
       FROM media_links ml JOIN media_items mi ON mi.id = ml.media_item_id
      WHERE ml.source = 'tmdb'
        AND json_extract(ml.raw_data, '$.belongs_to_collection.name') IS NOT NULL`
  );
  const igdb = query<RawIpRow>(
    `SELECT mi.id, mi.title, mi.type, json_extract(f.value, '$.name') AS name
       FROM media_links ml
       JOIN media_items mi ON mi.id = ml.media_item_id
       JOIN json_each(ml.raw_data, '$.franchises') f
      WHERE ml.source = 'igdb'
        AND json_extract(f.value, '$.name') IS NOT NULL`
  );
  return [...tmdb, ...igdb];
}

export function surveyFranchises(): FranchiseRow[] {
  const aliases = getIpAliases();
  const overrides = getItemIpOverrides();

  const byKey = new Map<string, FranchiseRow & { seen: Set<string> }>();
  const touch = (key: string, label: string) => {
    let row = byKey.get(key);
    if (!row) {
      row = { key, label, members: [], types: [], aliases: [], seen: new Set() };
      byKey.set(key, row);
    }
    // Prefer the label whose own key IS the canonical, so a bundle shows the
    // canonical's name rather than whichever member happened to come first.
    if (ipKey(label) === key && ipKey(row.label) !== key) row.label = label;
    return row;
  };

  // Provider-supplied membership, minus anything explicitly detached.
  for (const r of rawIpRows()) {
    const key = aliases.get(ipKey(r.name)) ?? ipKey(r.name);
    if (!key) continue;
    const detached = (overrides.get(r.id) ?? []).some(
      (o) => o.mode === "remove" && (aliases.get(o.ipKey) ?? o.ipKey) === key
    );
    if (detached) continue;
    const row = touch(key, r.name);
    if (row.seen.has(r.id)) continue;
    row.seen.add(r.id);
    row.members.push({ mediaItemId: r.id, title: r.title, type: r.type, source: "provider" });
  }

  // Hand-attached membership — the only way a show is ever in a franchise.
  const titles = new Map(
    query<{ id: string; title: string | null; type: string }>(
      `SELECT id, title, type FROM media_items`
    ).map((r) => [r.id, r])
  );
  for (const [mediaItemId, list] of overrides) {
    for (const o of list) {
      if (o.mode !== "add") continue;
      const key = aliases.get(o.ipKey) ?? o.ipKey;
      const row = touch(key, o.label);
      if (row.seen.has(mediaItemId)) continue;
      row.seen.add(mediaItemId);
      const t = titles.get(mediaItemId);
      row.members.push({ mediaItemId, title: t?.title ?? o.label, type: t?.type ?? "?", source: o.source });
    }
  }

  for (const [alias, canonical] of aliases) {
    byKey.get(canonical)?.aliases.push(alias);
  }

  return [...byKey.values()]
    .map(({ seen: _seen, ...row }) => ({
      ...row,
      types: [...new Set(row.members.map((m) => m.type))].sort(),
      aliases: row.aliases.sort(),
      members: row.members.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "")),
    }))
    .sort((a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key));
}

// ── title-match suggestions ───────────────────────────────────────────

export interface FranchiseSuggestion {
  mediaItemId: string;
  title: string;
  type: string;
  ipKey: string;
  ipLabel: string;
  match: "exact" | "prefix";
}

// A franchise key has to clear this to be matched by title at all. Measured on
// the real catalog: without it the show "X" matches the "X Collection" key, and
// every other one-word key is a coin flip. Two words for a prefix match is the
// same guard from the other side — "The Lord of the Rings: The Rings of Power"
// prefix-matching "the lord of the rings" is meaningful; matching "the" is not.
const MIN_EXACT_CHARS = 4;
const MIN_PREFIX_WORDS = 2;

/**
 * Items whose TITLE says they belong to a franchise the catalog already knows,
 * but which carry no provider franchise data. This is the only automatic signal
 * available for shows: TMDB has no collection concept for series and IGDB
 * covers only games, so without this (or a hand-attach) every show is invisible
 * to the franchise facet.
 *
 * Suggestions only — nothing is applied. Each one is accepted or rejected in
 * the admin panel, which is what keeps a wrong guess from silently scoring.
 */
export function suggestFranchisesByTitle(opts?: { types?: string[] }): FranchiseSuggestion[] {
  const survey = surveyFranchises();
  const known = new Map(survey.map((f) => [f.key, f.label]));
  const overrides = getItemIpOverrides();

  // Anything already carrying provider data or a decision is out of scope.
  const alreadyPlaced = new Set<string>();
  for (const f of survey) for (const m of f.members) alreadyPlaced.add(m.mediaItemId);
  for (const [id, list] of overrides) if (list.length) alreadyPlaced.add(id);

  const wantTypes = opts?.types;
  const rows = query<{ id: string; title: string | null; type: string }>(
    `SELECT id, title, type FROM media_items WHERE title IS NOT NULL`
  );

  const out: FranchiseSuggestion[] = [];
  for (const r of rows) {
    if (alreadyPlaced.has(r.id)) continue;
    if (wantTypes && !wantTypes.includes(r.type)) continue;
    const t = ipKey(r.title!);
    if (!t) continue;

    let hit: { key: string; match: "exact" | "prefix" } | null = null;
    if (known.has(t) && t.length >= MIN_EXACT_CHARS) {
      hit = { key: t, match: "exact" };
    } else {
      // Longest matching prefix wins, so "star wars the clone wars" prefers
      // "star wars the clone wars" over "star wars" when both are known.
      let best: string | null = null;
      for (const key of known.keys()) {
        if (key.split(" ").length < MIN_PREFIX_WORDS) continue;
        if (t === key || t.startsWith(key + " ")) {
          if (!best || key.length > best.length) best = key;
        }
      }
      if (best) hit = { key: best, match: "prefix" };
    }
    if (!hit) continue;

    out.push({
      mediaItemId: r.id,
      title: r.title!,
      type: r.type,
      ipKey: canonicalIpKey(hit.key),
      ipLabel: known.get(hit.key) ?? hit.key,
      match: hit.match,
    });
  }
  return out.sort((a, b) => a.ipLabel.localeCompare(b.ipLabel) || a.title.localeCompare(b.title));
}
