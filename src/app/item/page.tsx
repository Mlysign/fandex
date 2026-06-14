"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { EnrichedItem, MediaType } from "@/types";
import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/constants";
import NavBar from "@/components/NavBar";
import { TypeBadge, SourcePill } from "@/components/Badges";
import FacetLink from "@/components/FacetLink";
import { catalogForType } from "@/lib/sources/catalog";

const SOURCE_PARAM_KEYS = ["rawgId", "tmdbId", "traktId", "steamId", "letterboxdId"] as const;

function fmtDate(d: string) {
  try { return format(parseISO(d), "MMM d, yyyy"); } catch { return d; }
}

const fmtScore = (r: number) => (r % 1 === 0 ? String(r) : r.toFixed(1));

function fmtRuntime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}


// A single community/critic score, formatted by its scale.
function ScoreBadge({ r }: { r: { source: string; label: string; score: number; outOf: number; votes?: number | null; url?: string | null } }) {
  const color = SOURCE_COLORS[r.source] ?? "#888";
  const text =
    r.outOf === 100 ? `${Math.round(r.score)}${r.source === "rt" || r.source === "steam" ? "%" : ""}`
    : r.outOf === 5 ? `${r.score.toFixed(1)}/5`
    : `${fmtScore(r.score)}`;
  const inner = (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-semibold"
      style={{ background: color + "1f", color }}
      title={r.votes ? `${r.label} — ${r.votes.toLocaleString()} votes` : r.label}>
      <span className="text-[10px] uppercase tracking-wide opacity-80 font-bold">{r.label}</span>
      {text}
    </span>
  );
  return r.url
    ? <a href={r.url} target="_blank" rel="noopener noreferrer">{inner}</a>
    : inner;
}

// One labelled fact in the facts grid.
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="text-sm text-neutral-200 truncate">{children}</p>
    </div>
  );
}

// "Trakt 3 · TMDB 8" — for the rating tooltip.
function ratingsTooltip(ratings: { source: string; rating: number }[]): string | undefined {
  if (!ratings?.length) return undefined;
  return ratings.map((r) => `${SOURCE_LABELS[r.source] ?? r.source} ${fmtScore(r.rating)}`).join("  ·  ");
}

// Per-platform rating chips shown under the stars.
function RatingsBreakdown({ ratings }: { ratings: { source: string; rating: number }[] }) {
  if (!ratings || ratings.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
      {ratings.map((r) => (
        <span key={r.source} className="inline-flex items-center gap-1 text-xs">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: SOURCE_COLORS[r.source] ?? "#888" }} />
          <span className="text-neutral-400">{SOURCE_LABELS[r.source] ?? r.source}</span>
          <span className="text-neutral-200 font-medium">{fmtScore(r.rating)}</span>
        </span>
      ))}
    </div>
  );
}

function ItemInspector() {
  const router = useRouter();
  const sp = useSearchParams();

  const id = sp.get("id");
  const type = (sp.get("type") ?? "game") as MediaType;
  const title = sp.get("title");
  const posterUrl = sp.get("posterUrl");

  const [enriched, setEnriched] = useState<EnrichedItem | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [platforms, setPlatforms] = useState<any[]>([]);
  const [platformsLoading, setPlatformsLoading] = useState(true);
  const [platformAction, setPlatformAction] = useState<string | null>(null);
  const [resolvedMediaItemId, setResolvedMediaItemId] = useState<string | null>(null);
  const [userIdentities, setUserIdentities] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [ratingAction, setRatingAction] = useState(false);
  // Bumping this re-runs the load effect (manual "resync from providers").
  const [reloadKey, setReloadKey] = useState(0);

  // The detail/refresh APIs accept id + type + title + per-source ids. Forward
  // exactly those from the current URL — both endpoints ignore extras.
  function detailParams() {
    const p = new URLSearchParams();
    if (id) p.set("id", id);
    p.set("type", type);
    if (title) p.set("title", title);
    for (const k of SOURCE_PARAM_KEYS) {
      const v = sp.get(k);
      if (v) p.set(k, v);
    }
    return p;
  }

  function buildFallbackPlatforms() {
    const connected = new Set(userIdentities.map((i: any) => i.provider));
    return catalogForType(type).map((m) => ({
      provider: m.id,
      label: m.label,
      displayName: userIdentities.find((i: any) => i.provider === m.id)?.display_name ?? null,
      canWrite: m.capabilities.wishlist.write,
      onList: false,
      notConnected: !connected.has(m.id),
    }));
  }

  async function loadDetail(): Promise<any> {
    try {
      const res = await fetch(`/api/detail?${detailParams()}`);
      if (res.status === 401) { router.push("/"); return {}; }
      const data = await res.json();
      if (data.item) setEnriched(data.item);
      else if (data.error) setNotFound(true);
      setPlatforms(data.platforms ?? buildFallbackPlatforms());
      if (data.resolvedMediaItemId) setResolvedMediaItemId(data.resolvedMediaItemId);
      return data;
    } catch {
      setPlatforms(buildFallbackPlatforms());
      return {};
    }
  }

  useEffect(() => {
    // Identities power the fallback platform list if the detail fetch fails.
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) { router.push("/"); return; }
        setUserIdentities(d.identities ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) { setLoading(false); setNotFound(true); return; }
    let aborted = false;
    const controller = new AbortController();
    setLoading(true);
    setPlatformsLoading(true);
    setCarouselIdx(0);
    setNotFound(false);
    setResolvedMediaItemId(null);
    setEnriched(null);

    (async () => {
      await loadDetail();
      if (aborted) return;
      setLoading(false);
      setPlatformsLoading(false);

      setRefreshing(true);
      try {
        const res = await fetch(`/api/detail/refresh?${detailParams()}`, { method: "POST", signal: controller.signal });
        const data = await res.json();
        if (aborted) return;
        if (data.platforms) setPlatforms(data.platforms);
        if (data.resolvedMediaItemId) setResolvedMediaItemId(data.resolvedMediaItemId);
        setEnriched((prev) => prev ? {
          ...prev,
          rating:        data.library?.rating ?? null,
          ratings:       data.library?.ratings ?? [],
          review:        data.library?.review ?? null,
          reviewedAt:    data.library?.reviewedAt ?? null,
          libraryStatus: data.library?.libraryStatus ?? null,
        } : prev);
      } catch { /* aborted or failed — keep DB state */ }
      finally { if (!aborted) setRefreshing(false); }
    })();

    return () => { aborted = true; controller.abort(); };
  }, [id, reloadKey]);

  function buildIdsFromSources(sources: any[]): Record<string, number> {
    const ids: Record<string, number> = {};
    for (const s of sources) {
      if (s.source && s.sourceId && !isNaN(parseInt(s.sourceId))) ids[s.source] = parseInt(s.sourceId);
    }
    return ids;
  }

  function idsFromParams(): Record<string, number> {
    const ids: Record<string, number> = {};
    const map: Record<string, string> = { rawgId: "rawg", tmdbId: "tmdb", traktId: "trakt", steamId: "steam", letterboxdId: "letterboxd" };
    for (const [param, source] of Object.entries(map)) {
      const v = sp.get(param);
      if (v && !isNaN(parseInt(v))) ids[source] = parseInt(v);
    }
    return ids;
  }

  async function togglePlatform(provider: string, onList: boolean) {
    setPlatformAction(provider);
    const mediaItemId = resolvedMediaItemId ?? enriched?.id ?? id;

    if (onList) {
      await fetch("/api/watchlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaItemId, source: provider }),
      });
      await loadDetail();
    } else {
      const ids = enriched?.sources?.length ? buildIdsFromSources(enriched.sources) : idsFromParams();
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          title: enriched?.title ?? title,
          releaseDate: enriched?.releaseDate ?? null,
          ids,
          targetProvider: provider,
        }),
      });
      await loadDetail();
    }
    setPlatformAction(null);
  }

  // Body for /api/library: target an existing DB item by id, else send the item's
  // identity so the server creates it on the fly (rating a discover item).
  function libraryBody(extra: Record<string, any>) {
    if (resolvedMediaItemId) return { mediaItemId: resolvedMediaItemId, ...extra };
    const ids = enriched?.sources?.length ? buildIdsFromSources(enriched.sources) : idsFromParams();
    return { type, title: enriched?.title ?? title, releaseDate: enriched?.releaseDate ?? null, posterUrl, ids, ...extra };
  }

  async function handleRate(newRating: number | null) {
    setRatingAction(true);
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(libraryBody({ rating: newRating })),
      });
      const data = await res.json().catch(() => ({}));
      if (data.mediaItemId && !resolvedMediaItemId) setResolvedMediaItemId(data.mediaItemId);
      const nowSec = Math.floor(Date.now() / 1000);
      setEnriched((prev) => prev ? {
        ...prev,
        // The server pushes to every connected platform and returns the new
        // average + per-platform breakdown.
        rating: data.rating ?? newRating,
        ratings: data.ratings ?? prev.ratings ?? [],
        reviewedAt: prev.reviewedAt ?? nowSec,
        libraryStatus: prev.libraryStatus ?? (newRating != null ? (type === "game" ? "played" : "watched") : null),
      } : prev);
    } catch (e) {
      console.error("Failed to rate:", e);
    } finally {
      setRatingAction(false);
    }
  }

  async function handleMarkWatched() {
    const status = type === "game" ? "played" : "watched";
    setRatingAction(true);
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(libraryBody({ status })),
      });
      const data = await res.json().catch(() => ({}));
      if (data.mediaItemId && !resolvedMediaItemId) setResolvedMediaItemId(data.mediaItemId);
      const nowSec = Math.floor(Date.now() / 1000);
      setEnriched((prev) => prev ? { ...prev, libraryStatus: status, reviewedAt: prev.reviewedAt ?? nowSec } : prev);
    } catch (e) {
      console.error("Failed to mark watched:", e);
    } finally {
      setRatingAction(false);
    }
  }

  // ── Build image list ─────────────────────────────────────────────
  const imgs: string[] = [];
  if (posterUrl) imgs.push(posterUrl);
  if (enriched?.images) for (const u of enriched.images) if (u && !imgs.includes(u)) imgs.push(u);
  const validImgs = imgs.filter(Boolean);
  const idx = Math.min(carouselIdx, Math.max(0, validImgs.length - 1));

  const steamAppId = enriched?.sources?.find((s) => s.source === "steam")?.sourceId ?? sp.get("steamId");
  const steamStoreUrl = steamAppId ? `https://store.steampowered.com/app/${steamAppId}` : null;

  // ── Derived display values ────────────────────────────────────────
  const displayTitle       = enriched?.title ?? title ?? "Untitled";
  const description        = enriched?.description ?? null;
  const tagline            = enriched?.tagline ?? null;
  const releaseDate        = enriched?.releaseDate ?? null;
  const tags               = enriched?.tags ?? [];
  const platformList       = enriched?.platforms ?? [];
  const steamReview        = enriched?.steamReviewLabel ?? null;
  const communityRatings   = enriched?.communityRatings ?? [];
  const personalRating     = enriched?.rating ?? null;
  const personalRatings    = enriched?.ratings ?? [];
  const libraryStatus      = enriched?.libraryStatus ?? null;
  const reviewedAt         = enriched?.reviewedAt ?? null;
  const review             = enriched?.review ?? null;
  const developer          = enriched?.developer ?? null;
  const publisher          = enriched?.publisher ?? null;
  const director           = enriched?.director ?? null;
  const cast               = enriched?.cast ?? [];
  const keywords           = enriched?.keywords ?? [];
  const trailerKey         = enriched?.trailerYoutubeKey ?? null;
  const steamTrailerUrl    = enriched?.steamTrailerUrl ?? null;
  const storeLinks         = enriched?.storeLinks ?? [];
  const streamingProviders = enriched?.streamingProviders ?? [];
  const dates              = enriched?.dates ?? [];
  const platformSources    = enriched?.platformSources ?? [];
  // New facts
  const runtimeMinutes     = enriched?.runtimeMinutes ?? null;
  const certification      = enriched?.certification ?? [];
  const status             = enriched?.status ?? null;
  const collection         = enriched?.collection ?? null;
  const originalLanguage   = enriched?.originalLanguage ?? null;
  const country            = enriched?.country ?? null;
  const budget             = enriched?.budget ?? null;
  const revenue            = enriched?.revenue ?? null;
  const boxOffice          = enriched?.boxOffice ?? null;
  const awards             = enriched?.awards ?? null;
  const network            = enriched?.network ?? null;
  const seasonCount        = enriched?.seasonCount ?? null;
  const episodeCount       = enriched?.episodeCount ?? null;
  const nextEpisode        = enriched?.nextEpisode ?? null;
  const gameModes          = enriched?.gameModes ?? [];
  const playtimeHours      = enriched?.playtimeHours ?? null;
  const timeToBeat         = enriched?.timeToBeat ?? null;
  const dlc                = enriched?.dlc ?? [];

  const hasScores = communityRatings.length > 0 || steamReview;

  // We can rate/log as long as the item has an identity — either it's already in
  // the DB (resolvedMediaItemId) or it carries source ids we can persist on save.
  // This is what lets discover items be rated without first wishlisting them.
  const ratableIds = enriched?.sources?.length ? buildIdsFromSources(enriched.sources) : idsFromParams();
  const canRate = !!resolvedMediaItemId || Object.keys(ratableIds).length > 0;

  if (notFound) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-24 text-center">
        <p className="text-2xl font-bold mb-2">Item not found</p>
        <p className="text-neutral-400 text-sm mb-6">We couldn't resolve this item against any source.</p>
        <button onClick={() => router.back()} className="text-sm px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 transition-colors">
          ← Go back
        </button>
      </div>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-6 py-6">
      <button
        onClick={() => router.back()}
        className="text-neutral-400 hover:text-white text-sm transition-colors mb-5 inline-flex items-center gap-1.5"
      >
        ← Back
      </button>

      {/* ── Hero: media + headline ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,420px)_1fr] gap-8">
        {/* Media column */}
        <div className="flex-shrink-0">
          {validImgs.length > 0 ? (
            <div className="relative group rounded-2xl overflow-hidden bg-neutral-900 border border-neutral-800">
              <img
                src={validImgs[idx]}
                alt={displayTitle}
                className="w-full object-cover"
                style={{ maxHeight: 460 }}
                onError={() => { if (carouselIdx < validImgs.length - 1) setCarouselIdx(carouselIdx + 1); }}
              />
              {validImgs.length > 1 && (
                <>
                  <button
                    onClick={() => setCarouselIdx((i) => (i - 1 + validImgs.length) % validImgs.length)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white rounded-full w-8 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >←</button>
                  <button
                    onClick={() => setCarouselIdx((i) => (i + 1) % validImgs.length)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white rounded-full w-8 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >→</button>
                </>
              )}
            </div>
          ) : (
            <div className="w-full rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center" style={{ height: 320 }}>
              <span className="text-neutral-700 text-sm">No image</span>
            </div>
          )}

          {/* Thumbnail strip */}
          {validImgs.length > 1 && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {validImgs.map((src, i) => (
                <button
                  key={i}
                  onClick={() => setCarouselIdx(i)}
                  className="w-16 h-10 rounded-lg overflow-hidden border transition-colors flex-shrink-0"
                  style={{ borderColor: i === idx ? "#fff" : "rgba(255,255,255,0.12)" }}
                >
                  <img src={src} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Headline column */}
        <div className="min-w-0 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <TypeBadge type={type} />
            {platformSources.map((s) => <SourcePill key={s} source={s} />)}
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              disabled={loading || refreshing}
              title="Re-check this item against your connected accounts"
              className="text-xs px-2.5 py-1 rounded-full border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 transition-colors disabled:opacity-50"
            >
              {refreshing ? "Syncing…" : "↻ Resync"}
            </button>
            <Link
              href={`/item/debug?${sp.toString()}`}
              title="Inspect per-source data and how it was merged"
              className="text-xs px-2.5 py-1 rounded-full border border-neutral-800 text-neutral-600 hover:border-amber-700 hover:text-amber-400 transition-colors"
            >
              debug
            </Link>
          </div>

          <h1 className="text-3xl font-bold leading-tight">{displayTitle}</h1>

          {/* Release dates */}
          {dates.length > 0 ? (
            <div className="space-y-1">
              {dates.map((d) => (
                <div key={d.source} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: SOURCE_COLORS[d.source] ?? "#888" }} />
                  <span className="text-neutral-400 text-xs w-16">{SOURCE_LABELS[d.source] ?? d.source}</span>
                  <span className="text-neutral-200">{fmtDate(d.date)}</span>
                </div>
              ))}
            </div>
          ) : releaseDate ? (
            <p className="text-sm text-neutral-400">{fmtDate(releaseDate)}</p>
          ) : loading ? (
            <p className="text-sm text-neutral-600 animate-pulse">Loading…</p>
          ) : (
            <p className="text-sm text-neutral-600">TBA</p>
          )}

          {/* Tagline */}
          {tagline && <p className="text-base text-neutral-400 italic">{tagline}</p>}

          {/* Scores — unified community / critic ratings */}
          {hasScores && (
            <div className="flex items-center gap-2 flex-wrap">
              {communityRatings.map((r) => <ScoreBadge key={r.source} r={r} />)}
              {steamReview && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm" style={{ background: "#1b9af71f", color: "#1b9af7" }}>
                  <span className="text-[10px] uppercase tracking-wide opacity-80 font-bold">Steam</span>
                  {steamReview}
                </span>
              )}
            </div>
          )}

          {/* Dev / pub / director */}
          {(developer || publisher || director) && (
            <div className="space-y-1 text-sm">
              {director && (
                <p><span className="text-neutral-500">{type === "show" ? "Creator " : "Director "}</span><FacetLink kind="person" role={type === "show" ? "creator" : "director"} label={director} className="text-neutral-200 hover:text-white hover:underline" /></p>
              )}
              {developer && <p><span className="text-neutral-500">Developer </span><FacetLink kind="company" role="developer" label={developer} className="text-neutral-200 hover:text-white hover:underline" /></p>}
              {publisher && publisher !== developer && <p><span className="text-neutral-500">Publisher </span><FacetLink kind="company" role="publisher" label={publisher} className="text-neutral-200 hover:text-white hover:underline" /></p>}
            </div>
          )}

          {/* Facts grid */}
          {(runtimeMinutes || certification.length || status || network || seasonCount || collection || originalLanguage || country || budget || revenue || boxOffice || playtimeHours || timeToBeat) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 pt-1">
              {certification.length > 0 && <Fact label="Rated">{certification.join(" · ")}</Fact>}
              {runtimeMinutes && <Fact label="Runtime">{fmtRuntime(runtimeMinutes)}{type === "show" ? "/ep" : ""}</Fact>}
              {status && <Fact label="Status">{status}</Fact>}
              {network && <Fact label="Network">{network}</Fact>}
              {type === "show" && (seasonCount || episodeCount) && (
                <Fact label="Episodes">{seasonCount ? `${seasonCount} season${seasonCount > 1 ? "s" : ""}` : ""}{seasonCount && episodeCount ? " · " : ""}{episodeCount ? `${episodeCount} eps` : ""}</Fact>
              )}
              {collection && <Fact label={type === "game" ? "Franchise" : "Collection"}>{collection}</Fact>}
              {originalLanguage && <Fact label="Language">{originalLanguage}</Fact>}
              {country && <Fact label="Country">{country}</Fact>}
              {playtimeHours && <Fact label="Avg playtime">{playtimeHours}h</Fact>}
              {timeToBeat?.normally != null && <Fact label="Time to beat">{timeToBeat.normally}h</Fact>}
              {budget && <Fact label="Budget">{fmtMoney(budget)}</Fact>}
              {(boxOffice || revenue) && <Fact label="Box office">{boxOffice ?? fmtMoney(revenue!)}</Fact>}
            </div>
          )}

          {/* Next episode (returning shows) */}
          {nextEpisode?.airDate && (
            <p className="text-sm">
              <span className="text-neutral-500">Next episode </span>
              <span className="text-neutral-200">
                {nextEpisode.season != null && nextEpisode.episode != null ? `S${nextEpisode.season}E${nextEpisode.episode} · ` : ""}
                {fmtDate(nextEpisode.airDate)}
              </span>
            </p>
          )}

          {/* Awards */}
          {awards && <p className="text-sm text-amber-300/80">🏆 {awards}</p>}

          {/* Description */}
          {description && <p className="text-sm text-neutral-300 leading-relaxed">{description}</p>}

          {/* Rate & Log */}
          {(canRate || libraryStatus || (typeof personalRating === "number" && personalRating > 0) || reviewedAt || review) && (
            <div className="pt-4 border-t border-neutral-800/60">
              <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Rate &amp; Log</p>
              {canRate ? (
                <>
                  <div className="flex items-center gap-0.5 mb-3">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
                      const active = n <= (hoverRating ?? personalRating ?? 0);
                      return (
                        <button
                          key={n}
                          className="text-2xl leading-none transition-colors disabled:opacity-40"
                          style={{ color: active ? "#facc15" : "#3f3f46" }}
                          onMouseEnter={() => setHoverRating(n)}
                          onMouseLeave={() => setHoverRating(null)}
                          onClick={() => handleRate(n === personalRating ? null : n)}
                          disabled={ratingAction}
                          title={n === personalRating ? "Remove rating" : `Rate ${n}/10`}
                        >★</button>
                      );
                    })}
                    {personalRating != null && (
                      <span className="text-xs text-neutral-500 ml-2" title={ratingsTooltip(personalRatings)}>
                        {fmtScore(personalRating)}/10{personalRatings.length > 1 ? " avg" : ""}
                      </span>
                    )}
                  </div>
                  <RatingsBreakdown ratings={personalRatings} />
                  <div className="flex items-center gap-2 flex-wrap mt-2">
                    {libraryStatus ? (
                      <span className="text-xs text-neutral-500 capitalize">
                        ✓ {libraryStatus}
                        {reviewedAt && (() => { try { return ` · ${format(new Date(reviewedAt * 1000), "MMM d, yyyy")}`; } catch { return ""; } })()}
                      </span>
                    ) : (
                      <button onClick={handleMarkWatched} disabled={ratingAction} className="text-xs px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors disabled:opacity-40">
                        {ratingAction ? "Saving…" : "Mark as " + (type === "game" ? "played" : "watched")}
                      </button>
                    )}
                  </div>
                  {review && <p className="text-sm text-neutral-300 leading-relaxed italic mt-2">"{review}"</p>}
                </>
              ) : (
                <div className="flex items-center gap-3 flex-wrap">
                  {libraryStatus && <span className="text-xs px-2 py-1 rounded-full bg-neutral-800 text-neutral-300 capitalize">{libraryStatus}</span>}
                  {typeof personalRating === "number" && personalRating > 0 && (() => {
                    const c = personalRating >= 7 ? "#4ade80" : personalRating >= 5 ? "#f59e0b" : "#ef4444";
                    return (
                      <span className="text-sm font-bold" style={{ color: c }} title={ratingsTooltip(personalRatings)}>
                        ★ {fmtScore(personalRating)}<span className="text-neutral-600 font-normal text-xs"> / 10{personalRatings.length > 1 ? " avg" : ""}</span>
                      </span>
                    );
                  })()}
                  {review && <p className="text-sm text-neutral-300 leading-relaxed italic w-full">"{review}"</p>}
                  <div className="w-full"><RatingsBreakdown ratings={personalRatings} /></div>
                </div>
              )}
            </div>
          )}

          {/* Wishlist management */}
          <div className="pt-4 border-t border-neutral-800/60">
            <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Your wishlists</p>
            {platformsLoading ? (
              <p className="text-xs text-neutral-600">Loading…</p>
            ) : (
              <div className="space-y-2">
                {platforms.map((p) => {
                  const color = SOURCE_COLORS[p.provider] ?? "#888";
                  return (
                    <div key={p.provider} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                        <span className="text-sm text-neutral-300">{p.label}</span>
                        {p.displayName && <span className="text-xs text-neutral-600">@{p.displayName}</span>}
                      </div>
                      {p.notConnected ? (
                        <Link href="/settings" className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">Not connected →</Link>
                      ) : p.provider === "steam" ? (
                        <div className="flex items-center gap-2">
                          {p.onList && <span className="text-xs px-2.5 py-1 rounded-full border" style={{ borderColor: color + "44", color, background: color + "15" }}>✓ On wishlist</span>}
                          {steamStoreUrl ? (
                            <a href={steamStoreUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
                              {p.onList ? "Open on Steam →" : "View on Steam →"}
                            </a>
                          ) : (
                            <span className="text-xs text-neutral-600">Read-only</span>
                          )}
                        </div>
                      ) : p.onList ? (
                        <button onClick={() => togglePlatform(p.provider, true)} disabled={platformAction === p.provider} className="text-xs px-2.5 py-1 rounded-full border transition-colors disabled:opacity-40" style={{ borderColor: color + "44", color, background: color + "15" }}>
                          {platformAction === p.provider ? "..." : "✓ On list – Remove"}
                        </button>
                      ) : (
                        <button onClick={() => togglePlatform(p.provider, false)} disabled={platformAction === p.provider} className="text-xs px-2.5 py-1 rounded-full border border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-40">
                          {platformAction === p.provider ? "..." : "+ Add to list"}
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

      {/* ── Lower detail sections ───────────────────────────────── */}
      <div className="mt-10 space-y-8">
        {/* Trailer */}
        {trailerKey ? (
          <section>
            <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Trailer</p>
            <div className="relative w-full max-w-3xl rounded-xl overflow-hidden" style={{ paddingBottom: "min(56.25%, 480px)" }}>
              <iframe
                className="absolute inset-0 w-full h-full"
                src={`https://www.youtube.com/embed/${trailerKey}?rel=0`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </section>
        ) : steamTrailerUrl ? (
          <a href={steamTrailerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg" style={{ background: "#1b9af720", color: "#1b9af7" }}>
            Watch trailer on Steam →
          </a>
        ) : null}

        {/* Cast — full list */}
        {(type === "movie" || type === "show") && cast.length > 0 && (
          <section>
            <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Cast</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-2">
              {cast.map((c, i) => (
                <div key={`${c.name}-${i}`} className="text-sm min-w-0">
                  <FacetLink kind="person" role="cast" label={c.name} className="text-neutral-200 truncate block hover:text-white hover:underline" />
                  {c.character && <p className="text-neutral-500 text-xs truncate">{c.character}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Where to watch */}
        {streamingProviders.length > 0 && (
          <section>
            <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Where to watch</p>
            <div className="flex flex-wrap gap-2">
              {streamingProviders.map((p) => (
                <div key={p.providerId} className="flex items-center gap-1.5 bg-neutral-800 rounded-lg px-2.5 py-1.5">
                  {p.logoPath && <img src={`https://image.tmdb.org/t/p/w45${p.logoPath}`} className="w-5 h-5 rounded" alt={p.name} />}
                  <span className="text-xs">{p.name}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Platforms */}
        {platformList.length > 0 && (
          <section>
            <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Platforms</p>
            <div className="flex flex-wrap gap-1.5">
              {platformList.map((p) => (
                <span key={p} className="text-xs px-2 py-0.5 bg-neutral-800/60 border border-neutral-700 rounded-full text-neutral-400">{p}</span>
              ))}
            </div>
          </section>
        )}

        {/* Game modes */}
        {gameModes.length > 0 && (
          <section>
            <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Modes &amp; perspective</p>
            <div className="flex flex-wrap gap-1.5">
              {gameModes.map((m) => (
                <span key={m} className="text-xs px-2 py-0.5 bg-neutral-800/60 border border-neutral-700 rounded-full text-neutral-400">{m}</span>
              ))}
            </div>
          </section>
        )}

        {/* DLC / expansions / included content */}
        {dlc.length > 0 && (
          <section>
            <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">DLC &amp; expansions</p>
            <div className="flex flex-wrap gap-1.5">
              {dlc.map((d) => (
                <span key={d} className="text-xs px-2 py-0.5 bg-neutral-800 rounded-full text-neutral-300">{d}</span>
              ))}
            </div>
          </section>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <section>
            <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <FacetLink key={t} kind="tag" label={t} className="text-xs px-2 py-0.5 bg-neutral-800 rounded-full text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors" />
              ))}
            </div>
          </section>
        )}

        {/* Keywords */}
        {keywords.length > 0 && (
          <section>
            <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Keywords</p>
            <div className="flex flex-wrap gap-1.5">
              {keywords.map((k) => (
                <FacetLink key={k} kind="tag" label={k} className="text-xs px-2 py-0.5 bg-neutral-800/60 border border-neutral-700 rounded-full text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors" />
              ))}
            </div>
          </section>
        )}

        {/* Store links */}
        {storeLinks.length > 0 && (
          <section className="pt-2 border-t border-neutral-800">
            <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Links</p>
            <div className="flex flex-wrap gap-2">
              {storeLinks.map((l) => (
                <a key={l.name} href={l.url} target="_blank" rel="noopener noreferrer" className="text-xs px-3 py-1.5 rounded-lg transition-colors" style={{ background: `${SOURCE_COLORS[l.source] ?? "#888"}18`, color: SOURCE_COLORS[l.source] ?? "#aaa" }}>
                  {l.name} →
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default function ItemPage() {
  return (
    <div className="min-h-screen">
      <NavBar />
      <Suspense fallback={<div className="max-w-6xl mx-auto px-6 py-24 text-center text-neutral-500">Loading…</div>}>
        <ItemInspector />
      </Suspense>
    </div>
  );
}
