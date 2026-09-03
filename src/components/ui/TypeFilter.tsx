"use client";
import { Layers, Gamepad2, Clapperboard, Tv } from "lucide-react";
import { TYPE_COLORS } from "@/lib/constants";
import { MEDIA_TYPES, visibleTypes, enabledMediaTypes } from "@/lib/mediaTypes";
import CollapsibleChips from "@/components/ui/CollapsibleChips";
import LogoOutline from "@/components/LogoOutline";

// <TypeFilter> — 03-components.md §6a. Row of circular 40px icon chips
// (All/Games/Movies/Shows). Replaces SubBar's old text-pill type chips
// (mockup-vs-live gap, resolved 2026-07-27 — Nils's call to match the
// literal mockup anatomy here rather than keep Q14's pill treatment).

const TYPE_ICONS: Record<string, typeof Gamepad2> = {
  game: Gamepad2,
  movie: Clapperboard,
  show: Tv,
};

export interface TypeFilterProps {
  activeTypes: string[];
  onToggleType: (t: string) => void;
  availableTypes?: string[];
  /**
   * The account's `users.media_types`, raw. Needed because `activeTypes` alone
   * cannot say what is on screen: `[]` means "not narrowed", which resolves to
   * this, not to every type. Without it the row claimed "All" while the lists
   * showed two of three (Nils, 2026-09-02: "the type filters should always show
   * the current state").
   */
  storedTypes?: string[];
}

const INACTIVE_CLASS =
  "border-border-strong text-text-secondary bg-transparent hover:border-neutral-400";

// ⚠️ The DEFAULT is the live path now (2026-09-02): all four list surfaces stopped
// passing `availableTypes`, because the media-type setting became a default rather
// than a scope and its chip has to stay on screen. So this must read MEDIA_TYPES
// rather than repeat the triple — a new type added to the union would otherwise
// compile clean and silently never get a chip. mediaTypes.ts is a LEAF module
// (one erased `import type`), so a client component can import it safely.
export default function TypeFilter({ activeTypes, onToggleType, availableTypes = MEDIA_TYPES, storedTypes }: TypeFilterProps) {
  // ⚠️ WHAT IS ON SCREEN, not what was clicked. `activeTypes` is the chip
  // selection and `[]` means "not narrowed", which resolves to the account's
  // default — so reading it directly made the row say "All" while the lists
  // showed two types of three. Every pressed state below comes from `shown`.
  // A widened Set, because `availableTypes` is string[] and `visibleTypes`
  // returns MediaType[]: comparing them directly is a tsc error, and casting the
  // callback parameter would silence the one check that keeps these two lists
  // talking about the same thing.
  const shown = new Set<string>(visibleTypes(activeTypes, storedTypes));
  const allActive = availableTypes.every((t) => shown.has(t));

  // SM53 (Nils, 2026-09-02) — collapsed to one chip until tapped, on EVERY page
  // that renders SubBar, not just the calendar. "shrinking the type filter must
  // apply to all pages, not just calendar. consitency is key."
  //
  // This component is rendered from exactly one place (SubBar), which is what
  // makes site-wide a single change rather than five. The summary reflects the
  // current selection: the All icon when nothing is narrowed, the single
  // selected type's own icon and colour when one is, and All plus a count when
  // several are. → components/ui/CollapsibleChips.tsx
  // 2026-09-03 (Nils): "can you exchange the icon on the type filter stack to
  // the fandex logo? a line design icon variation of that logo?" So the
  // collapsed chip wears the brand mark as an outline when the filter is at its
  // default, which is the state it is in almost all the time and the one where
  // the chip is really saying "everything". The moment it IS narrowed to a
  // single type it still shows that type's own icon and colour, because a chip
  // that cannot say what it filtered to is a chip you have to open to read.
  //
  // ⚠️ The SAME mark is on the expanded row's "All" chip. Splitting them was the
  // first attempt and it read as a flicker; see the note on that button.
  // `Layers` survives only as the fallback for a media type with no icon.
  const selected = availableTypes.filter((t) => shown.has(t));
  const SelectedIcon = selected.length === 1 ? TYPE_ICONS[selected[0]] : null;
  const summary = SelectedIcon ? (
    <SelectedIcon className="w-4 h-4" aria-hidden style={{ color: TYPE_COLORS[selected[0]] }} />
  ) : (
    <LogoOutline size={17} />
  );

  return (
    <CollapsibleChips
      summaryIcon={summary}
      label={allActive ? "Filter by type" : `Filter by type (${selected.length} selected)`}
      title="Type"
      activeCount={selected.length}
      isDefault={allActive}
    >
      {chips()}
    </CollapsibleChips>
  );

  /**
   * "All" has to mean ALL, which clearing no longer achieves.
   *
   * It used to just empty the selection, and empty resolves to the account's
   * default — so for someone whose default is movies+shows, the All chip
   * delivered two types of three. It now diffs the current selection against a
   * target and toggles the difference, which works through the plain
   * `onToggleType` callback every surface already passes (each one is a
   * functional setState, so the calls compose).
   *
   * ⚠️ The target is `[]` when the account default IS every type, and the
   * explicit triple otherwise. Keeping `[]` for the common case matters: it is
   * the "not narrowed" state, and writing an explicit triple into sessionStorage
   * instead would pin this session to today's types and silently ignore a later
   * change in Settings. Same stale-state trap as the session probe cache.
   */
  function selectAll() {
    const target: string[] =
      enabledMediaTypes(storedTypes).length === MEDIA_TYPES.length ? [] : [...MEDIA_TYPES];
    const diff = [
      ...activeTypes.filter((t) => !target.includes(t)),
      ...target.filter((t) => !activeTypes.includes(t)),
    ];
    diff.forEach(onToggleType);
  }

  function chips() {
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Filter by type">
      <button
        type="button"
        onClick={selectAll}
        aria-pressed={allActive}
        aria-label="All types"
        title="All"
        className={`tap-44 w-10 h-10 shrink-0 rounded-full border flex items-center justify-center transition-colors ${allActive ? "" : INACTIVE_CLASS}`}
        style={allActive ? { borderColor: "var(--color-accent)", background: "var(--color-accent)", color: "var(--color-text-on-accent)" } : undefined}
      >
        {/* The SAME mark as the collapsed summary above, and that is the point.
            Nils, second pass: "the fandex logo only shows up briefly after
            loading but is then replaced by the old icon." It was not a race or a
            cache — this button IS the old icon. On a wide screen the row starts
            collapsed for one frame (useMediaQuery is false on the server and on
            the client's first paint, deliberately) and then expands, so the
            Fandex mark rendered, the row opened, and lucide's Layers took its
            place beside the three type chips.

            I had argued the two slots meant different things: "everything" next
            to game/movie/show, versus "Fandex" on its own. From the outside they
            are one control that changed icon mid-load, which is just a flicker.
            One mark, both states. */}
        <LogoOutline size={17} />
      </button>

      {availableTypes.map((t) => {
        const Icon = TYPE_ICONS[t] ?? Layers;
        // ⚠️ `!allActive &&` is deliberate, and it is about what the button MEANS.
        // A type chip is "narrow to this", not "this is visible", so when nothing
        // is narrowed the honest state is All lit and the types dim — the look
        // this row has always had, and the right `aria-pressed` for a control
        // that is not engaged. It is only once the set is narrowed that the chips
        // have to name it, which is the case that was broken.
        const active = !allActive && shown.has(t);
        const color = TYPE_COLORS[t];
        const label = `${t.charAt(0).toUpperCase()}${t.slice(1)}s`;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onToggleType(t)}
            aria-pressed={active}
            aria-label={label}
            title={label}
            className={`tap-44 w-10 h-10 shrink-0 rounded-full border flex items-center justify-center transition-colors ${active ? "" : INACTIVE_CLASS}`}
            style={active ? { borderColor: color, background: color, color: "var(--color-text-on-media)" } : undefined}
          >
            <Icon className="w-4 h-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
  }
}
