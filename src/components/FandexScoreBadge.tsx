// H5.3 — the compact per-item Fandex Score badge shown on cards. Renders
// nothing when there's no score (cold-start, no matching facets, or a
// logged-out viewer): a missing number reads as neutral, a fabricated one
// would mislead (docs/fandex-score.md §8).
//
// Color thresholds mirror ActionCells' personal-rating pill (green ≥7,
// amber ≥5, red below, on a 0-10 scale) scaled to Fandex's 0-100 range, with
// the cutoff nudged to align with 50 = "matches your baseline exactly": below
// baseline reads as a genuine mismatch, not just a middling one.
export function fandexScoreColor(score: number): string {
  return score >= 70 ? "#4ade80" : score >= 50 ? "#f59e0b" : "#ef4444";
}

export default function FandexScoreBadge({
  score,
  size = "sm",
  className = "",
}: {
  score: number | null | undefined;
  size?: "sm" | "md";
  className?: string;
}) {
  if (score == null) return null;
  const rounded = Math.round(score);
  const color = fandexScoreColor(score);
  const dims = size === "md" ? "text-sm px-2.5 py-1 gap-1.5" : "text-[11px] px-1.5 py-0.5 gap-1";

  return (
    <span
      className={`inline-flex items-center rounded-md font-bold leading-none whitespace-nowrap ${dims} ${className}`}
      style={{ background: `${color}26`, color }}
      title={`Fandex Score ${rounded}/100 — how well this matches your taste`}
    >
      <span className="uppercase tracking-wide opacity-80 font-bold" style={{ fontSize: size === "md" ? 9 : 8 }}>Match</span>
      {rounded}
    </span>
  );
}
