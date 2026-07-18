"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import NavBar from "@/components/NavBar";
import { useScrollRestore } from "@/lib/usePersistedState";
import { TypeIcon } from "@/components/Badges";
import { TYPE_COLORS } from "@/lib/constants";
import { publicItemHref } from "@/lib/publicUrl";
import type { PublicFacetPayload, PublicFacetItem, FacetSort } from "@/lib/detail/publicFacetDetail";

// P17 — the public, provider-sourced facet page UI. Renders the crowd half from
// the SSR'd first page, then (a) pages deeper / re-sorts via the public
// /api/facet, and (b) layers the logged-in viewer's personal overlay from the
// authed /api/facet/mine — which 401s for anon, so anonymous visitors simply see
// the clean public page with no personal data. `import type` keeps the
// server-only data module out of this client bundle.

const SORT_LABELS: { key: FacetSort; label: string }[] = [
  { key: "popular", label: "Most popular" },
  { key: "newest", label: "Newest" },
  { key: "rating", label: "Highest rated" },
];

interface MineState { rating: number | null; libraryStatus: string | null; onWatchlist: boolean }
interface Mine {
  stats: { userAvg: number | null; userCount: number; communityAvg: number | null; delta: number | null; baseline: number } | null;
  states: Record<string, MineState>;
}

interface Props {
  initial: PublicFacetPayload;
  prefix: string;       // "person" | "tag" | "studio" — for /api/facet paging
  kind: string;         // "person" | "tag" | "company" — for /api/facet/mine
  roleLabel: string;    // "Person" | "Tag" | "Studio" — header eyebrow
}

function ItemCard({ item, mine }: { item: PublicFacetItem; mine?: MineState }) {
  const color = TYPE_COLORS[item.type] ?? "#888";
  const year = item.releaseDate ? item.releaseDate.slice(0, 4) : null;
  const inner = (
    <div className="group rounded-xl border border-neutral-800 bg-neutral-900 hover:border-neutral-600 transition-all overflow-hidden relative">
      <div className="h-1.5" style={{ background: color }} />
      <div className="relative w-full bg-neutral-800" style={{ paddingBottom: "150%" }}>
        {item.posterUrl ? (
          <Image src={item.posterUrl} alt={item.title} fill sizes="(max-width: 768px) 45vw, 200px" className="object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-neutral-600">
            <TypeIcon type={item.type} size={28} /><span className="text-2xl font-bold">{item.title[0]}</span>
          </div>
        )}
        {mine?.rating != null && (
          <span className="absolute top-2 left-2 rounded-md bg-emerald-500/90 px-1.5 py-0.5 text-xs font-semibold text-black tabular-nums">{mine.rating}</span>
        )}
        {mine && mine.rating == null && (mine.libraryStatus || mine.onWatchlist) && (
          <span className="absolute top-2 left-2 rounded-md bg-sky-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-black">{mine.onWatchlist ? "Wishlist" : "Library"}</span>
        )}
        {item.communityScore != null && (
          <span className="absolute top-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums">{(item.communityScore / 10).toFixed(1)}</span>
        )}
      </div>
      <div className="p-2">
        <div className="text-sm font-medium line-clamp-2">{item.title}{year ? <span className="text-neutral-500 font-normal"> ({year})</span> : null}</div>
        {item.roles.length > 0 && <div className="mt-1 text-[11px] text-neutral-500 line-clamp-1">{item.roles.join(", ")}</div>}
      </div>
    </div>
  );
  return item.linkable
    ? <Link href={publicItemHref(item)} className="block">{inner}</Link>
    : <div className="opacity-80" title="Not yet in the catalog">{inner}</div>;
}

export default function PublicFacetView({ initial, prefix, kind, roleLabel }: Props) {
  const [items, setItems] = useState<PublicFacetItem[]>(initial.items);
  const [page, setPage] = useState(initial.page);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [sort, setSort] = useState<FacetSort>(initial.sort);
  const [loading, setLoading] = useState(false);
  const [mine, setMine] = useState<Mine | null>(null);
  const [hydrated, setHydrated] = useState(false);

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

  // Personal overlay — silently absent for anonymous viewers (401).
  useEffect(() => {
    let alive = true;
    fetch(`/api/facet/mine?kind=${encodeURIComponent(kind)}&key=${encodeURIComponent(initial.key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Mine | null) => { if (alive && d) setMine(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [kind, initial.key]);

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
    if (s === sort) return;
    setSort(s);
    const url = new URL(window.location.href);
    if (s === "popular") url.searchParams.delete("sort");
    else url.searchParams.set("sort", s);
    window.history.replaceState(null, "", url);
    load(0, s, true);
  };

  const s = mine?.stats;
  const deltaTxt = s && s.delta != null
    ? s.delta > 0 ? `You rate ${initial.label} ${s.delta.toFixed(1)} higher than the crowd`
      : s.delta < 0 ? `You rate ${initial.label} ${Math.abs(s.delta).toFixed(1)} lower than the crowd`
      : `You rate ${initial.label} the same as the crowd`
    : null;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100">
      <NavBar />
      <main className="max-w-6xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex gap-5">
          {person?.profileUrl && (
            <Image src={person.profileUrl} alt={initial.label} width={112} height={160} className="w-28 h-40 rounded-xl object-cover border border-neutral-800 shrink-0" />
          )}
          <div className="min-w-0">
            <span className="text-[11px] uppercase tracking-wide text-neutral-500">{roleLabel}</span>
            <h1 className="text-2xl font-bold">{initial.label}</h1>
            {person && (
              <p className="text-sm text-neutral-500 mt-0.5">
                {[person.knownForDepartment,
                  person.birthday ? `Born ${person.birthday}${person.age != null ? ` · age ${person.age}${person.deathday ? " at death" : ""}` : ""}` : null,
                  person.placeOfBirth].filter(Boolean).join(" · ")}
              </p>
            )}
            {person?.biography && <p className="text-sm text-neutral-400 leading-relaxed mt-2 max-w-3xl line-clamp-4">{person.biography}</p>}
          </div>
        </div>

        {/* Stats — crowd always; you-vs-crowd only when logged in + rated */}
        <div className="mt-5 flex flex-wrap gap-3">
          {initial.community.avg != null && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
              <div className="text-2xl font-semibold tabular-nums text-sky-400">{initial.community.avg.toFixed(1)}</div>
              <div className="text-xs text-neutral-400 mt-0.5">Crowd average · {initial.community.count} titles</div>
            </div>
          )}
          {s?.userAvg != null && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
              <div className="text-2xl font-semibold tabular-nums text-emerald-400">{s.userAvg.toFixed(1)}</div>
              <div className="text-xs text-neutral-400 mt-0.5">Your average · {s.userCount} rated</div>
            </div>
          )}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums">{initial.total}</div>
            <div className="text-xs text-neutral-400 mt-0.5">Titles</div>
          </div>
        </div>
        {deltaTxt && (
          <p className="text-sm mt-3">
            <span className={s!.delta! > 0 ? "text-emerald-400" : s!.delta! < 0 ? "text-rose-400" : "text-neutral-300"}>{deltaTxt}</span>
          </p>
        )}

        {/* Sort */}
        <div className="mt-6 mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">Titles</h2>
          <div className="flex gap-1">
            {SORT_LABELS.map((o) => (
              <button key={o.key} onClick={() => onSort(o.key)}
                className={`text-xs px-2.5 py-1 rounded-md border ${sort === o.key ? "border-neutral-500 bg-neutral-800 text-white" : "border-neutral-800 text-neutral-400 hover:text-white"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        {items.length === 0 ? (
          <p className="text-sm text-neutral-500 py-12 text-center">Nothing found for this {roleLabel.toLowerCase()}.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {items.map((item) => <ItemCard key={item.id} item={item} mine={mine?.states[item.id]} />)}
          </div>
        )}

        {hasMore && (
          <div className="mt-6 text-center">
            <button onClick={() => load(page + 1, sort, false)} disabled={loading}
              className="text-sm px-4 py-2 rounded-lg border border-neutral-700 hover:border-neutral-500 disabled:opacity-50">
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
