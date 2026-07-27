"use client";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import GroupedView from "@/components/GroupedView";
import Menu from "@/components/ui/Menu";
import { useScrollRestore } from "@/lib/usePersistedState";
import { probeSession } from "@/lib/sessionProbe";
import type { MediaCardItem } from "@/components/cardItem";
import type { PublicFacetPayload, PublicFacetItem, FacetSort } from "@/lib/detail/publicFacetDetail";
import TagAdminControls from "./TagAdminControls";

// P17 — the public, provider-sourced facet page UI. Renders the crowd half from
// the SSR'd first page, then (a) pages deeper / re-sorts via the public
// /api/facet, and (b) layers the logged-in viewer's personal overlay from the
// authed /api/facet/mine — which 401s for anon, so anonymous visitors simply see
// the clean public page with no personal data. `import type` keeps the
// server-only data module out of this client bundle.
//
// Q14 (2026-07-19): the grid is now GroupedView + PosterCard, the SAME
// components Discover/Library/Wishlist use — this used to be a bespoke card +
// flat grid that had drifted from the rest of the app (own aspect ratio, an
// icon in the type bar, no quick-action bar, no dividers/scrubber). The facet
// page keeps its OWN traits Discover doesn't need (community score, person
// roles) via cardItem.ts's optional context-dependent fields.

const SORT_LABELS: { key: FacetSort; label: string }[] = [
  { key: "popular", label: "Most popular" },
  { key: "newest", label: "Newest" },
  { key: "rating", label: "Highest rated" },
];

interface MineState { rating: number | null; libraryStatus: string | null; onWatchlist: boolean }
interface TagImpact { points: number; direction: "up" | "down" | "neutral"; ratedCount: number }
interface Mine {
  stats: { userAvg: number | null; userCount: number; communityAvg: number | null; delta: number | null; baseline: number } | null;
  states: Record<string, MineState>;
  fandexById: Record<string, number>;
  fandexCenter?: number | null;
  tagImpact?: TagImpact | null;
}

interface Props {
  initial: PublicFacetPayload;
  prefix: string;       // "person" | "tag" | "studio" — for /api/facet paging
  kind: string;         // "person" | "tag" | "company" — for /api/facet/mine
  roleLabel: string;    // "Person" | "Tag" | "Studio" — header eyebrow
}

// PublicFacetItem + the personal overlay → the shared card shape.
function toCardItem(item: PublicFacetItem, mine: MineState | undefined, fandexScore: number | undefined, fandexCenter: number | null | undefined): MediaCardItem {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    releaseDate: item.releaseDate,
    posterUrl: item.posterUrl,
    rating: mine?.rating ?? null,
    onWatchlist: mine?.onWatchlist ?? false,
    libraryStatus: mine?.libraryStatus ?? null,
    fandexScore: fandexScore ?? null,
    fandexCenter: fandexCenter ?? null,
    communityScore: item.communityScore,
    roles: item.roles,
    sources: item.sources,
    linkable: item.linkable,
  };
}

const noop = () => {};

export default function PublicFacetView({ initial, prefix, kind, roleLabel }: Props) {
  const [items, setItems] = useState<PublicFacetItem[]>(initial.items);
  const [page, setPage] = useState(initial.page);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [sort, setSort] = useState<FacetSort>(initial.sort);
  // H5.6 — "Fandex Score" is a client-side overlay sort (logged-in only): it
  // re-orders the LOADED pool by the viewer's per-item score from /api/facet/mine.
  // The server sort (`sort`) still drives fetching/paging/URL, so paging keeps
  // working underneath it.
  const [fandexActive, setFandexActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mine, setMine] = useState<Mine | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // Q18 — tag category/bundle can change live via the admin controls below.
  const [tagBundle, setTagBundle] = useState(initial.tagBundle);

  const person = initial.person;

  // ── N1: survive Back ─────────────────────────────────────────────────────────
  // Sort lives in the URL (see onSort) so the SSR re-render after back-nav (or a
  // shared link) already has the right order; the "Load more" depth is mirrored
  // to sessionStorage here, same T12 pattern as the list pages. Restore only when
  // the stored sort matches the SSR'd one — a URL with a different ?sort= means
  // the server content, not the stash, is what the viewer asked for.
  const stashKey = `rr_facet_${prefix}_${initial.key}`;
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(stashKey);
      if (raw != null) {
        const s = JSON.parse(raw) as { sort: FacetSort; page: number; hasMore: boolean; items: PublicFacetItem[] };
        if (s.sort === initial.sort && s.page > initial.page && Array.isArray(s.items)) {
          // sessionStorage is unavailable during SSR, so restoring necessarily
          // sets state in an effect (same justified disable as usePersistedState).
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setItems(s.items);
          setPage(s.page);
          setHasMore(s.hasMore);
        }
      }
    } catch { /* storage unavailable / bad JSON */ }
    setHydrated(true);
  }, [stashKey, initial.sort, initial.page]);

  useEffect(() => {
    if (!hydrated) return;
    try { sessionStorage.setItem(stashKey, JSON.stringify({ sort, page, hasMore, items })); } catch { /* quota */ }
  }, [stashKey, sort, page, hasMore, items, hydrated]);

  useScrollRestore(`rr_facet_scroll_${prefix}_${initial.key}`, hydrated && items.length > 0);

  // Personal overlay — absent for anonymous viewers. SM6: gate on the shared
  // session probe instead of firing the authed endpoint into a guaranteed 401.
  // Q24: send the ids actually rendered so the server can score facet-page
  // items outside the catalog pool (not yet in library/wishlist — exactly the
  // ones worth discovering) directly from their own provider data, not just
  // the pool-based fandexById. Re-fires as more pages load ("Load more"),
  // rescoring the whole set each time — simple, and cheap at facet-page scale.
  useEffect(() => {
    let alive = true;
    const ids = items.filter((it) => it.linkable).map((it) => it.id).join(",");
    probeSession()
      .then((authed) => {
        if (!alive || !authed) return null;
        const qs = ids ? `&ids=${encodeURIComponent(ids)}` : "";
        return fetch(`/api/facet/mine?kind=${encodeURIComponent(kind)}&key=${encodeURIComponent(initial.key)}${qs}`)
          .then((r) => (r.ok ? r.json() : null));
      })
      .then((d: Mine | null) => { if (alive && d) setMine(d); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, initial.key, items.length]);

  const load = useCallback(async (nextPage: number, nextSort: FacetSort, replace: boolean) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/facet?prefix=${encodeURIComponent(prefix)}&key=${encodeURIComponent(initial.key)}&page=${nextPage}&sort=${nextSort}`);
      if (!r.ok) return;
      const d: PublicFacetPayload = await r.json();
      setItems((prev) => (replace ? d.items : [...prev, ...d.items]));
      setPage(d.page);
      setHasMore(d.hasMore);
    } finally {
      setLoading(false);
    }
  }, [prefix, initial.key]);

  // Sort is reflected into the URL (shareable + Back-safe: the SSR after a
  // back-nav reads ?sort=). Native replaceState integrates with the Next router;
  // the default sort keeps a clean param-less canonical URL.
  const onSort = (s: FacetSort) => {
    setFandexActive(false);
    if (s === sort) return;
    setSort(s);
    const url = new URL(window.location.href);
    if (s === "popular") url.searchParams.delete("sort");
    else url.searchParams.set("sort", s);
    window.history.replaceState(null, "", url);
    load(0, s, true);
  };

  // Items as displayed: the Fandex overlay re-sorts the loaded pool by the
  // viewer's per-item score (nulls last); otherwise the server order stands.
  const shownItems = fandexActive && mine
    ? [...items].sort((a, b) => (mine.fandexById[b.id] ?? -1) - (mine.fandexById[a.id] ?? -1))
    : items;

  // Q14: same GroupedView grouping the unified sort model uses elsewhere —
  // "Newest" gets month dividers + a month scrubber, "Highest rated" gets
  // rating buckets, "Most popular" and the Fandex overlay stay flat (no
  // natural date/rating grouping to divide by).
  const cardItems: MediaCardItem[] = shownItems.map((it) => toCardItem(it, mine?.states[it.id], mine?.fandexById[it.id], mine?.fandexCenter));
  const groupBy: "month" | "rating" | "none" = fandexActive ? "none" : sort === "newest" ? "month" : sort === "rating" ? "rating" : "none";
  const ratingOf = (i: MediaCardItem) => (i.communityScore != null ? i.communityScore / 10 : null);

  const s = mine?.stats;
  const deltaTxt = s && s.delta != null
    ? s.delta > 0 ? `You rate ${initial.label} ${s.delta.toFixed(1)} higher than the crowd`
      : s.delta < 0 ? `You rate ${initial.label} ${Math.abs(s.delta).toFixed(1)} lower than the crowd`
      : `You rate ${initial.label} the same as the crowd`
    : null;

  return (
    <div className="min-h-screen bg-surface text-text-primary">
      <main className="max-w-6xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex gap-5">
          {person?.profileUrl && (
            <Image src={person.profileUrl} alt={initial.label} width={112} height={160} className="w-28 h-40 rounded-xl object-cover border border-border shrink-0" />
          )}
          <div className="min-w-0">
            <span className="font-mono text-[11px] uppercase tracking-wide text-text-secondary">{roleLabel}</span>
            <h1 className="font-serif text-serif-2xl text-text-primary">{initial.label}</h1>
            {initial.nameCollision && (
              <p className="text-xs mt-0.5" style={{ color: "var(--color-warning)" }}>
                Multiple people share this name — showing the most well-known match{person?.knownForDepartment ? ` (${person.knownForDepartment})` : ""}.
              </p>
            )}
            {person && (
              <p className="text-sm text-text-secondary mt-0.5">
                {[person.knownForDepartment,
                  person.birthday ? `Born ${person.birthday}${person.age != null ? ` · age ${person.age}${person.deathday ? " at death" : ""}` : ""}` : null,
                  person.placeOfBirth].filter(Boolean).join(" · ")}
              </p>
            )}
            {person?.biography && <p className="text-sm text-text-secondary leading-relaxed mt-2 max-w-3xl line-clamp-4">{person.biography}</p>}
          </div>
        </div>

        {/* Q18 — tag category + bundle membership (tags only) */}
        {prefix === "tag" && (initial.tagCategory || tagBundle) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {initial.tagCategory && (
              <span className="px-2 py-0.5 rounded-full" style={{ background: `${initial.tagCategory.color}22`, color: initial.tagCategory.color }}>
                {initial.tagCategory.label}
              </span>
            )}
            {tagBundle && tagBundle.members.length > 0 && (
              <span className="text-text-secondary">Also known as: {tagBundle.members.join(", ")}</span>
            )}
          </div>
        )}

        {/* Stats — crowd always; you-vs-crowd only when logged in + rated.
            Crowd numbers stay UNCOLORED (H1.6b's restraint rule: crowd rating
            is metadata, not a personal signal — color is reserved for your own
            taste-match). "Your average" is a personal signal, so it gets the
            one accent. */}
        <div className="mt-5 flex flex-wrap gap-3">
          {initial.community.avg != null && (
            <div className="rounded-xl border border-border bg-surface-elevated px-4 py-3">
              <div className="text-2xl font-semibold tabular-nums text-text-primary">{initial.community.avg.toFixed(1)}</div>
              <div className="text-xs text-text-secondary mt-0.5">Crowd average · {initial.community.count} titles</div>
            </div>
          )}
          {prefix === "tag" && initial.bayesCommunityAvg != null && (
            <div className="rounded-xl border border-border bg-surface-elevated px-4 py-3">
              <div className="text-2xl font-semibold tabular-nums text-text-primary">{initial.bayesCommunityAvg.toFixed(1)}</div>
              <div className="text-xs text-text-secondary mt-0.5">Crowd average (Bayesian)</div>
            </div>
          )}
          {s?.userAvg != null && (
            <div className="rounded-xl border border-border bg-surface-elevated px-4 py-3">
              <div className="text-2xl font-semibold tabular-nums text-accent">{s.userAvg.toFixed(1)}</div>
              <div className="text-xs text-text-secondary mt-0.5">Your average · {s.userCount} rated</div>
            </div>
          )}
          <div className="rounded-xl border border-border bg-surface-elevated px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums text-text-primary">{initial.total}</div>
            <div className="text-xs text-text-secondary mt-0.5">Titles</div>
          </div>
        </div>
        {deltaTxt && (
          <p className="text-sm mt-3">
            <span style={{ color: s!.delta! > 0 ? "var(--color-success)" : s!.delta! < 0 ? "var(--color-danger)" : "var(--color-text-secondary)" }}>{deltaTxt}</span>
          </p>
        )}

        {/* Q28 (2026-07-19) — REVERTS Q18's "Your average (Bayesian)" stat: too
            opaque for a non-technical viewer. Plain-language instead: what does
            this tag actually DO to your Fandex Score. */}
        {prefix === "tag" && mine?.tagImpact && (
          <div className="mt-3 flex items-center gap-2.5">
            <span
              className="inline-flex items-center rounded-full px-2.5 py-1 text-sm font-bold tabular-nums"
              style={{
                background: mine.tagImpact.direction === "up" ? "var(--color-success-subtle)" : mine.tagImpact.direction === "down" ? "var(--color-danger-subtle)" : "var(--color-surface-elevated)",
                color: mine.tagImpact.direction === "up" ? "var(--color-success)" : mine.tagImpact.direction === "down" ? "var(--color-danger)" : "var(--color-text-secondary)",
              }}
            >
              Fandex impact {mine.tagImpact.points > 0 ? "+" : ""}{mine.tagImpact.points}
            </span>
            <span className="text-xs text-text-secondary">
              {mine.tagImpact.direction === "up" && "titles with this tag typically score above your average"}
              {mine.tagImpact.direction === "down" && "titles with this tag typically score below your average"}
              {mine.tagImpact.direction === "neutral" && "titles with this tag score about the same as your average"}
              {" · "}{mine.tagImpact.ratedCount} rated
            </span>
          </div>
        )}

        {/* Q18 — admin-only inline taxonomy editor (renders nothing for non-admins) */}
        {prefix === "tag" && (
          <div className="mt-4">
            <TagAdminControls
              tagKey={initial.key}
              currentCategoryId={initial.tagCategory?.id ?? null}
              bundle={tagBundle}
              onBundleChange={setTagBundle}
            />
          </div>
        )}

        {/* Sort — 03-components.md §6b SortMenu dropdown (mockup-vs-live gap,
            resolved 2026-07-27, replacing the Q14 pill-button row here too for
            consistency with SubBar's identical change). */}
        <div className="mt-6 mb-3 flex items-center justify-between">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-text-secondary">Titles</h2>
          <Menu
            label="Sort results"
            items={[
              ...SORT_LABELS.map((o) => ({
                key: o.key,
                label: o.label,
                selected: !fandexActive && sort === o.key,
                onSelect: () => onSort(o.key),
              })),
              ...(mine ? [{ key: "fandexScore", label: "Fandex Score", selected: fandexActive, onSelect: () => setFandexActive(true) }] : []),
            ]}
            align="right"
            trigger={({ onClick, ...triggerProps }) => (
              <button
                {...triggerProps}
                onClick={onClick}
                className="tap-44 inline-flex items-center gap-1 font-mono text-meta text-text-secondary hover:text-text-primary transition-colors"
              >
                {fandexActive ? "Fandex Score" : SORT_LABELS.find((o) => o.key === sort)?.label ?? SORT_LABELS[0].label}
                <ChevronDown className="w-3.5 h-3.5" aria-hidden />
              </button>
            )}
          />
        </div>

        {/* Grid */}
        {cardItems.length === 0 ? (
          <p className="text-sm text-text-secondary py-12 text-center">Nothing found for this {roleLabel.toLowerCase()}.</p>
        ) : (
          <GroupedView
            items={cardItems}
            view="card"
            groupBy={groupBy}
            descending={sort === "newest"}
            ratingOf={groupBy === "rating" ? ratingOf : undefined}
            onSelect={noop}
            autoScrollToToday={false}
          />
        )}

        {hasMore && (
          <div className="mt-6 text-center">
            <button onClick={() => load(page + 1, sort, false)} disabled={loading}
              className="text-sm px-4 py-2 rounded-lg border border-border-strong hover:border-neutral-400 text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50">
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
