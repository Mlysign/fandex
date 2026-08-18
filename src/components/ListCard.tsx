"use client";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import type { TooltipItem } from "@/components/Tooltip";
import Tooltip from "@/components/Tooltip";
import { TypeIcon } from "@/components/Badges";
import ActionCells from "@/components/ActionCells";
import FandexScoreBadge from "@/components/FandexScoreBadge";
import CommunityScoreBadge from "@/components/CommunityScoreBadge";
import { TYPE_COLORS } from "@/lib/constants";
import type { MediaCardItem } from "@/components/cardItem";
import { buildItemHref } from "@/lib/itemUrl";

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
  const [imgErr, setImgErr] = useState(false);
  const ref = useRef<HTMLAnchorElement | HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canTooltip = item.dates !== undefined;
  const typeColor = TYPE_COLORS[item.type] ?? "#888";
  // The list row uses a LANDSCAPE thumbnail (the card uses the portrait poster):
  // prefer the merged landscape backdrop, fall back to the poster when absent.
  const thumb = item.backdropUrl ?? item.posterUrl;
  // Q14: see PosterCard — a facet-page item that couldn't be persisted has no
  // page to link to and no identity for the quick-action bar to act on.
  const linkable = item.linkable !== false;

  const body = (
    <>
      {/* Type accent — color-coded left bar carrying the type icon (T11); the
          distinct pictogram per type (not just the color) is what satisfies
          06-accessibility.md's "never encode meaning by color alone" here. */}
      <div className="w-7 flex-shrink-0 flex items-center justify-center" style={{ background: typeColor }}>
        <span className="text-text-on-media"><TypeIcon type={item.type} size={15} /></span>
      </div>
      {/* Full-height LANDSCAPE thumbnail, flush against the color bar. The image
          is absolutely filled so its aspect ratio can't drive the row height —
          rows stay uniform; a ~16:9 backdrop fills this wide frame with minimal
          crop (vs. the portrait poster the card uses). */}
      <div className="relative w-28 flex-shrink-0 bg-neutral-800 overflow-hidden">
        {thumb && !imgErr ? (
          <Image src={thumb} alt={item.title} fill sizes="112px" className="object-cover" onError={() => setImgErr(true)} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center"><TypeIcon type={item.type} size={16} className="text-text-muted" /></div>
        )}
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5">
        <p className="font-serif text-serif-sm text-text-primary truncate">{item.title}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap font-mono text-meta text-text-secondary">
          <span>
            {item.releaseDate
              ? (() => { try { return format(parseISO(item.releaseDate), "MMM d, yyyy"); } catch { return item.releaseDate; } })()
              : "TBA"}
          </span>
          {item.dates && item.dates.length > 1 && (
            <span>· {item.dates.length} dates</span>
          )}
          {item.roles && item.roles.length > 0 && (
            <span>· {item.roles.join(", ")}</span>
          )}
          <CommunityScoreBadge score={item.communityScore} />
          <FandexScoreBadge score={item.fandexScore} center={item.fandexCenter} />
        </div>
      </div>
      {/* `linkable` passed down, not gated here — see PosterCard's note. The
          wrapper stays unconditional so the row's trailing slot keeps its width
          whichever way ActionCells resolves. */}
      <div className="flex items-center pr-3 flex-shrink-0">
        <ActionCells item={item} layout="row" linkable={linkable} />
      </div>
    </>
  );

  return (
    <>
      {linkable ? (
        // N3: a real <a> (via Link), not a role="button" div — see PosterCard for
        // the same rationale.
        <Link
          ref={ref as React.RefObject<HTMLAnchorElement>}
          href={buildItemHref(item)}
          data-item-id={item.id}
          aria-label={`${item.title} — view details`}
          className={`flex items-stretch min-h-[60px] bg-surface-elevated hover:border-border-strong border rounded-lg overflow-hidden transition-colors duration-base cursor-pointer group ${
            highlight ? "border-accent/40" : "border-border"
          }`}
          onMouseEnter={() => { timer.current = setTimeout(() => setHovered(true), 350); }}
          onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setHovered(false); }}
          onClick={() => onSelect(item)}
        >
          {body}
        </Link>
      ) : (
        <div
          ref={ref as React.RefObject<HTMLDivElement>}
          data-item-id={item.id}
          title="Not yet in the catalog"
          aria-label={`${item.title} — not yet in the catalog`}
          className="flex items-stretch min-h-[60px] bg-surface-elevated border border-border rounded-lg overflow-hidden opacity-80"
        >
          {body}
        </div>
      )}
      {hovered && canTooltip && linkable && (
        <Tooltip item={item as TooltipItem} anchorRef={ref} />
      )}
    </>
  );
}
