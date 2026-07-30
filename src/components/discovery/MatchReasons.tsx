// The "why" chips under a recommended card: the facets that pushed it up (+) or,
// when present, down (−). Colour comes from the facet's CLASS (person / genre /
// other-tag / company) — see lib/facetPalette.ts. It used to be one of 17 hues
// (per-category for tags, per-role for people/companies).
import type { Reason } from "./types";
import { facetChipStyle } from "@/lib/facetPalette";

export default function MatchReasons({ reasons, max = 3 }: { reasons: Reason[]; max?: number }) {
  if (!reasons.length) return null;
  const shown = reasons.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1 px-0.5">
      {shown.map((r) => {
        const positive = r.contribution >= 0;
        return (
          <span
            key={`${r.kind}|${r.role ?? ""}|${r.label}`}
            className="text-[10px] leading-none px-1.5 py-1 rounded truncate max-w-full"
            title={`${positive ? "boosts" : "lowers"}: ${r.label}`}
            style={
              positive
                ? facetChipStyle(r)
                : { background: "#7f1d1d22", color: "#f87171", textDecoration: "line-through" }
            }
          >
            {positive ? "" : "−"}{r.label}
          </span>
        );
      })}
      {reasons.length > max && <span className="text-[10px] leading-none px-1.5 py-1 text-text-secondary">+{reasons.length - max}</span>}
    </div>
  );
}
