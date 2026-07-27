// Fandex brand mark — two stacked "cards", the mockups' brand mark
// (04-pages/*.html `.mark`): a show-purple card rotated -9° behind an
// accent-gold one, separated by a 1px surface-coloured edge.
//
// 2026-07-27: replaced the old indigo→violet "F" monogram. That mark predated
// Direction 2a and used #6366f1/#8b5cf6 — two colours that appear NOWHERE in
// the Ticket · Calm token set, so the app's most-repeated element was also its
// most off-palette one. Colours here are the shipping media-show hex and the
// brass accent, both real tokens.
//
// NOTE: the app icons / favicon / PWA manifest still carry the old monogram —
// regenerating those is a separate asset task, flagged in the mockup audit.
export default function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 26 26"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="0" y="5" width="18" height="20" rx="4"
        fill="var(--color-media-show, #a78bfa)"
        transform="rotate(-9 9 15)"
      />
      <rect
        x="7" y="2" width="18" height="20" rx="4"
        fill="var(--color-accent, #C8A24B)"
        stroke="var(--color-surface, #100E0C)"
        strokeWidth="1"
      />
    </svg>
  );
}
