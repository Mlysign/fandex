"use client";
import { Globe } from "lucide-react";
import BrandGlyph from "@/components/BrandGlyph";
import { BRAND_MARKS } from "@/lib/brandMarks";

// One outbound store/reference link on the item detail page.
//
// 2026-08-14 (Nils, mobile testing): "the links in a details page should not be
// these ugly chips with an arrow, just render the page's logo." They were
// `{name} →` text pills tinted by the SOURCE the link was DERIVED from, which
// was doubly odd — an IGDB-sourced Steam link rendered in IGDB's purple, so the
// colour named the middleman rather than the destination.
//
// ── 2026-08-18, Nils, round two ─────────────────────────────────────────────
// "the logos inside the slabs are cool but so small they are not readable. just
// showing the logo should be enough." and "the hover on the logos still uses the
// color coding, this should be the normal hover highlight behavior from other
// buttons."
//
// The August 14 pass put the logo INSIDE the pill instead of replacing the pill
// with it, and shrank it to 15px to fit — which is fine for a pictorial mark
// (Steam, Reddit) and unreadable for a WORDMARK, and simple-icons gives us
// several of those: IGDB is the letters "IGDB" in a rounded box, Wikipedia is a
// glyph-heavy "W". At 15px inside a bordered chip they were noise.
//
// So: no chip. The mark is the control, at 22px, on a transparent ground that
// only fills on hover — the same ghost treatment `<Button variant="ghost">`
// uses, which is what "the normal hover highlight behavior from other buttons"
// means here. No brand colour in any state; `brandHoverColor()` and its
// #000000 guard are no longer needed anywhere and are gone.
//
// ACCESSIBILITY is unchanged and is why this is a link with a hidden label
// rather than a bare <svg>: the mark is `aria-hidden` and the accessible name
// comes from a real (visually hidden) text node, so it announces "Steam" and
// not "link, graphic". The name is also the `title`, giving sighted users a
// hover tooltip — which matters more now that the chip's text is gone.

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
  // "Official site" is not a brand and RAWG has no simple-icons entry, so both
  // fall back to a globe. Those two keep a VISIBLE label — a globe alone can't
  // say which of them it is, and two identical globes side by side is exactly
  // the ambiguity the logos were meant to remove.
  const hasMark = !!BRAND_MARKS[link.name];

  return (
    <a
      href={link.url}
      target="_blank"
      rel={link.affiliate ? "sponsored noopener noreferrer" : "noopener noreferrer"}
      title={link.name}
      className={
        "tap-44 inline-flex items-center gap-2 h-11 rounded-lg text-text-secondary " +
        "transition-colors duration-fast hover:text-text-primary hover:bg-[var(--fill-idle-hover)] " +
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] " +
        (hasMark ? "px-3" : "px-3.5")
      }
    >
      {hasMark ? (
        <BrandGlyph source={link.name} size={22} className="text-current" />
      ) : (
        <Globe className="w-[18px] h-[18px] shrink-0" aria-hidden />
      )}
      <span className={hasMark ? "sr-only" : "text-sm"}>{link.name}</span>
      {children}
    </a>
  );
}
