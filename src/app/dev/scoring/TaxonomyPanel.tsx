"use client";
import { useState } from "react";
import type { TagCategoryConfig } from "./types";
import TagTable from "./TagTable";
import { slugify } from "@/lib/slug";
import { facetColorVar, tagCategoryHex } from "@/lib/facetPalette";

const inputCls = "bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-sm text-neutral-100";

// T7 (2026-07-29) — the Taxonomy tab is now category CRUD (unchanged, T5's
// slug fix) plus ONE tag table (TagTable.tsx), which absorbed and replaced
// what used to be a separate bundles list + a tick-many-then-bundle triage
// list. Category reassignment and aka bundling both happen inline, per row.
export default function TaxonomyPanel({
  categories, onChanged,
}: {
  categories: TagCategoryConfig[];
  onChanged: () => void;
}) {
  return (
    <div className="space-y-6">
      <CategoryList categories={categories} onChanged={onChanged} />
      <TagTable categories={categories} onChanged={onChanged} />
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
        Weight/ignored are edited in the Weights &amp; Tuning tab — this is id/label, and creating or removing a category.
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
