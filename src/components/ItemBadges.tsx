"use client";
import { TYPE_COLORS, SOURCE_COLORS, SOURCE_LABELS } from "@/lib/constants";
import { TypeBadge } from "@/components/Badges";

// "Trakt 3 · TMDB 8" — per-platform breakdown for the rating tooltip.
function ratingTitle(ratings?: { source: string; rating: number }[]): string | undefined {
  if (!ratings || ratings.length === 0) return undefined;
  return ratings.map((r) => `${SOURCE_LABELS[r.source] ?? r.source} ${fmtRating(r.rating)}`).join("  ·  ");
}

// The canonical badge set for any list / card / calendar item. Driven entirely
// by the item's user-state so the SAME item shows the SAME indicators in every
// view: wishlist provider dots, watched/played status, and personal rating.
export interface BadgeItem {
  type: string;
  platformSources?: string[];   // wishlist providers
  onWatchlist?: boolean;
  libraryStatus?: string | null; // watched | played | owned
  rating?: number | null;        // personal score, 0-10 (average across platforms)
  ratings?: { source: string; rating: number }[]; // per-platform breakdown
}

function ratingColor(r: number) { return r >= 7 ? "#4ade80" : r >= 5 ? "#f59e0b" : "#ef4444"; }
function fmtRating(r: number) { return r % 1 === 0 ? r.toFixed(0) : r.toFixed(1); }

function SourceDots({ sources, className }: { sources: string[]; className?: string }) {
  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
      {sources.map((s) => (
        <span key={s} className="w-2 h-2 rounded-full shadow" style={{ background: SOURCE_COLORS[s] ?? "#666" }} />
      ))}
    </div>
  );
}

export default function ItemBadges({ item, variant }: { item: BadgeItem; variant: "row" | "card" | "calendar" }) {
  const rating      = typeof item.rating === "number" && item.rating > 0 ? item.rating : null;
  const sources     = item.platformSources ?? [];
  const onWatchlist = item.onWatchlist ?? sources.length > 0;
  const status      = item.libraryStatus ?? null;

  // ── Inline cluster for list rows ──────────────────────────────────────────
  if (variant === "row") {
    return (
      <div className="flex items-center gap-2 flex-shrink-0">
        {rating !== null && (
          <span
            className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded font-semibold"
            style={{ background: `${ratingColor(rating)}1f`, color: ratingColor(rating) }}
            title={ratingTitle(item.ratings)}
          >
            ★ {fmtRating(rating)}
          </span>
        )}
        {status && (
          <span className="text-[10px] uppercase tracking-wide text-neutral-500 capitalize">{status}</span>
        )}
        <TypeBadge type={item.type} />
        {sources.length > 0 ? (
          <SourceDots sources={sources} />
        ) : onWatchlist ? (
          <span className="w-4 h-4 rounded-full bg-green-600 flex items-center justify-center text-xs text-white font-bold">✓</span>
        ) : null}
      </div>
    );
  }

  // ── Absolutely-positioned overlays for poster cards ───────────────────────
  // (rendered inside the poster's relative container)
  if (variant === "card") {
    return (
      <>
        {(rating !== null || status) && (
          <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
            {rating !== null && (
              <div
                className="flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded shadow"
                style={{ background: "rgba(0,0,0,0.7)", color: ratingColor(rating) }}
                title={ratingTitle(item.ratings)}
              >
                ★ {fmtRating(rating)}
              </div>
            )}
            {status && (
              <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded shadow text-neutral-200 capitalize" style={{ background: "rgba(0,0,0,0.7)" }}>
                {status}
              </span>
            )}
          </div>
        )}
        {sources.length > 0 ? (
          <SourceDots sources={sources} className="absolute top-2 right-2" />
        ) : onWatchlist ? (
          <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-green-600 flex items-center justify-center shadow">
            <span className="text-xs text-white font-bold">✓</span>
          </div>
        ) : null}
      </>
    );
  }

  // ── Compact markers for calendar cells / overflow rows ────────────────────
  return (
    <span className="inline-flex items-center gap-1 flex-shrink-0">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: TYPE_COLORS[item.type] ?? "#888" }} />
      {rating !== null && (
        <span className="text-[9px] font-bold" style={{ color: ratingColor(rating) }}>★{fmtRating(rating)}</span>
      )}
      {status && rating === null && (
        <span className="w-1.5 h-1.5 rounded-full bg-neutral-500" title={status} />
      )}
      {onWatchlist && (
        <span className="w-3 h-3 rounded-full bg-green-600 flex items-center justify-center text-[8px] text-white font-bold">✓</span>
      )}
    </span>
  );
}
