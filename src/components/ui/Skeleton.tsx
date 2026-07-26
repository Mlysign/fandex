// <Skeleton> — 03-components.md §13. Base neutral-800, shimmer sweep to
// neutral-750, 1200ms linear infinite; reduced-motion collapses the sweep to
// a static fill via the global rule in globals.css (animation-duration is
// forced to ~0), so no separate reduced-motion branch is needed here.
export default function Skeleton({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={`relative overflow-hidden bg-neutral-800 ${className}`}
      {...props}
    >
      <span
        className="absolute inset-0 -translate-x-full animate-[shimmer_1200ms_linear_infinite]"
        style={{ background: "linear-gradient(90deg, transparent, var(--color-neutral-750), transparent)" }}
      />
    </div>
  );
}

// Convenience shapes matching the spec's guidance ("poster 2:3 blocks, text
// bars at radius-xs"; rails show 4 cards, grids show 6, agenda shows 3 rows).
export function SkeletonPoster({ className = "" }: { className?: string }) {
  return <Skeleton className={`aspect-[2/3] rounded-md ${className}`} />;
}

export function SkeletonText({ className = "" }: { className?: string }) {
  return <Skeleton className={`h-3 rounded-xs ${className}`} />;
}
