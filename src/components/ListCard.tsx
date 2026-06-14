"use client";
import { useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import Tooltip, { TooltipItem } from "@/components/Tooltip";
import ItemBadges from "@/components/ItemBadges";
import { useQuickActions } from "@/lib/useQuickActions";
import { RateBar, WishlistButton } from "@/components/QuickActions";
import { MediaCardItem } from "@/components/cardItem";

// The list-view analog of PosterCard: one canonical, reusable row used wherever
// items render as a list (GroupedView list mode, and anywhere else in future).
export type ListCardItem = MediaCardItem;

interface ListCardProps {
  item: ListCardItem;
  onSelect: (item: ListCardItem) => void;
  highlight?: boolean;
}

export default function ListCard({ item, onSelect, highlight }: ListCardProps) {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canTooltip = item.dates !== undefined;

  const { rating, wishlisted, status, busy, rate, toggleWishlist } = useQuickActions(item);
  const badgeItem = {
    type: item.type,
    platformSources: item.platformSources ?? [],
    onWatchlist: wishlisted,
    libraryStatus: status,
    rating,
    ratings: item.ratings,
  };

  return (
    <>
      <div
        ref={ref}
        className={`flex items-center gap-3 bg-neutral-900 hover:bg-neutral-800/80 border rounded-xl px-4 py-3 transition-colors cursor-pointer group ${
          highlight ? "border-white/20" : "border-neutral-800"
        }`}
        onMouseEnter={() => { timer.current = setTimeout(() => setHovered(true), 350); }}
        onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setHovered(false); }}
        onClick={() => onSelect(item)}
      >
        <div className="w-16 h-10 rounded overflow-hidden flex-shrink-0 bg-neutral-800">
          {item.posterUrl && (
            <img src={item.posterUrl} alt={item.title} className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{item.title}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {item.releaseDate ? (
              <span className="text-xs text-neutral-500">
                {(() => { try { return format(parseISO(item.releaseDate), "MMM d, yyyy"); } catch { return item.releaseDate; } })()}
              </span>
            ) : (
              <span className="text-xs text-neutral-600">TBA</span>
            )}
            {item.dates && item.dates.length > 1 && (
              <span className="text-xs text-neutral-600">· {item.dates.length} dates</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Quick actions — slide open on hover */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 overflow-hidden max-w-0 group-hover:max-w-[150px] transition-[max-width] duration-200"
          >
            <div className="w-24"><RateBar rating={rating} busy={busy} onRate={rate} /></div>
            <WishlistButton wishlisted={wishlisted} busy={busy} onToggle={toggleWishlist} />
          </div>
          <ItemBadges variant="row" item={badgeItem} />
        </div>
      </div>
      {hovered && ref.current && canTooltip && (
        <Tooltip item={item as TooltipItem} anchor={ref.current} />
      )}
    </>
  );
}
