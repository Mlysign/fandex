import Panel from "@/components/ui/Panel";

// The mockup's `.stat3` — ONE bordered panel split into equal cells by hairline
// dividers, not N separate cards (04-pages/home.html). Home used three standalone
// StatTiles until 2026-07-30; Nils asked for the counters "combined in one strip"
// so the rotating highlight panels below read as the varying part and the counters
// as the fixed anchor.
//
// Cells are `flex-1` with a left border from the second on, exactly like the
// mockup, and the number is serif over a mono label.
export interface StatCell {
  label: string;
  value: React.ReactNode;
}

export default function StatStrip({ cells, className = "" }: { cells: StatCell[]; className?: string }) {
  if (cells.length === 0) return null;
  return (
    <Panel className={`flex items-stretch overflow-hidden p-0 ${className}`}>
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={`flex-1 px-2 py-4 text-center ${i > 0 ? "border-l border-border" : ""}`}
        >
          <div className="font-serif text-serif-lg text-text-primary leading-none tabular-nums">{c.value}</div>
          <div className="font-mono text-meta text-text-secondary mt-1.5">{c.label}</div>
        </div>
      ))}
    </Panel>
  );
}
