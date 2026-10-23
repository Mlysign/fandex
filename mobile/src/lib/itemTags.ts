// A title's tags, grouped the way the item page shows them: by category, in
// the taxonomy's order, each tag under its canonical key and chosen name.
//
// The grouping itself is the site's (src/lib/tags.ts). This file only feeds it
// the app's taxonomy, so the page and the Fandex Score read one set of rules.

import { tagKey } from '@/lib/facets';
import { CATEGORIES, groupTagsByCategory, type TagDisplayGroup } from '@/lib/tags';
import type { Taxonomy } from '~/lib/fandexScore';

export type { TagDisplayGroup };

export function tagGroups(tags: string[], keywords: string[], taxonomy: Taxonomy | null): TagDisplayGroup[] {
  const items = [...tags, ...keywords].map((t) => {
    const raw = tagKey(t);
    const key = taxonomy?.tagAliases.get(raw) ?? raw;
    return { key, label: taxonomy?.labels.get(`tag|${key}`) ?? t };
  });
  // Without a taxonomy (first launch, offline) the built-in rules still sort
  // every tag into a category; only the hand-made overrides are missing.
  const categories = taxonomy ? [...taxonomy.categories].map(([id, c]) => ({ id, label: c.label, color: '' })) : [];
  // An ignored category (Meta / Noise: "sequel", "steam achievements") is the
  // score's word for "not about the title", and printing it on the page read as
  // a leak (2026-10-23). It stays editable on /dev/scoring.
  const ignored = new Set(taxonomy
    ? [...taxonomy.categories].filter(([, c]) => c.ignored).map(([id]) => id)
    : CATEGORIES.filter((c) => c.defaultIgnored).map((c) => c.id));
  return groupTagsByCategory(items, taxonomy?.tagCategoryOverrides ?? new Map(), categories).filter((g) => !ignored.has(g.id));
}
