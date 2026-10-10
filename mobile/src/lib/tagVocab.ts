// The tag vocabulary, counted on the device: what the Scoring admin's Tags
// table lists. The site built it on its server from the scoring pool
// (getTagVocab, getRawTagCounts in src/lib/discovery.ts); the device holds the
// same pool with the same raw facets, so it can count the same thing.
//
// "Raw" is a tag as a provider spelled it. The vocabulary is after aliases:
// every spelling folded into its canonical tag, counted once per title.

import type { SQLiteDatabase } from 'expo-sqlite';
import type { TaxonomyJson } from '~/lib/fandexScore';

export interface AkaTag { key: string; label: string; count: number }

export interface TagRow {
  key: string;
  label: string;
  /** Titles carrying the tag under any of its spellings. */
  count: number;
  /** The category it counts under: the one chosen by hand, else the one the catalog gave it. */
  category: string;
  overridden: boolean;
  /** The other spellings folded into this tag. */
  aka: AkaTag[];
  labelOverridden: boolean;
}

interface RawTag { label: string; count: number; category: string }

/** Every tag as the providers spell it, with how many titles carry it. One pass over the catalog. */
export async function rawTagCounts(db: SQLiteDatabase): Promise<Map<string, RawTag>> {
  const rows = await db.getAllAsync<{ facets: string }>('SELECT facets FROM catalog');
  const raw = new Map<string, RawTag>();
  const itemsByKey = new Map<string, number[]>();
  rows.forEach((r, item) => {
    let facets: { kind: string; key: string; label: string; category?: string }[] = [];
    try { facets = JSON.parse(r.facets); } catch { return; }
    const seen = new Set<string>();
    for (const f of facets) {
      if (f.kind !== 'tag' || seen.has(f.key)) continue;
      seen.add(f.key);
      const cur = raw.get(f.key);
      if (cur) cur.count++; else raw.set(f.key, { label: f.label, count: 1, category: f.category ?? 'other' });
      const list = itemsByKey.get(f.key);
      if (list) list.push(item); else itemsByKey.set(f.key, [item]);
    }
  });
  // Kept on the map for buildTagRows, which needs "titles carrying ANY spelling" and not a sum of spellings.
  (raw as Map<string, RawTag> & { items?: Map<string, number[]> }).items = itemsByKey;
  return raw;
}

/** The table's rows, most common first: the site's /api/dev/scoring/tags answer, unfiltered. */
export function buildTagRows(raw: Map<string, RawTag>, tax: TaxonomyJson): TagRow[] {
  const items = (raw as Map<string, RawTag> & { items?: Map<string, number[]> }).items ?? new Map<string, number[]>();
  const alias = new Map(tax.tagAliases);
  const overrides = new Map(tax.tagCategoryOverrides);
  const chosen = new Map(tax.facetLabels.filter(([kind]) => kind === 'tag').map(([, key, label]) => [key, label]));

  const members = new Map<string, string[]>();
  for (const [a, canonical] of alias) members.set(canonical, [...(members.get(canonical) ?? []), a]);

  const canonicals = new Set<string>();
  for (const key of raw.keys()) canonicals.add(alias.get(key) ?? key);

  const rows: TagRow[] = [];
  for (const key of canonicals) {
    const own = raw.get(key);
    const aka = (members.get(key) ?? []).sort();
    // A title carrying two spellings of one tag is one title.
    const titles = new Set<number>(items.get(key) ?? []);
    for (const m of aka) for (const i of items.get(m) ?? []) titles.add(i);
    const firstMember = aka.map((m) => raw.get(m)).find(Boolean);
    rows.push({
      key,
      label: chosen.get(key) ?? own?.label ?? firstMember?.label ?? key,
      labelOverridden: chosen.has(key),
      count: titles.size,
      category: overrides.get(key) ?? own?.category ?? firstMember?.category ?? 'other',
      overridden: overrides.has(key),
      aka: aka.map((m) => ({ key: m, label: raw.get(m)?.label ?? m, count: raw.get(m)?.count ?? 0 })),
    });
  }
  return rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** The site's filter: a category, and a term matched against the tag and every spelling folded into it. */
export function filterTagRows(rows: TagRow[], category: string, q: string): TagRow[] {
  const term = q.trim().toLowerCase();
  if (!category && !term) return rows;
  return rows.filter((r) => {
    if (category && r.category !== category) return false;
    if (!term) return true;
    return r.label.toLowerCase().includes(term) || r.key.toLowerCase().includes(term)
      || r.aka.some((a) => a.label.toLowerCase().includes(term) || a.key.toLowerCase().includes(term));
  });
}
