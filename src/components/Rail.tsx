"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";

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
  children: React.ReactNode;
  className?: string;
}

export default function Rail({ title, forYou, seeAllHref, children, className = "" }: RailProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);

  const scrollBy = (dir: 1 | -1) => {
    scrollerRef.current?.scrollBy({ left: dir * 320, behavior: "smooth" });
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
        {seeAllHref && (
          <Link href={seeAllHref} className="inline-flex items-center gap-1 text-label text-text-secondary hover:text-text-primary transition-colors shrink-0">
            See all
            <ArrowRight className="w-3.5 h-3.5" aria-hidden />
          </Link>
        )}
      </div>

      <div
        className="relative"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        <div
          ref={scrollerRef}
          className="grid grid-flow-col auto-cols-[150px] gap-3 overflow-x-auto pb-1 snap-x snap-proximity [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
