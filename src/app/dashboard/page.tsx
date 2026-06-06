"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EnrichedItem, MediaType, Source } from "@/types";
import { format, parseISO, isToday, isTomorrow, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, getDay, isSameMonth } from "date-fns";

type View = "list" | "card" | "calendar";
type Filter = { types: MediaType[]; sources: Source[] };

const TYPE_COLORS: Record<string, string> = { game: "#4ade80", movie: "#f59e0b", show: "#a78bfa" };
const SOURCE_COLORS: Record<string, string> = { steam: "#1b9af7", rawg: "#4ade80", trakt: "#ed1c24", tmdb: "#01b4e4" };
const SOURCE_LABELS: Record<string, string> = { steam: "Steam", rawg: "RAWG", trakt: "Trakt", tmdb: "TMDB" };

function TypeBadge({ type }: { type: string }) {
  return <span className="text-xs px-1.5 py-0.5 rounded font-medium capitalize" style={{ background: `${TYPE_COLORS[type] ?? "#888"}22`, color: TYPE_COLORS[type] ?? "#888" }}>{type}</span>;
}

function SourcePill({ source }: { source: string }) {
  return (
    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
      style={{ borderColor: `${SOURCE_COLORS[source] ?? "#888"}44`, color: SOURCE_COLORS[source] ?? "#888", background: `${SOURCE_COLORS[source] ?? "#888"}11` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: SOURCE_COLORS[source] ?? "#888" }} />
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}

function SourceDots({ sources }: { sources: string[] }) {
  return (
    <div className="flex items-center gap-1">
      {sources.map((s) => <span key={s} className="w-2 h-2 rounded-full" style={{ background: SOURCE_COLORS[s] ?? "#666" }} title={SOURCE_LABELS[s] ?? s} />)}
    </div>
  );
}

function dateLabel(d: string) {
  const parsed = parseISO(d);
  if (isToday(parsed)) return "Today";
  if (isTomorrow(parsed)) return "Tomorrow";
  return format(parsed, "MMM d, yyyy");
}

function groupByDate(items: EnrichedItem[]) {
  const groups: Record<string, EnrichedItem[]> = {};
  const noDate: EnrichedItem[] = [];
  for (const item of items) {
    if (!item.releaseDate) { noDate.push(item); continue; }
    if (!groups[item.releaseDate]) groups[item.releaseDate] = [];
    groups[item.releaseDate].push(item);
  }
  return { groups, noDate };
}

// ── Tooltip ────────────────────────────────────────────────────────
function Tooltip({ item, anchor }: { item: EnrichedItem; anchor: HTMLElement }) {
  const rect = anchor.getBoundingClientRect();
  const w = 260;
  let left = rect.right + 12;
  if (left + w > window.innerWidth) left = rect.left - w - 12;
  const top = Math.min(rect.top + window.scrollY, window.scrollY + window.innerHeight - 220);
  return (
    <div className="fixed z-50 bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl overflow-hidden pointer-events-none" style={{ top, left, width: w }}>
      {item.posterUrl && <img src={item.posterUrl} alt={item.title} className="w-full h-32 object-cover" />}
      <div className="p-3 space-y-1.5">
        <p className="font-semibold text-sm">{item.title}</p>
        <p className="text-xs text-neutral-400">{item.releaseDate ? format(parseISO(item.releaseDate), "MMM d, yyyy") : "TBA"}</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <TypeBadge type={item.type} />
          <SourceDots sources={item.platformSources} />
        </div>
      </div>
    </div>
  );
}

// ── List Card ──────────────────────────────────────────────────────
function ListCard({ item, onSelect }: { item: EnrichedItem; onSelect: (i: EnrichedItem) => void }) {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <>
      <div ref={ref}
        className="flex items-center gap-3 bg-neutral-900 hover:bg-neutral-800/80 border border-neutral-800 rounded-xl px-4 py-3 transition-colors cursor-pointer group"
        onMouseEnter={() => { timer.current = setTimeout(() => setHovered(true), 350); }}
        onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setHovered(false); }}
        onClick={() => onSelect(item)}>
        <div className="w-16 h-10 rounded overflow-hidden flex-shrink-0 bg-neutral-800">
          {item.posterUrl && <img src={item.posterUrl} alt={item.title} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{item.title}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {item.releaseDate && <span className="text-xs text-neutral-500">{format(parseISO(item.releaseDate), "MMM d, yyyy")}</span>}
            {!item.releaseDate && <span className="text-xs text-neutral-600">TBA</span>}
            {item.dates.length > 1 && <span className="text-xs text-neutral-600">· {item.dates.length} dates</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <TypeBadge type={item.type} />
          <SourceDots sources={item.platformSources} />
        </div>
      </div>
      {hovered && ref.current && <Tooltip item={item} anchor={ref.current} />}
    </>
  );
}

// ── Poster Card ────────────────────────────────────────────────────
function PosterCard({ item, onSelect }: { item: EnrichedItem; onSelect: (i: EnrichedItem) => void }) {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <>
      <div ref={ref}
        className="group cursor-pointer rounded-xl overflow-hidden border border-neutral-800 bg-neutral-900 hover:border-neutral-600 transition-all hover:scale-[1.02]"
        onMouseEnter={() => { timer.current = setTimeout(() => setHovered(true), 350); }}
        onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setHovered(false); }}
        onClick={() => onSelect(item)}>
        <div className="relative w-full bg-neutral-800" style={{ paddingBottom: "56.25%" }}>
          {item.posterUrl
            ? <img src={item.posterUrl} alt={item.title} className="absolute inset-0 w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            : <div className="absolute inset-0 flex items-center justify-center text-neutral-600 text-2xl font-bold">{item.title[0]}</div>}
          <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: TYPE_COLORS[item.type] ?? "#888" }} />
        </div>
        <div className="p-3 space-y-1">
          <p className="font-medium text-sm leading-tight line-clamp-2">{item.title}</p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-neutral-500">{item.releaseDate ? format(parseISO(item.releaseDate), "MMM d, yyyy") : "TBA"}</span>
            <SourceDots sources={item.platformSources} />
          </div>
        </div>
      </div>
      {hovered && ref.current && <Tooltip item={item} anchor={ref.current} />}
    </>
  );
}

// ── Detail Sidebar ─────────────────────────────────────────────────
const SOURCE_COLORS_SIDEBAR: Record<string, string> = { steam: "#1b9af7", rawg: "#4ade80", trakt: "#ed1c24", tmdb: "#01b4e4" };

function DetailSidebar({ item: listItem, onClose, onRemove }: { item: EnrichedItem; onClose: () => void; onRemove: (id: string) => void }) {
  const [item, setItem] = useState<EnrichedItem>(listItem);
  const [loading, setLoading] = useState(true);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [platforms, setPlatforms] = useState<any[]>([]);
  const [platformsLoading, setPlatformsLoading] = useState(true);
  const [platformAction, setPlatformAction] = useState<string | null>(null);

  async function loadPlatformStatus() {
    setPlatformsLoading(true);
    const res = await fetch(`/api/watchlist/status?id=${listItem.id}&type=${listItem.type}`);
    const data = await res.json();
    setPlatforms(data.platforms ?? []);
    setPlatformsLoading(false);
  }

  function buildIdsFromSources(sources: any[]): Record<string, number> {
    const ids: Record<string, number> = {};
    for (const s of sources) {
      if (s.source && s.sourceId && !isNaN(parseInt(s.sourceId))) {
        ids[s.source] = parseInt(s.sourceId);
      }
    }
    return ids;
  }

  async function togglePlatform(provider: string, onList: boolean) {
    setPlatformAction(provider);
    if (onList) {
      await fetch("/api/watchlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaItemId: item.id, source: provider }),
      });
    } else {
      // Build ids from known sources, then add the specific provider we're targeting
      const allIds = buildIdsFromSources(item.sources ?? []);
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: item.type,
          title: item.title,
          releaseDate: item.releaseDate,
          ids: allIds,
          targetProvider: provider, // which platform to specifically write-back to
        }),
      });
    }
    setPlatformAction(null);
    await loadPlatformStatus();
    // If removed from all lists, close and remove from parent
    const statusRes = await fetch(`/api/watchlist/status?id=${listItem.id}&type=${listItem.type}`);
    const statusData = await statusRes.json();
    if (!statusData.onAnyList && onList) {
      onRemove(item.id);
      onClose();
    }
  }

  useEffect(() => {
    setLoading(true); setCarouselIdx(0);
    fetch(`/api/detail?id=${listItem.id}`)
      .then((r) => r.json())
      .then((d) => { if (d.item) setItem(d.item); setLoading(false); })
      .catch(() => setLoading(false));
    loadPlatformStatus();
  }, [listItem.id]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  const imgs = item.images.filter(Boolean);
  const idx = Math.min(carouselIdx, Math.max(0, imgs.length - 1));

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed left-0 top-0 h-full w-full max-w-md bg-neutral-900 border-r border-neutral-800 z-50 overflow-y-auto shadow-2xl flex flex-col" style={{ animation: "slideInLeft 0.2s ease-out" }}>

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 sticky top-0 bg-neutral-900 z-10">
          <button onClick={onClose} className="text-neutral-400 hover:text-white text-sm transition-colors">← Close</button>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <TypeBadge type={item.type} />
            {item.platformSources.map((s) => <SourcePill key={s} source={s} />)}
          </div>
        </div>

        {/* Image carousel */}
        {imgs.length > 0 && (
          <div className="relative group flex-shrink-0">
            <img src={imgs[idx]} alt={item.title} className="w-full object-cover" style={{ maxHeight: 220 }}
              onError={(e) => { if (carouselIdx < imgs.length - 1) setCarouselIdx(carouselIdx + 1); else (e.target as HTMLImageElement).style.display = "none"; }} />
            {imgs.length > 1 && <>
              <button onClick={() => setCarouselIdx((i) => (i - 1 + imgs.length) % imgs.length)}
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white rounded-full w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs">←</button>
              <button onClick={() => setCarouselIdx((i) => (i + 1) % imgs.length)}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white rounded-full w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs">→</button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                {imgs.map((_, i) => <button key={i} onClick={() => setCarouselIdx(i)} className="w-1.5 h-1.5 rounded-full transition-colors" style={{ background: i === idx ? "#fff" : "rgba(255,255,255,0.35)" }} />)}
              </div>
            </>}
          </div>
        )}

        <div className="px-5 pb-8 pt-5 space-y-4 flex-1">
          {loading && <p className="text-neutral-500 text-sm">Loading full details...</p>}

          <h2 className="text-xl font-bold leading-tight">{item.title}</h2>

          {/* Release dates */}
          {item.dates.length > 0 && (
            <div className="space-y-1">
              {item.dates.map((d) => (
                <div key={d.source} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: SOURCE_COLORS[d.source] ?? "#888" }} />
                  <span className="text-neutral-400 text-xs w-12">{SOURCE_LABELS[d.source] ?? d.source}</span>
                  <span className="text-neutral-200">{(() => { try { return format(parseISO(d.date), "MMM d, yyyy"); } catch { return d.date; } })()}</span>
                </div>
              ))}
              {item.dates.length === 0 && !item.releaseDate && <p className="text-neutral-500 text-sm">TBA</p>}
            </div>
          )}

          {/* Scores */}
          {(item.metacritic || item.steamReviewLabel) && (
            <div className="flex items-center gap-3 flex-wrap">
              {item.metacritic && (
                <span className="px-2.5 py-1 rounded-lg text-sm font-bold" style={{ background: item.metacritic >= 75 ? "#166534" : item.metacritic >= 50 ? "#92400e" : "#7f1d1d", color: "#fff" }}>
                  MC {item.metacritic}
                </span>
              )}
              {item.steamReviewLabel && (
                <span className="text-sm text-neutral-300">
                  <span className="text-neutral-500">Steam </span>{item.steamReviewLabel}
                </span>
              )}
            </div>
          )}

          {/* Tags */}
          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((t) => <span key={t} className="text-xs px-2 py-0.5 bg-neutral-800 rounded-full text-neutral-300">{t}</span>)}
            </div>
          )}

          {/* Platforms */}
          {item.platforms.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.platforms.map((p) => <span key={p} className="text-xs px-2 py-0.5 bg-neutral-800/60 border border-neutral-700 rounded-full text-neutral-400">{p}</span>)}
            </div>
          )}

          {/* Description */}
          {item.description && <p className="text-sm text-neutral-300 leading-relaxed">{item.description}</p>}

          {/* Dev/pub */}
          {(item.developer || item.publisher) && (
            <div className="space-y-1 text-sm">
              {item.developer && <p><span className="text-neutral-500">Developer </span><span className="text-neutral-200">{item.developer}</span></p>}
              {item.publisher && item.publisher !== item.developer && <p><span className="text-neutral-500">Publisher </span><span className="text-neutral-200">{item.publisher}</span></p>}
            </div>
          )}

          {/* Trailer */}
          {item.trailerYoutubeKey && (
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Trailer</p>
              <div className="relative w-full rounded-lg overflow-hidden" style={{ paddingBottom: "56.25%" }}>
                <iframe className="absolute inset-0 w-full h-full" src={`https://www.youtube.com/embed/${item.trailerYoutubeKey}?rel=0`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
              </div>
            </div>
          )}
          {!item.trailerYoutubeKey && item.steamTrailerUrl && (
            <a href={item.steamTrailerUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg transition-colors"
              style={{ background: "#1b9af720", color: "#1b9af7" }}>
              Watch trailer on Steam →
            </a>
          )}

          {/* Streaming */}
          {item.streamingProviders.length > 0 && (
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Where to watch</p>
              <div className="flex flex-wrap gap-2">
                {item.streamingProviders.map((p) => (
                  <div key={p.providerId} className="flex items-center gap-1.5 bg-neutral-800 rounded-lg px-2.5 py-1.5">
                    {p.logoPath && <img src={`https://image.tmdb.org/t/p/w45${p.logoPath}`} className="w-5 h-5 rounded" alt={p.name} />}
                    <span className="text-xs">{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Store links */}
          {item.storeLinks.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-3 border-t border-neutral-800">
              {item.storeLinks.map((l) => (
                <a key={l.name} href={l.url} target="_blank" rel="noopener noreferrer"
                  className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                  style={{ background: `${SOURCE_COLORS[l.source] ?? "#888"}18`, color: SOURCE_COLORS[l.source] ?? "#aaa" }}>
                  {l.name} →
                </a>
              ))}
            </div>
          )}

          {/* Wishlist status */}
          <div className="pt-4 border-t border-neutral-800/50 mt-2">
            <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Your wishlists</p>
            {platformsLoading ? (
              <p className="text-xs text-neutral-600">Loading...</p>
            ) : (
              <div className="space-y-2">
                {platforms.map((p: any) => {
                  const color = SOURCE_COLORS_SIDEBAR[p.provider] ?? "#888";
                  return (
                    <div key={p.provider} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                        <span className="text-sm text-neutral-300">{p.label}</span>
                        {p.displayName && (
                          <span className="text-xs text-neutral-600">@{p.displayName}</span>
                        )}
                      </div>
                      {p.notConnected ? (
                        <span className="text-xs text-neutral-600 px-2.5 py-1 rounded-full border border-neutral-800">
                          Not connected
                        </span>
                      ) : p.onList ? (
                        <button
                          onClick={() => togglePlatform(p.provider, true)}
                          disabled={platformAction === p.provider || !p.canWrite}
                          className="text-xs px-2.5 py-1 rounded-full border transition-colors disabled:opacity-40"
                          style={{ borderColor: `${color}44`, color, background: `${color}15` }}
                          title={!p.canWrite ? `${p.label} doesn't support removing via API` : undefined}>
                          {platformAction === p.provider ? "..." : p.canWrite ? "✓ On list – Remove" : "✓ On list"}
                        </button>
                      ) : (
                        <button
                          onClick={() => togglePlatform(p.provider, false)}
                          disabled={platformAction === p.provider || !p.canWrite}
                          className="text-xs px-2.5 py-1 rounded-full border border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-40"
                          title={!p.canWrite ? `${p.label} doesn't support adding via API` : undefined}>
                          {platformAction === p.provider ? "..." : p.canWrite ? "+ Add to list" : "Not on list"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`@keyframes slideInLeft { from { transform: translateX(-100%); } to { transform: translateX(0); } }`}</style>
    </>
  );
}

// ── Search Modal ───────────────────────────────────────────────────
function SearchModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleInput(val: string) {
    setQ(val);
    if (debounce.current) clearTimeout(debounce.current);
    if (val.trim().length < 2) { setResults([]); return; }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      const type = typeFilter === "all" ? "" : `&type=${typeFilter}`;
      const res = await fetch(`/api/search?q=${encodeURIComponent(val)}${type}`);
      const data = await res.json();
      setResults(data.results ?? []);
      setSearching(false);
    }, 400);
  }

  async function addItem(result: any) {
    // result.ids = { rawg?, tmdb?, trakt? } – all known IDs across sources
    const key = result.title + result.type;
    setAdding(key);
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: result.type,
        title: result.title,
        releaseDate: result.releaseDate,
        posterUrl: result.posterUrl,
        ids: result.ids,
      }),
    });
    setAdded((prev) => new Set(prev).add(key));
    setAdding(null);
    onAdded();
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed top-20 left-1/2 -translate-x-1/2 w-full max-w-lg z-50 bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-4 border-b border-neutral-800">
          <div className="flex items-center gap-3 mb-3">
            <input autoFocus type="text" placeholder="Search games, movies, shows..."
              className="flex-1 bg-neutral-800 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              value={q} onChange={(e) => handleInput(e.target.value)} />
            <button onClick={onClose} className="text-neutral-500 hover:text-white text-sm">✕</button>
          </div>
          <div className="flex gap-2">
            {["all", "game", "movie", "show"].map((t) => (
              <button key={t} onClick={() => { setTypeFilter(t); if (q.length >= 2) handleInput(q); }}
                className="text-xs px-2.5 py-1 rounded-full border transition-colors capitalize"
                style={{
                  borderColor: typeFilter === t ? (TYPE_COLORS[t] ?? "#888") : "transparent",
                  background: typeFilter === t ? `${TYPE_COLORS[t] ?? "#888"}15` : "#1a1a1a",
                  color: typeFilter === t ? (TYPE_COLORS[t] ?? "#fff") : "#888",
                }}>
                {t === "all" ? "All" : t + "s"}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {searching && <p className="text-center text-neutral-500 text-sm py-8">Searching...</p>}
          {!searching && results.length === 0 && q.length >= 2 && (
            <p className="text-center text-neutral-500 text-sm py-8">No results</p>
          )}
          {results.map((r) => (
            <div key={`${r.type}-${r.id}`} className="flex items-center gap-3 p-3 hover:bg-neutral-800 transition-colors border-b border-neutral-800/50">
              <div className="w-12 h-8 rounded overflow-hidden flex-shrink-0 bg-neutral-800">
                {r.posterUrl && <img src={r.posterUrl} alt={r.title} className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <TypeBadge type={r.type} />
                  <span className="text-xs text-neutral-500">{r.releaseDate ? format(parseISO(r.releaseDate), "MMM d, yyyy") : "TBA"}</span>
                </div>
              </div>
              {(() => {
                const key = r.title + r.type;
                const isAdded = added.has(key);
                const isAdding = adding === key;
                return (
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {r.foundOn && r.foundOn.length > 0 && (
                      <div className="flex gap-1">
                        {r.foundOn.map((s: string) => (
                          <span key={s} className="text-xs px-1.5 py-0.5 rounded"
                            style={{ background: SOURCE_COLORS[s] ? `${SOURCE_COLORS[s]}20` : "#1a1a1a", color: SOURCE_COLORS[s] ?? "#888" }}>
                            {SOURCE_LABELS[s] ?? s}
                          </span>
                        ))}
                      </div>
                    )}
                    <button onClick={() => addItem(r)} disabled={isAdding || isAdded}
                      className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                      style={{ background: isAdded ? "#1a2e1a" : "#ffffff15", color: isAdded ? "#4ade80" : "#fff" }}>
                      {isAdded ? "Added ✓" : isAdding ? "..." : "+ Add"}
                    </button>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [items, setItems] = useState<EnrichedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [view, setView] = useState<View>("list");
  const [filter, setFilter] = useState<Filter>({ types: [], sources: [] });
  const [calMonth, setCalMonth] = useState(new Date());
  const [selectedItem, setSelectedItem] = useState<EnrichedItem | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => { init(); }, []);

  async function init() {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (!data.user) { router.push("/"); return; }
    setUser(data.user);
    await loadCalendar();
  }

  async function loadCalendar() {
    setLoading(true);
    const res = await fetch("/api/calendar");
    const data = await res.json();
    setItems(data.items ?? []);
    setLoading(false);
  }

  async function sync() {
    setSyncing(true);
    await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "all" }) });
    await loadCalendar();
    setSyncing(false);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  function toggleFilter<T>(arr: T[], val: T): T[] {
    return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
  }

  const filtered = items.filter((item) => {
    if (filter.types.length > 0 && !filter.types.includes(item.type)) return false;
    if (filter.sources.length > 0 && !filter.sources.some((s) => item.platformSources.includes(s))) return false;
    return true;
  });

  const { groups, noDate } = groupByDate(filtered);
  const sortedDates = Object.keys(groups).sort();

  // Side index groups
  const monthGroups: Record<string, string[]> = {};
  for (const d of sortedDates) {
    const key = format(parseISO(d), "MMM yyyy");
    if (!monthGroups[key]) monthGroups[key] = [];
    monthGroups[key].push(d);
  }
  if (noDate.length) monthGroups["TBA"] = ["__nodate__"];

  // Calendar
  const monthStart = startOfMonth(calMonth);
  const monthEnd = endOfMonth(calMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPad = getDay(monthStart);

  return (
    <div className="min-h-screen">
      {selectedItem && <DetailSidebar item={selectedItem} onClose={() => setSelectedItem(null)} onRemove={(id) => setItems((prev) => prev.filter((i) => i.id !== id))} />}
      {showSearch && <SearchModal onClose={() => setShowSearch(false)} onAdded={() => { setShowSearch(false); loadCalendar(); }} />}

      {/* Nav */}
      <nav className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between sticky top-0 bg-neutral-950 z-30">
        <span className="font-bold text-lg">ReleaseRadar</span>
        <div className="flex items-center gap-4">
          <div className="flex bg-neutral-900 rounded-lg p-0.5">
            {(["list", "card", "calendar"] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors capitalize ${view === v ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-white"}`}>
                {v}
              </button>
            ))}
          </div>
          <Link href="/settings" className="text-neutral-400 hover:text-white text-sm">Settings</Link>
          <button onClick={logout} className="text-sm text-neutral-500 hover:text-white">Log out</button>
        </div>
      </nav>

      {/* Sticky filter bar */}
      <div className="sticky top-[65px] z-20 bg-neutral-950 border-b border-neutral-800/50 px-6 py-3">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(["game", "movie", "show"] as MediaType[]).map((t) => (
              <button key={t} onClick={() => setFilter((f) => ({ ...f, types: toggleFilter(f.types, t) }))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors"
                style={{ borderColor: filter.types.includes(t) ? TYPE_COLORS[t] : "transparent", background: filter.types.includes(t) ? `${TYPE_COLORS[t]}15` : "#1a1a1a", color: filter.types.includes(t) ? TYPE_COLORS[t] : "#888" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: TYPE_COLORS[t] }} />
                {t.charAt(0).toUpperCase() + t.slice(1)}s
              </button>
            ))}
            {(["trakt", "steam", "rawg"] as Source[]).map((s) => (
              <button key={s} onClick={() => setFilter((f) => ({ ...f, sources: toggleFilter(f.sources, s) }))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors"
                style={{ borderColor: filter.sources.includes(s) ? SOURCE_COLORS[s] : "transparent", background: filter.sources.includes(s) ? `${SOURCE_COLORS[s]}15` : "#1a1a1a", color: filter.sources.includes(s) ? SOURCE_COLORS[s] : "#888" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: SOURCE_COLORS[s] }} />
                {SOURCE_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowSearch(true)}
              className="text-sm px-4 py-2 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-300 rounded-lg transition-colors">
              + Add
            </button>
            <button onClick={sync} disabled={syncing}
              className="text-sm px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg disabled:opacity-40 transition-colors border border-neutral-700">
              {syncing ? "Syncing..." : "Sync"}
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-6 py-6">
        {loading && <div className="text-center py-20 text-neutral-500">Loading...</div>}

        {!loading && items.length === 0 && (
          <div className="text-center py-20 text-neutral-500">
            <p className="text-lg mb-2">Nothing here yet.</p>
            <p className="text-sm mb-6">Connect your accounts in <Link href="/settings" className="text-white underline">settings</Link> and hit Sync, or use <button onClick={() => setShowSearch(true)} className="text-white underline">Add</button> to search manually.</p>
          </div>
        )}

        {/* ── LIST VIEW ── */}
        {!loading && view === "list" && filtered.length > 0 && (
          <div className="flex gap-4">
            <div className="flex-1 space-y-8 min-w-0">
              {sortedDates.map((dateStr) => (
                <div key={dateStr} ref={(el) => { sectionRefs.current[dateStr] = el; }}>
                  <h2 className="text-sm font-medium text-neutral-400 mb-3 flex items-center gap-2">
                    <span>{dateLabel(dateStr)}</span>
                    <span className="text-neutral-700">{format(parseISO(dateStr), "EEEE")}</span>
                  </h2>
                  <div className="space-y-2">
                    {groups[dateStr].map((item) => <ListCard key={item.id} item={item} onSelect={setSelectedItem} />)}
                  </div>
                </div>
              ))}
              {noDate.length > 0 && (
                <div ref={(el) => { sectionRefs.current["__nodate__"] = el; }}>
                  <h2 className="text-sm font-medium text-neutral-400 mb-3">TBA / No date yet</h2>
                  <div className="space-y-2">
                    {noDate.map((item) => <ListCard key={item.id} item={item} onSelect={setSelectedItem} />)}
                  </div>
                </div>
              )}
            </div>
            {/* Floating side index */}
            {Object.keys(monthGroups).length > 2 && (
              <div className="hidden lg:flex flex-col gap-0.5 sticky top-40 self-start">
                {Object.entries(monthGroups).map(([month, dates]) => (
                  <button key={month} onClick={() => sectionRefs.current[dates[0]]?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    className="text-xs text-neutral-500 hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-neutral-800 text-right whitespace-nowrap">
                    {month}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── CARD VIEW ── */}
        {!loading && view === "card" && filtered.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {[...sortedDates.flatMap((d) => groups[d]), ...noDate].map((item) => (
              <PosterCard key={item.id} item={item} onSelect={setSelectedItem} />
            ))}
          </div>
        )}

        {/* ── CALENDAR VIEW ── */}
        {!loading && view === "calendar" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setCalMonth(subMonths(calMonth, 1))} className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white">←</button>
              <div className="flex items-center gap-3">
                <h2 className="font-medium">{format(calMonth, "MMMM yyyy")}</h2>
                {!isSameMonth(calMonth, new Date()) && (
                  <button onClick={() => setCalMonth(new Date())} className="text-xs px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-full border border-neutral-700 transition-colors">Today</button>
                )}
              </div>
              <button onClick={() => setCalMonth(addMonths(calMonth, 1))} className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white">→</button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="text-center text-xs text-neutral-500 py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} className="h-24 rounded-lg" />)}
              {days.map((day) => {
                const dateStr = format(day, "yyyy-MM-dd");
                const dayItems = groups[dateStr] || [];
                const today = isToday(day);
                const single = dayItems.length === 1 ? dayItems[0] : null;
                return (
                  <div key={day.toISOString()}
                    className="h-24 rounded-lg overflow-hidden relative border-2 transition-colors cursor-pointer"
                    style={{ borderColor: single ? `${TYPE_COLORS[single.type]}55` : today ? "rgba(255,255,255,0.2)" : "rgb(38,38,38)", background: !single ? "rgba(23,23,23,0.3)" : "transparent" }}
                    onClick={() => single && setSelectedItem(single)}>
                    {single && single.posterUrl && (
                      <>
                        <img src={single.posterUrl} alt={single.title} className="absolute inset-0 w-full h-full object-cover opacity-50" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                      </>
                    )}
                    <div className="relative z-10 p-1.5 h-full flex flex-col">
                      <p className={`text-xs mb-1 ${today ? "text-white font-bold" : "text-neutral-400"}`}>{format(day, "d")}</p>
                      {single ? (
                        <div className="flex-1 flex flex-col justify-end">
                          <p className="text-xs font-medium text-white leading-tight truncate drop-shadow">{single.title}</p>
                          <SourceDots sources={single.platformSources} />
                        </div>
                      ) : (
                        <div className="space-y-0.5 overflow-hidden">
                          {dayItems.slice(0, 3).map((item) => (
                            <div key={item.id} className="flex items-center gap-1 text-xs truncate hover:opacity-80"
                              onClick={(e) => { e.stopPropagation(); setSelectedItem(item); }}>
                              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TYPE_COLORS[item.type] }} />
                              <span className="truncate text-neutral-300">{item.title}</span>
                            </div>
                          ))}
                          {dayItems.length > 3 && <p className="text-xs text-neutral-500">+{dayItems.length - 3} more</p>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
