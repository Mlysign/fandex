"use client";
import { useState } from "react";

// Reusable quick-action controls shared by PosterCard and ListCard.

export const ratingColor = (r: number) => (r >= 7 ? "#4ade80" : r >= 5 ? "#f59e0b" : "#ef4444");
const stop = (e: React.MouseEvent) => e.stopPropagation();

// 10-segment quick-rate bar. Click segment N to rate N/10; hover previews fill.
export function RateBar({ rating, busy, onRate }: { rating: number | null; busy: boolean; onRate: (n: number) => void }) {
  const [hoverN, setHoverN] = useState(0);
  const shown = hoverN || rating || 0;
  return (
    <div className="flex gap-px flex-1" onMouseLeave={() => setHoverN(0)} onClick={stop} title="Quick rate">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          onMouseEnter={() => setHoverN(n)}
          onClick={(e) => { stop(e); if (!busy) onRate(n); }}
          title={`Rate ${n}/10`}
          className="flex-1 h-4 min-w-[5px] rounded-[1px] transition-colors"
          style={{ background: shown >= n ? ratingColor(shown) : "rgba(255,255,255,0.18)" }}
        />
      ))}
    </div>
  );
}

export function WishlistButton({ wishlisted, busy, onToggle }: { wishlisted: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => { stop(e); if (!busy) onToggle(); }}
      title={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
      className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-colors"
      style={{ background: wishlisted ? "#16a34a" : "rgba(255,255,255,0.15)", color: "#fff" }}
    >
      <svg viewBox="0 0 24 24" width="13" height="13" fill={wishlisted ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}
