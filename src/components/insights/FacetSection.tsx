"use client";
import { useMemo, useState } from "react";
import StatBar from "./StatBar";
import { FacetStat } from "./types";
import { CATEGORIES, CATEGORY_COLORS } from "@/lib/tags";
import { ROLE_COLORS, ROLE_LABELS } from "@/lib/constants";
import { buildFacetHref } from "@/lib/itemUrl";

const PERSON_ROLES = ["director", "writer", "creator", "cast"];
const COMPANY_ROLES = ["developer", "publisher", "studio", "network"];
const PER_GROUP = 12; // top/bottom rows shown per group before "+N more"

interface Group { id: string; label: string; color: string; facets: FacetStat[] }

// One category/role group. When `collapsedCount` is set the group starts capped
// at that many rows with a click-to-expand toggle; otherwise it keeps the legacy
// "show up to PER_GROUP, +N more — search" behaviour.
function FacetGroup({
  group, sorted, eligibleCount, baseline, collapsedCount,
}: {
  group: Group;
  sorted: FacetStat[];
  eligibleCount: number;
  baseline: number;
  collapsedCount: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = collapsedCount != null;
  const limit = collapsible ? collapsedCount! : PER_GROUP;
  const shown = expanded ? sorted : sorted.slice(0, limit);

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full" style={{ background: group.color }} />
        <span className="text-sm font-medium text-neutral-200">{group.label}</span>
        <span className="text-xs text-neutral-600">{eligibleCount}</span>
      </div>
      <div className="space-y-0.5">
        {shown.map((f) => (
          <StatBar key={`${f.role ?? ""}|${f.key}`} label={f.label} value={f.avg} count={f.count} color={group.color} baseline={baseline} href={buildFacetHref(f)} />
        ))}
        {collapsible
          ? sorted.length > limit && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-[11px] text-neutral-500 hover:text-white px-1 pt-1"
              >
                {expanded ? "Show less" : `Show ${sorted.length - limit} more`}
              </button>
            )
          : sorted.length > PER_GROUP && (
              <p className="text-[11px] text-neutral-600 px-1 pt-1">+{sorted.length - PER_GROUP} more — search to find them</p>
            )}
      </div>
    </div>
  );
}

export default function FacetSection({
  title, subtitle, kind, facets, baseline, collapsible = false, defaultVisible = 3,
}: {
  title: string;
  subtitle: string;
  kind: "tag" | "person" | "company";
  facets: FacetStat[];
  baseline: number;
  collapsible?: boolean;   // start each group capped at `defaultVisible`, with expand toggle
  defaultVisible?: number;
}) {
  const [query, setQuery] = useState("");
  const [minCount, setMinCount] = useState(3);
  const [sort, setSort] = useState<"top" | "bottom">("top");

  const ofKind = useMemo(() => facets.filter((f) => f.kind === kind), [facets, kind]);

  // Flat search across the whole kind (ignores min-count so anything is findable).
  const q = query.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!q) return [];
    return ofKind
      .filter((f) => f.label.toLowerCase().includes(q))
      .sort((a, b) => b.count - a.count || b.avg - a.avg)
      .slice(0, 50);
  }, [ofKind, q]);

  // Grouped browse view (by category for tags, by role otherwise).
  const groups: Group[] = useMemo(() => {
    if (kind === "tag") {
      return CATEGORIES.filter((c) => c.id !== "meta").map((c) => ({
        id: c.id, label: c.label, color: c.color,
        facets: ofKind.filter((f) => f.category === c.id),
      }));
    }
    const roles = kind === "person" ? PERSON_ROLES : COMPANY_ROLES;
    return roles.map((r) => ({
      id: r, label: ROLE_LABELS[r] ?? r, color: ROLE_COLORS[r] ?? "#888",
      facets: ofKind.filter((f) => f.role === r),
    }));
  }, [ofKind, kind]);

  const colorOf = (f: FacetStat) =>
    (f.kind === "tag" ? CATEGORY_COLORS[f.category ?? "other"] : ROLE_COLORS[f.role ?? ""]) ?? "#888";

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">{title}</h2>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${kind === "company" ? "studios" : kind + "s"}…`}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 focus:border-neutral-600 outline-none w-44"
          />
          {!q && (
            <>
              <div className="flex items-center gap-1 text-xs text-neutral-500">
                <span>min</span>
                <button onClick={() => setMinCount((c) => Math.max(1, c - 1))} className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 hover:text-white">−</button>
                <span className="w-5 text-center tabular-nums text-neutral-300">{minCount}</span>
                <button onClick={() => setMinCount((c) => c + 1)} className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 hover:text-white">+</button>
              </div>
              <div className="flex rounded-lg border border-neutral-800 overflow-hidden text-xs">
                <button onClick={() => setSort("top")} className={`px-2 py-1 ${sort === "top" ? "bg-neutral-800 text-white" : "text-neutral-500 hover:text-white"}`}>Highest</button>
                <button onClick={() => setSort("bottom")} className={`px-2 py-1 ${sort === "bottom" ? "bg-neutral-800 text-white" : "text-neutral-500 hover:text-white"}`}>Lowest</button>
              </div>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-neutral-600 mb-3">{subtitle}</p>

      {q ? (
        // ── Search results ──
        searchResults.length === 0 ? (
          <p className="text-sm text-neutral-600 py-6 text-center">No matches for “{query}”.</p>
        ) : (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-2">
            {searchResults.map((f) => (
              <StatBar
                key={`${f.role ?? ""}|${f.key}`}
                label={f.label}
                value={f.avg}
                count={f.count}
                color={colorOf(f)}
                baseline={baseline}
                href={buildFacetHref(f)}
                title={`${f.label}${f.role ? ` · ${ROLE_LABELS[f.role] ?? f.role}` : ""} — avg ${f.avg.toFixed(1)} over ${f.count}`}
              />
            ))}
          </div>
        )
      ) : (
        // ── Grouped browse ──
        <div className="grid sm:grid-cols-2 gap-3">
          {groups.map((g) => {
            const eligible = g.facets.filter((f) => f.count >= minCount);
            const sorted = [...eligible].sort((a, b) => (sort === "top" ? b.avg - a.avg : a.avg - b.avg) || b.count - a.count);
            if (sorted.length === 0) return null;
            return (
              <FacetGroup
                key={g.id}
                group={g}
                sorted={sorted}
                eligibleCount={eligible.length}
                baseline={baseline}
                collapsedCount={collapsible ? defaultVisible : null}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
