// The taxonomy sweep: what the catalog says is wrong with its own vocabulary.
// A port of the site's src/lib/taxonomySuggestions.ts, for the Scoring admin's
// Review section.
//
// The site ran this on its server over the scoring pool. The device holds the
// same pool, so it runs here over the two surveys the Tags table and the
// Franchises list already make (lib/tagVocab.ts, lib/ipSurvey.ts). The rules
// are the site's own, imported: `@/lib/taxonomyRules` and `categorizeTag`.
//
// Nothing here is stored. A proposal is worked out again every time, which is
// the only way it stays true as the catalog changes. Only the NOs are kept, on
// the Worker (taxonomy_suggestion_dismissed): an accepted proposal stops making
// itself, a denied one would come back for ever.
//
// Accepting has no route of its own. A tag batch is the Tags table's category
// write, a merge is the Franchises list's bundle, a membership is its attach,
// and a new franchise is one attach per title.

import { categorizeTag } from '@/lib/tags';
import { TAG_RULES, ruleFor, type TagRule } from '@/lib/taxonomyRules';
import type { TaxonomyJson } from '~/lib/fandexScore';
import {
  suggestFranchisesByTitle, suggestNewFranchises, surveyFranchises, type CatalogTitle, type FranchiseRow, type NewFranchiseMember,
} from '~/lib/ipSurvey';
import type { TagRow } from '~/lib/tagVocab';

export type SuggestionKind = 'tag-category' | 'tag-alias' | 'franchise-merge' | 'franchise-member' | 'franchise-new';

export interface SuggestedTag { key: string; label: string; count: number }

export interface TagCategorySuggestion {
  kind: 'tag-category';
  /** The rule id. Saying no to the rule says no to the whole group. */
  ref: string;
  title: string;
  why: string;
  categoryId: string;
  categoryLabel: string;
  /** Set when accepting has to make the category first. */
  createsCategory: { id: string; label: string } | null;
  tags: SuggestedTag[];
  /** How many times these tags appear in the catalog: the honest size of the change. */
  itemsAffected: number;
}

export interface TagAliasSuggestion {
  kind: 'tag-alias';
  /** `alias>canonical`, as a franchise merge. */
  ref: string;
  title: string;
  why: string;
  signal: 'spelling' | 'bracket' | 'acronym' | 'plural' | 'synonym';
  aliasKey: string; aliasLabel: string; aliasCount: number;
  canonicalKey: string; canonicalLabel: string; canonicalCount: number;
}

export interface FranchiseMergeSuggestion {
  kind: 'franchise-merge';
  /** `alias>canonical`. The other direction is a different proposal, on purpose. */
  ref: string;
  title: string;
  why: string;
  aliasKey: string; aliasLabel: string; aliasSize: number; aliasSample: string[];
  canonicalKey: string; canonicalLabel: string; canonicalSize: number; canonicalSample: string[];
}

export interface FranchiseMemberSuggestion {
  kind: 'franchise-member';
  /** `mediaItemId>ipKey`. */
  ref: string;
  title: string;
  why: string;
  mediaItemId: string;
  itemTitle: string;
  itemType: string;
  ipKey: string;
  ipLabel: string;
  /** How many titles the franchise already holds, so a one-title "franchise" shows as one. */
  franchiseSize: number;
}

export interface FranchiseNewSuggestion {
  kind: 'franchise-new';
  /** The proposed franchise's key. A no to it is a no to the franchise, whichever titles it would hold. */
  ref: string;
  title: string;
  why: string;
  signal: 'same-work' | 'shared-words';
  ipKey: string;
  ipLabel: string;
  /** True when the franchise exists and the titles join it. */
  joins: boolean;
  /** What accepting attaches, one row each. */
  members: NewFranchiseMember[];
}

export type Suggestion = TagCategorySuggestion | TagAliasSuggestion | FranchiseMergeSuggestion | FranchiseMemberSuggestion | FranchiseNewSuggestion;

export interface SweepReport {
  suggestions: Suggestion[];
  stats: {
    totalTags: number;
    otherTags: number;
    otherAfterAccepting: number;
    tagsCovered: number;
    itemsAffected: number;
    franchises: number;
    singletonFranchises: number;
    dismissed: number;
  };
}

// ── Tag categories ───────────────────────────────────────────────────────────

/**
 * The live category a rule means.
 *
 * ⚠️ Never `rule.category` alone. The hand-made categories were typed in by
 * hand and carry different ids in different databases (`character`, `object`
 * and `mode` on the live one). A rule that trusted one spelling would report
 * "creates this category" where the other spelling exists, and accepting the
 * card would make a second category with nearly the same name. So: the first
 * candidate that exists, and a new one only when none does.
 */
function resolveCategory(rule: TagRule, live: Map<string, string>): { id: string; label: string; creates: { id: string; label: string } | null } {
  for (const id of [rule.category, ...(rule.categoryAliases ?? [])]) {
    const label = live.get(id);
    if (label !== undefined) return { id, label, creates: null };
  }
  const creates = rule.creates ?? { id: rule.category, label: rule.category };
  return { id: creates.id, label: creates.label, creates };
}

/**
 * Candidates are tags the code files under Other and nobody has moved by hand.
 * A tag somebody moved is a decision already made, and a tag the code placed is
 * out of scope even where the placement looks wrong: "almost nothing in Other"
 * was the ask, and re-homing placed tags is a different, more careful job.
 */
function tagSuggestions(tags: TagRow[], tax: TaxonomyJson, dismissed: Set<string>): { list: TagCategorySuggestion[]; otherTotal: number } {
  const live = new Map(tax.tagCategories.map((c) => [c.id, c.label]));
  const byRule = new Map<string, SuggestedTag[]>();
  let otherTotal = 0;
  for (const t of tags) {
    if (t.overridden || categorizeTag(t.key) !== 'other') continue;
    otherTotal++;
    const rule = ruleFor(t.key);
    if (!rule) continue;
    const list = byRule.get(rule.id);
    const tag = { key: t.key, label: t.label, count: t.count };
    if (list) list.push(tag); else byRule.set(rule.id, [tag]);
  }

  const list: TagCategorySuggestion[] = [];
  for (const rule of TAG_RULES) {
    const found = byRule.get(rule.id);
    if (!found?.length || dismissed.has(`tag-category|${rule.id}`)) continue;
    found.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const target = resolveCategory(rule, live);
    list.push({
      kind: 'tag-category', ref: rule.id, title: rule.title, why: rule.why,
      categoryId: target.id, categoryLabel: target.label, createsCategory: target.creates,
      tags: found, itemsAffected: found.reduce((n, t) => n + t.count, 0),
    });
  }
  // Biggest first, by appearances and not by tag count: a rule claiming twelve
  // tags seen 900 times changes more than one claiming eighty nobody carries twice.
  list.sort((a, b) => b.itemsAffected - a.itemsAffected);
  return { list, otherTotal };
}

// ── Tags that are one tag ────────────────────────────────────────────────────

/**
 * Names the providers write differently that no spelling rule can join. Each
 * group is one tag; the forms are compared loose (see `loose` below). Short on
 * purpose: the mechanical signals find the rest, and a pair missing here is a
 * card nobody sees, while a wrong pair here is a card somebody denies once.
 */
export const TAG_SYNONYMS: string[][] = [
  ['science fiction', 'sci fi'],
  ['romantic comedy', 'rom com'],
  ['shoot em up', 'shmup'],
  ['cooperative', 'co op', 'coop'],
  ['world war ii', 'world war 2', 'wwii', 'ww2', 'second world war'],
  ['world war i', 'world war 1', 'wwi', 'ww1', 'first world war'],
  ['post apocalyptic', 'post apocalypse'],
  ['artificial intelligence', 'a i'],
];

/**
 * A tag's words with the punctuation gone: what two spellings of one tag share.
 * `tagKey` keeps brackets and apostrophes ("role playing (rpg)", "shoot 'em up"),
 * since its keys are stored and changing it would orphan them, so the
 * comparison loosens it here instead. "&" and a lone "n" read as "and".
 */
export function loose(key: string): string {
  // Letters of every script survive: "2D-платформер" is not "2D" (2026-11-06, the first run).
  return key.toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/(^| )n(?= |$)/g, '$1and').replace(/\s+/g, ' ').trim();
}

const initialsOf = (words: string) => words.split(' ').map((w) => w[0]).join('');

/** The singular a plural last word could be, longest stem first. Four letters at least, so "news" is not "new". */
function singulars(words: string): string[] {
  const m = words.match(/^(.*?)(\w+)$/);
  if (!m) return [];
  const [, head, last] = m;
  const out: string[] = [];
  if (last.length > 5 && last.endsWith('ies')) out.push(`${last.slice(0, -3)}y`);
  if (last.length > 5 && /(ches|shes|xes|sses|zes)$/.test(last)) out.push(last.slice(0, -2));
  if (last.length > 4 && last.endsWith('s') && !last.endsWith('ss') && !last.endsWith('us') && !last.endsWith('is')) out.push(last.slice(0, -1));
  return out.map((s) => head + s);
}

/**
 * Two tags in the vocabulary that are one tag: "rpg" and "role playing game",
 * "sci fi" and "scifi", "zombie" and "zombies". Five signals, strongest first:
 * the same letters once spaces go (spelling), an acronym in brackets after its
 * words, an acronym standing for a tag's words (three letters or more: "ai" also
 * stands for "alien invasion"), a plural, and the short synonym list above.
 *
 * The bigger tag is kept, as for franchises; a card offers the other way too.
 * Accepting is the Tags table's own bundle (`/v1/admin/tag-aliases`).
 */
export function tagAliasSuggestions(tags: TagRow[], dismissed: Set<string>): TagAliasSuggestion[] {
  const byLoose = new Map<string, TagRow>();
  for (const t of tags) {
    const l = loose(t.key);
    if (!l) continue;
    const had = byLoose.get(l);
    // Two keys can loosen to one form ("role-playing", "role playing!"): keep the commoner as its face.
    if (!had || t.count > had.count) byLoose.set(l, t);
  }
  const out: TagAliasSuggestion[] = [];
  const seen = new Set<string>();
  const WHY: Record<TagAliasSuggestion['signal'], string> = {
    spelling: 'The same letters, written with and without spaces or punctuation.',
    bracket: 'One tag names the other in brackets.',
    acronym: 'One is the initials of the other.',
    plural: 'The same word, singular and plural.',
    synonym: 'Two names for one thing.',
  };
  const push = (a: TagRow, b: TagRow, signal: TagAliasSuggestion['signal']) => {
    if (a.key === b.key) return;
    const pair = [a.key, b.key].sort().join('|');
    if (seen.has(pair)) return;
    seen.add(pair);
    // The commoner tag stays. On a tie, the cleaner spelling ("Palestine", not "\"Palestine\""), then the longer one.
    const junk = (t: TagRow) => (t.key.match(/["[\].:;]/g) ?? []).length;
    const bFirst = b.count !== a.count ? b.count > a.count : junk(b) !== junk(a) ? junk(b) < junk(a) : b.key.length > a.key.length;
    const [canonical, alias] = bFirst ? [b, a] : [a, b];
    const ref = `${alias.key}>${canonical.key}`;
    // Either direction denied is a no to the pair: "the other way" was on the card that was denied.
    if (dismissed.has(`tag-alias|${ref}`) || dismissed.has(`tag-alias|${canonical.key}>${alias.key}`)) return;
    out.push({
      kind: 'tag-alias', ref, title: `${alias.label} → ${canonical.label}`, why: WHY[signal], signal,
      aliasKey: alias.key, aliasLabel: alias.label, aliasCount: alias.count,
      canonicalKey: canonical.key, canonicalLabel: canonical.label, canonicalCount: canonical.count,
    });
  };

  // Spelling: one tag once the spaces go ("sci fi", "scifi").
  const byCompact = new Map<string, TagRow[]>();
  for (const [l, t] of byLoose) {
    const c = l.replace(/ /g, '');
    if (c.length < 4) continue;
    byCompact.set(c, [...(byCompact.get(c) ?? []), t]);
  }
  for (const group of byCompact.values()) for (let i = 1; i < group.length; i++) push(group[0], group[i], 'spelling');
  // Two keys that loosen to the very same words ("hack & slash", "hack and slash").
  const firstByLoose = new Map<string, TagRow>();
  for (const t of tags) {
    const l = loose(t.key);
    const had = firstByLoose.get(l);
    if (had) push(had, t, 'spelling'); else if (l) firstByLoose.set(l, t);
  }

  // A bracket holding the initials of the words before it: "Real Time Strategy (RTS)"
  // is "RTS" and is "Real Time Strategy". Only initials: a library qualifier,
  // "Identity (Psychology)", "London (England)", names another tag, not this one.
  for (const t of tags) {
    const m = t.key.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (!m) continue;
    const outer = loose(m[1]);
    const inner = loose(m[2]).replace(/ /g, '');
    if (!outer.includes(' ') || initialsOf(outer) !== inner) continue;
    for (const part of [outer, loose(m[2]), inner]) {
      const other = byLoose.get(part);
      if (other) push(t, other, 'bracket');
    }
  }

  // An acronym: a one-word tag WRITTEN in capitals ("FPS", "PvP", "MOBA") that is
  // another tag's initials. The capitals are the signal: lower case, "gore" is
  // a word and not "georgian or regency era".
  const byInitials = new Map<string, TagRow[]>();
  for (const [l, t] of byLoose) {
    const words = l.split(' ');
    if (words.length < 2 || words.length > 7) continue;
    const initials = initialsOf(l);
    byInitials.set(initials, [...(byInitials.get(initials) ?? []), t]);
  }
  for (const [l, t] of byLoose) {
    if (!/^[a-z]{3,6}$/.test(l) || !/[A-Z].*[A-Z]/.test(t.label)) continue;
    for (const full of byInitials.get(l) ?? []) push(t, full, 'acronym');
  }

  // A plural.
  for (const [l, t] of byLoose) {
    for (const s of singulars(l)) {
      const other = byLoose.get(s);
      if (other) { push(t, other, 'plural'); break; }
    }
  }

  // The synonym list.
  for (const group of TAG_SYNONYMS) {
    const found = group.map((g) => byLoose.get(g)).filter((t): t is TagRow => !!t);
    for (let i = 1; i < found.length; i++) push(found[0], found[i], 'synonym');
  }

  // Most titles first: a bundle of two common tags changes more of the catalog.
  return out.sort((a, b) => (b.aliasCount + b.canonicalCount) - (a.aliasCount + a.canonicalCount));
}

// ── Franchise merges ─────────────────────────────────────────────────────────

const ARTICLE = /^(the|a|an) /;
const MIN_PREFIX_CHARS = 6;
const sample = (f: FranchiseRow) => f.members.slice(0, 6).map((m) => m.title ?? '?');

/**
 * Two franchises the catalog holds apart that are probably one.
 *
 * `ipKey` already peels "Collection", "Series" and "Saga". It does not peel a
 * leading article, so "Terminator" and "The Terminator Collection" are two
 * franchises: signal one. Signal two is a whole-word prefix, "metal gear"
 * against "metal gear solid". It finds the spin-offs and it also finds "portal"
 * against "portal knights", which is why a card carries titles from both sides.
 */
function mergeSuggestions(survey: FranchiseRow[], dismissed: Set<string>): FranchiseMergeSuggestion[] {
  const out: FranchiseMergeSuggestion[] = [];
  const seen = new Set<string>();
  const push = (alias: FranchiseRow, canonical: FranchiseRow, why: string) => {
    const ref = `${alias.key}>${canonical.key}`;
    if (seen.has(ref) || dismissed.has(`franchise-merge|${ref}`)) return;
    seen.add(ref);
    out.push({
      kind: 'franchise-merge', ref, title: `${alias.label} → ${canonical.label}`, why,
      aliasKey: alias.key, aliasLabel: alias.label, aliasSize: alias.members.length, aliasSample: sample(alias),
      canonicalKey: canonical.key, canonicalLabel: canonical.label, canonicalSize: canonical.members.length, canonicalSample: sample(canonical),
    });
  };

  // Signal one: the same name once a leading article is dropped.
  const byStripped = new Map<string, FranchiseRow[]>();
  for (const f of survey) {
    const s = f.key.replace(ARTICLE, '');
    if (!s) continue;
    const group = byStripped.get(s);
    if (group) group.push(f); else byStripped.set(s, [f]);
  }
  for (const group of byStripped.values()) {
    if (group.length < 2) continue;
    // The bigger one is kept; on a tie, the one without the article, which is
    // the name the other providers use.
    const sorted = [...group].sort((a, b) => b.members.length - a.members.length || Number(ARTICLE.test(a.key)) - Number(ARTICLE.test(b.key)));
    for (const alias of sorted.slice(1)) {
      push(alias, sorted[0], 'The same name with and without a leading article. One of the two providers writes it the other way.');
    }
  }

  // Signal two: one key is a whole-word prefix of the other. The general name
  // is the franchise, so the longer one folds into it. The sentence says
  // "begins with the same words as" and names no prefix: the prefix is a key
  // and the card shows labels, and the two often differ.
  const byKey = new Map(survey.map((f) => [f.key, f]));
  for (const shortKey of byKey.keys()) {
    if (shortKey.length < MIN_PREFIX_CHARS) continue;
    for (const longKey of byKey.keys()) {
      if (longKey === shortKey || !longKey.startsWith(`${shortKey} `)) continue;
      const shortRow = byKey.get(shortKey)!;
      const longRow = byKey.get(longKey)!;
      push(longRow, shortRow, `"${longRow.label}" begins with the same words as "${shortRow.label}", so it is probably a sub-series and not a franchise of its own.`);
    }
  }

  // Biggest combined first.
  return out.sort((a, b) => (b.aliasSize + b.canonicalSize) - (a.aliasSize + a.canonicalSize));
}

// ── Missing members ──────────────────────────────────────────────────────────

function memberSuggestions(titles: CatalogTitle[], tax: TaxonomyJson, survey: FranchiseRow[], dismissed: Set<string>): FranchiseMemberSuggestion[] {
  const sizes = new Map(survey.map((f) => [f.key, f.members.length]));
  return suggestFranchisesByTitle(titles, tax, survey)
    .map((s): FranchiseMemberSuggestion => ({
      kind: 'franchise-member', ref: `${s.mediaItemId}>${s.ipKey}`, title: `${s.title} → ${s.ipLabel}`,
      why: s.match === 'exact'
        ? 'The title is the franchise name, and the item carries no provider franchise data.'
        : 'The title starts with the franchise name, and the item carries no provider franchise data.',
      mediaItemId: s.mediaItemId, itemTitle: s.title, itemType: s.type, ipKey: s.ipKey, ipLabel: s.ipLabel,
      franchiseSize: sizes.get(s.ipKey) ?? 0,
    }))
    .filter((s) => !dismissed.has(`franchise-member|${s.ref}`))
    // Biggest franchise first: a missing member shows most where the franchise is big.
    .sort((a, b) => b.franchiseSize - a.franchiseSize || a.itemTitle.localeCompare(b.itemTitle));
}

// ── New franchises ──────────────────────────────────────────────────────────

const MEDIA: Record<string, string> = { book: 'a book', movie: 'a film', show: 'a show', game: 'a game', boardgame: 'a board game' };

function mediaList(types: string[]): string {
  const names = [...new Set(types)].sort().map((t) => MEDIA[t] ?? t);
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function newFranchiseSuggestions(
  titles: CatalogTitle[], tax: TaxonomyJson, survey: FranchiseRow[], members: FranchiseMemberSuggestion[], dismissed: Set<string>,
): FranchiseNewSuggestion[] {
  // A title a membership card already offers to this same franchise is that
  // card's. Two cards writing one row would leave the second one stale.
  const offered = new Set(members.map((m) => m.ref));
  const out: FranchiseNewSuggestion[] = [];
  for (const s of suggestNewFranchises(titles, tax, survey)) {
    if (dismissed.has(`franchise-new|${s.ipKey}`)) continue;
    const list = s.members.filter((m) => !offered.has(`${m.mediaItemId}>${s.ipKey}`));
    if (!list.length) continue;
    const why = s.joins
      ? `The same name as a title already in ${s.ipLabel}, in another medium, and placed nowhere yet.`
      : s.signal === 'same-work'
        ? `One name as ${mediaList(list.map((m) => m.type))}, and no provider puts them in a franchise together.`
        : `${list.length} titles begin with "${s.ipLabel}" and no provider names the series.`;
    out.push({
      kind: 'franchise-new', ref: s.ipKey, title: s.joins ? `Join ${s.ipLabel}` : `New franchise: ${s.ipLabel}`, why,
      signal: s.signal, ipKey: s.ipKey, ipLabel: s.ipLabel, joins: s.joins, members: list,
    });
  }
  return out;
}

// ── The sweep ────────────────────────────────────────────────────────────────

export function runTaxonomySweep(input: {
  /** The Tags table's rows (buildTagRows). */
  tags: TagRow[];
  /** The catalog's titles with their franchises (catalogTitles). */
  titles: CatalogTitle[];
  tax: TaxonomyJson;
  /** `[kind, ref]` for every proposal somebody said no to. */
  dismissed: [string, string][];
}): SweepReport {
  const dismissed = new Set(input.dismissed.map(([kind, ref]) => `${kind}|${ref}`));
  const survey = surveyFranchises(input.titles, input.tax);
  const tags = tagSuggestions(input.tags, input.tax, dismissed);
  const members = memberSuggestions(input.titles, input.tax, survey, dismissed);
  const suggestions: Suggestion[] = [
    ...tags.list,
    ...tagAliasSuggestions(input.tags, dismissed),
    ...mergeSuggestions(survey, dismissed),
    ...newFranchiseSuggestions(input.titles, input.tax, survey, members, dismissed),
    ...members,
  ];
  const covered = tags.list.reduce((n, s) => n + s.tags.length, 0);
  return {
    suggestions,
    stats: {
      totalTags: input.tags.length,
      otherTags: tags.otherTotal,
      // What Other would hold if every tag card were accepted: the number the ask was about.
      otherAfterAccepting: tags.otherTotal - covered,
      tagsCovered: covered,
      itemsAffected: tags.list.reduce((n, s) => n + s.itemsAffected, 0),
      franchises: survey.length,
      singletonFranchises: survey.filter((f) => f.members.length === 1).length,
      dismissed: dismissed.size,
    },
  };
}
