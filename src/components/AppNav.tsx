"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { House, Search, CalendarDays, Library as LibraryIcon, User } from "lucide-react";
import Logo from "@/components/Logo";
import SignInDialog from "@/components/auth/SignInDialog";
import NavSearch from "@/components/NavSearch";
import { probeSession, resetSessionProbe } from "@/lib/sessionProbe";
import { recordPageView } from "@/lib/navHistory";

// H1.6c — the ONE adaptive navigation component (docs/design/fandex-handoff
// 03-components.md §1 + D-A). Bottom bar on mobile (<768px, safe-area inset),
// top bar on desktop (≥768px) — a single `<nav aria-label="Primary">` landmark
// either way. Replaces the old top-only NavBar, which was duplicated per-page.
//
// Five slots (D-A): Home · Search · Calendar · Library · You. Search = /discover
// (per H1.1's decision 3 — the old SearchModal it replaced was deleted in
// H1.6f, so there is no second search surface). The "Library" slot lights for
// BOTH /library and /wishlist (they're one "my stuff" surface, entered via a
// tab — H1.6e) and links to /wishlist by default (2026-07-27, Nils — the
// forward-looking half of the pair; the LibraryWishlistTabs switcher lists
// Wishlist first for the same reason). You lights for /profile and its
// /settings sub-page.
//
// Session-aware like the old NavBar: the catalog is public, so anon visitors
// see the same bar, but the "You" slot opens the H2c sign-in dialog (with a
// returnTo) instead of linking to the authed profile hub. Logout is NOT here —
// it lives on the /profile hub now.

const ITEMS = [
  { key: "home",     href: "/",         label: "Home",     Icon: House,       match: (p: string) => p === "/" },
  { key: "search",   href: "/discover", label: "Search",   Icon: Search,      match: (p: string) => p.startsWith("/discover") },
  { key: "calendar", href: "/calendar", label: "Calendar", Icon: CalendarDays, match: (p: string) => p.startsWith("/calendar") },
  { key: "library",  href: "/wishlist", label: "Library",  Icon: LibraryIcon, match: (p: string) => p.startsWith("/library") || p.startsWith("/wishlist") },
] as const;

// One slot renderer shared by the bottom (mobile) and top (desktop) bars so the
// two can't drift. `variant` only changes layout (stacked vs inline), never
// behaviour. Hoisted to module scope (not defined during render) so it isn't
// remounted every render. Pure over its props.
function Slot({
  href, label, Icon, active, variant, onClick,
}: {
  href?: string; label: string; Icon: typeof House; active: boolean;
  variant: "bottom" | "top"; onClick?: () => void;
}) {
  const color = active ? "text-accent" : "text-text-secondary hover:text-text-primary";
  const inner =
    variant === "bottom" ? (
      <span className="flex flex-col items-center justify-center gap-1">
        <Icon className="w-5 h-5" aria-hidden strokeWidth={active ? 2.4 : 2} />
        <span className="font-mono text-micro uppercase tracking-wide">{label}</span>
      </span>
    ) : (
      <span className="flex items-center gap-2">
        <Icon className="w-4 h-4" aria-hidden strokeWidth={active ? 2.4 : 2} />
        <span className="text-label">{label}</span>
      </span>
    );

  const cls =
    variant === "bottom"
      ? `flex-1 flex items-center justify-center min-h-[52px] transition-colors ${color}`
      : `px-3 py-1.5 rounded-lg transition-colors ${active ? "bg-surface-elevated" : ""} ${color}`;

  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} className={cls}>
        {inner}
      </button>
    );
  }
  return (
    <Link href={href!} aria-current={active ? "page" : undefined} className={cls}>
      {inner}
    </Link>
  );
}

export default function AppNav() {
  const pathname = usePathname();
  // null = probe in flight; the whole bar still renders (no layout shift) — only
  // the "You" slot's behaviour depends on the session.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);

  useEffect(() => { void probeSession().then(setAuthed); }, []);

  // T14 (2026-07-29) — AppNav mounts app-wide (root layout, outside the
  // per-page {children}) and re-runs on every route change, including
  // client-side transitions, since it depends on `pathname` — the one place
  // that can mark "a page was viewed" for EVERY page, not just the ones with
  // a BackButton. See navHistory.ts for why this beats document.referrer or
  // history.length alone.
  useEffect(() => { recordPageView(); }, [pathname]);

  const youActive = pathname.startsWith("/profile") || pathname.startsWith("/settings");

  // The "You" slot: link to /profile when signed in, open the sign-in dialog
  // when anonymous (authed === false). During the probe (null) it stays a link
  // to /profile — the profile page itself gracefully bounces an anon viewer.
  const youAsButton = authed === false;

  return (
    <>
      {/* Desktop: top bar */}
      <nav
        aria-label="Primary"
        className="hidden md:flex sticky top-0 z-30 h-14 items-center justify-between border-b border-border bg-surface px-6"
      >
        <Link href="/" className="flex items-center gap-2" aria-label="Fandex home">
          <Logo size={24} />
          <span className="font-serif text-[17px] tracking-tight text-text-primary">Fandex</span>
        </Link>
        <div className="flex items-center gap-1">
          {ITEMS.map((it) => (
            <Slot key={it.key} href={it.href} label={it.label} Icon={it.Icon} active={it.match(pathname)} variant="top" />
          ))}
          <div className="w-px h-4 bg-border-strong mx-1" />
          {/* §1's trailing slot: a collapsing search field (B5, 2026-07-28)
              with live suggestions — a plain re-route to /discover would just
              duplicate the Search nav item already sitting next to it, so
              this earns its place by finding a person/tag/title inline. See
              NavSearch.tsx. Followed by an avatar button in place of the
              plain "You" text link — just the circular chrome for now, not a
              photo — a real photo needs the user's identity data
              (displayName/avatar_url), which only the boolean-only
              `probeSession` this component already uses doesn't carry;
              adding a second fetch here would mean every page load
              re-fetches identity data just to render a nav icon. */}
          <NavSearch />
          {youAsButton ? (
            <button
              type="button"
              onClick={() => setShowSignIn(true)}
              aria-label="Log in"
              className="tap-44 w-9 h-9 rounded-full bg-surface-elevated border border-border flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
            >
              <User className="w-4 h-4" aria-hidden />
            </button>
          ) : (
            <Link
              href="/profile"
              aria-label="Your profile"
              aria-current={youActive ? "page" : undefined}
              className={`tap-44 w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${
                youActive ? "border-accent text-accent" : "border-border bg-surface-elevated text-text-secondary hover:text-text-primary"
              }`}
            >
              <User className="w-4 h-4" aria-hidden />
            </Link>
          )}
        </div>
      </nav>

      {/* Mobile: bottom bar (fixed, safe-area inset) */}
      <nav
        aria-label="Primary"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        {ITEMS.map((it) => (
          <Slot key={it.key} href={it.href} label={it.label} Icon={it.Icon} active={it.match(pathname)} variant="bottom" />
        ))}
        {youAsButton ? (
          <Slot label="You" Icon={User} active={false} variant="bottom" onClick={() => setShowSignIn(true)} />
        ) : (
          <Slot href="/profile" label="You" Icon={User} active={youActive} variant="bottom" />
        )}
      </nav>

      {showSignIn && (
        <SignInDialog
          returnTo={pathname}
          onClose={() => setShowSignIn(false)}
          // RAWG login sets the session in-place (no redirect): drop the cached
          // probe and reload so every island picks up the session.
          onAuthenticated={() => { resetSessionProbe(); window.location.reload(); }}
        />
      )}
    </>
  );
}
