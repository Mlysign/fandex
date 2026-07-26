// H5.3 — the compact per-item Fandex Score badge shown on cards. Renders
// nothing when there's no score (cold-start, no matching facets, or a
// logged-out viewer): a missing number reads as neutral, a fabricated one
// would mislead (docs/fandex-score.md §8).
//
// Restyled H1.6b onto Direction 2a's score ramp (03-components.md §9a) —
// PER D-B (docs/ui-overhaul.md §8): the THRESHOLDS are unchanged from before
// the restyle (>=70 / >=50 / below), only the three colors swap to the
// design's tokens. The design's OWN 80/65 fixed band cutoffs are NOT
// adopted — Q19 recentered the score on the user's own baseline, so there is
// no fixed neutral point to band against; changing the cutoffs is a scoring
// decision, not a restyle, and stays out of this file's scope.
export function fandexScoreColor(score: number): string {
  return score >= 70 ? "#5FE39A" : score >= 50 ? "#CFC9BE" : "#F0A04B";
}

function matchStrength(score: number): string {
  return score >= 70 ? "strong match" : score >= 50 ? "typical match" : "weak match";
}

export default function FandexScoreBadge({
  score,
  size = "sm",
  variant = "inline",
  className = "",
}: {
  score: number | null | undefined;
  size?: "sm" | "md";
  /** "inline" — plain colored text for a card meta row. "overlay" — dark
   *  blurred pill for a poster corner (§9a "pill-overlay" form). */
  variant?: "inline" | "overlay";
  className?: string;
}) {
  if (score == null) return null;
  const rounded = Math.round(score);
  const color = fandexScoreColor(score);
  const label = `Fandex Score ${rounded} out of 100 — ${matchStrength(score)}`;

  if (variant === "overlay") {
    const dims = size === "md" ? "text-sm px-2.5 py-1 gap-1.5" : "text-[11px] px-1.5 py-0.5 gap-1";
    return (
      <span
        className={`inline-flex items-center rounded-xs font-bold leading-none whitespace-nowrap backdrop-blur-[5px] ${dims} ${className}`}
        style={{ background: "rgb(16 14 12 / 0.66)", color }}
        role="img"
        aria-label={label}
      >
        <span className="uppercase tracking-wide opacity-80 font-mono" style={{ fontSize: size === "md" ? 9 : 8 }} aria-hidden>
          Match
        </span>
        {rounded}
      </span>
    );
  }

  const dims = size === "md" ? "text-sm gap-1" : "text-[11px] gap-0.5";
  return (
    <span
      className={`inline-flex items-center font-mono font-bold leading-none whitespace-nowrap tabular-nums ${dims} ${className}`}
      style={{ color }}
      role="img"
      aria-label={label}
    >
      {rounded}
      <span className="opacity-70 text-[0.85em]" aria-hidden>/100</span>
    </span>
  );
}
