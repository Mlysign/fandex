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

const TABS = [
  { href: "/library", label: "Library", Icon: LibraryIcon },
  { href: "/wishlist", label: "Wishlist", Icon: Bookmark },
] as const;

export default function LibraryWishlistTabs({ active }: { active: "library" | "wishlist" }) {
  return (
    <div className="max-w-6xl mx-auto px-6 pt-4" role="tablist" aria-label="Library or Wishlist">
      <div className="inline-flex rounded-lg border border-border-strong overflow-hidden">
        {TABS.map(({ href, label, Icon }) => {
          const isActive = href === `/${active}`;
          return (
            <Link
              key={href}
              href={href}
              role="tab"
              aria-selected={isActive}
              className={`flex items-center gap-1.5 px-4 py-2 text-label transition-colors ${
                isActive ? "bg-accent-subtle text-accent" : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
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
