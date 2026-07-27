"use client";
import Link from "next/link";
import { Library as LibraryIcon, Bookmark } from "lucide-react";

// H1.6e — the D-A "Library ⇄ Wishlist tab" that unifies the two pages into one
// "my stuff" surface: they were already treated as one destination by the nav
// (H1.6c — both light the same "Library" nav item), but had no way to switch
// between them without leaving the page. Each page keeps its own route,
// data fetch, filters and persisted state (usePersistedState keys are already
// namespaced per-page) — this is a navigation affordance, not a merge of the
// two pages' state.
//
// 2026-07-27 (Nils, mockup-vs-live pass): restyled from a pill/segmented
// switcher to the mockup's underline-tab anatomy (library.html's `.entry`-
// adjacent tab row — 13px sans, active = 2px accent inset-shadow underline,
// inactive = --color-neutral-400 "min" tone) and reordered Wishlist first.
// Wishlist is now also the default landing for the shared "Library" nav slot
// (AppNav) — this is the forward-looking half of "my stuff" (what's next),
// which is why H2c's onboarding already lands new sign-ins there.

const TABS = [
  { href: "/wishlist", label: "Wishlist", Icon: Bookmark },
  { href: "/library", label: "Library", Icon: LibraryIcon },
] as const;

export default function LibraryWishlistTabs({ active }: { active: "library" | "wishlist" }) {
  return (
    <div className="max-w-6xl mx-auto px-6 pt-4" role="tablist" aria-label="Library or Wishlist">
      <div className="flex items-center gap-5 border-b border-border">
        {TABS.map(({ href, label, Icon }) => {
          const isActive = href === `/${active}`;
          return (
            <Link
              key={href}
              href={href}
              role="tab"
              aria-selected={isActive}
              className={`tap-44-y flex items-center gap-1.5 pb-3 text-label transition-colors ${
                isActive ? "text-text-primary shadow-[inset_0_-2px_0_var(--color-accent)]" : "text-neutral-400 hover:text-text-secondary"
              }`}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden />
              {label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
