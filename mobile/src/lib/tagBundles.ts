// A bundled tag ("fantasy fiction" folded into "fantasy") is ONE tag on every
// screen that counts titles, as it is in the score (lib/fandexScore.ts,
// applyTagAliases). Until 0.3.37 the tag page and Insights counted each
// spelling apart, so a page's rated count and average left out titles its own
// impact number had learned from.

import type { Taxonomy } from '~/lib/fandexScore';
import { spokenKey } from '~/lib/facetImpact';

/**
 * The tag a page address stands for, and every stored spelling it gathers.
 * `key` is the canonical tag's spoken key (a bundled spelling's address opens
 * the tag it is bundled into, as a franchise's does); `members` are the stored
 * keys to look for, `spoken` the same as spoken keys for matching.
 */
export function tagPageKeys(spoken: string, tax: Taxonomy | null): { key: string; members: string[]; spoken: Set<string> } {
  let key = spoken;
  if (tax) for (const [alias, canonical] of tax.tagAliases) if (spokenKey(alias) === spoken) { key = spokenKey(canonical); break; }
  const members = [key];
  if (tax) for (const [alias, canonical] of tax.tagAliases) if (spokenKey(canonical) === key && spokenKey(alias) !== key) members.push(alias);
  return { key, members, spoken: new Set(members.map(spokenKey)) };
}

interface TagLike { kind: string; key: string; label: string }

/** A stored tag facet under its canonical key and name: the chosen name, else its own label. Other kinds pass through. */
export function foldTag<F extends TagLike>(f: F, tax: Taxonomy | null): F {
  if (f.kind !== 'tag' || !tax) return f;
  const canonical = tax.tagAliases.get(f.key) ?? f.key;
  const named = tax.labels.get(`tag|${canonical}`);
  return canonical === f.key && !named ? f : { ...f, key: canonical, label: named ?? f.label };
}
