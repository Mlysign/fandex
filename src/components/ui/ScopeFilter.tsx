"use client";
import { Bookmark, Library, Flame } from "lucide-react";
import CollapsibleChips from "@/components/ui/CollapsibleChips";

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

// The scopes that read a user's own data. 2026-08-18: the calendar is public
// now, so for an anonymous visitor these two can't resolve to anything — they
// render as a sign-in prompt instead of a filter that silently does nothing.
// Popular is deliberately absent: it's provider-fed and identical for everyone.
export const PERSONAL_SCOPES: readonly CalendarScope[] = ["wishlist", "library"];

export interface ScopeFilterProps {
  activeScopes: CalendarScope[];
  onToggleScope: (s: CalendarScope) => void;
  /**
   * Anonymous viewer. The two personal chips become sign-in triggers: still
   * visible (so the calendar's full shape is discoverable logged out) and still
   * a real 44px control, but dimmed, never `aria-pressed`, and routed to
   * `onRequestSignIn` instead of `onToggleScope`.
   */
  anon?: boolean;
  onRequestSignIn?: () => void;
}

export default function ScopeFilter({ activeScopes, onToggleScope, anon, onRequestSignIn }: ScopeFilterProps) {
  // SM53 — collapsed to one chip, same as its twin TypeFilter. These two were
  // built to look identical on purpose and the last thing they need is one of
  // them collapsing and the other not.
  //
  // ⚠️ The summary shows a single scope's own icon only when exactly one is on.
  // With two or three it falls back to the generic Flame + a count, because
  // picking one of them to represent the set would be a lie about what the
  // calendar is currently showing.
  const selected = CALENDAR_SCOPES.filter((s) => activeScopes.includes(s));
  const SummaryIcon = selected.length === 1 ? SCOPE_META[selected[0]].Icon : Flame;
  const summary = <SummaryIcon className="w-4 h-4" aria-hidden />;

  return (
    <CollapsibleChips
      summaryIcon={summary}
      label={
        selected.length === 0
          ? "Filter by source, nothing selected"
          : `Filter by source (${selected.map((s) => SCOPE_META[s].title).join(", ")})`
      }
      title="Source"
      activeCount={selected.length}
      // Every scope on is the calendar's default. Nothing on is NOT a default —
      // it is the state that empties the page, so it must not read as neutral.
      isDefault={selected.length === CALENDAR_SCOPES.length}
    >
      {chips()}
    </CollapsibleChips>
  );

  function chips() {
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Filter by source">
      {CALENDAR_SCOPES.map((scope) => {
        const { label, title, Icon } = SCOPE_META[scope];
        const locked = !!anon && PERSONAL_SCOPES.includes(scope);
        const active = !locked && activeScopes.includes(scope);
        return (
          <button
            key={scope}
            type="button"
            onClick={() => (locked ? onRequestSignIn?.() : onToggleScope(scope))}
            // A locked chip is a sign-in button, not a toggle — announcing a
            // pressed state for it would be a lie.
            aria-pressed={locked ? undefined : active}
            aria-label={locked ? `${title}, sign in to use` : label}
            title={locked ? `Sign in to see your ${title.toLowerCase()}` : title}
            className={`tap-44 w-10 h-10 shrink-0 rounded-full border flex items-center justify-center transition-colors ${active ? "" : INACTIVE_CLASS} ${locked ? "opacity-45" : ""}`}
            style={active ? { borderColor: "var(--color-accent)", background: "var(--color-accent)", color: "var(--color-text-on-accent)" } : undefined}
          >
            <Icon className="w-4 h-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
}
