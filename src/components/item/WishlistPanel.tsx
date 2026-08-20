"use client";
import Link from "next/link";
import BrandGlyph from "@/components/BrandGlyph";
import { SectionHeading } from "./primitives";

// Per-provider wishlist management ("Your wishlists") on the item detail page.
//
// ── 2026-08-18: brand MARKS, not brand COLOURS ──────────────────────────────
// Nils: "the color coding can be removed everywhere on fandex (e.g. wishlist on
// details pages)". This panel used to identify each provider with a 2px dot in
// its own hex and then repeat that hex three more times on the "on list" pill
// (border at 44% alpha, text at 100%, fill at 15%) — four tints per row, in a
// panel whose whole job is a list of two or three providers.
//
// Now it reads the same way StoreLink and AuthOptions do: the provider's real
// logo from lib/brandMarks (simple-icons, inlined — the CSP blocks remote
// favicons) in the UI's own secondary text colour, and the ACCENT for the one
// thing that is genuinely a state ("on your wishlist"). The label beside it
// never went away, so nothing was ever encoded by colour alone — this only
// removes the redundant tint. Providers with no simple-icons entry (RAWG) fall
// back to a generic globe, exactly like StoreLink's fallback.

// The one genuinely stateful pill in this panel, so it takes the accent — the
// same treatment ActionCells gives a wishlisted card.
const ON_LIST_PILL =
  "text-xs px-2.5 py-1 rounded-full border border-accent-subtle bg-accent-subtle text-accent";

export default function WishlistPanel({
  platforms, loading, platformAction, onToggle, steamStoreUrl,
}: {
  platforms: any[];
  loading: boolean;
  platformAction: string | null;
  onToggle: (provider: string, onList: boolean) => void;
  steamStoreUrl: string | null;
}) {
  return (
    <div className="pt-4 border-t border-border">
      <SectionHeading>Your wishlists</SectionHeading>
      {loading ? (
        <p className="text-xs text-text-secondary">Loading…</p>
      ) : (
        <div className="space-y-2">
          {platforms.map((p) => (
            <div key={p.provider} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BrandGlyph source={p.provider} />
                <span className="text-sm text-text-secondary">{p.label}</span>
                {p.displayName && <span className="text-xs text-text-secondary">@{p.displayName}</span>}
              </div>
              {p.notConnected ? (
                <Link href="/settings" className="text-xs text-text-secondary hover:text-text-primary transition-colors">Not connected →</Link>
              ) : p.provider === "steam" ? (
                <div className="flex items-center gap-2">
                  {p.onList && <span className={ON_LIST_PILL}>✓ On wishlist</span>}
                  {steamStoreUrl ? (
                    <a href={steamStoreUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-text-secondary hover:text-text-primary transition-colors">
                      {p.onList ? "Open on Steam →" : "View on Steam →"}
                    </a>
                  ) : (
                    <span className="text-xs text-text-secondary">Read-only</span>
                  )}
                </div>
              ) : p.onList ? (
                <button onClick={() => onToggle(p.provider, true)} disabled={platformAction === p.provider} className={`${ON_LIST_PILL} transition-colors disabled:opacity-40 hover:brightness-110`}>
                  {platformAction === p.provider ? "..." : "✓ On list, remove"}
                </button>
              ) : (
                <button onClick={() => onToggle(p.provider, false)} disabled={platformAction === p.provider} className="text-xs px-2.5 py-1 rounded-full border border-border-strong text-text-secondary hover:border-neutral-400 hover:text-text-primary transition-colors disabled:opacity-40">
                  {platformAction === p.provider ? "..." : "+ Add to list"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
