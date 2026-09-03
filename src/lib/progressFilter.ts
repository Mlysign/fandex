// The Progress tab's filter + sort, over episodes.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// The tab renders under the SAME toolbar as Library and Wishlist — type chips,
// search box, sort menu, Filters sheet — and until 2026-08-28 none of it was
// consulted there: MyStuffView returned early for this tab and handed
// ProgressTabPanel no state at all. Four visible controls that did nothing.
//
// It couldn't just reuse the other tabs' pipeline, because that one filters
// TITLES and this list is EPISODES. So the rule is: **every filter applies to
// the SHOW behind the episode**. "Must include steampunk" keeps the episodes of
// steampunk shows; "Available on Netflix" keeps the episodes of shows on
// Netflix. One reading, and the one a person would guess.
//
// ── A LEAF module ───────────────────────────────────────────────────────────
// No `db.ts` anywhere in its import graph — it runs in the browser, alongside
// the very predicates the other tabs use (`passesYearMembership`,
// `matchesPlatforms`, `typeIsVisible`, `sortItems`). Sharing those is the point:
// a filter that means one thing on Library and another on Progress is the
// "one component, two routes" failure with the halves swapped.
//
// The facts each entry carries are attached server-side by lib/upNextFacts.ts.

import type { MediaType, CommunityRating } from "@/types";
import type { FacetPill, MembershipFilters, ProgressSortKey } from "@/components/discovery/types";
import { matchesFacetIds, passesYearMembership } from "@/lib/facetFilter";
import { matchesPlatforms } from "@/lib/platformKeys";
import { typeIsVisible } from "@/lib/mediaTypes";
import { sortItems } from "@/lib/sortItems";

/**
 * One "next episode", plus everything the toolbar needs to filter and sort it.
 *
 * The first block is <EpisodeRow>'s own contract (this satisfies
 * `EpisodeRowEntry` structurally, so the row component needs no change). The
 * second is the SHOW's, and every field in it exists because some control in
 * SubBar reads it — nothing is carried "in case".
 */
export interface ProgressEntry {
  mediaItemId: string;
  showTitle: string;
  posterUrl: string | null;
  season: number;
  episode: number;
  episodeTitle: string | null;
  airDate: string | null;
  href: string;

  /** upNext.ts's sort key: the later of "you finished the one before" and "this aired". */
  eventAt: number | null;

  // ── the show's own facts ──
  /** Always "show" today. Carried anyway, because the type chips filter on it. */
  type: MediaType;
  /** `facetId()` strings — tags, people, companies and franchises alike. */
  facetIds: string[];
  releaseDate: string | null;
  platforms: string[];
  streamingProviders: { name: string }[];
  communityRatings: CommunityRating[];
  fandexScore: number | null;
  libraryStatus: string | null;
  rating: number | null;
  /** WISHLIST providers, the canonical meaning everywhere (userState.ts). */
  platformSources: string[];
  addedAt: number | null;
  /** This viewer hid the show. Present only on this tab; see the filter below. */
  hidden?: boolean;
}

export interface ProgressFilterState {
  /** Already trimmed and lowercased by the caller, which debounces it. */
  q: string;
  types: MediaType[];
  storedTypes: string[] | null;
  includeFacets: FacetPill[];
  excludeFacets: FacetPill[];
  yearRange: [number, number];
  membership: MembershipFilters;
}

/**
 * Everything EXCEPT the platform filter.
 *
 * Split the same way MyStuffView splits the other tabs, and for the same
 * reason: the platform chips count the set they will actually act on, so a chip
 * reading 12 yields exactly 12. Counting the fully filtered set deletes every
 * unpicked platform's chip the moment you pick one.
 */
export function filterProgressEntries(entries: ProgressEntry[], f: ProgressFilterState): ProgressEntry[] {
  return entries.filter((e) => {
    // ⚠️ A hidden show is in this list ONLY so the search box can reach it, so
    // it is dropped unless somebody is actually searching. Nils asked for both
    // halves and they pull in opposite directions: "shows should not show up on
    // the progress feed" AND "i cannot find it on progress when typing it into
    // the searchbox (wrong)". Gating on `f.q` is what satisfies both — the feed
    // is what you get without typing.
    if (e.hidden && !f.q) return false;
    if (!typeIsVisible(e.type, f.types, f.storedTypes)) return false;
    // The SHOW's title, not the episode's. Same rule as every other search box
    // in the app (they all match `item.title`), and an episode-title match would
    // quietly turn a search for "pilot" into twenty unrelated shows.
    if (f.q && !e.showTitle.toLowerCase().includes(f.q)) return false;
    if (!matchesFacetIds(e.facetIds, f.includeFacets, f.excludeFacets)) return false;
    if (!passesYearMembership(e, f.yearRange, f.membership)) return false;
    return true;
  });
}

/** The platform half, applied after the counts above are taken. */
export function filterProgressByPlatform(entries: ProgressEntry[], platforms: string[]): ProgressEntry[] {
  return platforms.length ? entries.filter((e) => matchesPlatforms(e, platforms)) : entries;
}

/**
 * "Up next" is re-derived rather than trusted as arrival order: `sortItems`
 * returns a NEW array, so by the time someone switches back to it the list in
 * hand may be in release-date order. It has to be a sort like the others.
 */
export function sortProgressEntries(entries: ProgressEntry[], sort: ProgressSortKey): ProgressEntry[] {
  if (sort === "upNext") {
    return [...entries].sort((a, b) => (b.eventAt ?? -Infinity) - (a.eventAt ?? -Infinity));
  }
  return sortItems(entries, sort);
}
