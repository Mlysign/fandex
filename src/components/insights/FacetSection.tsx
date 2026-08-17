"use client";
import { useMemo, useState } from "react";
import StatBar from "./StatBar";
import type { FacetStat, TagCategoryInfo } from "./types";
import { ROLE_LABELS } from "@/lib/constants";
import { facetColorVar } from "@/lib/facetPalette";
import { buildFacetHref } from "@/lib/itemUrl";
import TagCategoryPicker, { useTagAdminState } from "@/components/TagCategoryPicker";

const PERSON_ROLES = ["director", "writer", "creator", "cast"];
const COMPANY_ROLES = ["developer", "publisher", "studio", "network"];
const PER_GROUP = 12; // top/bottom rows shown per group before "+N more"

interface Group { id: string; label: string; color: string; facets: FacetStat[] }

// Q22 — non-intrusive admin-only category reassignment: hovering a tag row
// reveals a small dropdown to its LEFT (out of the way of the bar/number).
// Purely a save-and-confirm; it doesn't live-reshuffle the tag between group
// panels (that'd need lifting the whole grouped-view state) — the row moves
// on the next load.
//
// T8 (2026-07-29): the select + its admin/fetch/save logic moved to the
// shared TagCategoryPicker (also used by the facet page's TagAdminControls)
// — this wrapper keeps only the absolute hover-reveal positioning, unique to
// this surface.
function TagCategoryHoverPanel({ tagKey, categoryId }: { tagKey: string; categoryId?: string }) {
  return (
    <div
      className="absolute right-full top-1/2 -translate-y-1/2 mr-2 z-30 hidden group-hover:flex items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <TagCategoryPicker
        tagKey={tagKey}
        categoryId={categoryId}
        className="text-xs px-2 py-1 rounded-md bg-surface-elevated border border-border-strong outline-none shadow-xl whitespace-nowrap text-text-primary"
      />
    </div>
  );
}

// One category/role group. When `collapsedCount` is set the group starts capped
// at that many rows with a click-to-expand toggle; otherwise it keeps the legacy
// "show up to PER_GROUP, +N more — search" behaviour.
function FacetGroup({
  group, sorted, eligibleCount, baseline, collapsedCount, tagAdmin,
}: {
  group: Group;
  sorted: FacetStat[];
  eligibleCount: number;
  baseline: number;
  collapsedCount: number | null;
  tagAdmin: boolean; // Q22: admin viewer + kind === "tag" — show the hover category editor
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = collapsedCount != null;
  const limit = collapsible ? collapsedCount! : PER_GROUP;
  const shown = expanded ? sorted : sorted.slice(0, limit);

  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface-elevated p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full" style={{ background: group.color }} />
        <span className="text-sm font-medium text-text-primary">{group.label}</span>
        <span className="text-xs text-text-secondary">{eligibleCount}</span>
      </div>
      <div className="space-y-0.5">
        {shown.map((f) => (
          <div key={`${f.role ?? ""}|${f.key}`} className={tagAdmin ? "relative group" : undefined}>
            {tagAdmin && <TagCategoryHoverPanel tagKey={f.key} categoryId={f.category} />}
            <StatBar label={f.label} value={f.ba} rawAvg={f.avg} count={f.count} color={group.color} baseline={baseline} href={buildFacetHref(f)} impact={f.impact} />
          </div>
        ))}
        {collapsible
          ? sorted.length > limit && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-[11px] text-text-secondary hover:text-text-primary px-1 pt-1"
              >
                {expanded ? "Show less" : `Show ${sorted.length - limit} more`}
              </button>
            )
          : sorted.length > PER_GROUP && (
              <p className="text-[11px] text-text-secondary px-1 pt-1">+{sorted.length - PER_GROUP} more — search to find them</p>
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

  // Q22 — admin check for the hover category editor (tag panel only).
  // T8 (2026-07-29): reads the SAME shared cache TagCategoryPicker itself
  // uses (one fetch across the whole page, not one per FacetSection/tag row).
  const { isAdmin: isAdminUser } = useTagAdminState();
  const isAdmin = kind === "tag" && isAdminUser;

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

  // Grouped browse view (by category for tags, by role otherwise).
  const groups: Group[] = useMemo(() => {
    if (kind === "tag") {
      const cats = tagCategories?.length ? [...tagCategories].sort((a, b) => a.sortOrder - b.sortOrder) : [];
      // 2026-07-30: the group colour is the facet CLASS colour (genre vs any
      // other tag category), not the category row's own stored hex — see
      // lib/facetPalette.ts for why a per-category palette can't hold.
      return cats.map((c) => ({
        id: c.id, label: c.label, color: facetColorVar({ kind: "tag", category: c.id }),
        facets: ofKind.filter((f) => f.category === c.id),
      }));
    }
    const roles = kind === "person" ? PERSON_ROLES : COMPANY_ROLES;
    return roles.map((r) => ({
      id: r, label: ROLE_LABELS[r] ?? r, color: facetColorVar({ kind, role: r }),
      facets: ofKind.filter((f) => f.role === r),
    }));
  }, [ofKind, kind, tagCategories]);

  const colorOf = (f: FacetStat) => facetColorVar(f);

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
        <span className="font-mono text-eyebrow uppercase text-accent">{title}</span>
        {/* MB7 — `flex-wrap` here is load-bearing on mobile: a `w-44` input plus
            the min stepper plus the Highest/Lowest toggle is ~380px of content in
            a 327px content box, and without wrapping it pushed the PAGE wider,
            which zooms the viewport out and drops the fixed bottom nav off-screen
            (see the note in InsightsView's decade chart). */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${kind === "company" ? "studios" : kind + "s"}…`}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-surface-elevated border border-border focus:border-border-strong outline-none w-44 text-text-primary placeholder:text-text-secondary"
          />
          {!q && (
            <>
              <div className="flex items-center gap-1 text-xs text-text-secondary">
                <span>min</span>
                <button onClick={() => setMinCount((c) => Math.max(1, c - 1))} className="px-1.5 py-0.5 rounded bg-surface-elevated border border-border hover:text-text-primary">−</button>
                <span className="w-5 text-center tabular-nums text-text-primary">{minCount}</span>
                <button onClick={() => setMinCount((c) => c + 1)} className="px-1.5 py-0.5 rounded bg-surface-elevated border border-border hover:text-text-primary">+</button>
              </div>
              <div className="flex rounded-lg border border-border overflow-hidden text-xs">
                <button onClick={() => setSort("top")} className={`px-2 py-1 transition-colors ${sort === "top" ? "bg-accent-subtle text-accent" : "text-text-secondary hover:text-text-primary"}`}>Highest</button>
                <button onClick={() => setSort("bottom")} className={`px-2 py-1 transition-colors ${sort === "bottom" ? "bg-accent-subtle text-accent" : "text-text-secondary hover:text-text-primary"}`}>Lowest</button>
              </div>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-text-secondary mb-3">{subtitle}</p>

      {q ? (
        // ── Search results ──
        searchResults.length === 0 ? (
          <p className="text-sm text-text-secondary py-6 text-center">No matches for “{query}”.</p>
        ) : (
          <div className="rounded-xl border border-border bg-surface-elevated p-2">
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
                impact={f.impact}
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
                tagAdmin={isAdmin}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
