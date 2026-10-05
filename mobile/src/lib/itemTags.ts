// A title's tags, grouped the way the item page shows them: by category, in
// the taxonomy's order, each tag under its canonical key and chosen name.
//
// The grouping itself is the site's (src/lib/tags.ts). This file only feeds it
// the app's taxonomy, so the page and the Fandex Score read one set of rules.

import { tagKey } from '@/lib/facets';
import { groupTagsByCategory, type TagDisplayGroup } from '@/lib/tags';
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
  return groupTagsByCategory(items, taxonomy?.tagCategoryOverrides ?? new Map(), categories);
}
