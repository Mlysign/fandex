// Q14 (2026-07-19) — the crowd/platform rating badge, ported from the public
// facet pages' bespoke card into the shared PosterCard/ListCard so it renders
// consistently everywhere the data is present. Renders nothing when absent
// (same "null/absent → no badge" rule as FandexScoreBadge).
//
// Restyled H1.6b — deliberately NEUTRAL (no color-coding), unlike Fandex
// Score: the design brief's restraint rule reserves color meaning for the
// ONE personal score; the crowd number is presented as plain metadata.
export default function CommunityScoreBadge({
  score,
  size = "sm",
  variant = "inline",
  className = "",
}: {
  score: number | null | undefined; // 0-100 scale
  size?: "sm" | "md";
  /** "inline" — plain text for a card meta row. "overlay" — dark blurred pill for a poster corner. */
  variant?: "inline" | "overlay";
  className?: string;
}) {
  if (score == null) return null;
  const value = (score / 10).toFixed(1);
  const label = `Crowd rating ${value} out of 10`;

  if (variant === "overlay") {
    const dims = size === "md" ? "text-sm px-2.5 py-1" : "text-[11px] px-1.5 py-0.5";
    return (
      <span
        className={`inline-flex items-center rounded-xs font-semibold leading-none whitespace-nowrap tabular-nums backdrop-blur-[5px] text-text-primary ${dims} ${className}`}
        style={{ background: "rgb(16 14 12 / 0.66)" }}
        role="img"
        aria-label={label}
      >
        {value}
      </span>
    );
  }

  const dims = size === "md" ? "text-sm" : "text-[11px]";
  return (
    <span
      className={`inline-flex items-center font-mono text-text-secondary leading-none whitespace-nowrap tabular-nums ${dims} ${className}`}
      role="img"
      aria-label={label}
    >
      ★ {value}
    </span>
  );
}
