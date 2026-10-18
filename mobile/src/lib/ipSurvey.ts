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

  // The keys long enough to be a prefix, picked once. Asking each key for its
  // word count inside the loop below was a split per title per franchise,
  // seven million of them on the real catalog.
  const prefixKeys = [...known.keys()].filter((key) => key.split(' ').length >= MIN_PREFIX_WORDS);

  const out: FranchiseSuggestion[] = [];
  for (const t of titles) {
    if (placed.has(t.id) || !t.title) continue;
    const name = ipKey(t.title);
    if (!name) continue;
    let hit: { key: string; match: 'exact' | 'prefix' } | null = null;
    if (known.has(name) && name.length >= MIN_EXACT_CHARS) hit = { key: name, match: 'exact' };
    else {
      let best: string | null = null;
      for (const key of prefixKeys) {
        if ((name === key || name.startsWith(`${key} `)) && (!best || key.length > best.length)) best = key;
      }
      if (best) hit = { key: best, match: 'prefix' };
    }
    if (!hit) continue;
    out.push({ mediaItemId: t.id, title: t.title, type: t.type, ipKey: aliases.get(hit.key) ?? hit.key, ipLabel: known.get(hit.key) ?? hit.key, match: hit.match });
  }
  return out.sort((a, b) => a.ipLabel.localeCompare(b.ipLabel) || a.title.localeCompare(b.title));
}

export interface NewFranchiseMember {
  mediaItemId: string;
  title: string;
  type: string;
  /** The franchises it already sits in, by name. Empty for a title in none. */
  inFranchises: string[];
}

export interface NewFranchiseSuggestion {
  /** The proposed franchise's key: what `ipKey` makes of `ipLabel`. */
  ipKey: string;
  ipLabel: string;
  /** `same-work`: one name in two or more media. `shared-words`: a run of words a series begins with. */
  signal: 'same-work' | 'shared-words';
  /** True when the franchise exists and the members join it; false when accepting makes it. */
  joins: boolean;
  /** The titles accepting attaches. Never one the franchise already holds. */
  members: NewFranchiseMember[];
}

// Media that are rarely the same work as a book or a screen title that shares
// their name. A one-word game is far more often an unrelated work than the
// film of the same name: Limbo the game and Limbo the 2023 film, Prey the game
// and Prey the Predator film. So a game joins a same-name group only where a
// book is in it too (a game of the book); two games and a film never pair.
const GAME_MEDIA = new Set(['game', 'boardgame']);
const SCREEN_OR_PAGE = new Set(['book', 'movie', 'show']);
// Words that do not make a run of words a name: "the last" and "call of" begin
// unrelated titles in every medium.
const FILLER = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'at', 'to', 'for', 'from', 'with', 'by', 'is', 'or', 'vs']);
const MIN_SHARED_TITLES = 3;
// A sequel's number, as ipKey leaves it. From 2, so "Event[0]" is not a sequel
// of Event Horizon, and two digits at most, so a year is not one either.
const SEQUEL = /^([2-9]|[1-9]\d|ii|iii|iv|v|vi|vii|viii|ix)$/;
// Words that count instalments, where a 1 is a number too: "The Gallery:
// Episode 1" is the first of a series called The Gallery.
const COUNTER = new Set(['episode', 'part', 'chapter', 'vol', 'volume', 'book', 'season']);
const NUMBER = /^(\d{1,2}|i|ii|iii|iv|v|vi|vii|viii|ix)$/;
const sequelAt = (words: string[], i: number) =>
  SEQUEL.test(words[i] ?? '') || (COUNTER.has(words[i] ?? '') && NUMBER.test(words[i + 1] ?? ''));

/** One name in two or more media, by the rule above. */
function isSameWork(types: Set<string>): boolean {
  const pages = [...types].filter((t) => SCREEN_OR_PAGE.has(t));
  if (pages.length >= 2) return true;
  return types.has('book') && [...types].some((t) => GAME_MEDIA.has(t));
}

/**
 * How a key reads, from a title that carries it: the shortest run of the
 * title's own words that `ipKey` turns into the key, so the case and the
 * punctuation are the title's ("Monster Train", not "monster train").
 */
function labelFor(key: string, titles: string[]): string {
  for (const title of [...titles].sort((a, b) => a.length - b.length)) {
    const words = title.split(/\s+/);
    for (let n = 1; n <= words.length; n++) {
      if (ipKey(words.slice(0, n).join(' ')) === key) return words.slice(0, n).join(' ').replace(/[\s:,;\-–]+$/, '');
    }
  }
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Franchises the catalog does not have yet, proposed from the titles alone.
 * `suggestFranchisesByTitle` only ever joins a title to a franchise that
 * exists, so a book and its film where no provider names a franchise (Dracula,
 * The Green Mile) never met, and TMDB gives no show a franchise at all.
 *
 * Two signals, both measured on the live pool on 2026-10-17:
 * - the same work across media: titles in two or more media whose name, or
 *   the part before a colon, is the same, at least one of them in no franchise;
 * - a series no provider names: a leading run of two or more words that three
 *   or more titles in no franchise begin with (Monster Train, Monster Train 2),
 *   or a run a numbered sequel follows (Fable, Fable II).
 *
 * ⚠️ "In no franchise" counts a hand-made attach, not only the provider's data:
 * half of the first hand-made candidate list was already placed by somebody.
 * A name that already IS a franchise is left to the membership suggestions.
 */
export function suggestNewFranchises(titles: CatalogTitle[], tax: TaxonomyJson, survey = surveyFranchises(titles, tax)): NewFranchiseSuggestion[] {
  const aliases = new Map(tax.ipAliases);
  const known = new Set(survey.map((f) => f.key));
  const isKnown = (key: string) => known.has(key) || known.has(aliases.get(key) ?? key);
  const inFranchises = new Map<string, FranchiseRow[]>();
  for (const f of survey) for (const m of f.members) inFranchises.set(m.mediaItemId, [...(inFranchises.get(m.mediaItemId) ?? []), f]);
  const member = (t: CatalogTitle): NewFranchiseMember => ({
    mediaItemId: t.id, title: t.title, type: t.type, inFranchises: (inFranchises.get(t.id) ?? []).map((f) => f.label),
  });
  const unplaced = (t: CatalogTitle) => !inFranchises.has(t.id);

  const out = new Map<string, NewFranchiseSuggestion>();
  const add = (s: Omit<NewFranchiseSuggestion, 'members'>, list: CatalogTitle[]) => {
    const same = out.get(s.ipKey);
    if (!same) { out.set(s.ipKey, { ...s, members: list.map(member) }); return; }
    const ids = new Set(same.members.map((m) => m.mediaItemId));
    same.members.push(...list.filter((t) => !ids.has(t.id)).map(member));
  };

  // ── The same work across media ──
  const byName = new Map<string, CatalogTitle[]>();
  for (const t of titles) {
    if (!t.title) continue;
    const keys = new Set([ipKey(t.title)]);
    const colon = t.title.indexOf(':');
    if (colon > 0) keys.add(ipKey(t.title.slice(0, colon)));
    for (const key of keys) {
      if (key.length < MIN_EXACT_CHARS) continue;
      const group = byName.get(key);
      if (group) group.push(t); else byName.set(key, [t]);
    }
  }
  for (const [name, group] of byName) {
    if (!isSameWork(new Set(group.map((t) => t.type))) || !group.some(unplaced) || isKnown(name)) continue;
    // Where every title of the group that is placed sits in one franchise
    // together, the rest join that one: the film of Hannibal is in The
    // Hannibal Lecter Collection, so the show goes there, not into a new
    // "Hannibal" beside it.
    const placed = group.filter((t) => !unplaced(t));
    const shared = placed.length
      ? (inFranchises.get(placed[0].id) ?? []).find((f) => placed.every((t) => inFranchises.get(t.id)?.includes(f)))
      : undefined;
    if (shared) {
      add({ ipKey: shared.key, ipLabel: shared.label, signal: 'same-work', joins: true }, group.filter((t) => !shared.members.some((m) => m.mediaItemId === t.id)));
      continue;
    }
    const label = labelFor(name, group.map((t) => t.title));
    const key = ipKey(label);
    if (!key || isKnown(key)) continue;
    add({ ipKey: key, ipLabel: label, signal: 'same-work', joins: false }, group);
  }

  // ── A series no provider names ──
  // Every leading run of words, over titles in no franchise only, with how
  // many real words it holds and whether a title carries a sequel number
  // straight after it.
  const loose = titles.filter((t) => t.title && unplaced(t));
  const byRun = new Map<string, { list: CatalogTitle[]; words: number; named: number; sequel: boolean }>();
  for (const t of loose) {
    const words = ipKey(t.title).split(' ');
    let named = 0;
    for (let n = 1; n <= words.length; n++) {
      if (!FILLER.has(words[n - 1])) named++;
      const run = words.slice(0, n).join(' ');
      // A run never ends on its own number or on the word that counts:
      // "Monster Train 2" is Monster Train's, "The Gallery: Episode" is The Gallery's.
      const last = words[n - 1];
      if (!named || run.length < MIN_EXACT_CHARS || SEQUEL.test(last) || COUNTER.has(last)) continue;
      let entry = byRun.get(run);
      if (!entry) { entry = { list: [], words: n, named, sequel: false }; byRun.set(run, entry); }
      entry.list.push(t);
      if (sequelAt(words, n)) entry.sequel = true;
    }
  }
  // Two ways a run names a series: two real words that three titles begin
  // with, or any run that a numbered sequel follows (Fable and Fable II, Just
  // Cause 2 and Just Cause 3), where two titles are enough.
  const isSeries = (e: { list: CatalogTitle[]; named: number; sequel: boolean }) =>
    (e.named >= 2 && e.list.length >= MIN_SHARED_TITLES) || (e.sequel && e.list.length >= 2);
  // The shortest run first, and a title goes to the first run that takes it:
  // the general name is the franchise, so "Monster Train 2: Destiny of the
  // Railforged" lands in Monster Train and not in a franchise of its own.
  const claimed = new Set<string>();
  const runs = [...byRun.entries()]
    .filter(([, e]) => isSeries(e))
    .sort((a, b) => a[1].words - b[1].words || b[1].list.length - a[1].list.length || a[0].localeCompare(b[0]));
  for (const [run, e] of runs) {
    const free = e.list.filter((t) => !claimed.has(t.id));
    // Twins are not a series: the same title twice is one work from two sources.
    if (!isSeries({ ...e, list: free }) || new Set(free.map((t) => ipKey(t.title))).size < 2) continue;
    const label = labelFor(run, free.map((t) => t.title));
    const key = ipKey(label);
    if (!key || isKnown(key) || isKnown(run)) continue;
    for (const t of free) claimed.add(t.id);
    add({ ipKey: key, ipLabel: label, signal: 'shared-words', joins: false }, free);
  }

  return [...out.values()]
    .map((s) => ({ ...s, members: s.members.sort((a, b) => a.title.localeCompare(b.title) || a.type.localeCompare(b.type)) }))
    .sort((a, b) => Number(a.signal !== 'same-work') - Number(b.signal !== 'same-work') || b.members.length - a.members.length || a.ipLabel.localeCompare(b.ipLabel));
}
