"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import BrandGlyph from "@/components/BrandGlyph";
import PanelHeader from "@/components/insights/PanelHeader";
import type { PlatformOption } from "@/lib/platformKeys";
import { platformMarkName } from "@/lib/platformKeys";

// Settings → Your platforms (2026-08-27).
//
// Nils: "if I only have netflix and prime, the 'available on' filter should only
// show those. if I only own a PS5 and switch, only those filters should show
// up." This is where that is said; the filter reads it through narrowToOwned().
//
// ── Why the options come from YOUR catalog, not a curated list ──────────────
// The obvious design is a hand-maintained list of the big services. It is
// wrong here, and the live data says so: this account's own library carries
// MagentaTV, Videoload, maxdome, WOW, RTL+, Joyn and Freenet meinVOD. A global
// list written from memory contains none of them, so the one German user we
// have would find his actual subscriptions missing. Deriving from the catalog
// costs no maintenance and cannot drift.
//
// The trade is that a service you own but have nothing from yet does not appear.
// That is the right trade: selecting it would filter to zero results anyway,
// and it appears the moment anything on it lands in your library.

// ── Why the list is clipped to two rows (2026-08-27) ────────────────────────
// This account's survey holds 195 services and consoles, and the streaming half
// alone is 122 — a wall of chips you scroll past to reach the rest of Settings,
// with your own twelve picks scattered through it. Collapsed, the group shows
// TWO ROWS: what you have selected first, then the services the most of your
// library sits on (`options` arrives count-descending, so "backfill with the
// popular ones" is just the order it came in).
//
// ⚠️ Two rows is MEASURED, not a chip count. A row holds three chips at 375px
// and seven at desktop width, depending on label length, so any fixed N is wrong
// at some width. The group renders the full list once, reads which chips landed
// in the first two rows (`offsetTop` relative to the first chip), and then
// renders that many. `useLayoutEffect` does the measuring, so the long version
// never reaches a paint.
//
// ⚠️ It SLICES rather than clipping with `overflow: hidden`, and that is the
// point of the extra work: a clipped chip is still in the DOM, still tabbable
// and still read out, so keyboard focus walks into a row nobody can see and the
// browser scrolls the hidden box to chase it. What is not offered is not
// rendered.
//
// ⚠️ The selected-first ORDER is frozen while you work. Re-sorting on every
// toggle would make the chip you just tapped jump to the front of row one and
// push whatever you were about to tap out of view. It re-snapshots when the
// option list changes, when the group is expanded or collapsed, and when the
// selection goes from empty to non-empty (which is when `value` lands from its
// own round-trip) — never on an individual pick.
const ROW_GAP = 6; // gap-1.5
const FALLBACK_ROW_H = 44; // min-h-11, used only until the first measurement

function ownedSummary(count: number, total: number): string {
  if (count === 0) return `Nothing selected. The filter offers all ${total}.`;
  return `${count} of ${total} selected.`;
}

function ChipGroup({
  label, items, selected, onToggle, collapsible,
}: {
  label: string;
  items: PlatformOption[];
  selected: string[];
  onToggle: (key: string) => void;
  /** False while a search is running: clipping search results hides the answer. */
  collapsible: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const rowsRef = useRef<HTMLDivElement>(null);
  /** How many chips fit in two rows. null = not measured yet, so render them all. */
  const [fit, setFit] = useState<number | null>(null);

  // Selected first, everything else in the order it arrived (count-descending).
  // Snapshotted rather than recomputed per toggle — see the note above. This is
  // React's "adjust state during render" pattern, not an effect: the new order
  // is needed for THIS paint, and an effect would render the old one first.
  const sig = `${items.map((o) => o.key).join("|")}|${expanded}|${selected.length > 0}`;
  const [orderSig, setOrderSig] = useState(sig);
  const [order, setOrder] = useState<string[]>(() => rankSelectedFirst(items, selected));
  if (orderSig !== sig) {
    setOrderSig(sig);
    setOrder(rankSelectedFirst(items, selected));
  }
  const rank = new Map(order.map((k, i) => [k, i]));
  const ordered = [...items].sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0));

  const collapsed = collapsible && !expanded;
  const shown = collapsed && fit !== null ? ordered.slice(0, fit) : ordered;
  const hidden = ordered.length - shown.length;

  // Measure the FULL list, once per (list, width, collapse state). Runs before
  // paint, and skips itself the moment `fit` is known, so the sliced render is
  // not measured as if it were the whole list.
  useLayoutEffect(() => {
    const el = rowsRef.current;
    if (!collapsed || fit !== null || !el) return;
    const chips = [...el.children] as HTMLElement[];
    if (chips.length === 0) return;
    const top = chips[0].offsetTop;
    const rowH = chips[0].offsetHeight || FALLBACK_ROW_H;
    // Row one starts at 0, row two at rowH + gap; anything lower is row three.
    const limit = rowH + ROW_GAP + 1;
    setFit(chips.filter((c) => c.offsetTop - top <= limit).length);
  }, [collapsed, fit]);

  // Any of these invalidates the count: a different list, a different width, or
  // coming back from expanded. Re-measuring means rendering the full list again
  // for exactly one layout pass.
  // ⚠️ And the webfont. Measured before it swaps in, the fallback's wider
  // metrics fit SEVEN chips where the real font fits eight, and the count is
  // frozen at that — row two then ends 177px short of the edge. Worse the other
  // way round: a narrower fallback would push a chip into a third row that is
  // no longer clipped away. One extra pass once the fonts are in.
  const refit = useRef(false);
  useEffect(() => {
    if (refit.current || !document.fonts) return;
    void document.fonts.ready.then(() => { refit.current = true; setFit(null); });
  }, []);

  // A ResizeObserver on the row itself, not a window `resize` listener: the row
  // narrows whenever its column does, and a window event is only one of the ways
  // that happens. The first callback fires on observe, so the width is only
  // treated as a change once it differs from the measured one.
  // ⚠️ Unverifiable in the browser pane — an observer never fires while the pane
  // is not displayed (AGENTS.md). Checked by loading at 375 instead.
  const widthSig = useRef(0);
  useEffect(() => {
    const el = rowsRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const w = Math.round(el.clientWidth);
      if (w === widthSig.current) return;
      widthSig.current = w;
      setFit(null);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const listSig = items.map((o) => o.key).join("|");
  const [seenSig, setSeenSig] = useState(listSig);
  if (seenSig !== listSig) {
    setSeenSig(listSig);
    setFit(null);
  }

  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-meta text-text-secondary">{label}</span>
      <div ref={rowsRef} className="flex flex-wrap gap-1.5">
        {shown.map((o) => {
          const active = selected.includes(o.key);
          return (
            <button
              key={o.key}
              onClick={() => onToggle(o.key)}
              aria-pressed={active}
              className={`inline-flex items-center gap-2 min-h-11 px-3 rounded-full border text-label transition-colors ${
                active
                  ? "bg-accent-subtle border-accent text-text-primary"
                  : "border-border-strong text-text-secondary hover:text-text-primary"
              }`}
            >
              <BrandGlyph source={platformMarkName(o.label)} size={16} />
              <span className="whitespace-nowrap">{o.label}</span>
              <span className="font-mono text-meta text-text-muted tabular-nums">{o.count}</span>
            </button>
          );
        })}
      </div>
      {collapsible && (hidden > 0 || expanded) && (
        <button
          onClick={() => { setExpanded((v) => !v); setFit(null); }}
          aria-expanded={expanded}
          className="self-start min-h-11 text-label text-accent hover:text-accent-hover transition-colors"
        >
          {expanded ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

/** Selected keys first, then the rest untouched — `options` is already count-descending. */
function rankSelectedFirst(items: PlatformOption[], selected: string[]): string[] {
  const picked = new Set(selected);
  return [
    ...items.filter((o) => picked.has(o.key)).map((o) => o.key),
    ...items.filter((o) => !picked.has(o.key)).map((o) => o.key),
  ];
}

export default function PlatformPicker({
  options,
  value,
  onSave,
  loading = false,
}: {
  options: PlatformOption[];
  value: string[];
  /** Persists the full list. Returns what was actually stored. */
  onSave: (keys: string[]) => Promise<string[] | void>;
  loading?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(value);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The list every write starts from, so two toggles in one tick compose (see
  // `toggle`). Mirrors `selected` and is never read during render.
  const selectedRef = useRef<string[]>(value);

  // Prop→state sync: `value` arrives after the /api/auth/me round-trip, so the
  // first render is necessarily empty and has to be corrected once.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSelected(value); selectedRef.current = value; }, [value]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Toggling writes to local state immediately and persists on a trailing
  // debounce: picking four services is one save, not four, and the chips never
  // wait on a round-trip to respond.
  const toggle = (key: string) => {
    // ⚠️ Off a REF, not off `selected`. Two toggles inside one render tick both
    // read the same state closure, so the second overwrites the first and one
    // pick is silently lost — reproduced while testing the collapsed list, where
    // the chips sit close enough together to hit in quick succession. The save
    // below needs the resulting list, so a functional setState alone is not
    // enough; the ref is the list both halves agree on.
    const current = selectedRef.current;
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    selectedRef.current = next;
    setSelected(next);
    if (timer.current) clearTimeout(timer.current);
    setSaving(true);
    timer.current = setTimeout(async () => {
      try {
        const stored = await onSave(next);
        // Adopt what the server kept rather than assuming the list round-tripped:
        // it drops malformed and duplicate keys.
        if (Array.isArray(stored)) { setSelected(stored); selectedRef.current = stored; }
      } finally {
        setSaving(false);
      }
    }, 500);
  };

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options),
    [options, q]
  );
  const streaming = shown.filter((o) => o.group === "streaming");
  const games = shown.filter((o) => o.group === "games");

  return (
    <section className="space-y-3">
      <PanelHeader
        eyebrow="Your platforms"
        hint="Pick what you subscribe to and own. The “Available on” filter then offers only these."
      />
      <div className="bg-surface-elevated border border-border rounded-xl p-5 flex flex-col gap-4">
        {loading ? (
          <p className="text-xs text-text-secondary">Reading your library…</p>
        ) : options.length === 0 ? (
          // An empty picker with no explanation is the "renders null when empty"
          // trap: nothing here tells you whether it is broken, still loading, or
          // genuinely empty. Say which.
          <p className="text-xs text-text-secondary leading-relaxed">
            Nothing in your library says where it can be watched or played yet. Sync an account, or open a few titles,
            and the services they are on will show up here.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-text-secondary">
                {ownedSummary(selected.length, options.length)}
                {saving && <span className="ml-2 text-text-muted">Saving…</span>}
              </p>
              {selected.length > 0 && (
                <button
                  onClick={() => {
                    setSelected([]);
                    selectedRef.current = [];
                    if (timer.current) clearTimeout(timer.current);
                    setSaving(true);
                    void Promise.resolve(onSave([])).finally(() => setSaving(false));
                  }}
                  className="min-h-11 px-2 text-label text-accent hover:text-accent-hover transition-colors"
                >
                  Clear
                </button>
              )}
            </div>

            {options.length > 12 && (
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a service or console…"
                aria-label="Find a service or console"
                className="w-full min-h-11 bg-surface-inset border border-border-strong rounded-lg px-3 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent"
              />
            )}

            {shown.length === 0 ? (
              <p className="text-xs text-text-secondary">Nothing matches “{query}”.</p>
            ) : (
              <div className="flex flex-col gap-4">
                <ChipGroup label="Movies & shows" items={streaming} selected={selected} onToggle={toggle} collapsible={!q} />
                <ChipGroup label="Games" items={games} selected={selected} onToggle={toggle} collapsible={!q} />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
