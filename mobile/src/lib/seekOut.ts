// What you seek out: the facets you pick far more often than an ordinary
// library would hold, and the rails built from them.
//
// The Fandex Score answers "what would I rate this?", so forty steampunk
// titles move it only as far as their ratings sit above your usual (Nils,
// 2026-11-26: "I love steampunk and nothing on Fandex reflects this"). What
// you CHOOSE is the pull model's question (lib/pullModel.ts,
// docs/fandex-score.md §3.7). This file reads that model for two places that
// are about picking and stand apart from the score: Insights' "What you seek
// out" and the Recommendations page's "Because you seek out …" rails.
//
// The rule a pull row always had holds here: a facet shows only when the model
// weighs it AND the plain count agrees on its direction, so a tag that only
// rides along with another (firefighter, on three anime films) is not shown.
//
// Pure: no database, no React. The provider that fits the model and keeps this
// list is lib/SeekOutProvider.tsx.

import { dayISO } from '@/lib/dailyRotation';
import type { ScoreBand, ScoreFacet } from '~/lib/fandexScore';
import { balanceByType, MAX_WISHLISTED, RAIL_SIZE } from '~/lib/homeFeed';
import { timesAverage, type PullModel } from '~/lib/pullModel';

/**
 * Whether the pull model is fitted for these two places at all. `PULL_SHOWN`
 * (lib/scoreReasons.ts) is a different switch: pull beside the score, on a
 * title's page, which stays off.
 */
export const SEEK_OUT_LIVE = true;

/** Picked less than this many times the average, a facet is a lean, not something you seek out. */
export const MIN_SEEK_TIMES = 1.5;
/** On fewer of your titles than this, a facet is not listed, whatever the model says. */
export const MIN_SEEK_TITLES = 3;

/** One thing you seek out: a tag, a person, a studio or a franchise. */
export interface SeekFacet {
  /** `kind|key`: one entry per person or studio, whatever roles the model weighs them in. */
  id: string;
  kind: ScoreFacet['kind'];
  key: string;
  label: string;
  /** The role the numbers below are of: the one the model weighs most. Absent on a tag. */
  role?: string;
  /** A tag's category, after the taxonomy. */
  category?: string;
  /** The facet id the numbers below are of (`kind|role|key`): the role the model weighs most. */
  mainId: string;
  /** Every facet id of this entry the model weighs (a director who also writes has two): what a title must carry one of. */
  facetIds: string[];
  /** The model's coefficient, natural log: how much more often a title with it is one of your picks, other facets held equal. What the list is ranked by. */
  weight: number;
  /** From the plain counts: how many times more often your picks carry it than the baseline says they would. */
  times: number;
  /** How many of your picks carry it, and in which media. */
  titles: number;
  media: string[];
}

/**
 * Everything the model says you seek out, strongest first. `named` is every
 * facet your picks carry by facet id (`buildPullModelSteps` fills it), which
 * is where a row gets its name.
 */
export function seekFacets(
  model: PullModel, named: ReadonlyMap<string, ScoreFacet>,
  categoryOf: (f: ScoreFacet) => string | undefined = (f) => f.category,
): SeekFacet[] {
  const byEntry = new Map<string, SeekFacet>();
  for (const [facetId, beta] of model.beta) {
    if (beta <= 0) continue;
    const f = named.get(facetId);
    const plain = timesAverage(model, facetId);
    // The model and the plain count must agree, and the count must be worth a sentence.
    if (!f || !plain || plain.times < MIN_SEEK_TIMES || plain.titles < MIN_SEEK_TITLES) continue;
    const id = `${f.kind}|${f.key}`;
    const row: SeekFacet = {
      id, kind: f.kind, key: f.key, label: f.label, mainId: facetId, facetIds: [facetId], weight: beta, times: plain.times, titles: plain.titles, media: [...plain.media].sort(),
      ...(f.kind !== 'tag' && f.kind !== 'ip' && f.role ? { role: f.role } : {}),
      ...(f.kind === 'tag' ? { category: categoryOf(f) } : {}),
    };
    const held = byEntry.get(id);
    if (!held) { byEntry.set(id, row); continue; }
    // One person in two roles is one entry: the stronger role speaks, and a title in either role counts.
    const main = row.weight > held.weight ? row : held;
    byEntry.set(id, { ...main, facetIds: [...held.facetIds, facetId] });
  }
  return [...byEntry.values()].sort((a, b) => b.weight - a.weight || b.titles - a.titles || (a.id < b.id ? -1 : 1));
}

/**
 * The list as the device keeps it between starts, so the two screens open on
 * it without reading a single title. Raise the version with any change to
 * what `seekFacets` lists or a `SeekFacet` holds.
 */
export const SEEK_LIST_VERSION = 1;
export interface SeekList { v: number; facets: SeekFacet[]; picks: number; baseline: number }

const KINDS = new Set(['tag', 'person', 'company', 'ip']);

/** A kept list read back, or null when it is not one (another version, a damaged row). */
export function parseSeekList(v: unknown): SeekList | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<SeekList>;
  if (o.v !== SEEK_LIST_VERSION || typeof o.picks !== 'number' || typeof o.baseline !== 'number' || !Array.isArray(o.facets)) return null;
  const whole = (f: Partial<SeekFacet> | null) => !!f && typeof f.id === 'string' && KINDS.has(f.kind as string) && typeof f.key === 'string' && typeof f.label === 'string' && typeof f.mainId === 'string'
    && Array.isArray(f.facetIds) && f.facetIds.every((x) => typeof x === 'string') && Array.isArray(f.media)
    && typeof f.weight === 'number' && typeof f.times === 'number' && typeof f.titles === 'number';
  return o.facets.every(whole) ? { v: o.v, facets: o.facets, picks: o.picks, baseline: o.baseline } : null;
}

/** The list's other orders: how far above average, and on how many of your titles. */
export type SeekOrder = 'weight' | 'times' | 'titles';

export function sortSeek(list: SeekFacet[], order: SeekOrder): SeekFacet[] {
  if (order === 'weight') return list;
  const value = (f: SeekFacet) => (order === 'times' ? f.times : f.titles);
  return [...list].sort((a, b) => value(b) - value(a) || b.weight - a.weight);
}

/** One of your picks, as a list of your own titles needs it: in your library or only wishlisted, and what you gave it. */
export interface PickState { held: boolean; rating: number | null }

/**
 * Your own titles carrying a thing you seek out, for the rail a tapped row
 * opens: what you rated first, highest first, then the rest of your library,
 * then what you only wishlisted. In any role the entry is weighed in.
 */
export function yourTitles(facet: Pick<SeekFacet, 'facetIds'>, carriers: (facetId: string) => readonly string[], picks: ReadonlyMap<string, PickState>): string[] {
  const ids = new Set<string>();
  for (const facetId of facet.facetIds) for (const id of carriers(facetId)) if (picks.has(id)) ids.add(id);
  const rank = (id: string) => {
    const p = picks.get(id) as PickState;
    return !p.held ? 2 : p.rating == null ? 1 : 0;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b) || (picks.get(b)?.rating ?? 0) - (picks.get(a)?.rating ?? 0) || (a < b ? -1 : 1));
}

// ── The rails ────────────────────────────────────────────────────────────────

/** Fewer titles than this is not a rail. */
export const MIN_SEEK_RAIL = 4;
/** At most this many "Because you seek out" rails on the page. */
export const MAX_SEEK_RAILS = 12;
/** At most this many of them about one kind of thing, when another kind runs short of rails. */
export const MAX_RAILS_PER_KIND = 5;
/**
 * The kinds take turns, in this order: a tag, a person, a studio, a franchise,
 * then the next strongest of each. By weight alone the page was franchises to
 * the last rail: one you have been through whole is the model's surest facet
 * (measured on the public catalog, 2026-11-26: 38 of the 45 strongest), and it
 * is also the rail with the least left to recommend.
 */
const KIND_TURNS: SeekFacet['kind'][] = ['tag', 'person', 'company', 'ip'];

export interface SeekRail<T> { facet: SeekFacet; items: T[] }

/**
 * The page's rails: for each thing you seek out, the titles carrying it that
 * you have not been through. The kinds take turns (`KIND_TURNS`), each giving
 * its strongest facet that still makes a rail.
 *
 * The facet picks, the score gates: a title your Fandex Score puts below your
 * usual is never a recommendation (docs/decisions.md, 2026-10-17), and one the
 * score cannot speak about is left out with it. Within a rail the titles go
 * best match first and each media type gets an even share, as on Home
 * (`balanceByType`), so a tag that is mostly games does not make a rail that
 * is all games. A title sits in the first rail that claims it and in no other.
 */
export function seekRails<T extends { id: string | null; type: string }>(input: {
  facets: SeekFacet[];
  /** The titles carrying a facet id, by catalog id (the facet index, lib/related.ts). */
  carriers: (facetId: string) => readonly string[];
  /** A catalog id's card, when it may be recommended: not in your library, not a DLC or pack. */
  card: (id: string) => T | undefined;
  scoreOf: (id: string) => { score: number; band: ScoreBand } | undefined;
  hidden?: ReadonlySet<string>;
  wishlisted?: ReadonlySet<string>;
  /** The media types on screen. Every type when absent. */
  types?: readonly string[];
  day?: string;
}): SeekRail<T>[] {
  const day = input.day ?? dayISO();
  const taken = new Set<string>();
  /** The rail a facet makes of what no earlier rail took, or null when that is too little to be one. */
  const railOf = (facet: SeekFacet): T[] | null => {
    const seen = new Set<string>();
    const ranked: { card: T; score: number }[] = [];
    for (const facetId of facet.facetIds) {
      for (const id of input.carriers(facetId)) {
        if (seen.has(id) || taken.has(id) || input.hidden?.has(id)) continue;
        seen.add(id);
        const card = input.card(id);
        if (!card || (input.types && !input.types.includes(card.type))) continue;
        const match = input.scoreOf(id);
        if (!match || match.band === 'low') continue;
        ranked.push({ card, score: match.score });
      }
    }
    ranked.sort((a, b) => b.score - a.score);
    // What you already wishlisted may be here, a couple to a rail: confirmation, not the rail (Home's rule).
    let kept = 0;
    const capped = ranked.filter((r) => !(r.card.id && input.wishlisted?.has(r.card.id)) || kept++ < MAX_WISHLISTED).map((r) => r.card);
    const items = balanceByType(capped, RAIL_SIZE, `seek:${facet.id}`, day);
    return items.length < MIN_SEEK_RAIL ? null : items;
  };

  // Each kind's facets in the order given, strongest first.
  const waiting = new Map<string, SeekFacet[]>(KIND_TURNS.map((k) => [k, input.facets.filter((f) => f.kind === k)]));
  const perKind = new Map<string, number>();
  const rails: SeekRail<T>[] = [];
  for (let added = true; added && rails.length < MAX_SEEK_RAILS;) {
    added = false;
    for (const kind of KIND_TURNS) {
      if (rails.length >= MAX_SEEK_RAILS) break;
      if ((perKind.get(kind) ?? 0) >= MAX_RAILS_PER_KIND) continue;
      const queue = waiting.get(kind) as SeekFacet[];
      // This kind's turn: its next facet that makes a rail. One that does not is passed over for good.
      for (let facet = queue.shift(); facet; facet = queue.shift()) {
        const items = railOf(facet);
        if (!items) continue;
        for (const c of items) if (c.id) taken.add(c.id);
        perKind.set(kind, (perKind.get(kind) ?? 0) + 1);
        rails.push({ facet, items });
        added = true;
        break;
      }
    }
  }
  return rails;
}
