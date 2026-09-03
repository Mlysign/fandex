"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import type { ScoringConfigValues, TagCategoryConfig } from "./types";
import WeightsPanel from "./WeightsPanel";
import TaxonomyPanel from "./TaxonomyPanel";

// H5.4 — /dev/scoring: the Fandex Score dev backend (docs/fandex-score.md §5).
// Two tabs: Weights & tuning (role/category weights, C, K, top-N selection —
// live preview) and Taxonomy (category CRUD + the tag table, T7).
//
// 2026-07-29 (T7): overrides/bundles used to be fetched here and threaded
// down through TaxonomyPanel to its BundleList/TagTriage children. Both are
// gone — TagTable.tsx fetches its own rows (already override/aka-aware) from
// GET /api/dev/scoring/tags — so this component no longer needs to know about
// either.

export default function ScoringAdmin() {
  const [tab, setTab] = useState<"weights" | "taxonomy">("weights");
  const [config, setConfig] = useState<ScoringConfigValues | null>(null);
  const [categories, setCategories] = useState<TagCategoryConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 2026-09-03 (Nils): "keeps resetting when i change a tag's category or make
  // any other change, which means i have to scroll down again, set up the
  // filter and keep going."
  //
  // Every child calls `onChanged` after a save, which lands here. `load` used to
  // set ONE `loading` flag, and the render below swaps the whole panel for
  // "Loading…" while it is true. So a save UNMOUNTED TaxonomyPanel and with it
  // TagTable's search box, category filter and 100-row window, plus
  // FranchisePanel's filter and open row. Re-mounting starts at the top with
  // everything blank, which is why retagging felt like starting over on every
  // single row.
  //
  // Two flags, because they answer different questions. `loading` is "there is
  // nothing to render yet" and only ever true before the first response.
  // `refreshing` is "what you are looking at is one save out of date", which is
  // a status line, not a reason to throw the DOM away.
  const initial = useRef(true);

  const load = useCallback(async () => {
    if (initial.current) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/scoring");
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setConfig(data.config);
      setCategories(data.categories);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      initial.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-100">Fandex Score · Admin</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Tune the taste-match engine and edit the tag taxonomy. Changes here affect every user&apos;s Fandex Score.
        </p>
      </div>

      <div className="flex gap-1 border-b border-neutral-800">
        {(["weights", "taxonomy"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? "border-white text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {t === "weights" ? "Weights & Tuning" : "Taxonomy"}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-neutral-500">Loading…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {/* A status line, deliberately in a slot that always exists: it must not
          push the panel below it around, or every save would move the row you
          were about to click. */}
      <p className="text-xs text-neutral-600 h-4">{refreshing ? "Saving…" : ""}</p>

      {/* Rendered as soon as there IS a config and kept mounted through every
          subsequent refetch. `loading` gates only the very first paint. */}
      {!loading && !error && config && (
        tab === "weights" ? (
          <WeightsPanel config={config} categories={categories} onSaved={load} />
        ) : (
          <TaxonomyPanel categories={categories} onChanged={load} />
        )
      )}
    </div>
  );
}
