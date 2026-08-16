"use client";
import { Library as LibraryIcon, Bookmark, PlayCircle } from "lucide-react";
import type { MyStuffTab } from "@/lib/myStuffMerge";

// C8 (2026-07-28) — the Library/Wishlist merge: what was a two-route Link
// switcher (H1.6e) is now a four-tab strip over ONE shared view
// (MyStuffView.tsx). Tab is local React state, not navigation — clicking a
// tab never changes the URL, so Back always lands on the route's own
// initial tab rather than a stale stored one. Reuses the underline anatomy
// the two-route version had (2026-07-27 mockup-vs-live pass): 13px sans,
// active = 2px accent inset-shadow underline, inactive = neutral-400.
//
// "Playing" (the mockup's 4th tab) isn't here — this app stores no
// in-progress status (watched/played/owned/beaten/toplay are all terminal or
// ownership flags), so it would be permanently empty. "Unrated" is backed by
// real data instead (2026-07-28 decision).

// Three tabs since 2026-08-16 (Nils: "the tabs get a little crowded"). "All"
// was a superset of the other two rather than a place of its own, and
// Rated/Unrated were a rating FILTER wearing a tab's clothes — the toolbar
// already filters. Library keeps Unrated's icon, which is the one that always
// meant "your library" anyway.
//
// Order is Wishlist → Progress → Library, per the spec, and it happens to run
// from "haven't started" through "in the middle of" to "done with".
//
// MB16 footnote: the original comment above says "Playing" was left out in July
// because the app stored no in-progress status and the tab would have been
// permanently empty. Per-episode tracking is exactly the data that was missing,
// so Progress is that tab, finally backed by something.
const TABS: { key: MyStuffTab; label: string; Icon: typeof LibraryIcon }[] = [
  { key: "wishlist", label: "Wishlist", Icon: Bookmark },
  { key: "progress", label: "Progress", Icon: PlayCircle },
  { key: "library", label: "Library", Icon: LibraryIcon },
];

// 2026-07-28: the outer `max-w-6xl mx-auto px-6 pt-4` wrapper is gone — the
// strip now renders INSIDE SubBar (between the type chips and the search box,
// per the shared page order), which already supplies the container and padding.
// SM29 (2026-07-28): the tab buttons used to sit inside an unlabelled inner
// div, one level BELOW the actual role="tablist" element — so a tab's real
// DOM parent wasn't the tablist at all, breaking the tablist/tab relationship
// screen readers rely on. One element now carries both the layout classes and
// role="tablist", and each tab gets a stable id + aria-controls pointing at
// MyStuffView's role="tabpanel" content region, so the pairing is explicit in
// both directions.
export const tabId = (key: MyStuffTab) => `mystuff-tab-${key}`;
export const TABPANEL_ID = "mystuff-tabpanel";

export default function LibraryWishlistTabs({ active, onChange }: { active: MyStuffTab; onChange: (tab: MyStuffTab) => void }) {
  return (
    <div role="tablist" aria-label="Filter your library and wishlist" className="flex items-center gap-5 border-b border-border">
      {TABS.map(({ key, label, Icon }) => {
        const isActive = key === active;
        return (
          <button
            key={key}
            id={tabId(key)}
            type="button"
            onClick={() => onChange(key)}
            role="tab"
            aria-selected={isActive}
            aria-controls={TABPANEL_ID}
            className={`tap-44-y flex items-center gap-1.5 pb-3 text-label transition-colors ${
              isActive ? "text-text-primary shadow-[inset_0_-2px_0_var(--color-accent)]" : "text-neutral-400 hover:text-text-secondary"
            }`}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
