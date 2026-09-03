// The taxonomy sweep: what the catalog says is wrong with its own vocabulary.
//
// 2026-09-03 (Nils): "can you do a sweep of all tags and franchises? the goal
// should be to have almost no tag in the 'other' category and franchises cover
// all their items even spinoffs ... build me an easy way to review those
// suggestions and either accept, deny or correct them right away."
//
// ── Nothing here is stored ────────────────────────────────────────────────
//
// Suggestions are recomputed from the live catalog on every load. A stored
// queue would go stale the moment a backfill lane adds a hundred games, and it
// would need invalidating on every write path that touches a tag, an alias or a
// franchise — which is most of them. Recomputing is ~1s on the real catalog and
// the screen is used by one person.
//
// Only the NOs persist (`taxonomy_suggestion_dismissed`, migration 32). An
// accepted suggestion stops generating itself, because the tag is no longer in
// "other" and the franchise is no longer separate. A denied one comes back
// forever unless the denial is written down.
//
// ── Accepting reuses the existing write routes ────────────────────────────
//
// There is no "apply a suggestion" endpoint, deliberately. Accepting a tag
// batch posts to /api/dev/scoring/overrides, a merge posts the same `bundle`
// action the Franchises panel posts, and a membership posts `attach`. Every
// invariant those paths carry (the alias signature folding into discovery's
// cache key, the "a detach is a remove ROW not a delete" rule) keeps holding
// without being restated here, and a suggestion cannot reach a code path that
// review does not already exercise.

import { query, run, get } from "@/lib/db";
import { sharedCache } from "@/lib/boundedCache";
import { getTagVocab } from "@/lib/discovery";
import { getTagCategories, getTagCategoryOverrides } from "@/lib/scoringConfig";
import { categorizeTag } from "@/lib/tags";
import { surveyFranchises, suggestFranchisesByTitle, type FranchiseRow } from "@/lib/ipSurvey";
import { TAG_RULES, ruleFor, type TagRule } from "@/lib/taxonomyRules";

export type SuggestionKind = "tag-category" | "franchise-merge" | "franchise-member";

export interface SuggestedTag { key: string; label: string; count: number }

export interface TagCategorySuggestion {
  kind: "tag-category";
  /** The rule id. Dismissing this rule dismisses the whole group, permanently. */
  ref: string;
  title: string;
  why: string;
  categoryId: string;
  categoryLabel: string;
  /** Set when accepting has to CREATE the category first. */
  createsCategory: { id: string; label: string } | null;
  tags: SuggestedTag[];
  /** Sum of catalog appearances, which is the honest size of the change. */
  itemsAffected: number;
}

export interface FranchiseMergeSuggestion {
  kind: "franchise-merge";
  /** `alias>canonical`. Flipping the direction is a DIFFERENT suggestion, on purpose. */
  ref: string;
  title: string;
  why: string;
  aliasKey: string; aliasLabel: string; aliasSize: number; aliasSample: string[];
  canonicalKey: string; canonicalLabel: string; canonicalSize: number; canonicalSample: string[];
}

export interface FranchiseMemberSuggestion {
  kind: "franchise-member";
  /** `mediaItemId>ipKey`. */
  ref: string;
  title: string;
  why: string;
  mediaItemId: string;
  itemTitle: string;
  itemType: string;
  ipKey: string;
  ipLabel: string;
  /** How many titles the franchise already holds, so a one-member "franchise" is visible as such. */
  franchiseSize: number;
}

export type Suggestion = TagCategorySuggestion | FranchiseMergeSuggestion | FranchiseMemberSuggestion;

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

// ── dismissals ────────────────────────────────────────────────────────────

export function dismissSuggestion(kind: string, ref: string): void {
  run(
    `INSERT INTO taxonomy_suggestion_dismissed (kind, ref, created_at) VALUES (?, ?, strftime('%s','now'))
     ON CONFLICT(kind, ref) DO NOTHING`,
    [kind, ref]
  );
  invalidateSweepCache();
}

export function undismissSuggestion(kind: string, ref: string): void {
  run(`DELETE FROM taxonomy_suggestion_dismissed WHERE kind = ? AND ref = ?`, [kind, ref]);
  invalidateSweepCache();
}

export function listDismissed(): { kind: string; ref: string }[] {
  return query<{ kind: string; ref: string }>(
    `SELECT kind, ref FROM taxonomy_suggestion_dismissed ORDER BY created_at DESC`
  );
}

function dismissedSet(): Set<string> {
  return new Set(listDismissed().map((d) => `${d.kind}|${d.ref}`));
}

// ── tag suggestions ───────────────────────────────────────────────────────

/**
 * Candidates are tags whose EFFECTIVE category is "other" and which carry no
 * override. Two deliberate exclusions:
 *
 *  - An overridden tag is a decision somebody already made. Proposing to move
 *    it again would mean the screen argues with its own history.
 *  - A tag the heuristic already placed is out of scope even when the placement
 *    looks wrong. "Almost no tag in Other" was the ask; re-homing the 525 tags
 *    that ARE placed is a different, much more careful job, and doing it here
 *    would bury the 5,516 under a pile of debatable one-line moves.
 */
function tagSuggestions(dismissed: Set<string>): { list: TagCategorySuggestion[]; otherTotal: number; totalTags: number } {
  const overrides = getTagCategoryOverrides();
  const categories = getTagCategories();
  const byId = new Map(categories.map((c) => [c.id, c.label]));
  const vocab = getTagVocab();

  const byRule = new Map<string, SuggestedTag[]>();
  let otherTotal = 0;
  for (const v of vocab) {
    if (overrides.has(v.key)) continue;
    if (categorizeTag(v.key) !== "other") continue;
    otherTotal++;
    const rule = ruleFor(v.key);
    if (!rule) continue;
    let arr = byRule.get(rule.id);
    if (!arr) { arr = []; byRule.set(rule.id, arr); }
    arr.push({ key: v.key, label: v.label, count: v.count });
  }

  const list: TagCategorySuggestion[] = [];
  for (const rule of TAG_RULES) {
    const tags = byRule.get(rule.id);
    if (!tags?.length) continue;
    if (dismissed.has(`tag-category|${rule.id}`)) continue;
    tags.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    list.push({
      kind: "tag-category",
      ref: rule.id,
      title: rule.title,
      why: rule.why,
      categoryId: rule.category,
      // A rule that creates its category has no live label to read, so it
      // supplies its own. Once accepted, the row exists and this reads it.
      categoryLabel: byId.get(rule.category) ?? rule.creates?.label ?? rule.category,
      createsCategory: byId.has(rule.category) ? null : (rule.creates ?? null),
      tags,
      itemsAffected: tags.reduce((n, t) => n + t.count, 0),
    });
  }

  // Biggest first. `itemsAffected` rather than tag count on purpose: a rule
  // claiming 12 tags that appear 900 times changes more of the site than one
  // claiming 80 tags nobody's catalog carries twice.
  list.sort((a, b) => b.itemsAffected - a.itemsAffected);
  return { list, otherTotal, totalTags: vocab.length };
}

// ── franchise merge suggestions ───────────────────────────────────────────

const ARTICLE = /^(the|a|an) /;
const sample = (f: FranchiseRow) => f.members.slice(0, 6).map((m) => m.title ?? "?");

/**
 * Two franchises the catalog is holding apart that are probably one.
 *
 * ⚠️ `ipKey` ALREADY peels "Collection", "Series", "Saga" and friends, which is
 * why "Star Wars Collection" and IGDB's bare "Star Wars" are one row before
 * this function ever runs. What it does NOT peel is a leading article, so
 * "Terminator" and "The Terminator Collection" are two separate franchises with
 * five members each. That is signal one.
 *
 * Signal two is a word-prefix: "metal gear" against "metal gear solid". It is
 * the one that finds spin-offs, and it is also the one that produces the false
 * positives ("portal" against "portal knights" is two unrelated games), so
 * every suggestion carries sample titles from BOTH sides. Judging it needs the
 * titles, not the names.
 */
function mergeSuggestions(survey: FranchiseRow[], dismissed: Set<string>): FranchiseMergeSuggestion[] {
  const out: FranchiseMergeSuggestion[] = [];
  const seen = new Set<string>();

  const push = (alias: FranchiseRow, canonical: FranchiseRow, why: string) => {
    const ref = `${alias.key}>${canonical.key}`;
    if (seen.has(ref) || dismissed.has(`franchise-merge|${ref}`)) return;
    seen.add(ref);
    out.push({
      kind: "franchise-merge",
      ref,
      title: `${alias.label} → ${canonical.label}`,
      why,
      aliasKey: alias.key, aliasLabel: alias.label, aliasSize: alias.members.length, aliasSample: sample(alias),
      canonicalKey: canonical.key, canonicalLabel: canonical.label, canonicalSize: canonical.members.length, canonicalSample: sample(canonical),
    });
  };

  // Signal one: identical once a leading article is dropped.
  const byStripped = new Map<string, FranchiseRow[]>();
  for (const f of survey) {
    const s = f.key.replace(ARTICLE, "");
    if (!s) continue;
    let arr = byStripped.get(s);
    if (!arr) { arr = []; byStripped.set(s, arr); }
    arr.push(f);
  }
  for (const group of byStripped.values()) {
    if (group.length < 2) continue;
    // Canonical = the bigger one; on a tie, the one WITHOUT the article, since
    // that is the name the other providers use.
    const sorted = [...group].sort(
      (a, b) => b.members.length - a.members.length || Number(ARTICLE.test(a.key)) - Number(ARTICLE.test(b.key))
    );
    const canonical = sorted[0];
    for (const alias of sorted.slice(1)) {
      push(alias, canonical, "The same name with and without a leading article. One of the two providers writes it the other way.");
    }
  }

  // Signal two: one key is a whole-word prefix of the other.
  const MIN_PREFIX_CHARS = 6;
  const keys = survey.map((f) => f.key);
  const byKey = new Map(survey.map((f) => [f.key, f]));
  for (const shortKey of keys) {
    if (shortKey.length < MIN_PREFIX_CHARS) continue;
    for (const longKey of keys) {
      if (longKey === shortKey || !longKey.startsWith(shortKey + " ")) continue;
      const shortRow = byKey.get(shortKey)!;
      const longRow = byKey.get(longKey)!;
      // The general name is the franchise, so the longer one folds INTO it.
      //
      // ⚠️ The message says "begins with the same words as" rather than naming
      // the prefix, because the prefix is a KEY and the card shows LABELS. They
      // routinely differ: ipKey peels TMDB's "Collection", so the real match is
      // "star wars" while the label reads "Star Wars Collection", and a card
      // claiming `"Star Wars: Battlefront" starts with "Star Wars Collection"`
      // is saying something plainly untrue about two names on the same screen.
      push(longRow, shortRow, `"${longRow.label}" begins with the same words as "${shortRow.label}", so it is probably a sub-series rather than a franchise of its own.`);
    }
  }

  // Biggest combined first: a merge of two ten-title franchises is worth
  // looking at before one that tidies away a pair of singletons.
  return out.sort((a, b) => (b.aliasSize + b.canonicalSize) - (a.aliasSize + a.canonicalSize));
}

// ── franchise membership suggestions ──────────────────────────────────────

function memberSuggestions(survey: FranchiseRow[], dismissed: Set<string>): FranchiseMemberSuggestion[] {
  const sizes = new Map(survey.map((f) => [f.key, f.members.length]));
  return suggestFranchisesByTitle()
    .map((s) => ({
      kind: "franchise-member" as const,
      ref: `${s.mediaItemId}>${s.ipKey}`,
      title: `${s.title} → ${s.ipLabel}`,
      why: s.match === "exact"
        ? "The title IS the franchise name, and the item carries no provider franchise data."
        : "The title starts with the franchise name, and the item carries no provider franchise data.",
      mediaItemId: s.mediaItemId,
      itemTitle: s.title,
      itemType: s.type,
      ipKey: s.ipKey,
      ipLabel: s.ipLabel,
      franchiseSize: sizes.get(s.ipKey) ?? 0,
    }))
    .filter((s) => !dismissed.has(`franchise-member|${s.ref}`))
    // Biggest franchise first: attaching a show to a ten-title franchise is
    // worth more than pairing up two singletons, and the big ones are the ones
    // where a missing member is most visible on the item page rail.
    .sort((a, b) => b.franchiseSize - a.franchiseSize || a.itemTitle.localeCompare(b.itemTitle));
}

// ── the sweep ─────────────────────────────────────────────────────────────

// Two whole-catalog scans (surveyFranchises runs again inside
// suggestFranchisesByTitle) plus a vocab pass. Cached because the Review tab
// re-reads after every accept, and a 60s window is well under how long a
// reviewer spends on one card. Named + pinned to globalThis via sharedCache:
// Next resolves a module into a different bundle per route kind, so a
// module-level Map here would be per-bundle rather than per-process.
const sweepCache = sharedCache<string, SweepReport>("taxonomySweep", { max: 1, ttlMs: 60_000 });

export function invalidateSweepCache(): void {
  sweepCache.clear();
}

export function runTaxonomySweep(): SweepReport {
  const cached = sweepCache.get("all");
  if (cached) return cached;

  const dismissed = dismissedSet();
  const survey = surveyFranchises();
  const tags = tagSuggestions(dismissed);

  const suggestions: Suggestion[] = [
    ...tags.list,
    ...mergeSuggestions(survey, dismissed),
    ...memberSuggestions(survey, dismissed),
  ];

  const covered = tags.list.reduce((n, s) => n + s.tags.length, 0);
  const report: SweepReport = {
    suggestions,
    stats: {
      totalTags: tags.totalTags,
      otherTags: tags.otherTotal,
      // What Other would hold if every tag card were accepted. This is the
      // number the ask was about, so it is the one on the screen.
      otherAfterAccepting: tags.otherTotal - covered,
      tagsCovered: covered,
      itemsAffected: tags.list.reduce((n, s) => n + s.itemsAffected, 0),
      franchises: survey.length,
      singletonFranchises: survey.filter((f) => f.members.length === 1).length,
      dismissed: dismissed.size,
    },
  };
  sweepCache.set("all", report);
  return report;
}

/** Whether a media item still exists, so a stale membership ref cannot 500 a route. */
export function itemExists(mediaItemId: string): boolean {
  return !!get<{ id: string }>(`SELECT id FROM media_items WHERE id = ?`, [mediaItemId]);
}

export type { TagRule };
