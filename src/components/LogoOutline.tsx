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
// The back card is dimmed rather than drawn at full weight: at 16px two
// overlapping outlines at equal contrast read as one noisy shape, and the
// depth is the only thing that makes it recognisable as the Fandex mark at all.
export default function LogoOutline({
  size = 16,
  className,
  strokeWidth = 1.7,
}: {
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
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
      <rect
        x="1" y="6" width="16" height="18" rx="3.4"
        opacity="0.5"
        transform="rotate(-9 9 15)"
      />
      <rect x="8" y="3" width="16" height="18" rx="3.4" />
    </svg>
  );
}
