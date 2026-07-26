"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Compass, CalendarDays, Library as LibraryIcon, Bookmark } from "lucide-react";
import Logo from "@/components/Logo";
import AuthOptions from "@/components/auth/AuthOptions";
import { probeSession } from "@/lib/sessionProbe";

// H1.6c — `/` is now the public browse Home, the anchor of the restructured IA
// (it used to be a login-only landing that bounced authed users to /dashboard).
// This is the MINIMAL version: an anonymous welcome/sign-in hero, and a simple
// signed-in launcher. The rich Home (stats strip, best-genre card, personalised
// rails) is H1.6e — post-login still lands on /wishlist for now, so a signed-in
// visitor only reaches this page by navigating to it deliberately.

const TYPES = [
  { label: "Games", color: "var(--color-media-game)" },
  { label: "Movies", color: "var(--color-media-movie)" },
  { label: "Shows", color: "var(--color-media-show)" },
];

const LAUNCH = [
  { href: "/discover", label: "Discover",  Icon: Compass,      hint: "Browse games, movies & shows" },
  { href: "/calendar", label: "Calendar",  Icon: CalendarDays, hint: "Upcoming releases by date" },
  { href: "/library",  label: "Library",   Icon: LibraryIcon,  hint: "Everything you've tracked" },
  { href: "/wishlist", label: "Wishlist",  Icon: Bookmark,     hint: "What you're waiting for" },
];

export default function HomePage() {
  // null = probing; render the neutral hero until we know (no auth-state flash).
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => { void probeSession().then(setAuthed); }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="max-w-sm w-full space-y-8 text-center">
        <div>
          <Logo size={56} className="mx-auto mb-4" />
          <h1 className="font-serif text-serif-2xl text-text-primary mb-2">Fandex</h1>
          <p className="text-body-sm text-text-secondary">
            Track your wishlists, discover what you&apos;ll love, and see what&apos;s coming — games, movies &amp; shows, all in one place.
          </p>
        </div>

        {authed ? (
          // Signed-in launcher — minimal until H1.6e builds the real Home.
          <div className="grid grid-cols-2 gap-3 text-left">
            {LAUNCH.map(({ href, label, Icon, hint }) => (
              <Link
                key={href}
                href={href}
                className="p-4 rounded-lg bg-surface-elevated border border-border hover:border-border-strong transition-colors duration-base"
              >
                <Icon className="w-5 h-5 text-accent mb-2" aria-hidden />
                <span className="block text-label text-text-primary">{label}</span>
                <span className="block text-caption text-text-secondary">{hint}</span>
              </Link>
            ))}
          </div>
        ) : (
          <>
            <AuthOptions />

            {/* Q2 — the catalog is public (H2b): give visitors a way in without
                an account instead of a login-only dead end. */}
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-caption text-text-muted">
                <span className="flex-1 h-px bg-border" />
                or
                <span className="flex-1 h-px bg-border" />
              </div>
              <Link
                href="/discover"
                className="block w-full py-3 rounded-lg font-medium border border-border-strong text-text-secondary hover:text-text-primary hover:border-neutral-400 hover:bg-surface-elevated transition-colors duration-base"
              >
                Browse without an account →
              </Link>
            </div>
          </>
        )}

        <div className="flex justify-center gap-6 text-caption text-text-muted pt-2">
          {TYPES.map((t) => (
            <span key={t.label} className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />
              {t.label}
            </span>
          ))}
        </div>
      </div>
    </main>
  );
}
