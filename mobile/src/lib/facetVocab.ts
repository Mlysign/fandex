// The people and tags in the catalog on the device, for Search's "People" and
// "Tags" groups: the site's A5 typed search groups (DiscoverPageClient.tsx,
// FacetMatchGroup, fed by /api/discover/facets), answered from the device.
//
// One pass over the catalog's facets, kept until the catalog changes. Matching
// is on the spoken name: the whole name first, then a word starting with what
// was typed, each ordered by how many titles carry it.

import type { SQLiteDatabase } from 'expo-sqlite';
import { normalizeName } from '@/lib/normalize';

export interface VocabEntry { kind: 'person' | 'tag'; key: string; label: string; count: number; norm: string }

let cached: { db: SQLiteDatabase; revision: number; entries: Promise<VocabEntry[]> } | null = null;

async function build(db: SQLiteDatabase): Promise<VocabEntry[]> {
  const rows = await db.getAllAsync<{ facets: string }>('SELECT facets FROM catalog');
  const byKey = new Map<string, VocabEntry>();
  for (let i = 0; i < rows.length; i++) {
    let facets: { kind?: string; key?: string; label?: string }[] = [];
    try { facets = JSON.parse(rows[i].facets); } catch { /* an unreadable row adds nothing */ }
    const seen = new Set<string>();
    for (const f of facets) {
      if ((f.kind !== 'person' && f.kind !== 'tag') || !f.key) continue;
      const id = `${f.kind}|${f.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const cur = byKey.get(id);
      if (cur) cur.count++;
      else byKey.set(id, { kind: f.kind, key: f.key, label: f.label || f.key, count: 1, norm: normalizeName(f.label || f.key) });
    }
    // Hand the thread back now and then: this runs while somebody types.
    if (i % 500 === 499) await new Promise<void>((r) => setTimeout(r, 0));
  }
  return [...byKey.values()];
}

/** The vocabulary for this catalog copy, built once and shared. */
export function facetVocab(db: SQLiteDatabase, revision: number): Promise<VocabEntry[]> {
  if (!cached || cached.db !== db || cached.revision !== revision) {
    const entries = build(db);
    cached = { db, revision, entries };
    entries.catch(() => { if (cached?.entries === entries) cached = null; });
  }
  return cached.entries;
}

/** The best matches of each kind for a typed, normalised query: 8 people and 8 tags, as the site showed. */
export function matchVocab(entries: VocabEntry[], norm: string, limit = 8): { people: VocabEntry[]; tags: VocabEntry[] } {
  if (norm.length < 2) return { people: [], tags: [] };
  // The whole name, then a word starting with it anywhere (so "nolan" ranks
  // Christopher Nolan on his title count, not after Nolan Gerard Funk), then the rest.
  const rank = (e: VocabEntry) => (e.norm === norm ? 0 : e.norm.startsWith(norm) || e.norm.includes(` ${norm}`) ? 1 : 2);
  const hits = entries.filter((e) => e.norm.includes(norm)).sort((a, b) => rank(a) - rank(b) || b.count - a.count);
  return { people: hits.filter((e) => e.kind === 'person').slice(0, limit), tags: hits.filter((e) => e.kind === 'tag').slice(0, limit) };
}
