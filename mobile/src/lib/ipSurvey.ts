// What franchises the catalog holds and which titles are in each, counted on
// the device: what the Scoring admin's Franchises section lists. A port of the
// site's src/lib/ipSurvey.ts, reading the catalog copy's facets where the site
// read provider blobs. They say the same thing: an `ip` facet IS the provider's
// franchise for the title (TMDB's collection, IGDB's franchise).

import type { SQLiteDatabase } from 'expo-sqlite';
import { ipKey } from '@/lib/facets';
import type { TaxonomyJson } from '~/lib/fandexScore';

export interface FranchiseMember {
  mediaItemId: string;
  title: string | null;
  type: string;
  /** Where the membership comes from: the provider's data, or a row somebody or a job added. */
  source: 'provider' | 'manual' | 'wikidata';
}

export interface FranchiseRow {
  /** The canonical key, after bundling. */
  key: string;
  /** What people see: the chosen name, else the best spelling seen. */
  label: string;
  members: FranchiseMember[];
  types: string[];
  /** The other keys folded into this one. */
  aliases: string[];
  rawLabel: string;
  labelOverridden: boolean;
}

export interface CatalogTitle { id: string; title: string; type: string; ips: { key: string; label: string }[] }

/** Every title with the franchises its providers put it in. One pass over the catalog. */
export async function catalogTitles(db: SQLiteDatabase): Promise<CatalogTitle[]> {
  const rows = await db.getAllAsync<{ id: string; title: string; type: string; facets: string }>('SELECT id, title, type, facets FROM catalog');
  return rows.map((r) => {
    let ips: CatalogTitle['ips'] = [];
    try {
      ips = (JSON.parse(r.facets) as { kind: string; key: string; label: string }[])
        .filter((f) => f.kind === 'ip').map((f) => ({ key: f.key, label: f.label }));
    } catch { /* a title with unreadable facets is in no franchise */ }
    return { id: r.id, title: r.title, type: r.type, ips };
  });
}

type Override = TaxonomyJson['itemIpOverrides'][number];

function overridesByItem(tax: TaxonomyJson): Map<string, Override[]> {
  const out = new Map<string, Override[]>();
  for (const o of tax.itemIpOverrides) out.set(o.mediaItemId, [...(out.get(o.mediaItemId) ?? []), o]);
  return out;
}

export function surveyFranchises(titles: CatalogTitle[], tax: TaxonomyJson): FranchiseRow[] {
  const aliases = new Map(tax.ipAliases);
  const overrides = overridesByItem(tax);
  const byKey = new Map<string, { key: string; label: string; members: FranchiseMember[]; aliases: string[]; seen: Set<string> }>();

  const touch = (key: string, label: string) => {
    let row = byKey.get(key);
    if (!row) { row = { key, label, members: [], aliases: [], seen: new Set() }; byKey.set(key, row); }
    // Prefer a spelling that IS the canonical key over one that only folds into it.
    if (ipKey(label) === key && ipKey(row.label) !== key) row.label = label;
    return row;
  };

  for (const t of titles) {
    for (const ip of t.ips) {
      const key = aliases.get(ip.key) ?? ip.key;
      if (!key) continue;
      const detached = (overrides.get(t.id) ?? []).some((o) => o.mode === 'remove' && (aliases.get(o.ipKey) ?? o.ipKey) === key);
      if (detached) continue;
      const row = touch(key, ip.label);
      if (row.seen.has(t.id)) continue;
      row.seen.add(t.id);
      row.members.push({ mediaItemId: t.id, title: t.title, type: t.type, source: 'provider' });
    }
  }

  const byId = new Map(titles.map((t) => [t.id, t]));
  for (const [mediaItemId, list] of overrides) {
    for (const o of list) {
      if (o.mode !== 'add') continue;
      const row = touch(aliases.get(o.ipKey) ?? o.ipKey, o.label);
      if (row.seen.has(mediaItemId)) continue;
      row.seen.add(mediaItemId);
      const t = byId.get(mediaItemId);
      row.members.push({ mediaItemId, title: t?.title ?? o.label, type: t?.type ?? '?', source: o.source === 'wikidata' ? 'wikidata' : 'manual' });
    }
  }

  for (const [alias, canonical] of aliases) byKey.get(canonical)?.aliases.push(alias);

  const names = new Map(tax.facetLabels.filter(([kind]) => kind === 'ip').map(([, key, label]) => [key, label]));
  return [...byKey.values()]
    .map((row): FranchiseRow => ({
      key: row.key,
      rawLabel: row.label,
      labelOverridden: names.has(row.key),
      label: names.get(row.key) ?? row.label,
      types: [...new Set(row.members.map((m) => m.type))].sort(),
      aliases: row.aliases.sort(),
      members: row.members.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '')),
    }))
    .sort((a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key));
}

export interface FranchiseSuggestion {
  mediaItemId: string;
  title: string;
  type: string;
  ipKey: string;
  ipLabel: string;
  match: 'exact' | 'prefix';
}

const MIN_EXACT_CHARS = 4;
const MIN_PREFIX_WORDS = 2;

/**
 * Titles whose own name says they belong to a franchise the catalog already
 * knows, and which no provider and nobody placed in one. Suggestions only:
 * nothing is applied until it is accepted.
 */
export function suggestFranchisesByTitle(titles: CatalogTitle[], tax: TaxonomyJson, survey = surveyFranchises(titles, tax)): FranchiseSuggestion[] {
  const aliases = new Map(tax.ipAliases);
  const known = new Map(survey.map((f) => [f.key, f.label]));
  const placed = new Set<string>();
  for (const f of survey) for (const m of f.members) placed.add(m.mediaItemId);
  for (const o of tax.itemIpOverrides) placed.add(o.mediaItemId);

  const out: FranchiseSuggestion[] = [];
  for (const t of titles) {
    if (placed.has(t.id) || !t.title) continue;
    const name = ipKey(t.title);
    if (!name) continue;
    let hit: { key: string; match: 'exact' | 'prefix' } | null = null;
    if (known.has(name) && name.length >= MIN_EXACT_CHARS) hit = { key: name, match: 'exact' };
    else {
      let best: string | null = null;
      for (const key of known.keys()) {
        if (key.split(' ').length < MIN_PREFIX_WORDS) continue;
        if ((name === key || name.startsWith(`${key} `)) && (!best || key.length > best.length)) best = key;
      }
      if (best) hit = { key: best, match: 'prefix' };
    }
    if (!hit) continue;
    out.push({ mediaItemId: t.id, title: t.title, type: t.type, ipKey: aliases.get(hit.key) ?? hit.key, ipLabel: known.get(hit.key) ?? hit.key, match: hit.match });
  }
  return out.sort((a, b) => a.ipLabel.localeCompare(b.ipLabel) || a.title.localeCompare(b.title));
}
