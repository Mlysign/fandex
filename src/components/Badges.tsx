"use client";
import { TYPE_COLORS, SOURCE_COLORS, SOURCE_LABELS } from "@/lib/constants";

// Shared, dependency-free badge primitives used across list rows, cards,
// the search modal, and the item inspection page.

export function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded font-medium capitalize"
      style={{ background: `${TYPE_COLORS[type] ?? "#888"}22`, color: TYPE_COLORS[type] ?? "#888" }}
    >
      {type}
    </span>
  );
}

export function SourcePill({ source }: { source: string }) {
  return (
    <span
      className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
      style={{
        borderColor: `${SOURCE_COLORS[source] ?? "#888"}44`,
        color: SOURCE_COLORS[source] ?? "#888",
        background: `${SOURCE_COLORS[source] ?? "#888"}11`,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: SOURCE_COLORS[source] ?? "#888" }} />
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}
