"use client";
import { useId } from "react";

// The Fandex mark as a LINE icon (2026-09-03, Nils: "can you exchange the icon
// on the type filter stack to the fandex logo? a line design icon variation of
// that logo?").
//
// Same two stacked cards as `Logo.tsx`, the back one rotated -9°, drawn as
// strokes instead of fills. What it does differently from the brand mark, in
// every case because this one is a CONTROL rather than a signature:
//
//   · It inherits `currentColor`, so the chip it sits in owns its colour. The
//     filled mark's gold and show-purple are fixed by the brand; a filter chip
//     has to go accent when engaged and secondary when it is not, and a
//     two-colour logo in that slot would say "brand" in a row saying "state".
//   · BOTH cards are drawn at the same weight (Nils, third pass: "the logo line
//     icon uses different shades for the cards. make them the same. the more
//     transparent shade is barely visible"). The first version dimmed the back
//     card to 50% to stop the two outlines reading as one noisy shape; at 16px
//     on a dark chip that made it a smudge instead. The MASK below is what
//     separates them now, so the dimming was solving a problem that no longer
//     exists.
//
// ── Matching the icons beside it ────────────────────────────────────────────
//
// Nils: "i think the stroke thickness of the other icons for the type filter is
// slightly thicker? please verify this and adjust." He was right. Measured
// rather than eyeballed:
//
//   lucide (Gamepad2, Clapperboard, Tv)   viewBox 24, strokeWidth 2, box 16px
//                                          → 2 × 16/24 = 1.333px of stroke
//   this, before                           viewBox 26, strokeWidth 1.7, box 17px
//                                          → 1.7 × 17/26 = 1.111px
//
// So the neighbours were 20% heavier. The defaults below render 1.333px at a
// 16px box, the same size the lucide chips use, and `STROKE` is derived from
// that arithmetic rather than picked by eye. `strokeLinecap` is set for the same
// reason: lucide sets it, and matching a row of icons means matching all of it.
//
// ── Why there is a mask ─────────────────────────────────────────────────────
//
// "the logo should not have the border of the behind card shown through the
// front card." Exactly right, and it is what makes an outline version harder
// than a filled one: `Logo.tsx` gets this for free because its front card is
// OPAQUE and carries a surface-coloured stroke that cuts a channel between the
// two. An unfilled front card hides nothing, so the back card's outline ran
// straight across it and the mark read as a scribble rather than two cards.
//
// Filling the front card is not available: the chip behind it is transparent at
// rest and solid gold when the filter is engaged, so there is no one colour to
// fill it with. The mask paints the front card's own footprint, grown by a
// stroke width, out of the back card instead. That reproduces the filled mark's
// channel exactly, at any size and on any background.
//
// ⚠️ The mask needs a DOCUMENT-UNIQUE id, hence `useId` and hence `"use client"`.
// A hard-coded id would be duplicated once per rendered chip; browsers resolve
// `url(#id)` to the first match, so it would happen to look right and be invalid
// markup. React's ids contain colons and guillemets, which are not safe in a URL
// fragment reference, so they are stripped.

/** The box the type-filter chips draw their icons in (Tailwind `w-4 h-4`). */
const BOX = 16;
/** This icon's own grid. Wider than lucide's 24 so the rotated card has room. */
const VIEWBOX = 26;
/** lucide's rendered stroke at the same box: 2 units on a 24 grid. */
const LUCIDE_PX = (2 * BOX) / 24;
/** …expressed in THIS grid's units, so the two render identically. */
const STROKE = Number(((LUCIDE_PX * VIEWBOX) / BOX).toFixed(2));   // 2.17

export default function LogoOutline({
  size = BOX,
  className,
  strokeWidth = STROKE,
}: {
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const maskId = `fx-logo-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={VIEWBOX} height={VIEWBOX}>
        <rect width={VIEWBOX} height={VIEWBOX} fill="white" />
        {/* The front card's footprint, painted out. The knockout stroke is
            DOUBLE the drawn one: a stroke is centred on its path, so 2w extends
            w outward, leaving a clear channel of w/2 between the two outlines.
            That is the same separation the filled mark gets from its
            surface-coloured edge. */}
        <rect
          x="9.5" y="4" width="14.5" height="17" rx="3"
          fill="black" stroke="black" strokeWidth={strokeWidth * 2}
        />
      </mask>

      {/* Back card. Both cards are inset far enough that a half-stroke of 1.09
          still clears the viewBox on every side, INCLUDING after the rotation
          grows this one's bounding box to 16.98 x 19.06. */}
      <g mask={`url(#${maskId})`}>
        <rect x="2.5" y="6" width="14.5" height="17" rx="3" transform="rotate(-9 9.75 14.5)" />
      </g>

      <rect x="9.5" y="4" width="14.5" height="17" rx="3" />
    </svg>
  );
}
