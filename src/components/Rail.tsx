"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { scrollBehavior } from "@/lib/scrollBehavior";

// <Rail> — 03-components.md §4, NEW component (the board's "Card Carousel
// View" — did not exist in code before H1.6). Generic horizontal-scroll
// shell; callers supply the items (PosterCard for poster-rail, a custom
// avatar row for people-rail, TagChip/Chip for chip-rail — no variant prop
// needed, the child content IS the variant).
//
// Keyboard note: items are real focusable elements (links/buttons) in DOM
// order, so Tab already reaches every one — the spec's "roving tabindex, one
// tab stop for the rail + arrow keys within" is a further a11y refinement
// not implemented here; flagged for the H1.6f a11y pass rather than blocking
// this component's first use.

export interface RailProps {
  title: string;
  forYou?: boolean;
  /** "See all" link in the header, e.g. to a full listing page. */
  seeAllHref?: string;
  /**
   * Arbitrary control in the header's trailing slot, where `seeAllHref` would
   * go. For rails that are dismissible or otherwise interactive rather than a
   * gateway to a listing page — Calendar's day rail (MB8) uses it for Close.
   * Takes precedence over `seeAllHref`; passing both is a call-site mistake, so
   * the action wins rather than the two stacking up in one corner.
   */
  action?: React.ReactNode;
  /**
   * Column width for the scroller, as a Tailwind `auto-cols-*` class. Defaults
   * to the 150px poster column every rail used before 2026-08-16. Home's
   * progress rail carries three lines of text instead of a poster, so it needs a
   * wider column — a prop rather than a second scroller so the header, the
   * chevrons and the scroll behaviour stay in one place.
   */
  colsClass?: string;
  children: React.ReactNode;
  className?: string;
}

export default function Rail({
  title, forYou, seeAllHref, action, colsClass = "auto-cols-[150px]", children, className = "",
}: RailProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);

  const scrollBy = (dir: 1 | -1) => {
    scrollerRef.current?.scrollBy({ left: dir * 320, behavior: scrollBehavior() });
  };

  return (
    <section className={className}>
      <div className="flex items-center justify-between gap-3 mb-3 px-1">
        <div className="flex items-center gap-2.5">
          <h2 className="font-serif text-serif-md text-text-primary">{title}</h2>
          {forYou && (
            <span className="inline-flex items-center rounded-full bg-accent-subtle text-accent font-mono text-micro uppercase px-2 py-1">
              For you
            </span>
          )}
        </div>
        {action ? (
          <div className="shrink-0">{action}</div>
        ) : seeAllHref ? (
          <Link href={seeAllHref} className="inline-flex items-center gap-1 text-label text-text-secondary hover:text-text-primary transition-colors shrink-0">
            See all
            <ArrowRight className="w-3.5 h-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>

      <div
        className="relative"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        <div
          ref={scrollerRef}
          className={`grid grid-flow-col ${colsClass} gap-3 overflow-x-auto pb-1 snap-x snap-proximity [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
        >
          {children}
        </div>

        {/* Desktop-only chevron overlays — fade in on hover, no fade under
            reduced-motion (still functional, just no transition per §4). */}
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          aria-label={`Scroll ${title} left`}
          className={`hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 items-center justify-center rounded-full bg-surface-overlay border border-border shadow-lg transition-opacity duration-base ${
            hovering ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <ChevronLeft className="w-4 h-4 text-text-primary" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => scrollBy(1)}
          aria-label={`Scroll ${title} right`}
          className={`hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-9 h-9 items-center justify-center rounded-full bg-surface-overlay border border-border shadow-lg transition-opacity duration-base ${
            hovering ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <ChevronRight className="w-4 h-4 text-text-primary" aria-hidden />
        </button>
      </div>
    </section>
  );
}
