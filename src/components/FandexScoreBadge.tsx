// H5.3 — the compact per-item Fandex Score badge shown on cards. Renders
// nothing when there's no score (cold-start, no matching facets, or a
// logged-out viewer): a missing number reads as neutral, a fabricated one
// would mislead (docs/fandex-score.md §8).
//
// Restyled H1.6b onto Direction 2a's score ramp (03-components.md §9a) — the
// design's OWN 80/65 fixed band cutoffs are NOT adopted, since Q19 recentered
// the score on the user's own baseline, so there is no fixed neutral point to
// band against.
//
// S11 (2026-07-27, fixes SM12): D-B's decision was "keep baseline-relative
// thresholds" — but the thresholds were never actually baseline-relative, they
// were a hardcoded >=70/>=50 that only coincidentally read right for a user
// whose baseline happened to be ~7. Bands are now `center ± BAND_MARGIN`, so
// "typical match" means "about your own average" for every user. `center`
// defaults to 50 (the pre-Q19 fixed center) when unavailable — same numeric
// behavior as before this fix for any caller that hasn't threaded it through
// yet, rather than silently mis-banding against a wrong assumed baseline.
//
// 2026-07-29: re-anchored from 8 to 10 alongside the raw-sum aggregate rework
// (scripts/calibrate-fandex.mjs) — round((p75 - p25) / 2) of the owner's real
// calibrated score distribution (p25 60.3, p75 80.9). The old value of 8 was
// calibrated for the mean's much narrower spread and no longer means anything
// against the wider, unbounded sum.
const BAND_MARGIN = 10;

export function fandexScoreColor(score: number, center: number | null = 50): string {
  const c = center ?? 50;
  return score >= c + BAND_MARGIN ? "#5FE39A" : score <= c - BAND_MARGIN ? "#F0A04B" : "#CFC9BE";
}

export function matchStrength(score: number, center: number | null = 50): string {
  const c = center ?? 50;
  return score >= c + BAND_MARGIN ? "strong match" : score <= c - BAND_MARGIN ? "weak match" : "typical match";
}

export default function FandexScoreBadge({
  score,
  center = null,
  size = "sm",
  variant = "inline",
  className = "",
}: {
  score: number | null | undefined;
  /** The score's center (baseline*10) — bands render relative to THIS, not a
   *  fixed point. Omit only when the caller genuinely has none to give. */
  center?: number | null;
  size?: "sm" | "md";
  /** "inline" — plain colored text for a card meta row. "overlay" — dark
   *  blurred pill for a poster corner (§9a "pill-overlay" form). */
  variant?: "inline" | "overlay";
  className?: string;
}) {
  if (score == null) return null;
  const rounded = Math.round(score);
  const color = fandexScoreColor(score, center);
  const label = `Fandex Score ${rounded} — ${matchStrength(score, center)}`;

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

  // 03-components.md §2's meta-row score: the NUMBER is serif (19px on a card,
  // scaled down for denser rows) in the score colour. Was mono-bold before the
  // 2026-07-27 mockup audit — the serif is what makes the score read as the
  // card's one editorial accent rather than another piece of metadata.
  //
  // 2026-07-29: dropped the mono "/100" suffix — the raw-sum rework made the
  // score genuinely unbounded (this library's real range is 27.5-129.2), so a
  // "/100" denominator would be actively misleading now, not just decorative.
  // The strong/typical/weak band word (in the aria-label, and via `color`
  // here) carries the meaning a fixed scale used to.
  const dims = size === "md" ? "text-[21px]" : "text-[19px]";
  return (
    <span
      className={`inline-flex items-baseline gap-0.5 font-serif leading-none whitespace-nowrap tabular-nums ${dims} ${className}`}
      style={{ color }}
      role="img"
      aria-label={label}
    >
      {rounded}
    </span>
  );
}
