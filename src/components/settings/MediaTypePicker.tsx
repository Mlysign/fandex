"use client";
import { useEffect, useState } from "react";
import { Gamepad2, Clapperboard, Tv, Layers } from "lucide-react";
import PanelHeader from "@/components/insights/PanelHeader";
import type { MediaType } from "@/types";
import { MEDIA_TYPES, MEDIA_TYPE_LABELS, enabledMediaTypes } from "@/lib/mediaTypes";

// Settings → Default types (2026-08-27, semantics reversed 2026-09-02).
//
// Nils, 2026-08-27: "if users don't want to use fandex for games, we keep the
// games filter permanently disabled."
//
// ⚠️ **It is a DEFAULT, not a scope, and that is a reversal.** The first version
// removed the type's chip from the filter row entirely. Nils, 2026-09-02: "i
// dont want to hide the games filter here, just set the default to my pref."
// So the chip row now renders every type and this decides what an UN-NARROWED
// list resolves to: Home's rails, Discover, the Calendar, Library and Wishlist
// all start here, and one tap on the chip overrides it for the session.
//
// The chip selection lives in sessionStorage (`rr_type_filter`), so an override
// lasts the browser session and a genuinely new visit falls back to this. →
// lib/mediaTypes.ts `visibleTypes`
//
// ⚠️ It is a DISPLAY preference and nothing else. Your games stay synced and
// stay in the database — turning games back on restores the exact same rows.
// It must never reach a sync pull: `pruneWatchlist`/`pruneLibrary` read
// "absent from the pull" as "removed upstream", so filtering there would delete
// them for real.
//
// ⚠️ It also does NOT touch the Fandex Score. Every facet weight is a deviation
// from your GLOBAL rating baseline, so dropping games from the taste profile
// would move the score of every movie and show you have not touched. "What you
// want to see" and "what you like" are different questions.

const ICONS: Record<MediaType, typeof Gamepad2> = {
  game: Gamepad2,
  movie: Clapperboard,
  show: Tv,
};

export default function MediaTypePicker({
  value,
  onSave,
}: {
  /** Raw stored value: [] means not configured, i.e. everything is on. */
  value: string[];
  onSave: (types: string[]) => Promise<string[] | void>;
}) {
  const [selected, setSelected] = useState<MediaType[]>(enabledMediaTypes(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prop→state sync: `value` arrives after the /api/auth/me round-trip.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSelected(enabledMediaTypes(value)); }, [value]);

  const toggle = async (t: MediaType) => {
    const next = selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t];
    // ⚠️ Refuse to turn the last one off, in the UI as well as in the reader.
    // "Uses none of them" is indistinguishable from "never configured" in the
    // stored column, so it cannot round-trip — and an app with every list empty
    // and no explanation is the worst version of this feature.
    if (next.length === 0) {
      setError("Keep at least one. Fandex has nothing to show otherwise.");
      return;
    }
    setError(null);
    setSelected(next);
    setSaving(true);
    try {
      const stored = await onSave(next);
      if (Array.isArray(stored)) setSelected(enabledMediaTypes(stored));
    } finally {
      setSaving(false);
    }
  };

  const allOn = selected.length === MEDIA_TYPES.length;

  return (
    <section className="space-y-3">
      <PanelHeader
        eyebrow="Default types"
        hint="Which types every list starts with. You can still switch one on from the filter row any time."
      />
      <div className="bg-surface-elevated border border-border rounded-xl p-5 flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {MEDIA_TYPES.map((t) => {
            const Icon = ICONS[t] ?? Layers;
            const on = selected.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggle(t)}
                aria-pressed={on}
                className={`inline-flex items-center gap-2 min-h-11 px-4 rounded-full border text-label transition-colors ${
                  on
                    ? "bg-accent-subtle border-accent text-text-primary"
                    : "border-border-strong text-text-muted hover:text-text-secondary"
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden />
                {MEDIA_TYPE_LABELS[t]}
              </button>
            );
          })}
        </div>

        {error && <p className="text-caption text-danger">{error}</p>}

        <p className="text-xs text-text-secondary leading-relaxed">
          {allOn
            ? "Every list starts with all three."
            : `Off by default: ${MEDIA_TYPES.filter((t) => !selected.includes(t)).map((t) => MEDIA_TYPE_LABELS[t]).join(", ")}. `}
          {!allOn && "Nothing is deleted or hidden for good. Tap the type in any list's filter row to bring it back for that visit."}
          {saving && <span className="ml-2 text-text-muted">Saving…</span>}
        </p>
      </div>
    </section>
  );
}
