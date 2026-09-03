"use client";
import { useId } from "react";

// The Fandex mark as a LINE icon (2026-09-03, Nils: "can you exchange the icon
// on the type filter stack to the fandex logo? a line design icon variation of
// that logo?").
//
// Same two stacked cards as `Logo.tsx`, the back one rotated -9°, drawn as
// strokes instead of fills. Two things it does differently from the brand mark,
// both because this one is a CONTROL rather than a signature:
//
//   · It inherits `currentColor`, so the chip it sits in owns its colour. The
//     filled mark's gold and show-purple are fixed by the brand; a filter chip
//     has to go accent when engaged and secondary when it is not, and a
//     two-colour logo in that slot would say "brand" in a row that is saying
//     "state".
//   · It is drawn on the same 26-unit grid but inset by half a stroke, because
//     the filled version's rects sit flush to the viewBox edge and a stroke
//     centred on that line renders half-clipped.
//
// ── Why there is a mask (Nils, second pass) ─────────────────────────────────
//
// "the logo should not have the border of the behind card shown through the
// front card." Exactly right, and it is what makes an outline version harder
// than a filled one: `Logo.tsx` gets this for free because its front card is
// OPAQUE and carries a surface-coloured stroke that cuts a 1px channel between
// the two. An unfilled front card hides nothing, so the back card's outline ran
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
// markup. React's ids contain colons and guillemets, which are not safe in a
// URL fragment reference, so they are stripped.
export default function LogoOutline({
  size = 16,
  className,
  strokeWidth = 1.7,
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
      viewBox="0 0 26 26"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="26" height="26">
        <rect width="26" height="26" fill="white" />
        {/* The front card's footprint, painted out. The knockout stroke is
            DOUBLE the drawn one: a stroke is centred on its path, so 2w extends
            w outward, which leaves a clear channel of w/2 between the two
            outlines. That is the same separation the filled mark gets from its
            surface-coloured edge. */}
        <rect
          x="8" y="3" width="16" height="18" rx="3.4"
          fill="black" stroke="black" strokeWidth={strokeWidth * 2}
        />
      </mask>

      {/* Back card. Dimmed as well as clipped: at 16px two outlines at equal
          contrast read as one noisy shape, and the depth is the only thing that
          makes this recognisable as the Fandex mark at all. */}
      <g mask={`url(#${maskId})`}>
        <rect
          x="1" y="6" width="16" height="18" rx="3.4"
          opacity="0.5"
          transform="rotate(-9 9 15)"
        />
      </g>

      <rect x="8" y="3" width="16" height="18" rx="3.4" />
    </svg>
  );
}
