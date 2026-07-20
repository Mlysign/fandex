"use client";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { TYPE_COLORS } from "@/lib/constants";
import Tooltip from "@/components/Tooltip";
import type { TooltipItem } from "@/components/Tooltip";
import { TypeIcon } from "@/components/Badges";
import ActionCells from "@/components/ActionCells";
import FandexScoreBadge from "@/components/FandexScoreBadge";
import CommunityScoreBadge from "@/components/CommunityScoreBadge";
import { MediaCardItem } from "@/components/cardItem";
import { buildItemHref } from "@/lib/itemUrl";

// The shared media-item shape (see cardItem.ts). Re-exported as PosterCardItem
// for the existing call-sites that import it from here.
export type PosterCardItem = MediaCardItem;

interface PosterCardProps {
  item: PosterCardItem;
  onSelect: (item: PosterCardItem) => void;
}

export default function PosterCard({ item, onSelect }: PosterCardProps) {
  const [hovered, setHovered] = useState(false);
  const [imgErr, setImgErr] = useState(false);
  const ref = useRef<HTMLAnchorElement | HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Use the portrait poster when present; otherwise fall back to the landscape
  // art (backdrop) — many games have hero/artwork but no box-art cover.
  const imageSrc = item.posterUrl ?? item.backdropUrl ?? null;
  const typeColor = TYPE_COLORS[item.type] ?? "#888";
  // Q14: a facet-page item that couldn't be persisted to a real row (rare) has
  // no page to link to and no identity for the quick-action bar to act on —
  // render it as an inert preview instead (ported from the old facet card).
  const linkable = item.linkable !== false;

  const body = (
    <>
      {/* Type accent — color-only bar, no icon (Q14: matches the facet-page card) */}
      <div className="h-1.5 rounded-t-xl" style={{ background: typeColor }} />

      {/* Poster image — wider-than-classic-poster ratio (Q14: matches the
          facet-page card); the image fills the frame (cropped). */}
      <div className="relative w-full bg-neutral-800 overflow-hidden" style={{ paddingBottom: "140%" }}>
        {imageSrc && !imgErr ? (
          <Image src={imageSrc} alt={item.title} fill sizes="(max-width: 768px) 45vw, 200px" className="object-cover" onError={() => setImgErr(true)} />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-neutral-600">
            <TypeIcon type={item.type} size={28} />
            <span className="text-2xl font-bold">{item.title[0]}</span>
          </div>
        )}

        {/* Hover overlay */}
        {linkable && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
            <span className="opacity-0 group-hover:opacity-100 transition-all text-xs text-white bg-black/60 px-3 py-1.5 rounded-lg">
              View details
            </span>
          </div>
        )}

        {/* Fandex Score — top-right; crowd rating — top-left. Both render nothing if absent. */}
        <div className="absolute top-1.5 left-1.5">
          <CommunityScoreBadge score={item.communityScore} className="shadow-sm backdrop-blur-sm" />
        </div>
        <div className="absolute top-1.5 right-1.5">
          <FandexScoreBadge score={item.fandexScore} className="shadow-sm backdrop-blur-sm" />
        </div>
      </div>

      {/* Action toolbar — rate · watched · wishlist (always visible; skipped for
          a non-linkable item, which has no identity to act on) */}
      {linkable && (
        <div className="px-2 pt-2">
          <ActionCells item={item} layout="card" />
        </div>
      )}

      {/* Footer — title + date (type now reads from the color-coded top bar).
          Q14: the title block reserves a fixed 2-line height regardless of
          actual title length, so cards in the same row stay the same height. */}
      <div className="px-2.5 pb-2.5 pt-1.5 space-y-0.5">
        <p className="font-medium text-sm leading-tight line-clamp-2 min-h-[2.25rem]">{item.title}</p>
        <div className="text-xs text-neutral-500">
          {item.releaseDate
            ? (() => { try { return format(parseISO(item.releaseDate), "MMM d, yyyy"); } catch { return item.releaseDate; } })()
            : "TBA"}
        </div>
        {item.roles && item.roles.length > 0 && (
          <div className="text-[11px] text-neutral-500 line-clamp-1">{item.roles.join(", ")}</div>
        )}
      </div>
    </>
  );

  return (
    <>
      {linkable ? (
        // N3: a real <a> (via Link), not a role="button" div — gives middle-click/
        // cmd-click "open in new tab", a real hover-preview URL, and native
        // keyboard Enter activation. Nested ActionCells buttons stopPropagation()
        // so they don't also trigger this navigation.
        <Link
          ref={ref as React.RefObject<HTMLAnchorElement>}
          href={buildItemHref(item)}
          data-item-id={item.id}
          aria-label={`${item.title} — view details`}
          className="group cursor-pointer rounded-xl border border-neutral-800 bg-neutral-900 hover:border-neutral-600 transition-all hover:scale-[1.02] relative block"
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
          className="rounded-xl border border-neutral-800 bg-neutral-900 relative block opacity-80"
        >
          {body}
        </div>
      )}

      {hovered && linkable && (
        <Tooltip item={item as TooltipItem} anchorRef={ref} />
      )}
    </>
  );
}
