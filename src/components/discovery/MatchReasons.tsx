// The "why" chips under a recommended card: the facets that pushed it up (+) or,
// when present, down (−). Tags use their category color; people/companies use
// their role color.
import { Reason } from "./types";
import { CATEGORY_COLORS } from "@/lib/tags";
import { ROLE_COLORS } from "@/lib/constants";

function color(r: Reason): string {
  if (r.kind === "tag") return CATEGORY_COLORS[r.category ?? "other"] ?? "#888";
  return ROLE_COLORS[r.role ?? ""] ?? "#888";
}

export default function MatchReasons({ reasons, max = 3 }: { reasons: Reason[]; max?: number }) {
  if (!reasons.length) return null;
  const shown = reasons.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1 px-0.5">
      {shown.map((r) => {
        const positive = r.contribution >= 0;
        const c = color(r);
        return (
          <span
            key={`${r.kind}|${r.role ?? ""}|${r.label}`}
            className="text-[10px] leading-none px-1.5 py-1 rounded truncate max-w-full"
            title={`${positive ? "boosts" : "lowers"}: ${r.label}`}
            style={
              positive
                ? { background: `${c}22`, color: c }
                : { background: "#7f1d1d22", color: "#f87171", textDecoration: "line-through" }
            }
          >
            {positive ? "" : "−"}{r.label}
          </span>
        );
      })}
      {reasons.length > max && <span className="text-[10px] leading-none px-1.5 py-1 text-neutral-600">+{reasons.length - max}</span>}
    </div>
  );
}
