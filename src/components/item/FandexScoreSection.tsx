"use client";
import { useState } from "react";
import { Reason } from "@/components/discovery/types";
import { fandexScoreColor } from "@/components/FandexScoreBadge";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/lib/tags";
import { ROLE_COLORS, ROLE_LABELS } from "@/lib/constants";

// H5.3 — the detail-page Fandex Score: the prominent number + a click-to-expand
// breakdown (docs/fandex-score.md §3.4/§7). Three states:
//   coldStart      → "rate a few titles to unlock" nudge, no number (§8)
//   score == null  → nothing (enough signal overall, but THIS item shares no
//                     facets with the profile — not a cold-start, just no match)
//   score present  → the number + expandable reasons

function reasonColor(r: Reason): string {
  return r.kind === "tag" ? (CATEGORY_COLORS[r.category ?? "other"] ?? "#888") : (ROLE_COLORS[r.role ?? ""] ?? "#888");
}
function reasonGroupLabel(r: Reason): string {
  return r.kind === "tag" ? (CATEGORY_LABELS[r.category ?? "other"] ?? "Tag") : (ROLE_LABELS[r.role ?? ""] ?? "Person");
}

export default function FandexScoreSection({ score, reasons, coldStart }: { score: number | null; reasons: Reason[]; coldStart: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (coldStart) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-3.5 py-3 text-sm text-neutral-400">
        Rate a few titles to unlock your Fandex Score — a personalized 0-100 taste match for everything you browse.
      </div>
    );
  }
  if (score == null) return null;

  const rounded = Math.round(score);
  const color = fandexScoreColor(score);
  const sorted = [...reasons].sort((a, b) => b.contribution - a.contribution);

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        disabled={!reasons.length}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left disabled:cursor-default"
        aria-expanded={expanded}
        aria-label={`Fandex Score ${rounded} out of 100${reasons.length ? " — show breakdown" : ""}`}
      >
        <span className="text-2xl font-bold leading-none" style={{ color }}>{rounded}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-neutral-200">Fandex Score</span>
          <span className="block text-xs text-neutral-500">how well this matches your taste</span>
        </span>
        {reasons.length > 0 && (
          <span className="text-neutral-500 text-xs shrink-0">{expanded ? "Hide why ▲" : "Why? ▼"}</span>
        )}
      </button>

      {expanded && (
        <div className="px-3.5 pb-3.5 space-y-1.5 border-t border-neutral-800/70 pt-3">
          {sorted.map((r) => {
            const positive = r.contribution >= 0;
            const c = reasonColor(r);
            return (
              <div key={`${r.kind}|${r.role ?? ""}|${r.label}`} className="flex items-start justify-between gap-3 text-xs">
                <span className="min-w-0">
                  <span className="uppercase tracking-wide text-[10px] font-bold" style={{ color: c }}>{reasonGroupLabel(r)}</span>
                  <span className="text-neutral-300"> — {r.label}</span>
                  {r.BA != null && r.n != null && (
                    <span className="block text-neutral-500 mt-0.5">
                      you rate this {r.BA.toFixed(1)} avg over {r.n} title{r.n === 1 ? "" : "s"}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-semibold" style={{ color: positive ? "#4ade80" : "#f87171" }}>
                  {positive ? "+" : ""}{r.contribution.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
