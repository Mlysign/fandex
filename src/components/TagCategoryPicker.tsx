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

// T9 (2026-07-29): `overrides` is included so a caller that only has a
// CODE-HEURISTIC guess for a tag's category (categorizeTag(), not
// override-aware) — the item detail page's tag chips, unlike the facet page
// and Insights, which already get an override-aware categoryId server-side
// — still ends up pre-selecting the TRUE current category. No race with the
// select's uncontrolled `defaultValue`: TagCategoryPicker renders nothing
// until `isAdmin` flips true, which only happens once this SAME fetch
// (overrides included) has already resolved — so by the time the <select>
// exists, `overrides` is already populated.
interface AdminState { isAdmin: boolean; categories: TagCategoryOpt[]; overrides: Map<string, string> }

let cache: AdminState | null = null;
let inflight: Promise<AdminState> | null = null;
const listeners = new Set<(s: AdminState) => void>();

function loadAdminState(): Promise<AdminState> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch("/api/dev/scoring")
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { categories?: TagCategoryOpt[]; overrides?: { tagKey: string; categoryId: string }[] } | null) => {
      cache = d
        ? { isAdmin: true, categories: d.categories ?? [], overrides: new Map((d.overrides ?? []).map((o) => [o.tagKey, o.categoryId])) }
        : { isAdmin: false, categories: [], overrides: new Map() };
      listeners.forEach((fn) => fn(cache!));
      return cache;
    })
    .catch(() => {
      cache = { isAdmin: false, categories: [], overrides: new Map() };
      listeners.forEach((fn) => fn(cache!));
      return cache;
    });
  return inflight;
}

export function useTagAdminState(): AdminState {
  const [state, setState] = useState<AdminState>(cache ?? { isAdmin: false, categories: [], overrides: new Map() });
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
  // Caller's best guess (a server-computed, override-aware value where the
  // caller has one; a code-heuristic fallback otherwise — see the `overrides`
  // note above for why either is fine).
  categoryId?: string | null;
  className?: string;
  onSaved?: (categoryId: string) => void;
}) {
  const { isAdmin, categories, overrides } = useTagAdminState();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!isAdmin) return null;

  const effectiveCategoryId = overrides.get(tagKey) ?? categoryId ?? "";

  async function save(id: string) {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/dev/scoring/overrides", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagKey, categoryId: id }),
      });
      // Keep the shared cache in sync so any OTHER picker instance for this
      // same tag (unlikely on one page, but cheap to guarantee) shows the new
      // value too, without waiting on a full re-fetch.
      if (cache) { cache.overrides.set(tagKey, id); listeners.forEach((fn) => fn(cache!)); }
      setSaved(true);
      onSaved?.(id);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <select
        defaultValue={effectiveCategoryId}
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
