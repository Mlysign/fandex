"use client";
import { useEffect, useState, useCallback } from "react";
import { TagCategoryConfig, TagBundle } from "./types";
import { OverrideEntry } from "./ScoringAdmin";

interface VocabTag { key: string; label: string; count: number; category: string; overridden: boolean }
interface TagItem { id: string; title: string; type: string; posterUrl: string | null; year: number | null }

const inputCls = "bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-sm text-neutral-100";

export default function TaxonomyPanel({
  categories, overrides, bundles, onChanged,
}: {
  categories: TagCategoryConfig[];
  overrides: OverrideEntry[];
  bundles: TagBundle[];
  onChanged: () => void;
}) {
  return (
    <div className="space-y-6">
      <CategoryList categories={categories} onChanged={onChanged} />
      <BundleList bundles={bundles} onChanged={onChanged} />
      <TagTriage categories={categories} overrides={overrides} bundles={bundles} onChanged={onChanged} />
    </div>
  );
}

function CategoryList({ categories, onChanged }: { categories: TagCategoryConfig[]; onChanged: () => void }) {
  const [newCat, setNewCat] = useState({ id: "", label: "", color: "#9ca3af" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addCategory() {
    setBusy("new");
    setError(null);
    try {
      const res = await fetch("/api/dev/scoring/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: newCat.id, label: newCat.label, color: newCat.color, weight: 1, ignored: false }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not create category"); return; }
      setNewCat({ id: "", label: "", color: "#9ca3af" });
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
        Weight/ignored are edited in the Weights &amp; Tuning tab — this is id/label/color, and creating or removing a category.
      </p>
      <div className="space-y-1.5">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-3 text-sm">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
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

      <div className="flex items-center gap-2 pt-2 border-t border-neutral-800/70">
        <input placeholder="id (lowercase-kebab)" value={newCat.id} onChange={(e) => setNewCat((c) => ({ ...c, id: e.target.value }))}
          className={`${inputCls} w-40`} />
        <input placeholder="Label" value={newCat.label} onChange={(e) => setNewCat((c) => ({ ...c, label: e.target.value }))}
          className={`${inputCls} flex-1 min-w-0`} />
        <input type="color" value={newCat.color} onChange={(e) => setNewCat((c) => ({ ...c, color: e.target.value }))}
          className="w-9 h-8 rounded-md bg-neutral-950 border border-neutral-700" />
        <button onClick={addCategory} disabled={busy === "new" || !newCat.id || !newCat.label}
          className="px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-200 transition-colors disabled:opacity-50">
          Add
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  );
}

// H5.6 — existing tag bundles: a canonical key + its member spellings. Members
// are folded into the canonical everywhere (scoring, Insights, facet page, the
// triage list below), so this is where you see/undo the folding.
function BundleList({ bundles, onChanged }: { bundles: TagBundle[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function removeMember(alias: string) {
    setBusy(alias);
    try {
      await fetch(`/api/dev/scoring/aliases?alias=${encodeURIComponent(alias)}`, { method: "DELETE" });
      onChanged();
    } finally { setBusy(null); }
  }

  async function dissolve(canonical: string) {
    setBusy(canonical);
    try {
      await fetch(`/api/dev/scoring/aliases?canonical=${encodeURIComponent(canonical)}`, { method: "DELETE" });
      onChanged();
    } finally { setBusy(null); }
  }

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-neutral-200">Tag bundles</h2>
      <p className="text-xs text-neutral-500">
        Bundled spellings score and aggregate as one tag. Build a bundle by selecting tags in the triage list below.
      </p>
      {bundles.length === 0 ? (
        <p className="text-sm text-neutral-600">No bundles yet.</p>
      ) : (
        <div className="space-y-2">
          {bundles.map((b) => (
            <div key={b.canonical} className="flex items-start gap-3 text-sm border-t border-neutral-800/70 pt-2 first:border-0 first:pt-0">
              <span className="font-medium text-neutral-200 shrink-0">{b.canonical}</span>
              <div className="flex-1 min-w-0 flex flex-wrap gap-1.5">
                {b.members.map((m) => (
                  <span key={m} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded bg-neutral-800 text-xs text-neutral-400">
                    {m}
                    <button onClick={() => removeMember(m)} disabled={busy === m}
                      aria-label={`Remove ${m} from bundle`} className="text-neutral-500 hover:text-red-400 leading-none disabled:opacity-50">×</button>
                  </span>
                ))}
              </div>
              <button onClick={() => dissolve(b.canonical)} disabled={busy === b.canonical}
                className="text-xs text-neutral-500 hover:text-red-400 transition-colors shrink-0 disabled:opacity-50">
                Dissolve
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TagTriage({
  categories, overrides, bundles, onChanged,
}: {
  categories: TagCategoryConfig[];
  overrides: OverrideEntry[];
  bundles: TagBundle[];
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState("other");
  const [tags, setTags] = useState<VocabTag[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // click-to-reveal state
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [revealItems, setRevealItems] = useState<TagItem[]>([]);
  const [revealLoading, setRevealLoading] = useState(false);

  // bundle-builder selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [canonical, setCanonical] = useState<string>("");
  const [bundling, setBundling] = useState(false);

  const overrideByKey = new Map(overrides.map((o) => [o.tagKey, o.categoryId]));
  const memberOf = new Map<string, string>(); // any key currently a member → its canonical
  for (const b of bundles) for (const m of b.members) memberOf.set(m, b.canonical);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ limit: "100" });
      if (filter !== "all") p.set("category", filter);
      const res = await fetch(`/api/dev/scoring/vocab?${p}`);
      const data = await res.json();
      setTags(data.tags ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function toggleReveal(key: string) {
    if (revealKey === key) { setRevealKey(null); setRevealItems([]); return; }
    setRevealKey(key);
    setRevealItems([]);
    setRevealLoading(true);
    try {
      const res = await fetch(`/api/dev/scoring/tag-items?key=${encodeURIComponent(key)}`);
      const data = await res.json();
      setRevealItems(data.items ?? []);
    } finally {
      setRevealLoading(false);
    }
  }

  function toggleSelect(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelected(next);
    // keep canonical valid: default to the first selected if unset/removed
    if (!next.has(canonical)) setCanonical(next.values().next().value ?? "");
  }

  async function bundleSelected() {
    if (selected.size < 2 || !canonical) return;
    setBundling(true);
    try {
      const res = await fetch("/api/dev/scoring/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonical, members: [...selected] }),
      });
      if (res.ok) {
        setSelected(new Set());
        setCanonical("");
        await load();
        onChanged();
      }
    } finally {
      setBundling(false);
    }
  }

  async function reassign(tagKey: string, categoryId: string) {
    setBusyKey(tagKey);
    try {
      await fetch("/api/dev/scoring/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagKey, categoryId }),
      });
      await load();
      onChanged();
    } finally {
      setBusyKey(null);
    }
  }

  async function revert(tagKey: string) {
    setBusyKey(tagKey);
    try {
      await fetch(`/api/dev/scoring/overrides?tagKey=${encodeURIComponent(tagKey)}`, { method: "DELETE" });
      await load();
      onChanged();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-200">Tag triage</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={inputCls}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      <p className="text-xs text-neutral-500">
        {loading ? "Loading…" : `${total} tag${total === 1 ? "" : "s"} in this bucket, by catalog frequency.`}
        {" "}Click a tag name to see items carrying it; tick two or more to bundle them.
      </p>

      {selected.size >= 2 && (
        <div className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-950 p-2 text-sm sticky top-2 z-10">
          <span className="text-neutral-400 shrink-0">Bundle {selected.size} tags into</span>
          <select value={canonical} onChange={(e) => setCanonical(e.target.value)} className={`${inputCls} flex-1 min-w-0`}>
            {[...selected].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button onClick={bundleSelected} disabled={bundling || !canonical}
            className="px-3 py-1.5 rounded-md bg-white text-black text-sm font-medium hover:bg-neutral-200 transition-colors disabled:opacity-50 shrink-0">
            {bundling ? "Bundling…" : "Bundle"}
          </button>
          <button onClick={() => { setSelected(new Set()); setCanonical(""); }}
            className="text-xs text-neutral-500 hover:text-neutral-300 shrink-0">Clear</button>
        </div>
      )}

      <div className="max-h-96 overflow-y-auto space-y-1">
        {tags.map((t) => (
          <div key={t.key}>
            <div className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={selected.has(t.key)} onChange={() => toggleSelect(t.key)}
                aria-label={`Select ${t.label}`} className="shrink-0" />
              <button onClick={() => toggleReveal(t.key)}
                className="flex-1 min-w-0 truncate text-left text-neutral-300 hover:text-neutral-100 transition-colors">
                {t.label}
                {memberOf.has(t.key) && <span className="text-xs text-neutral-600"> → {memberOf.get(t.key)}</span>}
              </button>
              <span className="text-xs text-neutral-600 w-10 text-right shrink-0">{t.count}×</span>
              <select
                value={overrideByKey.get(t.key) ?? t.category}
                disabled={busyKey === t.key}
                onChange={(e) => reassign(t.key, e.target.value)}
                className={`${inputCls} w-36 shrink-0`}
              >
                {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              {t.overridden && (
                <button onClick={() => revert(t.key)} disabled={busyKey === t.key}
                  className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors shrink-0 disabled:opacity-50">
                  Revert
                </button>
              )}
            </div>
            {revealKey === t.key && (
              <div className="ml-7 mt-1 mb-2 flex flex-wrap gap-2">
                {revealLoading && <span className="text-xs text-neutral-600">Loading…</span>}
                {!revealLoading && revealItems.length === 0 && <span className="text-xs text-neutral-600">No items.</span>}
                {revealItems.map((it) => (
                  <span key={it.id} className="inline-flex items-center gap-1.5 rounded-md bg-neutral-800 pl-1 pr-2 py-1 text-xs text-neutral-300 max-w-[14rem]">
                    {it.posterUrl
                      // eslint-disable-next-line @next/next/no-img-element -- dev-only admin tool, remote poster thumbnails
                      ? <img src={it.posterUrl} alt="" className="w-5 h-7 object-cover rounded-sm shrink-0" />
                      : <span className="w-5 h-7 rounded-sm bg-neutral-700 shrink-0" />}
                    <span className="truncate">{it.title}</span>
                    <span className="text-neutral-600 shrink-0">{it.year ?? it.type}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {!loading && tags.length === 0 && <p className="text-sm text-neutral-600">No tags in this bucket.</p>}
      </div>
    </section>
  );
}
