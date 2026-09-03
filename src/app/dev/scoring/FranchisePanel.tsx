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
interface Franchise { key: string; label: string; members: Member[]; types: string[]; aliases: string[]; rawLabel?: string; labelOverridden?: boolean }
interface Suggestion { mediaItemId: string; title: string; type: string; ipKey: string; ipLabel: string; match: "exact" | "prefix" }
interface SearchHit { id: string; title: string; type: string }

type Action =
  | { action: "bundle"; alias: string; canonical: string; displayLabel?: string }
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

  // 2026-09-03 (Nils): "when i bundle franchises or tags, i need an option to
  // choose which version i want to use as display name on fandex. the other name
  // should then never be displayed again."
  //
  // A separate route from the franchise actions, because naming is reversible on
  // its own and applies just as well to a franchise that is in no bundle. A null
  // label reverts to whatever the providers call it.
  async function setDisplayName(key: string, label: string | null) {
    setBusy(`n-${key}`);
    setError(null);
    try {
      const res = label
        ? await fetch("/api/dev/scoring/labels", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "ip", key, label }),
          })
        : await fetch(`/api/dev/scoring/labels?kind=ip&key=${encodeURIComponent(key)}`, { method: "DELETE" });
      if (!res.ok) { setError("Could not set the display name"); return; }
      await load(false);
      onChanged();
    } catch {
      setError("Could not set the display name");
    } finally {
      setBusy(null);
    }
  }

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

  // 2026-09-03 (Nils): "the franchises list should be sorted alphabetically to
  // easily identify bundles." surveyFranchises() returns them by member count
  // (most first), which is the right order for "what is big" and the wrong one
  // for "are these two rows the same franchise under two names" — the duplicates
  // you are hunting sit next to each other only under a name sort. Alphabetical
  // is the default now; the size order stays one click away rather than being
  // deleted, since it is what the API still computes.
  const [order, setOrder] = useState<"name" | "size">("name");

  const term = filter.trim().toLowerCase();
  const shown = (term
    ? franchises.filter((f) => f.key.includes(term) || f.label.toLowerCase().includes(term))
    : franchises
  ).slice().sort((a, b) =>
    order === "name"
      ? a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) || a.key.localeCompare(b.key)
      : b.members.length - a.members.length || a.key.localeCompare(b.key),
  );

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-neutral-200">Franchises</h2>
        <div className="flex items-center gap-2">
          <input
            className={inputCls} placeholder="Filter franchises…"
            value={filter} onChange={(e) => setFilter(e.target.value)}
          />
          <select
            className={inputCls} value={order}
            onChange={(e) => setOrder(e.target.value as "name" | "size")}
            aria-label="Sort franchises"
          >
            <option value="name">A to Z</option>
            <option value="size">Most items</option>
          </select>
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
            key={f.key} f={f} all={franchises}
            open={openKey === f.key} onToggle={() => setOpenKey(openKey === f.key ? null : f.key)}
            busy={busy} act={act} onSetDisplayName={setDisplayName}
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
  f, all, open, onToggle, busy, act, onSetDisplayName,
}: {
  f: Franchise;
  all: Franchise[];
  open: boolean;
  onToggle: () => void;
  busy: string | null;
  act: (a: Action, busyKey: string) => Promise<void>;
  onSetDisplayName: (key: string, label: string | null) => void;
}) {
  const [bundleInto, setBundleInto] = useState("");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  // 2026-09-03 (Nils): "the searchbox for bundle franchise to franchise does not
  // show results like it does on the searchbox for add item to franchise."
  //
  // It was a native <datalist>, which is not a search box even though it looks
  // like one. Chrome matches a datalist option on its VALUE only, by prefix, and
  // the values here are KEYS: typing "Star Wars" against `star-wars` matches
  // nothing, and neither does "Rings" against `the-lord-of-the-rings`. It also
  // silently caps how many options it will render, so the long tail was
  // unreachable even when the prefix was right.
  //
  // Replaced with the same shape the attach box uses: type, see a list, click
  // one. Filtering is client-side because the whole franchise list is already in
  // memory here, so it needs no endpoint and answers on the keystroke.
  const bundleTerm = bundleInto.trim().toLowerCase();
  const bundleMatches = bundleTerm.length < 1 ? [] : all
    .filter((x) => x.key !== f.key
      && (x.key.includes(bundleTerm) || x.label.toLowerCase().includes(bundleTerm)))
    .slice(0, 8);
  // An exact key is what the API takes, so a typed key that IS one needs no pick.
  const bundleReady = all.some((x) => x.key !== f.key && x.key === bundleInto.trim());
  /** What the merged franchise would be called if we changed nothing. */
  const bundleTargetLabel = all.find((x) => x.key === bundleInto.trim())?.label ?? bundleInto.trim();

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
          {/* "Shown as", for a franchise that is ALREADY bundled or just badly
              named by its provider. The bundle buttons below choose at fold
              time; this changes the answer afterwards, and is the only place a
              free-typed name can be given. */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-600">
            <span className="shrink-0">Shown as:</span>
            <span className="text-neutral-300 truncate max-w-[14rem]" title={f.label}>{f.label}</span>
            {f.labelOverridden && f.rawLabel && f.rawLabel !== f.label && (
              <button
                className={btnCls}
                disabled={busy === `n-${f.key}`}
                title={`Go back to "${f.rawLabel}", what the providers call it`}
                onClick={() => onSetDisplayName(f.key, null)}
              >
                reset to &ldquo;{f.rawLabel}&rdquo;
              </button>
            )}
            <input
              className={`${inputCls} text-xs py-0.5 w-40`}
              placeholder="Rename, then Enter"
              disabled={busy === `n-${f.key}`}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const v = (e.target as HTMLInputElement).value.trim();
                if (!v) return;
                onSetDisplayName(f.key, v);
                (e.target as HTMLInputElement).value = "";
              }}
            />
          </div>

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
          <div className="border-t border-neutral-800/70 pt-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-neutral-500">Fold this franchise into:</span>
              <input
                className={inputCls} placeholder="Search franchises…"
                value={bundleInto} onChange={(e) => setBundleInto(e.target.value)}
              />
              {/* 2026-09-03 (Nils): "when i bundle franchises or tags, i need an
                  option to choose which version i want to use as display name."
                  Two buttons rather than a separate step, because at the moment
                  of bundling there are exactly two candidate names and the
                  question is which one survives. The label rides along in the
                  same request, so there is no window where the pair is folded
                  under a name nobody picked. */}
              {/* The pair appears only once a target is actually picked. Before
                  that `bundleTargetLabel` is the empty string, so the buttons
                  read `Bundle, keep ""` — disabled, but nonsense to look at, and
                  a disabled control that says nothing is worse than one control
                  that says what it needs. */}
              {bundleReady ? (
                <>
                  <button
                    className={btnCls}
                    disabled={busy === `b-${f.key}`}
                    title={`Fold into ${bundleInto.trim()} and show it as "${bundleTargetLabel}"`}
                    onClick={() => void act({ action: "bundle", alias: f.key, canonical: bundleInto.trim() }, `b-${f.key}`)
                      .then(() => setBundleInto(""))}
                  >
                    Bundle, keep &ldquo;{bundleTargetLabel}&rdquo;
                  </button>
                  <button
                    className={btnCls}
                    disabled={busy === `b-${f.key}`}
                    title={`Fold into ${bundleInto.trim()} but show it as "${f.label}"`}
                    onClick={() => void act(
                      { action: "bundle", alias: f.key, canonical: bundleInto.trim(), displayLabel: f.label },
                      `b-${f.key}`,
                    ).then(() => setBundleInto(""))}
                  >
                    Bundle, keep &ldquo;{f.label}&rdquo;
                  </button>
                </>
              ) : (
                <button className={btnCls} disabled>Bundle</button>
              )}
              {f.aliases.length > 0 && (
                <button
                  className={btnCls} disabled={busy === `d-${f.key}`}
                  onClick={() => void act({ action: "dissolve", canonical: f.key }, `d-${f.key}`)}
                >
                  Dissolve bundle
                </button>
              )}
            </div>

            {/* Results, not a datalist. Clicking one fills the exact key, which
                is what arms the Bundle button. */}
            {bundleTerm.length > 0 && !bundleReady && (
              bundleMatches.length > 0 ? (
                <div className="space-y-0.5">
                  {bundleMatches.map((x) => (
                    <button
                      key={x.key}
                      onClick={() => setBundleInto(x.key)}
                      className="w-full text-left px-2 py-1 rounded text-xs text-neutral-300 hover:bg-neutral-800 truncate"
                    >
                      {x.label}
                      <span className="text-neutral-600 font-mono"> · {x.key}</span>
                      <span className="text-neutral-600"> · {x.members.length} item{x.members.length === 1 ? "" : "s"}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-600 px-2">No other franchise matches that.</p>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
