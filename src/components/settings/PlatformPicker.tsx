"use client";
import { useEffect, useMemo, useRef, useState } from "react";
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

function ownedSummary(count: number, total: number): string {
  if (count === 0) return `Nothing selected. The filter offers all ${total}.`;
  return `${count} of ${total} selected.`;
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

  // Prop→state sync: `value` arrives after the /api/auth/me round-trip, so the
  // first render is necessarily empty and has to be corrected once.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSelected(value); }, [value]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Toggling writes to local state immediately and persists on a trailing
  // debounce: picking four services is one save, not four, and the chips never
  // wait on a round-trip to respond.
  const toggle = (key: string) => {
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    setSelected(next);
    if (timer.current) clearTimeout(timer.current);
    setSaving(true);
    timer.current = setTimeout(async () => {
      try {
        const stored = await onSave(next);
        // Adopt what the server kept rather than assuming the list round-tripped:
        // it drops malformed and duplicate keys.
        if (Array.isArray(stored)) setSelected(stored);
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

  const group = (label: string, items: PlatformOption[]) =>
    items.length === 0 ? null : (
      <div className="flex flex-col gap-2">
        <span className="font-mono text-meta text-text-secondary">{label}</span>
        <div className="flex flex-wrap gap-1.5">
          {items.map((o) => {
            const active = selected.includes(o.key);
            return (
              <button
                key={o.key}
                onClick={() => toggle(o.key)}
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
      </div>
    );

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
                {group("Movies & shows", streaming)}
                {group("Games", games)}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
