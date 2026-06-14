"use client";
import { useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { TYPE_COLORS } from "@/lib/constants";
import Tooltip from "@/components/Tooltip";
import type { TooltipItem } from "@/components/Tooltip";
import ItemBadges from "@/components/ItemBadges";
import { useQuickActions } from "@/lib/useQuickActions";
import { RateBar, WishlistButton } from "@/components/QuickActions";
import { MediaCardItem } from "@/components/cardItem";

// The shared media-item shape (see cardItem.ts). Re-exported as PosterCardItem
// for the existing call-sites that import it from here.
export type PosterCardItem = MediaCardItem;

interface PosterCardProps {
  item: PosterCardItem;
  onSelect: (item: PosterCardItem) => void;
}

export default function PosterCard({ item, onSelect }: PosterCardProps) {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { rating, wishlisted, status, busy, rate, toggleWishlist } = useQuickActions(item);

  const badgeItem = {
    type: item.type,
    platformSources: item.platformSources ?? [],
    onWatchlist: wishlisted,
    libraryStatus: status,
    rating,
  };

  return (
    <>
      <div
        ref={ref}
        className="group cursor-pointer rounded-xl overflow-hidden border border-neutral-800 bg-neutral-900 hover:border-neutral-600 transition-all hover:scale-[1.02] relative"
        onMouseEnter={() => { timer.current = setTimeout(() => setHovered(true), 350); }}
        onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setHovered(false); }}
        onClick={() => onSelect(item)}
      >
        {/* Poster image — 2:3 portrait ratio */}
        <div className="relative w-full bg-neutral-800" style={{ paddingBottom: "150%" }}>
          {item.posterUrl ? (
            <img
              src={item.posterUrl}
              alt={item.title}
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-neutral-600 text-2xl font-bold">
              {item.title[0]}
            </div>
          )}

          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
            <span className="opacity-0 group-hover:opacity-100 transition-all text-xs text-white bg-black/60 px-3 py-1.5 rounded-lg">
              View details
            </span>
          </div>

          {/* Type colour stripe */}
          <div
            className="absolute bottom-0 left-0 right-0 h-0.5"
            style={{ background: TYPE_COLORS[item.type] ?? "#888" }}
          />

          {/* Canonical user-state badges (rating, watched/played, wishlist) */}
          <ItemBadges variant="card" item={badgeItem} />

          {/* Quick actions (rate / wishlist) — hover only */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-0 left-0 right-0 px-1.5 pb-1.5 pt-4 bg-gradient-to-t from-black/90 to-transparent opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-10"
          >
            <div className="flex items-center gap-1.5">
              <WishlistButton wishlisted={wishlisted} busy={busy} onToggle={toggleWishlist} />
              <RateBar rating={rating} busy={busy} onRate={rate} />
            </div>
          </div>
        </div>

        {/* Card footer */}
        <div className="p-2.5 space-y-0.5">
          <p className="font-medium text-sm leading-tight line-clamp-2">{item.title}</p>
          <p className="text-xs text-neutral-500">
            {item.releaseDate
              ? (() => { try { return format(parseISO(item.releaseDate), "MMM d, yyyy"); } catch { return item.releaseDate; } })()
              : "TBA"}
          </p>
        </div>
      </div>

      {hovered && ref.current && (
        <Tooltip item={item as TooltipItem} anchor={ref.current} />
      )}
    </>
  );
}
