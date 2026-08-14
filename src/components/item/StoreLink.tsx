"use client";
import { Globe } from "lucide-react";
import { BRAND_MARKS } from "@/lib/brandMarks";
import { SOURCE_COLORS } from "@/lib/constants";

// One outbound store/reference link on the item detail page.
//
// 2026-08-14 (Nils, mobile testing): "the links in a details page should not be
// these ugly chips with an arrow, just render the page's logo." They were
// `{name} →` text pills tinted by the SOURCE the link was DERIVED from, which
// was doubly odd — an IGDB-sourced Steam link rendered in IGDB's purple, so the
// colour named the middleman rather than the destination.
//
// Now: the brand's own mark, from a generated table (lib/brandMarks.ts, see
// scripts/gen-brand-marks.mjs). Remote favicons are not an option — the CSP
// blocks every external host — so the marks are inline SVG paths.
//
// ACCESSIBILITY: a bare logo is not a label. The mark is `aria-hidden` and the
// accessible name comes from a real (visually hidden) text node, so the link
// announces "Steam" rather than "link, graphic". The name is also the `title`,
// which gives sighted users a hover tooltip and covers the fallback case.
//
// COLOUR: the mark sits in the UI's own secondary text colour at rest and takes
// the brand's colour on hover/focus. A row of eleven saturated brand logos is a
// fruit salad that fights the whole "Ticket · Calm" palette; desaturating at
// rest keeps the row calm while still letting a logo be recognisably itself the
// moment you reach for it.

export interface StoreLinkItem {
  name: string;
  url: string;
  source: string;
  affiliate?: boolean;
}

export default function StoreLink({
  link, children,
}: {
  link: StoreLinkItem;
  /** Trailing content rendered inside the link, e.g. the affiliate marker. */
  children?: React.ReactNode;
}) {
  const mark = BRAND_MARKS[link.name];
  // Fallback tint for the two names with no brand mark: "Official site" (not a
  // brand at all) and RAWG (simple-icons carries no icon for it). Those fall
  // back to the source colour, which for RAWG IS its own colour.
  const hoverColor = mark?.hex ?? SOURCE_COLORS[link.source] ?? "var(--color-text-primary)";

  return (
    <a
      href={link.url}
      target="_blank"
      rel={link.affiliate ? "sponsored noopener noreferrer" : "noopener noreferrer"}
      title={link.name}
      className="group tap-44 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-surface-elevated text-text-secondary transition-colors hover:border-border-strong"
      style={{ ["--brand" as string]: hoverColor }}
    >
      {mark ? (
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          aria-hidden
          className="shrink-0 fill-current transition-colors group-hover:text-[var(--brand)] group-focus-visible:text-[var(--brand)]"
        >
          <path d={mark.path} />
        </svg>
      ) : (
        <Globe
          className="w-[15px] h-[15px] shrink-0 transition-colors group-hover:text-[var(--brand)] group-focus-visible:text-[var(--brand)]"
          aria-hidden
        />
      )}
      {/* The accessible name. Visible for the fallback case — "Official site"
          and RAWG are not recognisable from a globe or a dot — and screen-reader
          only where a real logo already carries the identity. */}
      <span className={mark ? "sr-only" : "text-xs"}>{link.name}</span>
      {children}
    </a>
  );
}
