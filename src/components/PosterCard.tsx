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
      {/* Type chip — dot + UPPERCASE mono label (H1.6d: was a color-only bar,
          which the a11y spec (06-accessibility.md) flags as encoding meaning
          by color alone; a text label now pairs with the dot). Sits in its
          own strip above the poster rather than overlaying it, since the
          poster's top corners are already claimed by the score badges (Q14). */}
      <div className="flex items-center gap-1.5 px-2 pt-2 pb-1.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: typeColor }} aria-hidden />
        <span className="font-mono text-micro uppercase text-text-secondary">{item.type}</span>
      </div>

      {/* Poster image — wider-than-classic-poster ratio (Q14: matches the
          facet-page card); the image fills the frame (cropped). */}
      <div className="relative w-full bg-neutral-800 overflow-hidden rounded-md" style={{ paddingBottom: "140%" }}>
        {imageSrc && !imgErr ? (
          <Image src={imageSrc} alt={item.title} fill sizes="(max-width: 768px) 45vw, 200px" className="object-cover transition-transform duration-base group-hover:scale-[1.02]" onError={() => setImgErr(true)} />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-neutral-600">
            <TypeIcon type={item.type} size={28} />
            <span className="text-2xl font-bold">{item.title[0]}</span>
          </div>
        )}

        {/* Hover overlay — a neutral hint, not a CTA (the whole card is
            already the click target), so it stays off the accent gold per
            the design's restraint rule. */}
        {linkable && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-base flex items-center justify-center">
            <span
              className="opacity-0 group-hover:opacity-100 transition-opacity duration-base text-label text-text-primary px-3 py-1.5 rounded-full backdrop-blur-[5px]"
              style={{ background: "rgb(16 14 12 / 0.66)" }}
            >
              View details
            </span>
          </div>
        )}

        {/* Fandex Score — top-right; crowd rating — top-left. Both render nothing if absent. */}
        <div className="absolute top-1.5 left-1.5">
          <CommunityScoreBadge score={item.communityScore} variant="overlay" className="shadow-sm" />
        </div>
        <div className="absolute top-1.5 right-1.5">
          <FandexScoreBadge score={item.fandexScore} variant="overlay" className="shadow-sm" />
        </div>
      </div>

      {/* Action toolbar — rate · watched · wishlist (always visible; skipped for
          a non-linkable item, which has no identity to act on) */}
      {linkable && (
        <div className="px-2 pt-2">
          <ActionCells item={item} layout="card" />
        </div>
      )}

      {/* Footer — title + date. Q14: the title block reserves a fixed 2-line
          height regardless of actual title length, so cards in the same row
          stay the same height. */}
      <div className="px-2.5 pb-2.5 pt-1.5 space-y-0.5">
        <p className="font-serif text-serif-sm leading-tight line-clamp-2 min-h-[2.25rem] text-text-primary">{item.title}</p>
        <div className="font-mono text-meta text-text-secondary">
          {item.releaseDate
            ? (() => { try { return format(parseISO(item.releaseDate), "MMM d, yyyy"); } catch { return item.releaseDate; } })()
            : "TBA"}
        </div>
        {item.roles && item.roles.length > 0 && (
          <div className="text-caption text-text-secondary line-clamp-1">{item.roles.join(", ")}</div>
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
          className="group cursor-pointer overflow-hidden rounded-md border border-border bg-surface-elevated hover:border-border-strong transition-colors duration-base relative block"
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
          className="overflow-hidden rounded-md border border-border bg-surface-elevated relative block opacity-80"
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
