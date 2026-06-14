"use client";

// Minimal two-thumb range slider: two overlaid native range inputs whose tracks
// are transparent, with only the thumbs accepting pointer events (so either
// thumb is grabbable regardless of input stacking). The visible track + active
// segment are drawn separately underneath.
interface DualRangeSliderProps {
  min: number;
  max: number;
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
  className?: string;
}

export default function DualRangeSlider({ min, max, low, high, onChange, className }: DualRangeSliderProps) {
  const span = Math.max(1, max - min);
  const lowPct = ((low - min) / span) * 100;
  const highPct = ((high - min) / span) * 100;

  return (
    <div className={`relative h-6 select-none ${className ?? ""}`}>
      {/* base track */}
      <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 h-1 rounded-full bg-neutral-700" />
      {/* active segment */}
      <div
        className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-white"
        style={{ left: `${lowPct}%`, width: `${Math.max(0, highPct - lowPct)}%` }}
      />

      <input
        type="range"
        min={min}
        max={max}
        value={low}
        aria-label="Minimum tag frequency"
        onChange={(e) => onChange(Math.min(Number(e.target.value), high), high)}
        className="dual-range absolute left-0 top-0 w-full bg-transparent appearance-none pointer-events-none"
      />
      <input
        type="range"
        min={min}
        max={max}
        value={high}
        aria-label="Maximum tag frequency"
        onChange={(e) => onChange(low, Math.max(Number(e.target.value), low))}
        className="dual-range absolute left-0 top-0 w-full bg-transparent appearance-none pointer-events-none"
      />

      <style>{`
        .dual-range { height: 1.5rem; margin: 0; }
        .dual-range:focus { outline: none; }
        .dual-range::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          height: 14px; width: 14px; border-radius: 9999px;
          background: #fff; border: 2px solid #0a0a0a; cursor: pointer;
          pointer-events: auto; position: relative; z-index: 10;
        }
        .dual-range::-moz-range-thumb {
          height: 14px; width: 14px; border-radius: 9999px;
          background: #fff; border: 2px solid #0a0a0a; cursor: pointer;
          pointer-events: auto;
        }
        .dual-range::-webkit-slider-runnable-track { background: transparent; border: none; }
        .dual-range::-moz-range-track { background: transparent; border: none; }
      `}</style>
    </div>
  );
}
