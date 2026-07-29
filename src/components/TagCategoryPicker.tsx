"use client";
import { useEffect, useState } from "react";

// T8 (2026-07-29) — the admin-only inline tag-category picker, factored out
// of two near-identical implementations: TagAdminControls.tsx (the facet
// page's admin box) and insights/FacetSection.tsx's TagCategoryHoverPanel.
// Both independently fetched GET /api/dev/scoring (fail-closed: 200 means
// admin + categories, a 404/error means neither) and POSTed
// /api/dev/scoring/overrides to save — same logic, same admin gate, drifting
// apart every time one side got a fix the other didn't.
//
// `useTagAdminState()` shares ONE fetch across the whole page via a
// module-level cache/in-flight promise — an item page with 30 tag chips (or
// an insights panel with hundreds of rows) must not fire 30 identical
// requests just because 30 components each want to know "am I an admin, and
// what are the categories". Every caller (this component, TagAdminControls,
// FacetSection) reads the same shared state.

export interface TagCategoryOpt { id: string; label: string; color: string }

interface AdminState { isAdmin: boolean; categories: TagCategoryOpt[] }

let cache: AdminState | null = null;
let inflight: Promise<AdminState> | null = null;
const listeners = new Set<(s: AdminState) => void>();

function loadAdminState(): Promise<AdminState> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch("/api/dev/scoring")
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { categories?: TagCategoryOpt[] } | null) => {
      cache = d ? { isAdmin: true, categories: d.categories ?? [] } : { isAdmin: false, categories: [] };
      listeners.forEach((fn) => fn(cache!));
      return cache;
    })
    .catch(() => {
      cache = { isAdmin: false, categories: [] };
      listeners.forEach((fn) => fn(cache!));
      return cache;
    });
  return inflight;
}

export function useTagAdminState(): AdminState {
  const [state, setState] = useState<AdminState>(cache ?? { isAdmin: false, categories: [] });
  useEffect(() => {
    listeners.add(setState);
    void loadAdminState().then(setState);
    return () => { listeners.delete(setState); };
  }, []);
  return state;
}

// Renders ONLY the <select> (+ a "Saved" confirmation) — no wrapper chrome,
// so each call site keeps its own container styling/positioning exactly as
// it was (TagAdminControls' warning-bordered box vs FacetSection's absolute
// hover-reveal pill). Renders null for a non-admin, same fail-closed
// behavior both originals had.
export default function TagCategoryPicker({
  tagKey, categoryId, className, onSaved,
}: {
  tagKey: string;
  categoryId?: string | null;
  className?: string;
  onSaved?: (categoryId: string) => void;
}) {
  const { isAdmin, categories } = useTagAdminState();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!isAdmin) return null;

  async function save(id: string) {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/dev/scoring/overrides", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagKey, categoryId: id }),
      });
      setSaved(true);
      onSaved?.(id);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <select
        defaultValue={categoryId ?? ""}
        disabled={saving}
        onChange={(e) => save(e.target.value)}
        className={className}
      >
        {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      {saved && <span className="text-success text-xs">Saved ✓</span>}
    </>
  );
}
