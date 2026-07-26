"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { House, Search, CalendarDays, Library as LibraryIcon, User } from "lucide-react";
import Logo from "@/components/Logo";
import SignInDialog from "@/components/auth/SignInDialog";
import { probeSession, resetSessionProbe } from "@/lib/sessionProbe";

// H1.6c — the ONE adaptive navigation component (docs/design/fandex-handoff
// 03-components.md §1 + D-A). Bottom bar on mobile (<768px, safe-area inset),
// top bar on desktop (≥768px) — a single `<nav aria-label="Primary">` landmark
// either way. Replaces the old top-only NavBar, which was duplicated per-page.
//
// Five slots (D-A): Home · Search · Calendar · Library · You. Search = /discover
// (the SearchModal stays dead). Library lights for BOTH /library and /wishlist
// (they're one "my stuff" surface, entered via a tab — H1.6e). You lights for
// /profile and its /settings sub-page.
//
// Session-aware like the old NavBar: the catalog is public, so anon visitors
// see the same bar, but the "You" slot opens the H2c sign-in dialog (with a
// returnTo) instead of linking to the authed profile hub. Logout is NOT here —
// it lives on the /profile hub now.

const ITEMS = [
  { key: "home",     href: "/",         label: "Home",     Icon: House,       match: (p: string) => p === "/" },
  { key: "search",   href: "/discover", label: "Search",   Icon: Search,      match: (p: string) => p.startsWith("/discover") },
  { key: "calendar", href: "/calendar", label: "Calendar", Icon: CalendarDays, match: (p: string) => p.startsWith("/calendar") },
  { key: "library",  href: "/library",  label: "Library",  Icon: LibraryIcon, match: (p: string) => p.startsWith("/library") || p.startsWith("/wishlist") },
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
          {youAsButton ? (
            <Slot label="Log in" Icon={User} active={false} variant="top" onClick={() => setShowSignIn(true)} />
          ) : (
            <Slot href="/profile" label="You" Icon={User} active={youActive} variant="top" />
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
