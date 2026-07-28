"use client";
import { Bookmark, Library, Flame } from "lucide-react";

// <ScopeFilter> — the calendar's "what am I looking at" control (2026-07-28).
// Deliberately shaped like <TypeFilter> (same 40px circular icon chips, same
// tap-44 hit area) because Nils asked for "an easy filter, similar to the media
// type filter", and the two sit side by side in the same row.
//
// ONE semantic difference from TypeFilter, and it matters: TypeFilter treats an
// empty selection as "All" (its own dedicated chip clears the rest). Here each
// scope is an independent source of items, so empty means EMPTY — there is no
// "All" chip and no clever clearing. The caller is responsible for telling the
// user why the calendar went blank when they switch everything off.
//
// All three active states use the accent fill rather than a colour per scope:
// success/warning read fine as icon tints but become low-contrast as a FILL
// under the light theme, which is exactly the class of bug the H1 pass got
// caught by. The icons already distinguish them.

export const CALENDAR_SCOPES = ["wishlist", "library", "popular"] as const;
export type CalendarScope = (typeof CALENDAR_SCOPES)[number];

const SCOPE_META: Record<CalendarScope, { label: string; title: string; Icon: typeof Bookmark }> = {
  wishlist: { label: "Wishlist releases", title: "Wishlist", Icon: Bookmark },
  library:  { label: "Library releases",  title: "Library",  Icon: Library },
  popular:  { label: "Popular releases",  title: "Popular",  Icon: Flame },
};

const INACTIVE_CLASS =
  "border-border-strong text-text-secondary bg-transparent hover:border-neutral-400";

export interface ScopeFilterProps {
  activeScopes: CalendarScope[];
  onToggleScope: (s: CalendarScope) => void;
}

export default function ScopeFilter({ activeScopes, onToggleScope }: ScopeFilterProps) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Filter by source">
      {CALENDAR_SCOPES.map((scope) => {
        const { label, title, Icon } = SCOPE_META[scope];
        const active = activeScopes.includes(scope);
        return (
          <button
            key={scope}
            type="button"
            onClick={() => onToggleScope(scope)}
            aria-pressed={active}
            aria-label={label}
            title={title}
            className={`tap-44 w-10 h-10 shrink-0 rounded-full border flex items-center justify-center transition-colors ${active ? "" : INACTIVE_CLASS}`}
            style={active ? { borderColor: "var(--color-accent)", background: "var(--color-accent)", color: "var(--color-text-on-accent)" } : undefined}
          >
            <Icon className="w-4 h-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
