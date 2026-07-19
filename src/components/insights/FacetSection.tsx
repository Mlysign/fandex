"use client";
import { useEffect, useMemo, useState } from "react";
import StatBar from "./StatBar";
import { FacetStat, TagCategoryInfo } from "./types";
import { CATEGORY_COLORS } from "@/lib/tags";
import { ROLE_COLORS, ROLE_LABELS } from "@/lib/constants";
import { buildFacetHref } from "@/lib/itemUrl";

const PERSON_ROLES = ["director", "writer", "creator", "cast"];
const COMPANY_ROLES = ["developer", "publisher", "studio", "network"];
const PER_GROUP = 12; // top/bottom rows shown per group before "+N more"

interface Group { id: string; label: string; color: string; facets: FacetStat[] }

// Q22 — non-intrusive admin-only category reassignment: hovering a tag row
// reveals a small dropdown to its LEFT (out of the way of the bar/number),
// reusing the same POST /api/dev/scoring/overrides the Taxonomy editor uses.
// Purely a save-and-confirm; it doesn't live-reshuffle the tag between group
// panels (that'd need lifting the whole grouped-view state) — the row moves
// on the next load.
function TagCategoryHoverPanel({ tagKey, categoryId, categories }: { tagKey: string; categoryId?: string; categories: TagCategoryInfo[] }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(id: string) {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/dev/scoring/overrides", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagKey, categoryId: id }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="absolute right-full top-1/2 -translate-y-1/2 mr-2 z-30 hidden group-hover:flex items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <select
        defaultValue={categoryId}
        disabled={saving}
        onChange={(e) => save(e.target.value)}
        className="text-xs px-2 py-1 rounded-md bg-neutral-900 border border-neutral-700 outline-none shadow-xl whitespace-nowrap"
      >
        {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      {saved && <span className="text-emerald-400 text-xs">Saved ✓</span>}
    </div>
  );
}

// One category/role group. When `collapsedCount` is set the group starts capped
// at that many rows with a click-to-expand toggle; otherwise it keeps the legacy
// "show up to PER_GROUP, +N more — search" behaviour.
function FacetGroup({
  group, sorted, eligibleCount, baseline, collapsedCount, tagAdmin, tagCategories,
}: {
  group: Group;
  sorted: FacetStat[];
  eligibleCount: number;
  baseline: number;
  collapsedCount: number | null;
  tagAdmin: boolean; // Q22: admin viewer + kind === "tag" — show the hover category editor
  tagCategories: TagCategoryInfo[];
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
          <div key={`${f.role ?? ""}|${f.key}`} className={tagAdmin ? "relative group" : undefined}>
            {tagAdmin && <TagCategoryHoverPanel tagKey={f.key} categoryId={f.category} categories={tagCategories} />}
            <StatBar label={f.label} value={f.ba} rawAvg={f.avg} count={f.count} color={group.color} baseline={baseline} href={buildFacetHref(f)} />
          </div>
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
  title, subtitle, kind, facets, baseline, tagCategories, collapsible = false, defaultVisible = 3,
}: {
  title: string;
  subtitle: string;
  kind: "tag" | "person" | "company";
  facets: FacetStat[];
  baseline: number;
  // Q22: the live, DB-backed taxonomy (kind === "tag" only) — a category added
  // via /dev/scoring's Taxonomy editor gets a panel here without a code
  // change. Falls back to the static tags.ts list if omitted (person/company
  // callers don't pass it at all).
  tagCategories?: TagCategoryInfo[];
  collapsible?: boolean;   // start each group capped at `defaultVisible`, with expand toggle
  defaultVisible?: number;
}) {
  const [query, setQuery] = useState("");
  const [minCount, setMinCount] = useState(3);
  const [sort, setSort] = useState<"top" | "bottom">("top");

  // Q22 — admin check for the hover category editor (tag panel only). Reuses
  // the same fail-closed gate /dev/scoring itself uses: a 200 means admin, a
  // 404 (or logged-out) means render nothing extra.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (kind !== "tag") return;
    let alive = true;
    fetch("/api/dev/scoring").then((r) => { if (alive && r.ok) setIsAdmin(true); }).catch(() => {});
    return () => { alive = false; };
  }, [kind]);

  const ofKind = useMemo(() => facets.filter((f) => f.kind === kind), [facets, kind]);

  // Flat search across the whole kind (ignores min-count so anything is findable).
  const q = query.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!q) return [];
    return ofKind
      .filter((f) => f.label.toLowerCase().includes(q))
      .sort((a, b) => b.count - a.count || b.ba - a.ba)
      .slice(0, 50);
  }, [ofKind, q]);

  const categoryColor = useMemo(
    () => new Map((tagCategories ?? []).map((c) => [c.id, c.color])),
    [tagCategories]
  );

  // Grouped browse view (by category for tags, by role otherwise).
  const groups: Group[] = useMemo(() => {
    if (kind === "tag") {
      const cats = tagCategories?.length ? [...tagCategories].sort((a, b) => a.sortOrder - b.sortOrder) : [];
      return cats.map((c) => ({
        id: c.id, label: c.label, color: c.color,
        facets: ofKind.filter((f) => f.category === c.id),
      }));
    }
    const roles = kind === "person" ? PERSON_ROLES : COMPANY_ROLES;
    return roles.map((r) => ({
      id: r, label: ROLE_LABELS[r] ?? r, color: ROLE_COLORS[r] ?? "#888",
      facets: ofKind.filter((f) => f.role === r),
    }));
  }, [ofKind, kind, tagCategories]);

  const colorOf = (f: FacetStat) =>
    (f.kind === "tag" ? categoryColor.get(f.category ?? "other") ?? CATEGORY_COLORS[f.category ?? "other"] : ROLE_COLORS[f.role ?? ""]) ?? "#888";

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
                value={f.ba}
                rawAvg={f.avg}
                count={f.count}
                color={colorOf(f)}
                baseline={baseline}
                href={buildFacetHref(f)}
                title={`${f.label}${f.role ? ` · ${ROLE_LABELS[f.role] ?? f.role}` : ""} — ${f.ba.toFixed(1)} Bayesian avg (raw ${f.avg.toFixed(1)}) over ${f.count}`}
              />
            ))}
          </div>
        )
      ) : (
        // ── Grouped browse ──
        <div className="grid sm:grid-cols-2 gap-3">
          {groups.map((g) => {
            const eligible = g.facets.filter((f) => f.count >= minCount);
            const sorted = [...eligible].sort((a, b) => (sort === "top" ? b.ba - a.ba : a.ba - b.ba) || b.count - a.count);
            if (sorted.length === 0) return null;
            return (
              <FacetGroup
                key={g.id}
                group={g}
                sorted={sorted}
                eligibleCount={eligible.length}
                baseline={baseline}
                collapsedCount={collapsible ? defaultVisible : null}
                tagAdmin={kind === "tag" && isAdmin}
                tagCategories={tagCategories ?? []}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
