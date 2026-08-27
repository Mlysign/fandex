"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useViewMode } from "@/lib/useViewMode";
import type { SearchBarFacets, ViewMode } from "@/components/SubBar";
import SubBar from "@/components/SubBar";
import GroupedView from "@/components/GroupedView";
import FilterPanel from "@/components/discovery/FilterPanel";
import { buildItemHref } from "@/lib/itemUrl";
import { platformOptions, matchesPlatforms } from "@/lib/platformKeys";
import FacetLink from "@/components/FacetLink";
import { usePersistedState, useScrollRestore, hasSavedScroll } from "@/lib/usePersistedState";
import { readBrowseCache, writeBrowseCache } from "@/lib/discoverBrowseCache";
import ErrorBoundary from "@/components/ErrorBoundary";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import Eyebrow from "@/components/ui/Eyebrow";
import type {
  UiFilters, FacetPill, VocabMatch, SortKey, DiscoverItem} from "@/components/discovery/types";
import { defaultUiFilters,
  SORTS, DATE_SORTS, YEAR_MIN, YEAR_MAX, normalizeSort, countActiveAdvanced,
} from "@/components/discovery/types";
import { bayesRating, ratingPrior } from "@/lib/ratingsSort";
import type { MediaType } from "@/types";
import { probeSession } from "@/lib/sessionProbe";

const LIMIT = 60;

// Filters that REQUIRE the local-catalog search (find): facet include/exclude and
// a narrowed year range. Type + membership are deliberately NOT here — they're
// applied to the live UPCOMING browse instead (client-side), so "hide what I own"
// or picking a medium keeps Discover anchored on upcoming releases rather than
// flipping to a whole-catalog date sort that lands on decades-old library titles.
function needsCatalogSearch(f: UiFilters): boolean {
  return (
    f.includeFacets.length > 0 || f.excludeFacets.length > 0 ||
    f.yearRange[0] > YEAR_MIN || f.yearRange[1] < YEAR_MAX
  );
}

// UiFilters → /api/discover/find filter body (only send bounds off their extreme).
function apiFilters(f: UiFilters) {
  const out: Record<string, any> = {
    types: f.types, membership: f.membership,
    includeFacets: f.includeFacets, excludeFacets: f.excludeFacets,
  };
  if (f.yearRange[0] > YEAR_MIN) out.yearMin = f.yearRange[0];
  if (f.yearRange[1] < YEAR_MAX) out.yearMax = f.yearRange[1];
  return out;
}

// Platform score (0-100): local items carry communityAvg; external (facet/web)
// items carry communityScore.
function platformOf(i: any): number | null {
  return i.communityAvg ?? i.communityScore ?? null;
}
function cmpDate(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0; if (!a) return 1; if (!b) return -1; return a.localeCompare(b);
}
// Sort the merged (local + database) result list by the active sort, matching
// the server's find() order. Local items carry communityVotes + fandexScore;
// external (web) items don't, so they sort last under popularity/rating/Fandex.
function sortDiscover(items: any[], sort: SortKey): any[] {
  const arr = [...items];
  const score10 = (i: any) => { const p = platformOf(i); return p == null ? null : p / 10; };
  const votesOf = (i: any) => i.communityVotes ?? 0;
  switch (sort) {
    case "releaseDate": arr.sort((a, b) => cmpDate(b.releaseDate, a.releaseDate)); break;
    case "popularity": arr.sort((a, b) => votesOf(b) - votesOf(a)); break;
    case "rating": {
      const prior = ratingPrior(arr.map((i) => ({ score10: score10(i), votes: votesOf(i) })));
      arr.sort((a, b) => bayesRating(score10(b), votesOf(b), prior) - bayesRating(score10(a), votesOf(a), prior));
      break;
    }
    case "fandexScore": arr.sort((a, b) => (b.fandexScore ?? -1) - (a.fandexScore ?? -1)); break;
    // "addedAt" is a Library-only sort (H1.6f) and is not offered here — the
    // browse feed is live provider data with no per-user added date. It can
    // still ARRIVE via a stale persisted value, so degrade to release date
    // rather than silently returning the list unsorted.
    case "addedAt": arr.sort((a, b) => cmpDate(b.releaseDate, a.releaseDate)); break;
  }
  return arr;
}

// Merge freshly-fetched items into the browse timeline, deduping by id and
// re-sorting by release date (module-scoped: no closure over component state).
function mergeSorted(prev: any[], incoming: any[], prepend: boolean) {
  const seen = new Set(prev.map((i) => i.id));
  const fresh = incoming.filter((i) => !seen.has(i.id));
  const all = prepend ? [...fresh, ...prev] : [...prev, ...fresh];
  return all.sort((a, b) => {
    if (!a.releaseDate && !b.releaseDate) return 0;
    if (!a.releaseDate) return 1;
    if (!b.releaseDate) return -1;
    return a.releaseDate.localeCompare(b.releaseDate);
  });
}

// T7 — the actual network fetch loadDefault() needs, pulled out module-scope
// (no closure over component state) so it can run TWICE: once synchronously
// for a cold load, once in the background to revalidate a warm cache-painted
// one. Same page depth either way — these are server-cached + deterministic
// (see loadDefault's own comment), so a revalidation is expected to mostly
// reproduce the cache, not diverge from it.
async function fetchBrowsePages(
  target: { games: number; movies: number; shows: number },
  targetBack: { games: number; movies: number; shows: number }
): Promise<any[]> {
  const reqs: Promise<any>[] = [fetch("/api/discover").then((r) => r.json())];
  for (const sec of ["games", "movies", "shows"] as const) {
    for (let p = 2; p <= target[sec]; p++) reqs.push(fetch(`/api/discover?section=${sec}&page=${p}`).then((r) => r.json()));
    for (let p = 1; p <= targetBack[sec]; p++) reqs.push(fetch(`/api/discover?section=${sec}&page=${p}&direction=past`).then((r) => r.json()));
  }
  const results = await Promise.all(reqs.map((p) => p.catch(() => ({}))));
  const [base, ...rest] = results;
  let merged: any[] = base.items ?? [];
  for (const d of rest) merged = mergeSorted(merged, d.items ?? [], false);
  return merged;
}

// A5 — typed search groups (Titles / People / Tags). People/Tags are a small
// row of clickable pills above the title results, linking straight to the
// facet page — the same catalog vocab `FacetAutocomplete` already searches
// for the must-include/exclude pills, just surfaced as a result group here
// instead of requiring you to already know that control exists.
function FacetMatchGroup({ title, matches }: { title: string; matches: VocabMatch[] }) {
  if (matches.length === 0) return null;
  return (
    <div className="mb-4">
      <Eyebrow tone="secondary" className="block mb-2">{title}</Eyebrow>
      <div className="flex flex-wrap gap-2">
        {matches.map((m) => (
          <FacetLink
            key={`${m.kind}|${m.role ?? ""}|${m.key}`}
            kind={m.kind as "tag" | "person" | "company"}
            role={m.role}
            label={m.label}
            className="inline-flex items-center gap-1.5 text-label px-3 py-1.5 rounded-full border border-border bg-surface-elevated text-text-primary hover:border-border-strong transition-colors"
          />
        ))}
      </div>
    </div>
  );
}

type Sentinel = { loading: boolean; has: boolean; busy: string; cta: string; end: string; onClick: () => void };

// One end-of-list loader bar (top or bottom of the browse timeline). Module-scoped
// so reading its booleans happens on plain props, not flagged as a ref access in
// the page's render (the sentinel objects close over ref-stored loaders).
function SentinelBar({ loading, has, busy, cta, end, onClick }: Sentinel) {
  return loading ? (
    <span className="text-sm text-text-secondary animate-pulse">{busy}</span>
  ) : has ? (
    <button onClick={onClick} className="text-sm px-6 py-2.5 bg-surface-elevated hover:bg-surface-overlay border border-border-strong text-text-secondary hover:text-text-primary rounded-xl transition-colors">
      {cta}
    </button>
  ) : (
    <span className="text-sm text-text-secondary">{end}</span>
  );
}

export default function DiscoverPageClient() {
  const router = useRouter();
  // Persisted across back-nav (T12).
  const [q, setQ] = usePersistedState("rr_discover_q", "");
  // SM2: the type filter is GLOBAL (shared with Wishlist/Library), so it lives
  // in its own key; `filters` is merged from the rest + the shared types slice.
  // The types stored inside rr_discover_filters are ignored from now on.
  const [types, setTypes] = usePersistedState<MediaType[]>("rr_type_filter", []);
  const [filtersRest, setFilters] = usePersistedState<UiFilters>("rr_discover_filters", defaultUiFilters());
  const filters: UiFilters = { ...filtersRest, types };
  // Default = "popularity" (S2, 2026-07-27): H1.1 locked "Popularity for
  // everyone" as the industry-convention default; H5.7 held it back at
  // "releaseDate" only because a taste/rating sort risked an empty results
  // view for anon. The 4th smoke sweep (2026-07-27) measured Popularity
  // holding a full, genuinely-reordered set for anon, so that blocker is
  // gone. releaseDate stays the newest-first Timeline; Popularity / Rating /
  // Fandex Score (or a query/filter) switch into catalog search results.
  const [sort, setSort] = usePersistedState<SortKey>("rr_discover_sort", "popularity", normalizeSort);
  const [view, setView] = useViewMode("rr_view_discover", "card", ["list", "card", "calendar"]);

  // ── Browse (Timeline) state ──
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [pages, setPages] = useState({ games: 1, movies: 1, shows: 1 });
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [hasMoreBack, setHasMoreBack] = useState(true);
  const [backPages, setBackPages] = useState({ games: 0, movies: 0, shows: 0 });
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const prevScrollHeightRef = useRef(0);
  const pendingPrependRef = useRef(false);
  // Q26 (2026-07-19) — for a non-date sort (Popularity/Rating/Fandex Score),
  // new items can land ANYWHERE in the resorted list, not just at the top —
  // the releaseDate timeline's height-delta prepend trick above assumes a
  // clean prepend, which doesn't hold once the list is resorted by score.
  // Track which item sits at the top of the viewport before a merge, then
  // scroll so that same item lands back in the same spot after — keeps the
  // viewport stable regardless of where the new items actually landed.
  const anchorIdRef = useRef<string | null>(null);
  const anchorOffsetRef = useRef(0);

  // ── Search state ──
  const [searchItems, setSearchItems] = useState<DiscoverItem[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  /**
   * The query the currently-displayed results actually belong to.
   *
   * Gates the "No results" empty state, and the reason is a 300ms hole the
   * other flags cannot cover: the search is DEBOUNCED, and `searchLoading` is
   * only set inside runSearch — i.e. after the debounce fires. So for the first
   * 300ms after a query changes, `searchLoading`, `searchLoadingMore` and
   * `webLoading` are all false while `combined` is still empty, and the empty
   * state renders "No results for X" for a query nothing has searched yet.
   * Measured on /discover 2026-08-17: typing from browse mode showed it within
   * ~216ms, every time. The existing guard covers the WEB phase (`webLoading`),
   * which is why this survived — the hole is strictly before the search starts.
   */
  const [searchedQ, setSearchedQ] = useState<string | null>(null);
  const [webItems, setWebItems] = useState<any[]>([]);   // fresh DB matches (fetch-more)
  const [webLoading, setWebLoading] = useState(false);
  // A5 — typed search groups: People/Tags matching a real text query, shown
  // above the Titles results. Signed-in only (same reason /api/discover/find
  // is skipped for anon above — it's an authed endpoint) so anon gets exactly
  // today's Titles-only behavior, no regression.
  const [peopleMatches, setPeopleMatches] = useState<VocabMatch[]>([]);
  const [tagMatches, setTagMatches] = useState<VocabMatch[]>([]);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Browse = the live infinite timeline (a much wider pool of upcoming releases
  // than the local catalog). Only a text query or a facet/year filter needs the
  // catalog find() search — a plain SORT change does NOT, it just re-orders the
  // same browse set client-side (see browseSorted below). This used to also flip
  // to search mode for any non-releaseDate sort, which silently swapped the wide
  // live pool for the much smaller local-catalog pool — that's what Q16 (2026-07-19)
  // reported as Discover "losing a lot of items" when sorting by popularity.
  const searchActive = q.trim().length >= 2 || needsCatalogSearch(filters);

  // ── Browse loaders ──
  // Declared before the mount effect that calls it (react-hooks: no use-before-declaration).
  async function loadDefault() {
    // N2 (Discover): restore the browse DEPTH from the last visit. The feed
    // pages are server-cached and deterministic, so refetching the same page
    // numbers reproduces the same list — which the saved scroll position
    // (useScrollRestore below) then lands on. Depth is capped so a stale/huge
    // stash can't trigger a fetch storm.
    const CAP = 10;
    let stash: { pages?: typeof pages; backPages?: typeof backPages } = {};
    try { stash = JSON.parse(sessionStorage.getItem("rr_discover_browse") ?? "{}") ?? {}; } catch { /* bad JSON */ }
    const cap = (n: unknown, min: number) => Math.min(CAP, Math.max(min, Number(n) || min));
    const target = { games: cap(stash.pages?.games, 1), movies: cap(stash.pages?.movies, 1), shows: cap(stash.pages?.shows, 1) };
    const targetBack = { games: cap(stash.backPages?.games, 0), movies: cap(stash.backPages?.movies, 0), shows: cap(stash.backPages?.shows, 0) };

    // T7 — a warm cache paints immediately (no spinner, no re-fetch wait), the
    // exact ~1.5s gap the previous plan's T4 traced Discover's late scroll
    // restore to. Written alongside the depth stash, so it always represents
    // this same target/targetBack pair. A cold load (no cache) behaves exactly
    // as before this change: spinner, fetch, then paint once.
    const cached = readBrowseCache();
    if (cached && cached.items.length > 0) {
      setItems(cached.items);
      setPages(target);
      setBackPages(targetBack);
      setHasMore(true);
      setHasMoreBack(true);
      setLoading(false);
      // Revalidate silently in the background — same fetch a cold load would
      // do, just not blocking the paint. On success, re-anchor the viewport
      // (Q26's existing mechanism — see captureAnchor's own comment) before
      // swapping in the fresh data, in case revalidation genuinely differs
      // from what was cached. On failure, keep showing the cached view rather
      // than erroring out from under the visitor.
      fetchBrowsePages(target, targetBack)
        .then((merged) => {
          captureAnchor();
          setItems(merged);
        })
        .catch(() => { /* keep the cache-painted view */ });
      return;
    }

    setLoading(true);
    const merged = await fetchBrowsePages(target, targetBack);
    setItems(merged);
    setPages(target);
    setBackPages(targetBack);
    setHasMore(true);
    setHasMoreBack(true);
    setLoading(false);
  }

  useEffect(() => {
    // H2b — no auth gate. /discover was UI-gated only: it bounced anonymous
    // visitors to "/" even though /api/discover has always supported them
    // (getSession()?.userId ?? null; annotate() returns empty user-state for
    // anon and the region falls back to DEFAULT_COUNTRY).
    //
    // Ungated only NOW, with discover-persists, and not before: every result
    // needed a uuid first. An anonymous browse whose every click dead-ended on
    // an unresolvable url would have been worse than the gate.
    //
    // Initial browse load sets loading state synchronously — expected for a
    // data-fetch-on-mount effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDefault();
  }, []);

  // N2: mirror the browse depth for loadDefault's restore, and save/restore the
  // browse scroll. The today-scroll yields when a restore is pending — same
  // pattern as the wishlist/library pages.
  //
  // T7: the SAME effect also mirrors the items cache — writing both together
  // (one commit, `pages`/`backPages`/`items` as the trigger) keeps the depth
  // stash and the cached items from ever disagreeing about what target they
  // correspond to. Runs after loadMore/loadPrevious/the background
  // revalidation too, not just the initial load, so Back always paints
  // whatever was most recently seen.
  useEffect(() => {
    if (loading) return;
    try { sessionStorage.setItem("rr_discover_browse", JSON.stringify({ pages, backPages })); } catch { /* quota */ }
    writeBrowseCache(items);
  }, [pages, backPages, loading, items]);
  const [autoToday] = useState(() => !hasSavedScroll("rr_discover_scroll"));
  useScrollRestore("rr_discover_scroll", !searchActive && !loading && items.length > 0);

  // Q26: which item currently sits at (or straddles) the top of the viewport,
  // and how far into the viewport it sits — captured right before a merge so
  // the restoring layout effect can put it back in the same spot regardless
  // of where the resort actually placed the new items.
  function captureAnchor() {
    anchorIdRef.current = null;
    for (const el of document.querySelectorAll<HTMLElement>("[data-item-id]")) {
      const r = el.getBoundingClientRect();
      if (r.bottom > 0) {
        anchorIdRef.current = el.dataset.itemId ?? null;
        anchorOffsetRef.current = r.top;
        break;
      }
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore || searchActive) return;
    setLoadingMore(true);
    const next = { games: pages.games + 1, movies: pages.movies + 1, shows: pages.shows + 1 };
    const fetches = await Promise.all([
      fetch(`/api/discover?section=games&page=${next.games}`).then((r) => r.json()),
      fetch(`/api/discover?section=movies&page=${next.movies}`).then((r) => r.json()),
      fetch(`/api/discover?section=shows&page=${next.shows}`).then((r) => r.json()),
    ]);
    const newItems = fetches.flatMap((d) => d.items ?? []);
    if (newItems.length === 0) { setHasMore(false); setLoadingMore(false); return; }
    if (sort === "releaseDate") {
      // Future items render at the TOP when newest-first → anchor the scroll there.
      prevScrollHeightRef.current = document.documentElement.scrollHeight;
      pendingPrependRef.current = true;
    } else {
      // Score sorts can insert new items ANYWHERE in the resorted list — the
      // height-delta trick above assumes a clean prepend, which doesn't hold
      // once the list is resorted (Q26).
      captureAnchor();
    }
    setItems((prev) => mergeSorted(prev, newItems, false));
    setPages(next);
    setLoadingMore(false);
  }

  async function loadPrevious() {
    if (loadingPrev || !hasMoreBack || searchActive) return;
    setLoadingPrev(true);
    const next = { games: backPages.games + 1, movies: backPages.movies + 1, shows: backPages.shows + 1 };
    const fetches = await Promise.all([
      fetch(`/api/discover?section=games&page=${next.games}&direction=past`).then((r) => r.json()),
      fetch(`/api/discover?section=movies&page=${next.movies}&direction=past`).then((r) => r.json()),
      fetch(`/api/discover?section=shows&page=${next.shows}&direction=past`).then((r) => r.json()),
    ]);
    const newItems = fetches.flatMap((d) => d.items ?? []);
    if (newItems.length === 0) { setHasMoreBack(false); setLoadingPrev(false); return; }
    // Past items render at the TOP only when oldest-first → anchor the scroll there.
    // The single date sort (releaseDate) is newest-first, so past items append
    // at the bottom and need no compensation there.
    if (sort !== "releaseDate") {
      // Q26: same anchor-tracking fix as loadMore — this is the path the top
      // sentinel calls for a score sort (scrolling toward the top used to keep
      // queueing more items via the broken height-delta trick, which is why
      // the true top was never reachable).
      captureAnchor();
    }
    setItems((prev) => mergeSorted(prev, newItems, true));
    setBackPages(next);
    setLoadingPrev(false);
  }

  // ── Search loader ──
  async function runSearch(offset: number, append: boolean) {
    // Captured up front: `q` can change again while this is awaiting, and what
    // gates the empty state has to be the query THESE results are for.
    const qUsed = q.trim();
    if (append) setSearchLoadingMore(true);
    else { setSearchLoading(true); setWebItems([]); setPeopleMatches([]); setTagMatches([]); }
    try {
      // SM6: the local-catalog find is an authed endpoint — for anonymous
      // viewers skip straight to the public database results below instead of
      // eating a 401 on every keystroke.
      const authed = await probeSession();
      let localItems: DiscoverItem[] = [];
      if (authed) {
        const res = await fetch("/api/discover/find", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: q.trim(), filters: apiFilters(filters), sort, limit: LIMIT, offset }),
        });
        const d = await res.json();
        localItems = d.items ?? [];
        setSearchTotal(d.total ?? 0);
      } else {
        setSearchTotal(0);
      }
      setSearchItems((prev) => (append ? [...prev, ...localItems] : localItems));
      // Show local results immediately; the DB fetch below populates separately.
      if (append) setSearchLoadingMore(false);
      else { setSearchLoading(false); setSearchedQ(qUsed); }

      // Fetch-more from the external DBs: a text query pulls live title matches;
      // a must-include facet pulls its full external set (e.g. a person's TMDB
      // filmography). Both shown deduped under "More from the databases".
      if (!append) {
        const query = q.trim();

        // A5 — typed groups (People/Tags): a real text query only (not a bare
        // facet/year filter, which isn't something you "typed"), and only for
        // a signed-in viewer — /api/discover/facets is the same authed
        // catalog-vocab search FacetAutocomplete already uses.
        if (authed && query.length >= 2) {
          try {
            const md = await (await fetch(`/api/discover/facets?q=${encodeURIComponent(query)}`)).json();
            const matches: VocabMatch[] = md.matches ?? [];
            setPeopleMatches(matches.filter((m) => m.kind === "person").slice(0, 8));
            setTagMatches(matches.filter((m) => m.kind === "tag").slice(0, 8));
          } catch { /* ignore — Titles results still render */ }
        }

        const wantWeb = query.length >= 2 || filters.includeFacets.length > 0;
        if (!wantWeb) { setWebItems([]); return; }
        setWebLoading(true);
        const extras: any[] = [];
        if (query.length >= 2) {
          const typeParam = filters.types.length === 1 ? `&type=${filters.types[0]}` : "";
          try {
            const wd = await (await fetch(`/api/discover?q=${encodeURIComponent(query)}${typeParam}`)).json();
            extras.push(...(wd.items ?? []));
          } catch { /* ignore */ }
        }
        if (authed && filters.includeFacets.length > 0) {
          try {
            const fd = await (await fetch("/api/discover/facet-fetch", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ facets: filters.includeFacets, types: filters.types, membership: filters.membership }),
            })).json();
            extras.push(...(fd.items ?? []));
          } catch { /* ignore */ }
        }
        setWebItems(extras.length ? dedupeWeb(localItems, extras) : []);
        setWebLoading(false);
      }
    } catch {
      if (!append) { setSearchItems([]); setSearchTotal(0); setWebItems([]); setSearchedQ(qUsed); }
      setSearchLoading(false); setSearchLoadingMore(false); setWebLoading(false);
    }
  }

  // Keys an item is known by — its source ids (`sources[]` or `ids{}`) + title+type.
  function itemKeys(item: any): string[] {
    const ks: string[] = [];
    for (const s of item.sources ?? []) ks.push(`${s.source}:${s.sourceId}`);
    for (const [src, id] of Object.entries(item.ids ?? {})) ks.push(`${src}:${id}`);
    ks.push(`t:${(item.title ?? "").toLowerCase()}:${item.type}`);
    return ks;
  }

  // Drop external matches already present locally; also dedupe within the web set.
  function dedupeWeb(local: DiscoverItem[], web: any[]): any[] {
    const keys = new Set<string>();
    for (const it of local) for (const k of itemKeys(it)) keys.add(k);
    const out: any[] = [];
    for (const w of web) {
      const ks = itemKeys(w);
      if (ks.some((k) => keys.has(k))) continue;
      for (const k of ks) keys.add(k);
      out.push(w);
    }
    return out;
  }

  // Re-run the search (debounced) whenever the query / filters / sort change.
  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    if (!searchActive) return;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => runSearch(0, false), 300);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, filtersKey, searchActive]);

  // ── Browse infinite scroll (disabled while searching) ──
  // Keep refs pointing at the latest closures (assigned in an effect, not during
  // render) so the IntersectionObservers always call the current loaders.
  const loadMoreRef = useRef(loadMore);
  const loadPreviousRef = useRef(loadPrevious);
  // The top/bottom sentinels load by DISPLAY position, which flips with direction:
  // newest-first → top loads future (loadMore), bottom loads past (loadPrevious).
  const topLoadRef = useRef<() => void>(() => {});
  const bottomLoadRef = useRef<() => void>(() => {});
  useEffect(() => {
    loadMoreRef.current = loadMore;
    loadPreviousRef.current = loadPrevious;
    const newestFirst = sort === "releaseDate";
    topLoadRef.current = newestFirst ? loadMore : loadPrevious;
    bottomLoadRef.current = newestFirst ? loadPrevious : loadMore;
  });

  // A DATE sort walks a timeline (two loaders, either direction); every other
  // sort is a ranking (one loader, forward). Declared up here because both the
  // top-sentinel effect and the render read it.
  const isDateSort = DATE_SORTS.includes(sort);

  // Browse filters applied client-side to the live upcoming feed (keeps Discover
  // today-anchored): media type + membership (hide/only library & wishlist) +
  // "available on" (2026-08-27).
  // Everything EXCEPT the platform filter, so the chips can count the set they
  // actually act on (see the note beside platformOpts).
  const beforePlatform = useMemo(() => {
    let r = filters.types.length ? items.filter((i) => filters.types.includes(i.type)) : items;
    const m = filters.membership;
    if (m.library === "exclude") r = r.filter((i) => !i.libraryStatus);
    else if (m.library === "only") r = r.filter((i) => !!i.libraryStatus);
    if (m.wishlist === "exclude") r = r.filter((i) => !i.onWatchlist);
    else if (m.wishlist === "only") r = r.filter((i) => !!i.onWatchlist);
    if (m.rated === "exclude") r = r.filter((i) => i.rating == null);
    else if (m.rated === "only") r = r.filter((i) => i.rating != null);
    return r;
  }, [items, filters.types, filters.membership]);

  const browseFiltered = useMemo(
    () => (filters.platforms?.length ? beforePlatform.filter((i) => matchesPlatforms(i as any, filters.platforms)) : beforePlatform),
    [beforePlatform, filters.platforms]
  );

  // Options + counts from `beforePlatform`: every other filter applied, this one
  // not. Counting the fully filtered set would delete every unpicked platform's
  // chip as soon as you pick one; counting the raw feed would promise a number
  // the type chips have already ruled out.
  const platformOpts = useMemo(() => platformOptions(beforePlatform as any[]), [beforePlatform]);

  // Non-date sorts re-order the SAME browse set client-side instead of switching
  // to catalog search (see the searchActive comment above).
  const browseSorted = useMemo(
    () => (sort === "releaseDate" ? browseFiltered : sortDiscover(browseFiltered, sort)),
    [browseFiltered, sort]
  );

  useEffect(() => {
    if (searchActive) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((e) => { if (e[0].isIntersecting) bottomLoadRef.current(); }, { rootMargin: "600px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading, view, searchActive, browseFiltered.length > 0]);

  useEffect(() => {
    if (searchActive) return;
    const el = topSentinelRef.current;
    // Null under a non-date sort: there is no top sentinel to observe, and
    // wiring one up anyway is what auto-prepended on load and shoved the header
    // off screen. `isDateSort` is in the deps so switching sorts re-runs this.
    if (!el || !isDateSort) return;
    const obs = new IntersectionObserver((e) => { if (e[0].isIntersecting) topLoadRef.current(); }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading, view, searchActive, isDateSort, browseFiltered.length > 0]);

  useLayoutEffect(() => {
    if (!pendingPrependRef.current) return;
    const delta = document.documentElement.scrollHeight - prevScrollHeightRef.current;
    if (delta > 0) window.scrollBy(0, delta);
    pendingPrependRef.current = false;
  }, [items]);

  // Q26: restore the anchor item captured before the merge (non-date sorts) to
  // its pre-merge viewport offset, wherever it ended up after the resort.
  useLayoutEffect(() => {
    const id = anchorIdRef.current;
    if (!id) return;
    anchorIdRef.current = null;
    const el = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const delta = el.getBoundingClientRect().top - anchorOffsetRef.current;
    if (delta !== 0) window.scrollBy(0, delta);
  }, [items, sort]);

  // Q26: jump to the top when switching to a score/rating sort, so the #1
  // item for the NEW sort is what you actually see first — previously the
  // page kept whatever scroll depth releaseDate had left it at, and the top
  // sentinel's own scroll-triggered loading (see loadPrevious) meant
  // scrolling up from there could never actually reach true position 0.
  const prevSortRef = useRef(sort);
  useEffect(() => {
    if (prevSortRef.current !== sort && sort !== "releaseDate") window.scrollTo(0, 0);
    prevSortRef.current = sort;
  }, [sort]);

  // (`handleCalendarMonth` lived here — it paged the browse feed as the
  // calendar view scrolled between months. Deleted 2026-07-27 with Discover's
  // calendar view; `/calendar` has its own paging.)

  // ── Filter mutators ──
  function toggleType(t: string) {
    setTypes((prev) => (prev.includes(t as MediaType) ? prev.filter((x) => x !== t) : [...prev, t as MediaType]));
  }
  // A `types` patch (if a caller ever sends one) goes to the shared key, the
  // rest to this page's own filters.
  function patchFilters(patch: Partial<UiFilters>) {
    const { types: patchTypes, ...rest } = patch;
    if (patchTypes) setTypes(patchTypes as MediaType[]);
    if (Object.keys(rest).length) setFilters((f) => ({ ...f, ...rest }));
  }
  function resetFilters() { setFilters(defaultUiFilters()); setTypes([]); setQ(""); }

  // Must-include / exclude facets for the shared SearchBar.
  const searchFacets: SearchBarFacets = {
    include: filters.includeFacets,
    exclude: filters.excludeFacets,
    onAdd: (key, m: VocabMatch) => {
      const arrKey = key === "include" ? "includeFacets" : "excludeFacets";
      const pill: FacetPill = { kind: m.kind, role: m.role, key: m.key, label: m.label };
      setFilters((f) => (f[arrKey].some((x) => x.kind === pill.kind && x.role === pill.role && x.key === pill.key) ? f : { ...f, [arrKey]: [...f[arrKey], pill] }));
    },
    onRemove: (key, i) => {
      const arrKey = key === "include" ? "includeFacets" : "excludeFacets";
      setFilters((f) => ({ ...f, [arrKey]: f[arrKey].filter((_, idx) => idx !== i) }));
    },
  };

  // find() already constrains by type, so search results need no extra filter.
  // Merge local results + database fetch-more into ONE list, sorted by the active sort.
  const combined = sortDiscover([...searchItems, ...webItems], sort);

  // Sort-driven layout (T8): rating sorts group by rating, best-match is flat,
  // date sorts keep the month timeline; calendar view is only for date sorts.
  const groupBy: "month" | "rating" | "none" =
    sort === "rating" ? "rating" : sort === "releaseDate" ? "month" : "none";
  const descending = sort === "releaseDate";
  const ratingOf =
    sort === "rating" ? (i: any) => { const p = platformOf(i); return p != null ? p / 10 : null; }
    : undefined;
  // 2026-07-27 (Nils): Discover is GRID-ONLY. The mockups show a 2-up card
  // grid on every list page and no view switcher anywhere; list and calendar
  // views are gone from here (Calendar keeps its own `/calendar` route, which
  // is the IA's home for the month/agenda views). A single-entry
  // `availableViews` makes SubBar drop the toggle entirely.
  const availableViews: ViewMode[] = ["card"];
  const effView: ViewMode = "card";

  // Browse timeline sentinels — top/bottom map to past/future by sort direction.
  // ── Which loaders the timeline gets, and why only a DATE sort gets two ────
  //
  // Nils, 2026-08-27: "load earlier releases makes no sense when sorted by
  // popularity", and "on loading the search page the header bar disappears".
  // Both are this. The pair of sentinels models a TIMELINE — you are somewhere
  // in a run of dates and can walk either way — which is only true under a date
  // sort. Under popularity or rating the list is a ranking, so a control at the
  // top offering "earlier releases" describes nothing on screen.
  //
  // The header bug is the same fault. The top sentinel renders at scroll 0 with
  // `rootMargin: "200px"`, so its observer fires immediately on a cold load,
  // `loadPrevious()` prepends, and the layout effect below scrolls by the height
  // delta to hold position — pushing the page down under someone who never
  // asked. That scroll compensation is CORRECT for a user-initiated prepend; the
  // bug was that a non-date sort had a top sentinel to trip over at all.
  // ⚠️ It only reproduces on a COLD browse cache (measured scrollY 21 on a first
  // load, 0 on every warm reload, because loadPrevious then returns nothing), so
  // do not "verify" it on a second reload and conclude it is gone.
  //
  // Non-date sorts keep ONE bottom loader with neutral copy: the feed still
  // pages, it just pages forward through a ranking rather than through time.
  const futureSentinel = { loading: loadingMore, has: hasMore, busy: "Loading newer releases…", cta: "Load newer releases", end: "No newer releases", onClick: () => loadMore() };
  const pastSentinel = { loading: loadingPrev, has: hasMoreBack, busy: "Loading earlier releases…", cta: "Load earlier releases", end: "No earlier releases", onClick: () => loadPrevious() };
  const rankedSentinel = { loading: loadingMore, has: hasMore, busy: "Loading more…", cta: "Load more", end: "That's everything we have", onClick: () => loadMore() };
  const topSentinel = isDateSort ? (descending ? futureSentinel : pastSentinel) : null;
  const bottomSentinel = isDateSort ? (descending ? pastSentinel : futureSentinel) : rankedSentinel;

  return (
    <div className="min-h-screen">
      {/* No visible headline on any list page (2026-07-28) — Discover never had
          one; this is just the sr-only outline the others now also carry. */}
      <h1 className="sr-only">Discover</h1>
      <SubBar
        activeTypes={filters.types}
        onToggleType={toggleType}
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder="Search games, movies, shows…"
        searchFacets={searchFacets}
        sort={{ value: sort, onChange: (v) => setSort(v as SortKey), options: SORTS }}
        advancedFilters={<FilterPanel filters={filters} onChange={patchFilters} platformOptions={platformOpts} />}
        advancedActiveCount={countActiveAdvanced(filters)}
        onResetFilters={resetFilters}
        view={effView}
        onViewChange={setView}
        availableViews={availableViews}
        /* SM20 (2026-07-28): this used to read searchTotal while searching —
           the LOCAL-catalog match count from /api/discover/find — but the
           grid renders combined (local + external database results), so it
           could read "TITLES · 1" over 17 rendered cards. There's no single
           number that spans both sources and also equals what's on screen,
           so drop the count entirely while a search is active; "Load more
           (N left)" below already communicates more local results exist. */
        resultCount={searchActive ? null : browseSorted.length}
      />

      <main className="max-w-6xl mx-auto px-6 py-6">
        {/* ── Search results ── */}
        {searchActive ? (
          <ErrorBoundary label="discover search">
            {searchLoading && <Spinner label="Searching…" />}

            {/* A5 — People/Tags groups, shown above the Titles results whenever
                a real text query matched the catalog vocab. */}
            {!searchLoading && (
              <>
                <FacetMatchGroup title="People" matches={peopleMatches} />
                <FacetMatchGroup title="Tags" matches={tagMatches} />
              </>
            )}

            {!searchLoading && combined.length === 0 && peopleMatches.length === 0 && tagMatches.length === 0 && webLoading && (
              <Spinner label="Searching the databases…" />
            )}

            {/* `searchedQ === q.trim()` is the debounce-window guard — without it
                this renders "No results for X" for the 300ms before the search
                even starts. See searchedQ's declaration for the measurement. */}
            {!searchLoading && !webLoading && searchedQ === q.trim() && combined.length === 0 && peopleMatches.length === 0 && tagMatches.length === 0 && (
              <EmptyState
                title={<>No results{q.trim() ? <> for &ldquo;<span className="text-text-primary">{q}</span>&rdquo;</> : " with these filters"}</>}
                actions={<Button variant="ghost" onClick={resetFilters}>Clear search &amp; filters</Button>}
              />
            )}

            {!searchLoading && combined.length > 0 && (
              <>
                {(peopleMatches.length > 0 || tagMatches.length > 0) && (
                  <Eyebrow tone="secondary" className="block mb-2">Titles</Eyebrow>
                )}
                <GroupedView items={combined as any} view={effView} groupBy={groupBy} descending={descending} ratingOf={ratingOf} onSelect={(i) => router.push(buildItemHref(i as any))} />
                {webLoading && <div className="text-center text-xs text-text-secondary animate-pulse pt-5">Pulling more from the databases…</div>}
                {searchItems.length < searchTotal && (
                  <div className="flex justify-center pt-6">
                    <Button variant="secondary" size="md" onClick={() => runSearch(searchItems.length, true)} disabled={searchLoadingMore} className="px-6 py-2.5">
                      {searchLoadingMore ? "Loading…" : `Load more (${(searchTotal - searchItems.length).toLocaleString()} left)`}
                    </Button>
                  </div>
                )}
              </>
            )}
          </ErrorBoundary>
        ) : (
          /* ── Browse (Timeline) ── */
          <ErrorBoundary label="discover browse">
            {loading && <Spinner label="Loading…" />}

            {!loading && browseSorted.length > 0 && (
              <>
                {topSentinel && (
                  <div ref={topSentinelRef} className="mb-6 flex justify-center">
                    <SentinelBar {...topSentinel} />
                  </div>
                )}

                <GroupedView items={browseSorted} view={effView} groupBy={groupBy} descending={descending} ratingOf={ratingOf} onSelect={(i) => router.push(buildItemHref(i as any))} autoScrollToToday={isDateSort && autoToday} />

                <div ref={sentinelRef} className="mt-10 flex justify-center">
                  <SentinelBar {...bottomSentinel} />
                </div>
              </>
            )}
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
