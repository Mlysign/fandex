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
import { usePendingFandexScore } from "@/components/usePendingFandexScore";
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

  // 2026-07-27 — rebuilt to `03-components.md §2`'s anatomy after the
  // mockup-vs-live audit found this card had kept its pre-H1 structure and
  // only picked up the new tokens. Three structural changes, all Nils's call:
  //   1. The poster now starts at the card's TOP EDGE (it used to sit below a
  //      type-chip strip), with the type chip OVERLAID on it top-left.
  //   2. The score moved out of the poster's corners and into the meta row as
  //      a serif number (bare, no "/100" as of 2026-07-29 — see
  //      FandexScoreBadge.tsx) — the design shows exactly ONE score there
  //      (per D-E: Fandex when signed in, community rating in its place for
  //      anon), never two badges competing over the artwork.
  //   3. The action bar dropped to two buttons and moved BELOW title+meta.
  // 2026-07-29 — an item the feed left `fandexPending` has no score YET (its
  // local row is too thin to score honestly). Resolve it client-side; until it
  // lands, the badge slot shows a pending pip rather than the community score,
  // so the number in that slot never silently changes meaning mid-load.
  const { score: resolvedScore, loading: scoreLoading } = usePendingFandexScore(item.id, item.fandexPending);
  const fandexScore = item.fandexScore ?? resolvedScore?.score ?? null;
  const fandexCenter = item.fandexCenter ?? resolvedScore?.center ?? null;
  const shownScore = fandexScore ?? item.communityScore;
  const releaseLabel = item.releaseDate
    ? (() => { try { return format(parseISO(item.releaseDate), "MMM yyyy"); } catch { return item.releaseDate; } })()
    : "TBA";

  const body = (
    <>
      {/* Poster — 2:3 per spec, flush to the card's top edge. rounded-t-md
          matches the root's rounded-md now that the root itself no longer
          clips (T13, 2026-07-29) — the poster is the only child that ever
          needed clipping to the card's shape; a solid div's own
          border-radius already rounds its background/border with no
          overflow needed. */}
      <div className="relative w-full bg-neutral-800 overflow-hidden rounded-t-md aspect-[2/3]">
        {imageSrc && !imgErr ? (
          <Image src={imageSrc} alt={item.title} fill sizes="(max-width: 768px) 45vw, 200px" className="object-cover transition-transform duration-base group-hover:scale-[1.02]" onError={() => setImgErr(true)} />
        ) : (
          /* H1.6f a11y: was neutral-600 on the neutral-800 placeholder well —
             1.48:1, below even the 3:1 bar that applies to icons and 24px-bold
             text. neutral-500 is 3.23:1 there: still clearly a recessed
             placeholder, but actually perceivable. */
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-neutral-500">
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

        {/* Type chip — overlaid top-left per spec. Keeps the dot + text label
            pairing H1.6d introduced (06-accessibility.md: never encode meaning
            by color alone); only its position changed. */}
        <div
          className="absolute top-2 left-2 flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-full"
          style={{ background: "rgb(16 14 12 / 0.62)" }}
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: typeColor }} aria-hidden />
          <span className="font-mono text-micro uppercase text-text-primary">{item.type}</span>
        </div>
      </div>

      {/* Body — title · meta row (release · score) · action bar, in that
          order. Fixed padding + gap per spec (10px/11px, gap 7px). */}
      <div className="px-2.5 py-2.5 flex flex-col gap-[7px]">
        <p className="font-serif text-serif-sm text-text-primary truncate" title={item.title}>{item.title}</p>

        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-meta text-text-secondary truncate">{releaseLabel}</span>
          {scoreLoading ? (
            <span
              className="w-8 h-3 rounded-full bg-surface-overlay animate-pulse shrink-0"
              role="status"
              aria-label="Working out your Fandex Score"
            />
          ) : shownScore != null && (
            fandexScore != null
              ? <FandexScoreBadge score={fandexScore} center={fandexCenter} variant="inline" />
              : <CommunityScoreBadge score={item.communityScore} variant="inline" />
          )}
        </div>

        {item.roles && item.roles.length > 0 && (
          <div className="text-caption text-text-secondary line-clamp-1">{item.roles.join(", ")}</div>
        )}

        {/* Quick actions — skipped for a non-linkable item, which has no
            identity to act on. */}
        {linkable && <ActionCells item={item} layout="card" />}
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
          // T13 (2026-07-29): overflow-hidden removed — it was clipping the
          // rate quick-action's expanding 10-star popover at the card's
          // bottom edge (ActionCells' `picking` overlay is `absolute
          // top-full`, positioned to extend BELOW the card). rounded-md
          // alone still rounds this element's own background/border with no
          // overflow needed; the poster (the only child that ever overflowed
          // this box's rounded shape) now clips itself via its own wrapper's
          // rounded-t-md + overflow-hidden, just above.
          className="group cursor-pointer rounded-md border border-border bg-surface-elevated hover:border-border-strong transition-colors duration-base relative block"
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
