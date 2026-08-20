"use client";
import { useCallback, useEffect, useState } from "react";

// 2026-08-14 — the Franchises section of the Taxonomy tab. Two mechanisms, kept
// visually separate because they fix different problems:
//
//   BUNDLE  — the providers NAME one franchise twice ("metal gear solid" and
//             "metal gear"). Folding them gives one Bayesian average.
//   ATTACH  — the providers have no franchise DATA for an item. TMDB has no
//   /DETACH   collection concept for shows and IGDB covers only games, so a
//             hand-attach is the ONLY way a series joins a franchise.
//
// Suggestions are title matches, deliberately never auto-applied: the same
// matcher that correctly finds "Star Wars: Andor" also matched the show "X" to
// the "X Collection" franchise, so a human accepting each one is the guard.

const inputCls = "bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-sm text-neutral-100";
const btnCls = "px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200 transition-colors disabled:opacity-50";

interface Member { mediaItemId: string; title: string | null; type: string; source: "provider" | "manual" | "wikidata" }

const SOURCE_LABEL: Record<Member["source"], string> = {
  provider: "",
  manual: "attached by hand",
  wikidata: "via Wikidata",
};
interface Franchise { key: string; label: string; members: Member[]; types: string[]; aliases: string[] }
interface Suggestion { mediaItemId: string; title: string; type: string; ipKey: string; ipLabel: string; match: "exact" | "prefix" }
interface SearchHit { id: string; title: string; type: string }

type Action =
  | { action: "bundle"; alias: string; canonical: string }
  | { action: "unbundle"; alias: string }
  | { action: "dissolve"; canonical: string }
  | { action: "attach"; mediaItemId: string; label: string }
  | { action: "detach"; mediaItemId: string; ipKey: string; label?: string }
  | { action: "clear"; mediaItemId: string; ipKey: string };

export default function FranchisePanel({ onChanged }: { onChanged: () => void }) {
  const [franchises, setFranchises] = useState<Franchise[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [filter, setFilter] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (withSuggestions: boolean) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dev/scoring/franchises${withSuggestions ? "?suggest=1" : ""}`);
      const data = await res.json();
      setFranchises(data.franchises ?? []);
      if (data.suggestions) setSuggestions(data.suggestions);
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetch-on-mount
  useEffect(() => { void load(false); }, [load]);

  async function act(a: Action, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch("/api/dev/scoring/franchises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(a),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Action failed"); return; }
      setFranchises(data.franchises ?? []);
      // A franchise edit changes real scores, so the parent reloads too —
      // scoringConfigSignature folds both ip signatures in, meaning every
      // cached profile is already invalidated server-side by this point.
      onChanged();
    } catch {
      setError("Action failed");
    } finally {
      setBusy(null);
    }
  }

  const shown = filter.trim()
    ? franchises.filter((f) => f.key.includes(filter.trim().toLowerCase()) || f.label.toLowerCase().includes(filter.trim().toLowerCase()))
    : franchises;

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-neutral-200">Franchises</h2>
        <div className="flex items-center gap-2">
          <input
            className={inputCls} placeholder="Filter franchises…"
            value={filter} onChange={(e) => setFilter(e.target.value)}
          />
          <button className={btnCls} disabled={loading} onClick={() => void load(true)}>
            {suggestions ? "Refresh suggestions" : "Find suggestions"}
          </button>
        </div>
      </div>

      <p className="text-xs text-neutral-500">
        A franchise contributes to the Fandex Score through its own weight (<span className="text-neutral-400">Franchise</span>,
        on the Weights tab). <span className="text-neutral-400">Bundle</span> two names for the same franchise so they share one
        average; <span className="text-neutral-400">attach or detach</span> an item when the provider data is wrong or missing.
        Shows have no provider franchise data at all, because TMDB has no collections for series and IGDB only covers
        games, so attaching is the only way a series joins one.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {suggestions && (
        <SuggestionList
          suggestions={suggestions}
          busy={busy}
          onAccept={(s) => act({ action: "attach", mediaItemId: s.mediaItemId, label: s.ipLabel }, `sug-${s.mediaItemId}`)
            .then(() => setSuggestions((prev) => prev?.filter((x) => x.mediaItemId !== s.mediaItemId) ?? null))}
          onReject={(s) => setSuggestions((prev) => prev?.filter((x) => x.mediaItemId !== s.mediaItemId) ?? null)}
        />
      )}

      <div className="space-y-1">
        {loading && !franchises.length && <p className="text-sm text-neutral-500">Loading…</p>}
        {!loading && !shown.length && <p className="text-sm text-neutral-500">No franchises match.</p>}
        {shown.map((f) => (
          <FranchiseRow
            key={f.key} f={f} allKeys={franchises.map((x) => x.key)}
            open={openKey === f.key} onToggle={() => setOpenKey(openKey === f.key ? null : f.key)}
            busy={busy} act={act}
          />
        ))}
      </div>
    </section>
  );
}

function SuggestionList({
  suggestions, busy, onAccept, onReject,
}: {
  suggestions: Suggestion[];
  busy: string | null;
  onAccept: (s: Suggestion) => void;
  onReject: (s: Suggestion) => void;
}) {
  if (!suggestions.length) {
    return <p className="text-xs text-neutral-500">No title matches left to review.</p>;
  }
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 space-y-2">
      <p className="text-xs text-neutral-400">
        {suggestions.length} title match{suggestions.length === 1 ? "" : "es"}, meaning items whose title says they belong to a
        franchise the catalog already knows, but which carry no provider data. Nothing is applied until you accept it.
      </p>
      <div className="max-h-72 overflow-y-auto space-y-1">
        {suggestions.map((s) => (
          <div key={s.mediaItemId} className="flex items-center justify-between gap-3 text-sm py-1">
            <span className="text-neutral-300 truncate">
              <span className="text-[10px] uppercase text-neutral-600 mr-2">{s.type}</span>
              {s.title}
              <span className="text-neutral-600"> → </span>
              <span className="text-neutral-400">{s.ipLabel}</span>
              <span className="text-[10px] text-neutral-600 ml-2">{s.match}</span>
            </span>
            <span className="flex gap-1.5 shrink-0">
              <button className={btnCls} disabled={busy === `sug-${s.mediaItemId}`} onClick={() => onAccept(s)}>Attach</button>
              <button className={btnCls} onClick={() => onReject(s)}>Skip</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FranchiseRow({
  f, allKeys, open, onToggle, busy, act,
}: {
  f: Franchise;
  allKeys: string[];
  open: boolean;
  onToggle: () => void;
  busy: string | null;
  act: (a: Action, busyKey: string) => Promise<void>;
}) {
  const [bundleInto, setBundleInto] = useState("");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  async function runSearch() {
    if (search.trim().length < 2) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/dev/scoring/library-search?q=${encodeURIComponent(search.trim())}`);
      const data = await res.json();
      setHits(data.results ?? []);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-800/70">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-neutral-800/30 transition-colors"
      >
        <span className="text-sm text-neutral-200 truncate">
          {f.label}
          {f.aliases.length > 0 && (
            <span className="text-xs text-neutral-500"> · aka {f.aliases.join(", ")}</span>
          )}
        </span>
        <span className="text-xs text-neutral-500 shrink-0">
          {f.members.length} item{f.members.length === 1 ? "" : "s"} · {f.types.join(", ")}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-neutral-800/70 pt-3">
          {/* Members */}
          <div className="space-y-1">
            {f.members.map((m) => (
              <div key={m.mediaItemId} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-neutral-400 truncate">
                  <span className="text-[10px] uppercase text-neutral-600 mr-2">{m.type}</span>
                  {m.title ?? m.mediaItemId}
                  {m.source !== "provider" && (
                    <span className="text-[10px] text-neutral-600 ml-2">{SOURCE_LABEL[m.source]}</span>
                  )}
                </span>
                <button
                  className={btnCls}
                  disabled={busy === `m-${m.mediaItemId}`}
                  // An override-derived row is CLEARED (delete the row); a
                  // provider-derived one is DETACHED (write a 'remove'), since
                  // deleting nothing would just let the next read re-derive it.
                  // Clearing a wikidata row lets a later sweep re-attach it —
                  // detach it instead if you want the removal to stick.
                  onClick={() => void (m.source !== "provider"
                    ? act({ action: "clear", mediaItemId: m.mediaItemId, ipKey: f.key }, `m-${m.mediaItemId}`)
                    : act({ action: "detach", mediaItemId: m.mediaItemId, ipKey: f.key, label: f.label }, `m-${m.mediaItemId}`))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          {/* Attach an item */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              className={inputCls} placeholder="Search your library to attach…"
              value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runSearch(); } }}
            />
            <button className={btnCls} disabled={searching} onClick={() => void runSearch()}>Search</button>
          </div>
          {hits.length > 0 && (
            <div className="space-y-1">
              {hits.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-neutral-400 truncate">
                    <span className="text-[10px] uppercase text-neutral-600 mr-2">{h.type}</span>{h.title}
                  </span>
                  <button
                    className={btnCls} disabled={busy === `a-${h.id}`}
                    onClick={() => void act({ action: "attach", mediaItemId: h.id, label: f.label }, `a-${h.id}`)
                      .then(() => setHits((prev) => prev.filter((x) => x.id !== h.id)))}
                  >
                    Attach
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Bundling */}
          <div className="flex items-center gap-2 flex-wrap border-t border-neutral-800/70 pt-3">
            <span className="text-xs text-neutral-500">Fold this franchise into:</span>
            <input
              className={inputCls} placeholder="canonical key…" list={`ip-keys-${f.key}`}
              value={bundleInto} onChange={(e) => setBundleInto(e.target.value)}
            />
            <datalist id={`ip-keys-${f.key}`}>
              {allKeys.filter((k) => k !== f.key).map((k) => <option key={k} value={k} />)}
            </datalist>
            <button
              className={btnCls}
              disabled={!bundleInto.trim() || busy === `b-${f.key}`}
              onClick={() => void act({ action: "bundle", alias: f.key, canonical: bundleInto.trim() }, `b-${f.key}`)
                .then(() => setBundleInto(""))}
            >
              Bundle
            </button>
            {f.aliases.length > 0 && (
              <button
                className={btnCls} disabled={busy === `d-${f.key}`}
                onClick={() => void act({ action: "dissolve", canonical: f.key }, `d-${f.key}`)}
              >
                Dissolve bundle
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
