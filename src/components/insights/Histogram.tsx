// Lightweight CSS bar chart — no charting dependency. Used for the rating
// distribution (0.5 buckets, 1..10) and the per-type mini distributions.

import { HistogramBucket } from "./types";

export default function Histogram({
  data, color = "#a3a3a3", baseline, height = 140, compact = false, onBarClick, selected,
}: {
  data: HistogramBucket[];
  color?: string;
  baseline?: number;   // draws a vertical "your average" tick on the 1..10 axis
  height?: number;
  compact?: boolean;   // smaller bars + integer-only labels, for the mini charts
  onBarClick?: (bucket: number) => void; // makes non-empty bars clickable
  selected?: number | null;              // highlight one bucket, dim the rest
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const lo = data.length ? data[0].bucket : 1;
  const hi = data.length ? data[data.length - 1].bucket : 10;
  const span = hi - lo || 1;

  return (
    <div className="relative" style={{ height }}>
      <div className="flex items-end gap-px h-full">
        {data.map((d) => {
          const isInt = Number.isInteger(d.bucket);
          const clickable = !!onBarClick && d.count > 0;
          const dimmed = selected != null && selected !== d.bucket;
          return (
            <div
              key={d.bucket}
              className={`flex-1 flex flex-col items-center justify-end h-full group ${clickable ? "cursor-pointer" : ""}`}
              onClick={clickable ? () => onBarClick!(d.bucket) : undefined}
            >
              {!compact && d.count > 0 && (
                <span className="text-[9px] leading-none text-neutral-500 mb-0.5 tabular-nums">{d.count}</span>
              )}
              <div
                className="w-full rounded-t transition-all group-hover:brightness-125"
                style={{
                  height: `${(d.count / max) * 100}%`,
                  minHeight: d.count > 0 ? 2 : 0,
                  background: color,
                  opacity: dimmed ? 0.3 : 0.8,
                  outline: selected === d.bucket ? `1px solid ${color}` : undefined,
                  outlineOffset: 1,
                }}
                title={`${d.bucket.toFixed(1)} — ${d.count}`}
              />
              <span className="text-[9px] leading-none text-neutral-600 mt-1 h-2.5 tabular-nums">
                {isInt ? d.bucket : ""}
              </span>
            </div>
          );
        })}
      </div>
      {baseline != null && baseline > 0 && (
        <div
          className="absolute top-0 w-px bg-neutral-400/70 pointer-events-none"
          style={{ left: `${((baseline - lo) / span) * 100}%`, bottom: 14 }}
          title={`Your average: ${baseline.toFixed(1)}`}
        />
      )}
    </div>
  );
}
