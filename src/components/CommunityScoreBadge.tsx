// Q14 (2026-07-19) — the crowd/platform rating badge, ported from the public
// facet pages' bespoke card into the shared PosterCard/ListCard so it renders
// consistently everywhere the data is present. Renders nothing when absent
// (same "null/absent → no badge" rule as FandexScoreBadge).
export default function CommunityScoreBadge({
  score,
  size = "sm",
  className = "",
}: {
  score: number | null | undefined; // 0-100 scale
  size?: "sm" | "md";
  className?: string;
}) {
  if (score == null) return null;
  const dims = size === "md" ? "text-sm px-2.5 py-1" : "text-[11px] px-1.5 py-0.5";

  return (
    <span
      className={`inline-flex items-center rounded-md font-semibold leading-none whitespace-nowrap bg-black/70 text-white tabular-nums ${dims} ${className}`}
      title={`Crowd rating ${(score / 10).toFixed(1)}/10`}
    >
      {(score / 10).toFixed(1)}
    </span>
  );
}
