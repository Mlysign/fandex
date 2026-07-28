"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search } from "lucide-react";
import { VocabMatch, TitleMatch } from "@/components/discovery/types";
import { ROLE_LABELS } from "@/lib/constants";
import { buildItemHref, buildFacetHref } from "@/lib/itemUrl";

// B5 (2026-07-28) — the desktop nav's collapsing search field
// (AppNav.tsx's trailing slot, 03-components.md §1). Debounced against the
// existing `/api/discover/facets` vocab (no new API route) — `kind=title`
// for titles, unfiltered for facets, bucketed here into People / Tags
// (Studio/company matches aren't one of the plan's three groups, so they're
// dropped from this quick box; the full facet search on /discover still
// finds them). Desktop-only: rendered from AppNav's `hidden md:flex` bar,
// so the mobile bottom nav never sees this component.
//
// That endpoint is `withUser`-gated (Taste Match's own autocomplete, which
// this reuses, is a personalized feature) — an anon visitor's fetch 401s.
// Rather than show a misleading "No matches", a failed/non-OK response just
// keeps the dropdown closed.

type Option =
  | { group: "people" | "tags"; kind: "facet"; data: VocabMatch }
  | { group: "titles"; kind: "title"; data: TitleMatch };

const MIN_CHARS = 3;

export default function NavSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<VocabMatch[]>([]);
  const [tags, setTags] = useState<VocabMatch[]>([]);
  const [titles, setTitles] = useState<TitleMatch[]>([]);
  const [searched, setSearched] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const term = q.trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (term.length < MIN_CHARS) { setPeople([]); setTags([]); setTitles([]); setSearched(false); setActiveIdx(-1); return; }
    debounce.current = setTimeout(async () => {
      try {
        const [facetsRes, titlesRes] = await Promise.all([
          fetch(`/api/discover/facets?q=${encodeURIComponent(term)}`),
          fetch(`/api/discover/facets?q=${encodeURIComponent(term)}&kind=title`),
        ]);
        // A 401 (anon — this endpoint is Taste Match's, session-gated) or any
        // other failure just keeps the dropdown closed, not a false "No matches".
        if (!facetsRes.ok || !titlesRes.ok) { setSearched(false); return; }
        const facetsData = await facetsRes.json();
        const titlesData = await titlesRes.json();
        const matches: VocabMatch[] = facetsData.matches ?? [];
        setPeople(matches.filter((m) => m.kind === "person"));
        setTags(matches.filter((m) => m.kind === "tag"));
        setTitles(titlesData.matches ?? []);
        setSearched(true);
        setActiveIdx(-1);
      } catch { setSearched(false); }
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q]);

  const options: Option[] = useMemo(() => [
    ...people.map((data): Option => ({ group: "people", kind: "facet", data })),
    ...tags.map((data): Option => ({ group: "tags", kind: "facet", data })),
    ...titles.map((data): Option => ({ group: "titles", kind: "title", data })),
  ], [people, tags, titles]);

  const noMatches = searched && q.trim().length >= MIN_CHARS && options.length === 0;

  function reset() {
    setOpen(false);
    setQ("");
    setPeople([]); setTags([]); setTitles([]);
    setSearched(false);
    setActiveIdx(-1);
  }

  function hrefFor(opt: Option) {
    return opt.kind === "title" ? buildItemHref(opt.data) : buildFacetHref(opt.data);
  }

  function go(opt: Option) {
    reset();
    router.push(hrefFor(opt));
  }

  // Dismiss on outside pointerdown (ActionCells.tsx:62-69's pattern).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) reset();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { reset(); inputRef.current?.blur(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); if (options.length) setActiveIdx((i) => (i + 1) % options.length); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); if (options.length) setActiveIdx((i) => (i <= 0 ? options.length - 1 : i - 1)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const opt = options[activeIdx] ?? options[0];
      if (opt) go(opt);
    }
  }

  const groupLabel = (g: Option["group"]) => (g === "people" ? "People" : g === "tags" ? "Tags" : "Titles");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); }}
        aria-label="Search titles, people and tags"
        className="tap-44 w-9 h-9 rounded-full bg-surface-elevated border border-border flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
      >
        <Search className="w-4 h-4" aria-hidden />
      </button>
    );
  }

  return (
    <div className="relative" ref={rootRef}>
      <div className="flex items-center gap-2 h-9 w-64 px-3 rounded-full bg-surface-elevated border border-border-strong">
        <Search className="w-3.5 h-3.5 text-text-secondary shrink-0" aria-hidden />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={options.length > 0 || noMatches}
          aria-controls="nav-search-listbox"
          aria-activedescendant={activeIdx >= 0 ? `nav-search-opt-${activeIdx}` : undefined}
          aria-autocomplete="list"
          placeholder="Search titles, people, tags…"
          className="flex-1 min-w-0 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-secondary"
        />
      </div>
      {(options.length > 0 || noMatches) && (
        <ul
          id="nav-search-listbox"
          role="listbox"
          aria-label="Search suggestions"
          className="absolute z-30 top-full mt-1.5 w-64 max-h-80 overflow-y-auto rounded-lg border border-border-strong bg-surface-overlay shadow-xl py-1"
        >
          {noMatches ? (
            <li className="px-3 py-2 text-xs text-text-secondary">No matches</li>
          ) : (
            (["people", "tags", "titles"] as const).map((g) => {
              const groupOptions = options.filter((o) => o.group === g);
              if (!groupOptions.length) return null;
              return (
                <li key={g} role="presentation">
                  <div aria-hidden className="px-3 pt-1.5 pb-1 font-mono text-[10px] uppercase tracking-wide text-text-secondary">{groupLabel(g)}</div>
                  <ul role="presentation">
                    {groupOptions.map((opt) => {
                      const idx = options.indexOf(opt);
                      const active = idx === activeIdx;
                      // SM24 (2026-07-28): these used to be bare <li onMouseDown>
                      // — no href, so no middle-click/cmd-click "open in new
                      // tab" and no copy-link, unlike every other result card
                      // in the app (PosterCard's N3 note). A real <Link>
                      // fixes that; role="option" keeps the listbox semantics
                      // the input's aria-activedescendant already relies on.
                      // Plain left-click still goes through Next's client-side
                      // nav, so `reset()` alone (not go()'s router.push) is
                      // all the onClick needs to do.
                      return (
                        <Link
                          key={opt.kind === "title" ? `title|${opt.data.id}` : `${opt.data.kind}|${opt.data.role ?? ""}|${opt.data.key}`}
                          id={`nav-search-opt-${idx}`}
                          href={hrefFor(opt)}
                          role="option"
                          aria-selected={active}
                          onMouseEnter={() => setActiveIdx(idx)}
                          onClick={() => reset()}
                          className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${active ? "bg-surface-elevated text-text-primary" : "text-text-secondary hover:bg-surface-elevated"}`}
                        >
                          {opt.kind === "title" ? (
                            <>
                              <span className="flex-1 truncate">{opt.data.title}</span>
                              <span className="text-[10px] text-text-secondary shrink-0">{opt.data.year ?? ""} · {opt.data.type}</span>
                            </>
                          ) : (
                            <>
                              <span className="flex-1 truncate">{opt.data.label}</span>
                              <span className="text-[10px] text-text-secondary shrink-0">{opt.data.role ? (ROLE_LABELS[opt.data.role] ?? opt.data.role) : opt.data.kind} · {opt.data.count}</span>
                            </>
                          )}
                        </Link>
                      );
                    })}
                  </ul>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
