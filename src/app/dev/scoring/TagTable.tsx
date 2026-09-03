"use client";
import { useCallback, useEffect, useState } from "react";
import type { TagCategoryConfig } from "./types";
import { useDebouncedValue } from "@/lib/useDebounced";

interface AkaTag { key: string; label: string; count: number }
interface TagRowData {
  key: string;
  label: string;
  count: number;
  category: string;
  overridden: boolean;
  aka: AkaTag[];
  /** `label` is a deliberate choice rather than a provider's spelling (2026-09-03). */
  labelOverridden?: boolean;
}

const inputCls = "bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-sm text-neutral-100";
const PAGE_SIZE = 100;

// T7 (2026-07-29) — replaces the old BundleList + TagTriage split (a separate
// bundles list, plus a tick-many-then-bundle builder) with ONE table: tag ·
// category (dropdown, inline) · aka (chips + inline search-to-add). Category
// filter is UNSET by default (the old TagTriage defaulted to "other" — Nils's
// explicit decision this time is no default filter). Backed by T6's
// GET /api/dev/scoring/tags, which already folds alias members into their
// canonical — so bundling a tag removes its own row on the next `load()`
// (a soft re-fetch, not a page reload) simply because it's no longer a
// canonical row in the response.
//
// Windowed at PAGE_SIZE (100) with a "Load more" button rather than rendering
// the full ~5,200-tag catalog at once — SM19 (2026-07-28) is the cautionary
// tale: /library rendering all 2,014 cards blocked the main thread 237ms-1.4s
// per keystroke. Search is 200ms-debounced (useDebouncedValue, the same L19
// fix /library itself uses) so typing stays instant.
export default function TagTable({ categories, onChanged }: { categories: TagCategoryConfig[]; onChanged: () => void }) {
  const [filter, setFilter] = useState(""); // "" = no category filter
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [rows, setRows] = useState<TagRowData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ limit: String(limit) });
      if (filter) p.set("category", filter);
      if (debouncedSearch.trim()) p.set("q", debouncedSearch.trim());
      const res = await fetch(`/api/dev/scoring/tags?${p}`);
      const data = await res.json();
      setRows(data.tags ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [filter, debouncedSearch, limit]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  // The window resets whenever the filter/search underneath it changes, so
  // "Load more" always means "100 more of THIS query", not a stale one.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setLimit(PAGE_SIZE); }, [filter, debouncedSearch]);

  async function reassign(tagKey: string, categoryId: string) {
    setBusyKey(tagKey);
    try {
      await fetch("/api/dev/scoring/overrides", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagKey, categoryId }),
      });
      setRows((rs) => rs.map((r) => (r.key === tagKey ? { ...r, category: categoryId, overridden: true } : r)));
      onChanged();
    } finally {
      setBusyKey(null);
    }
  }

  async function removeAkaMember(alias: string) {
    setBusyKey(alias);
    try {
      await fetch(`/api/dev/scoring/aliases?alias=${encodeURIComponent(alias)}`, { method: "DELETE" });
      await load();
      onChanged();
    } finally {
      setBusyKey(null);
    }
  }

  async function addAkaMember(canonical: string, memberKey: string, displayLabel?: string) {
    setBusyKey(memberKey);
    try {
      const res = await fetch("/api/dev/scoring/aliases", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonical, members: [memberKey], displayLabel }),
      });
      if (res.ok) { await load(); onChanged(); }
    } finally {
      setBusyKey(null);
    }
  }

  // 2026-09-03 (Nils): "when i bundle franchises or tags, i need an option to
  // choose which version i want to use as display name on fandex. the other name
  // should then never be displayed again."
  //
  // A separate call from bundling, because the two are separately reversible and
  // because a name is useful on a tag that is in no bundle at all. A null label
  // reverts to whatever the providers call it.
  async function setDisplayName(tagKey: string, label: string | null) {
    setBusyKey(tagKey);
    try {
      const res = label
        ? await fetch("/api/dev/scoring/labels", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "tag", key: tagKey, label }),
          })
        : await fetch(`/api/dev/scoring/labels?kind=tag&key=${encodeURIComponent(tagKey)}`, { method: "DELETE" });
      if (res.ok) { await load(); onChanged(); }
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-neutral-200">Tags</h2>
        <div className="flex items-center gap-2">
          <input
            placeholder="Search tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputCls} w-48`}
          />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className={inputCls}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      </div>
      <p className="text-xs text-neutral-500">
        {loading ? "Loading…" : `${rows.length} of ${total} tag${total === 1 ? "" : "s"} shown, by catalog frequency.`}
      </p>

      <div className="space-y-1">
        <div className="hidden md:flex items-center gap-3 text-[11px] text-neutral-600 uppercase tracking-wide px-0.5 pb-1 border-b border-neutral-800">
          <span className="flex-1 min-w-0">Tag</span>
          <span className="w-14 text-right shrink-0">Count</span>
          <span className="w-36 shrink-0">Category</span>
          <span className="w-72 shrink-0">Aka</span>
        </div>
        {rows.map((r) => (
          <TagRow
            key={r.key}
            row={r}
            categories={categories}
            busy={busyKey}
            onReassign={reassign}
            onRemoveAka={removeAkaMember}
            onAddAka={addAkaMember}
            onSetDisplayName={setDisplayName}
          />
        ))}
        {!loading && rows.length === 0 && <p className="text-sm text-neutral-600 py-2">No tags match.</p>}
      </div>

      {!loading && rows.length < total && (
        <button
          onClick={() => setLimit((n) => n + PAGE_SIZE)}
          className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          Load {Math.min(PAGE_SIZE, total - rows.length)} more…
        </button>
      )}
    </section>
  );
}

function TagRow({
  row, categories, busy, onReassign, onRemoveAka, onAddAka, onSetDisplayName,
}: {
  row: TagRowData;
  categories: TagCategoryConfig[];
  busy: string | null;
  onReassign: (tagKey: string, categoryId: string) => void;
  onRemoveAka: (alias: string) => void;
  onAddAka: (canonical: string, memberKey: string, displayLabel?: string) => void;
  onSetDisplayName: (tagKey: string, label: string | null) => void;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-1.5 md:gap-3 text-sm py-1.5 border-b border-neutral-900 last:border-0">
      <span className="flex-1 min-w-0 truncate text-neutral-300">
        {row.label}
        {row.labelOverridden && (
          <span className="ml-1.5 text-[10px] text-neutral-600" title="Shown under a name you chose">
            renamed
          </span>
        )}
      </span>
      <span className="w-14 text-right shrink-0 text-xs text-neutral-600">{row.count}×</span>
      <select
        value={row.category}
        disabled={busy === row.key}
        onChange={(e) => onReassign(row.key, e.target.value)}
        className={`${inputCls} w-36 shrink-0`}
      >
        {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <div className="w-72 shrink-0 space-y-1">
        <AkaEditor row={row} busy={busy} onRemoveAka={onRemoveAka} onAddAka={onAddAka} />
        {/* Only offered once the tag IS a bundle. On a lone tag there is no
            second spelling to choose between, and the row already shows the
            only name there is. */}
        {row.aka.length > 0 && (
          <DisplayNamePicker row={row} busy={busy} onSetDisplayName={onSetDisplayName} />
        )}
      </div>
    </div>
  );
}

// Chips for current aka members (each removable), plus an inline
// click-to-reveal search box that bundles a picked tag as a new member.
function AkaEditor({
  row, busy, onRemoveAka, onAddAka,
}: {
  row: TagRowData;
  busy: string | null;
  onRemoveAka: (alias: string) => void;
  onAddAka: (canonical: string, memberKey: string) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);
  const [results, setResults] = useState<TagRowData[]>([]);

  useEffect(() => {
    const term = debouncedQuery.trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load guard: clears stale results when the query drops below the search threshold, same pattern as FacetAutocomplete.tsx
    if (!searching || term.length < 2) { setResults([]); return; }
    let alive = true;
    const memberKeys = new Set(row.aka.map((a) => a.key));
    fetch(`/api/dev/scoring/tags?q=${encodeURIComponent(term)}&limit=10`)
      .then((r) => r.json())
      .then((d: { tags?: TagRowData[] }) => {
        if (!alive) return;
        const candidates = (d.tags ?? []).filter((t) => t.key !== row.key && !memberKeys.has(t.key));
        setResults(candidates);
      })
      .catch(() => { if (alive) setResults([]); });
    return () => { alive = false; };
  }, [debouncedQuery, searching, row.key, row.aka]);

  function pick(memberKey: string) {
    onAddAka(row.key, memberKey);
    setQuery("");
    setResults([]);
    setSearching(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {row.aka.map((a) => (
        <span key={a.key} className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded bg-neutral-800 text-xs text-neutral-400">
          {a.label}
          <span className="text-neutral-600">{a.count}×</span>
          <button
            onClick={() => onRemoveAka(a.key)}
            disabled={busy === a.key}
            aria-label={`Remove ${a.label} from ${row.label}`}
            className="text-neutral-500 hover:text-red-400 leading-none disabled:opacity-50"
          >
            ×
          </button>
        </span>
      ))}
      {searching ? (
        <div className="relative">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => setTimeout(() => setSearching(false), 150)}
            onKeyDown={(e) => { if (e.key === "Escape") setSearching(false); }}
            placeholder="Find a tag to add…"
            className="text-xs px-1.5 py-0.5 rounded bg-neutral-950 border border-neutral-700 text-neutral-100 w-32"
          />
          {results.length > 0 && (
            <div
              className="absolute z-20 mt-1 w-56 max-h-40 overflow-y-auto rounded-md border border-neutral-700 bg-neutral-900 shadow-xl"
              onMouseDown={(e) => e.preventDefault()}
            >
              {results.map((t) => (
                <button
                  key={t.key}
                  onClick={() => pick(t.key)}
                  className="w-full text-left px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 truncate"
                >
                  {t.label} <span className="text-neutral-600">{t.count}×</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSearching(true)}
          className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors underline decoration-dotted"
        >
          + add
        </button>
      )}
    </div>
  );
}

// "Shown as" — which spelling of a bundle people actually see.
//
// 2026-09-03 (Nils): "when i bundle franchises or tags, i need an option to
// choose which version i want to use as display name on fandex. the other name
// should then never be displayed again."
//
// ── Why the options are LABELS and the write is a string ────────────────────
//
// Bundling is a key operation and naming is a label one, deliberately kept
// apart: re-keying a bundle would move `tag_category_override` rows and every
// facet url, while a name is a single row and a single DELETE to undo.
//
// So the picker offers each member's own spelling as a shortcut, plus a free
// text field, because the honest answer is sometimes neither ("Sci-Fi" and
// "science fiction" both being wrong for "Science Fiction"). "Whatever the
// providers say" is the reset, and it is the only option that removes the row
// rather than writing one.
function DisplayNamePicker({
  row, busy, onSetDisplayName,
}: {
  row: TagRowData;
  busy: string | null;
  onSetDisplayName: (tagKey: string, label: string | null) => void;
}) {
  const [custom, setCustom] = useState("");
  const [editing, setEditing] = useState(false);
  const disabled = busy === row.key;

  // The member spellings, deduped against the name already showing. `row.label`
  // is the CHOSEN name when one exists, so listing it would offer a no-op.
  const options = [...new Set(row.aka.map((a) => a.label))].filter((l) => l !== row.label);

  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-neutral-600">
      <span className="shrink-0">Shown as:</span>
      <span className="text-neutral-400 truncate max-w-[8rem]" title={row.label}>{row.label}</span>

      {editing ? (
        <input
          autoFocus
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onBlur={() => setTimeout(() => setEditing(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setEditing(false); setCustom(""); }
            if (e.key === "Enter" && custom.trim()) {
              onSetDisplayName(row.key, custom.trim());
              setCustom("");
              setEditing(false);
            }
          }}
          placeholder="Type a name, Enter"
          className="text-xs px-1.5 py-0.5 rounded bg-neutral-950 border border-neutral-700 text-neutral-100 w-36"
        />
      ) : (
        <>
          {options.map((label) => (
            <button
              key={label}
              disabled={disabled}
              onClick={() => onSetDisplayName(row.key, label)}
              title={`Show this tag as "${label}" everywhere`}
              className="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 truncate max-w-[8rem] disabled:opacity-50"
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditing(true)}
            className="text-neutral-600 hover:text-neutral-300 underline decoration-dotted disabled:opacity-50"
          >
            custom
          </button>
          {row.labelOverridden && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSetDisplayName(row.key, null)}
              title="Go back to whatever the providers call it"
              className="text-neutral-600 hover:text-neutral-300 underline decoration-dotted disabled:opacity-50"
            >
              reset
            </button>
          )}
        </>
      )}
    </div>
  );
}
