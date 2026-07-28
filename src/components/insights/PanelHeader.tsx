// B7 (2026-07-28) — the mockup's panel heading anatomy (04-pages/insights.html:148),
// shared by every Insights section: an accent-colored mono eyebrow on the left,
// an optional right-aligned mono summary stat on the same baseline. Extracted
// (not inlined per-section) so InsightsView and FacetSection — which InsightsView
// itself renders, so it can't import back from there — share one definition.
export default function PanelHeader({ eyebrow, stat, hint }: { eyebrow: string; stat?: string; hint?: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-eyebrow uppercase text-accent">{eyebrow}</span>
        {stat && <span className="font-mono text-meta text-text-secondary shrink-0">{stat}</span>}
      </div>
      {hint && <p className="text-xs text-text-secondary mt-1">{hint}</p>}
    </div>
  );
}
