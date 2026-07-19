// One horizontal rating bar: label · 0-10 bar with a baseline tick · avg ×count.
// The visual language of the old TagBar, generalized for tags/people/companies.
// When `href` is given, the whole row links to that facet's detail page.
import Link from "next/link";

export default function StatBar({
  label, value, rawAvg, count, color, baseline, title, href,
}: {
  label: string;
  value: number;       // 0-10 — drives the bar (Q22: the Bayesian score, not the raw average)
  rawAvg?: number;      // Q22: the plain average, shown as a smaller secondary hint when it differs
  count: number;
  color: string;
  baseline: number;    // your mean rating (drawn as a tick)
  title?: string;
  href?: string;
}) {
  const inner = (
    <div className="flex items-center gap-3 px-1 py-1" title={title ?? label}>
      <span className="w-40 shrink-0 text-sm truncate text-neutral-300">{label}</span>
      <div className="relative flex-1 h-2.5 rounded-full bg-neutral-800 overflow-hidden">
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
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-neutral-400">
        {value.toFixed(1)} <span className="text-neutral-600">×{count}</span>
        {rawAvg != null && Math.abs(rawAvg - value) >= 0.05 && (
          <span className="block text-[10px] text-neutral-600">avg {rawAvg.toFixed(1)}</span>
        )}
      </span>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block rounded-md -mx-1 px-1 hover:bg-neutral-800/60 transition-colors">
        {inner}
      </Link>
    );
  }
  return inner;
}
