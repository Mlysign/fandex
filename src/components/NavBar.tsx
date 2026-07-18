"use client";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Logo from "@/components/Logo";
import SignInDialog from "@/components/auth/SignInDialog";
import { probeSession, resetSessionProbe } from "@/lib/sessionProbe";

// Q1 — the nav is session-aware. Public pages (facets, /discover) render for
// anonymous visitors too, so the nav can't assume a session: anon gets the
// public links + "Log in" (which opens the H2c sign-in dialog with a returnTo,
// so login lands back on the page they were reading), authed gets the full nav.

const AUTHED_LINKS = [
  { href: "/discover",   label: "Discover" },
  { href: "/dashboard",  label: "Wishlist" },
  { href: "/library",    label: "Library" },
  { href: "/insights",   label: "Insights" },
  { href: "/settings",   label: "Profile" },
];

const ANON_LINKS = [
  { href: "/discover", label: "Discover" },
];

export default function NavBar() {
  const router   = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // null = probe in flight → render neither variant (no wrong-state flash).
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);

  // Fetch-on-mount session probe: the server can't tell this client component
  // the session, so it's resolved here (setState is async, inside the chain).
  useEffect(() => { void probeSession().then(setAuthed); }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    resetSessionProbe();
    router.push("/");
  }

  const isActive = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(href));
  const linkClass = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm transition-colors ${
      active ? "bg-neutral-800 text-white font-medium" : "text-neutral-400 hover:text-white hover:bg-neutral-900"
    }`;

  const links = authed ? AUTHED_LINKS : ANON_LINKS;

  return (
    <nav className="border-b border-neutral-800 px-6 flex items-center justify-between sticky top-0 bg-neutral-950 z-30 h-14">
      <Link href={authed ? "/dashboard" : "/"} className="flex items-center gap-2">
        <Logo size={24} />
        <span className="font-bold text-base tracking-tight">Fandex</span>
      </Link>

      {authed !== null && (
        <>
          {/* Desktop links (md+) */}
          <div className="hidden md:flex items-center gap-1">
            {links.map(({ href, label }) => (
              <Link key={href} href={href} className={linkClass(isActive(href))}>{label}</Link>
            ))}
            <div className="w-px h-4 bg-neutral-800 mx-1" />
            {authed ? (
              <button onClick={logout} className="px-3 py-1.5 rounded-lg text-sm text-neutral-500 hover:text-white hover:bg-neutral-900 transition-colors">
                Log out
              </button>
            ) : (
              <button onClick={() => setShowSignIn(true)} className="px-3 py-1.5 rounded-lg text-sm border border-neutral-700 text-neutral-200 hover:bg-neutral-900 hover:border-neutral-500 transition-colors">
                Log in
              </button>
            )}
          </div>

          {/* Mobile hamburger (< md) */}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={menuOpen}
            className="md:hidden p-2 -mr-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-900 transition-colors"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              {menuOpen
                ? <><line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" /></>
                : <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>}
            </svg>
          </button>

          {/* Mobile dropdown panel */}
          {menuOpen && (
            <div className="md:hidden absolute top-full left-0 right-0 bg-neutral-950 border-b border-neutral-800 px-4 py-2 flex flex-col gap-0.5 shadow-xl">
              {links.map(({ href, label }) => (
                <Link key={href} href={href} onClick={() => setMenuOpen(false)} className={linkClass(isActive(href))}>{label}</Link>
              ))}
              <div className="h-px bg-neutral-800 my-1" />
              {authed ? (
                <button onClick={() => { setMenuOpen(false); logout(); }} className="text-left px-3 py-1.5 rounded-lg text-sm text-neutral-500 hover:text-white hover:bg-neutral-900 transition-colors">
                  Log out
                </button>
              ) : (
                <button onClick={() => { setMenuOpen(false); setShowSignIn(true); }} className="text-left px-3 py-1.5 rounded-lg text-sm text-neutral-200 hover:bg-neutral-900 transition-colors">
                  Log in
                </button>
              )}
            </div>
          )}
        </>
      )}

      {showSignIn && (
        <SignInDialog
          returnTo={pathname}
          onClose={() => setShowSignIn(false)}
          // RAWG login sets the session in-place (no redirect): drop the cached
          // probe and reload so every island on the page picks up the session.
          onAuthenticated={() => { resetSessionProbe(); window.location.reload(); }}
        />
      )}
    </nav>
  );
}
