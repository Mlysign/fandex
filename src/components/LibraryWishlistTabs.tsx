"use client";
import { Library as LibraryIcon, Bookmark, LayoutGrid, Star } from "lucide-react";
import { MyStuffTab } from "@/lib/myStuffMerge";

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

const TABS: { key: MyStuffTab; label: string; Icon: typeof LibraryIcon }[] = [
  { key: "all", label: "All", Icon: LayoutGrid },
  { key: "wishlist", label: "Wishlist", Icon: Bookmark },
  { key: "unrated", label: "Unrated", Icon: LibraryIcon },
  { key: "rated", label: "Rated", Icon: Star },
];

export default function LibraryWishlistTabs({ active, onChange }: { active: MyStuffTab; onChange: (tab: MyStuffTab) => void }) {
  return (
    <div className="max-w-6xl mx-auto px-6 pt-4" role="tablist" aria-label="Filter your library and wishlist">
      <div className="flex items-center gap-5 border-b border-border">
        {TABS.map(({ key, label, Icon }) => {
          const isActive = key === active;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              role="tab"
              aria-selected={isActive}
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
    </div>
  );
}
