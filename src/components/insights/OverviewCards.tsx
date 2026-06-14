"use client";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-neutral-400 mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-neutral-600 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function OverviewCards({
  overview,
}: {
  overview: {
    ratedTotal: number;
    libraryTotal: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    meanRating: number | null;
  };
  baseline: number;
}) {
  const typeEntries = Object.entries(overview.byType).filter(([, n]) => n > 0);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <Stat label="Rated items" value={String(overview.ratedTotal)} sub={`${overview.libraryTotal} in library`} />
      <Stat label="Average" value={overview.meanRating != null ? overview.meanRating.toFixed(1) : "—"} sub="your mean rating" />
      {typeEntries.map(([type, n]) => (
        <Stat key={type} label={`${type[0].toUpperCase()}${type.slice(1)}s`} value={String(n)} />
      ))}
    </div>
  );
}
