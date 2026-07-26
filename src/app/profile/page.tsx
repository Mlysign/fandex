"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Compass, Library as LibraryIcon, Bookmark, CalendarDays, BarChart3, Settings as SettingsIcon, LogOut } from "lucide-react";
import { SOURCE_LABELS } from "@/lib/constants";
import { resetSessionProbe } from "@/lib/sessionProbe";
import { usePageTitle } from "@/lib/usePageTitle";
import Avatar from "@/components/ui/Avatar";
import Spinner from "@/components/ui/Spinner";

// H1.6c — new /profile hub, the "You" nav slot's destination. It's the top of
// the profile branch; /settings keeps its own URL as a sub-page (account +
// connections + data/deletion). Minimal for now: identity summary, quick links
// into every main surface, and sign-out. Richer profile content (stats,
// activity) is an H1.6e concern.

interface Me { user?: { displayName?: string; provider?: string } | null }

const LINKS = [
  { href: "/discover", label: "Discover",  Icon: Compass,      hint: "Browse games, movies & shows" },
  { href: "/library",  label: "Library",   Icon: LibraryIcon,  hint: "Everything you've played & watched" },
  { href: "/wishlist", label: "Wishlist",  Icon: Bookmark,     hint: "What you're waiting for" },
  { href: "/calendar", label: "Calendar",  Icon: CalendarDays, hint: "Upcoming releases by date" },
  { href: "/insights", label: "Insights",  Icon: BarChart3,    hint: "Your taste, analysed" },
  { href: "/settings", label: "Settings",  Icon: SettingsIcon, hint: "Connections, account & your data" },
];

export default function ProfilePage() {
  usePageTitle("You");
  const router = useRouter();
  const [me, setMe] = useState<Me["user"] | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d: Me) => {
      if (!d.user) { router.push("/"); return; }
      setMe(d.user);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    resetSessionProbe();
    router.push("/");
  }

  if (me === undefined) {
    return <main className="min-h-screen"><div className="max-w-2xl mx-auto px-6 py-10"><Spinner label="Loading…" /></div></main>;
  }

  const provider = me?.provider ? (SOURCE_LABELS[me.provider] ?? me.provider) : null;

  return (
    <div className="min-h-screen">
      <main className="max-w-2xl mx-auto px-6 py-10 space-y-8">
        {/* Identity header */}
        <header className="flex items-center gap-4">
          <Avatar name={me?.displayName ?? "You"} size={64} />
          <div className="min-w-0">
            <h1 className="font-serif text-serif-lg text-text-primary truncate">{me?.displayName ?? "You"}</h1>
            {provider && <p className="font-mono text-meta text-text-secondary mt-1">Signed in via {provider}</p>}
          </div>
        </header>

        {/* Quick links into every surface */}
        <nav aria-label="Your pages" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {LINKS.map(({ href, label, Icon, hint }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 p-4 rounded-lg bg-surface-elevated border border-border hover:border-border-strong transition-colors duration-base"
            >
              <span className="flex-none w-10 h-10 rounded-lg bg-accent-subtle text-accent flex items-center justify-center">
                <Icon className="w-5 h-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-label text-text-primary">{label}</span>
                <span className="block text-caption text-text-secondary truncate">{hint}</span>
              </span>
            </Link>
          ))}
        </nav>

        {/* Sign out */}
        <button
          onClick={logout}
          className="inline-flex items-center gap-2 text-label px-4 py-2 rounded-lg border border-border-strong text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors duration-base"
        >
          <LogOut className="w-4 h-4" aria-hidden />
          Log out
        </button>
      </main>
    </div>
  );
}
