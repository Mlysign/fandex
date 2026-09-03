"use client";
import { useState } from "react";
import type { TagCategoryConfig } from "./types";
import TagTable from "./TagTable";
import FranchisePanel from "./FranchisePanel";
import ReviewPanel from "./ReviewPanel";
import { slugify } from "@/lib/slug";
import { facetColorVar, tagCategoryHex } from "@/lib/facetPalette";

const inputCls = "bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-sm text-neutral-100";

// T7 (2026-07-29) — the Taxonomy tab is now category CRUD (unchanged, T5's
// slug fix) plus ONE tag table (TagTable.tsx), which absorbed and replaced
// what used to be a separate bundles list + a tick-many-then-bundle triage
// list. Category reassignment and aka bundling both happen inline, per row.
// 2026-09-03 (Nils): "it is a single long scroll. can you add sub-tabs for each
// feature?" The three sections are separate jobs and are never done together:
// categories is a rare CRUD, tags is a long retagging sit-down, franchises is
// bundling. Stacked, the one you want is always the one below the fold, and the
// tag table alone is 100 rows tall.
//
// The sub-tab lives here rather than in ScoringAdmin because it is state ABOUT
// the taxonomy view, and ScoringAdmin re-renders on every save. Switching tabs
// does unmount the other two panels, which is what a tab means; what must NOT
// reset is the panel you are working in when you save a row, and that is fixed
// in ScoringAdmin (see its `refreshing` note).
//
// 2026-09-03, second pass (Nils): "can you do a sweep of all tags and
// franchises? ... build me an easy way to review those suggestions." Review is
// first and is the default section, because the other three are where you go to
// fix ONE thing you already know about, and this is the one that tells you what
// there is to fix.
type Section = "review" | "categories" | "tags" | "franchises";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "review", label: "Review" },
  { id: "categories", label: "Categories" },
  { id: "tags", label: "Tags" },
  { id: "franchises", label: "Franchises" },
];

export default function TaxonomyPanel({
  categories, onChanged,
}: {
  categories: TagCategoryConfig[];
  onChanged: () => void;
}) {
  const [section, setSection] = useState<Section>("review");

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            aria-pressed={section === s.id}
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
              section === s.id
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === "review" && <ReviewPanel categories={categories} onChanged={onChanged} />}
      {section === "categories" && <CategoryList categories={categories} onChanged={onChanged} />}
      {section === "tags" && <TagTable categories={categories} onChanged={onChanged} />}
      {section === "franchises" && <FranchisePanel onChanged={onChanged} />}
    </div>
  );
}

function CategoryList({ categories, onChanged }: { categories: TagCategoryConfig[]; onChanged: () => void }) {
  // 2026-07-29 (T5) — the id is DERIVED from the label by default (root cause
  // of "my created categories are gone": this form used to require typing a
  // separate lowercase-kebab id, and typing only a human label like "People &
  // Characters" into it 400'd — the category was never actually created).
  // `idOverride` stays null until the admin explicitly opts to hand-edit it.
  const [newCat, setNewCat] = useState({ label: "" });
  const [idOverride, setIdOverride] = useState<string | null>(null);
  const [editingId, setEditingId] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const derivedId = slugify(newCat.label);
  const effectiveId = idOverride ?? derivedId;

  async function addCategory() {
    setBusy("new");
    setError(null);
    try {
      const res = await fetch("/api/dev/scoring/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 2026-07-30: colour is DERIVED, not chosen. Facets render in one of
        // four gold-family class colours (lib/facetPalette.ts), so a
        // per-category picker here could only ever promise something the app
        // no longer honours. The column is still written so the stored value
        // matches what renders.
        body: JSON.stringify({ id: effectiveId, label: newCat.label, color: tagCategoryHex(effectiveId), weight: 1, ignored: false }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not create category"); return; }
      setNewCat({ label: "" });
      setIdOverride(null);
      setEditingId(false);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function removeCategory(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/dev/scoring/categories?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-neutral-200">Categories</h2>
      <p className="text-xs text-neutral-500">
        Weight/ignored are edited in the Weights &amp; Tuning tab. This is id/label, and creating or removing a category.
        Colour is not per-category: every tag renders in the shared tag colour, except <code>genre</code>, which gets the brand gold.
      </p>
      <div className="space-y-1.5">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-3 text-sm">
            {/* The colour that actually renders app-wide (facet class), not the
                stored tag_category.color — those can only differ if a row
                predates 2026-07-30, and showing the stale one would mislead. */}
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: facetColorVar({ kind: "tag", category: c.id }) }} />
            <span className="w-28 shrink-0 text-neutral-500 font-mono text-xs truncate">{c.id}</span>
            <span className="flex-1 min-w-0 truncate text-neutral-300">{c.label}</span>
            <span className="text-xs text-neutral-600">{c.ignored ? "ignored" : `w=${c.weight}`}</span>
            <button onClick={() => removeCategory(c.id)} disabled={busy === c.id}
              className="text-xs text-neutral-500 hover:text-red-400 transition-colors disabled:opacity-50">
              Delete
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-1.5 pt-2 border-t border-neutral-800/70">
        <div className="flex items-center gap-2">
          <input placeholder="Label (e.g. People & Characters)" value={newCat.label}
            onChange={(e) => setNewCat((c) => ({ ...c, label: e.target.value }))}
            className={`${inputCls} flex-1 min-w-0`} />
          <button onClick={addCategory} disabled={busy === "new" || !newCat.label || !effectiveId}
            className="px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-200 transition-colors disabled:opacity-50">
            Add
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-neutral-500 pl-0.5">
          {editingId ? (
            <input
              placeholder="id (lowercase-kebab)"
              value={idOverride ?? derivedId}
              onChange={(e) => setIdOverride(e.target.value)}
              className={`${inputCls} w-48 text-xs py-0.5`}
            />
          ) : (
            <>
              <span>
                id: <span className="font-mono text-neutral-400">{derivedId || "—"}</span>
              </span>
              <button type="button" onClick={() => { setIdOverride(derivedId); setEditingId(true); }}
                className="text-neutral-600 hover:text-neutral-300 transition-colors underline decoration-dotted">
                edit
              </button>
            </>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  );
}
