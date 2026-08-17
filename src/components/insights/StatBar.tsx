// One rating bar row — B7 (2026-07-28): the mockup's anatomy (04-pages/insights.html:149),
// a label + count·avg pair above a 6px accent progress bar, rather than the
// old single-line label/bar/value layout. The baseline tick + below-average
// dimming are real analysis the mockup's static example never showed, kept
// here rather than dropped for literal mockup parity.
import Link from "next/link";
import NavPendingBar from "@/components/ui/NavPendingBar";

export default function StatBar({
  label, value, rawAvg, count, color, baseline, title, href, impact,
}: {
  label: string;
  value: number;       // 0-10 — drives the bar (Q22: the Bayesian score, not the raw average)
  rawAvg?: number;      // Q22: the plain average, shown alongside when it differs
  count: number;
  color: string;
  baseline: number;    // your mean rating (drawn as a tick)
  title?: string;
  href?: string;
  // T10 (2026-07-29) — the canonical Fandex Score points this facet is worth
  // (facetImpact()), the SAME number the item page's breakdown and the facet
  // page's "Fandex impact" panel show. Omit for kinds that don't carry one.
  impact?: number | null;
}) {
  const showRaw = rawAvg != null && Math.abs(rawAvg - value) >= 0.05;
  const inner = (
    <div className="py-1.5" title={title ?? label}>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        {/* MB7 — `truncate` alone does NOTHING here. A flex item defaults to
            `min-width: auto`, so this span kept contributing the full width of
            names like "Sony Interactive Entertainment", growing its card past
            the viewport. `min-w-0` is what lets the ellipsis actually engage. */}
        <span className="min-w-0 text-sm font-medium text-text-primary truncate">{label}</span>
        <span className="font-mono text-meta text-text-secondary shrink-0 tabular-nums">
          {count} · {value.toFixed(1)}{showRaw && ` (avg ${rawAvg!.toFixed(1)})`}
          {impact != null && (
            <span className="ml-1.5" style={{ color: impact >= 0 ? "var(--color-success)" : "var(--color-danger)" }}>
              {impact >= 0 ? "+" : ""}{impact.toFixed(1)}
            </span>
          )}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-neutral-800 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${(value / 10) * 100}%`, background: color, opacity: value >= baseline ? 0.85 : 0.35 }}
        />
        {baseline > 0 && (
          <div
            className="absolute top-0 bottom-0 w-px bg-neutral-400/70"
            style={{ left: `${(baseline / 10) * 100}%` }}
            title={`Your average: ${baseline.toFixed(1)}`}
          />
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      // 2026-08-14: `hover:` alone was the entire feedback story here, and a
      // phone has no hover — tapping a facet looked like nothing happened while
      // a force-dynamic facet page took its time. `active:` covers the press,
      // <NavPendingBar> covers the wait. `relative` is what the bar positions
      // against; `touch-manipulation` drops the 300ms tap delay so the press
      // state appears on contact rather than after a double-tap timeout.
      <Link
        href={href}
        className="relative block rounded-md -mx-2 px-2 touch-manipulation transition-colors hover:bg-surface-elevated active:bg-surface-overlay"
      >
        {inner}
        <NavPendingBar />
      </Link>
    );
  }
  return inner;
}
