"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  Compass, Library as LibraryIcon, Bookmark, CalendarDays, BarChart3,
  Settings as SettingsIcon, LogOut, Star, Trophy,
} from "lucide-react";
import { SOURCE_LABELS, TYPE_COLORS } from "@/lib/constants";
import { resetSessionProbe } from "@/lib/sessionProbe";
import { usePageTitle } from "@/lib/usePageTitle";
import { buildItemHref } from "@/lib/itemUrl";
import Avatar from "@/components/ui/Avatar";
import Spinner from "@/components/ui/Spinner";
import StatTile from "@/components/ui/StatTile";
import ErrorState from "@/components/ui/ErrorState";
import Rail from "@/components/Rail";
import PosterCard from "@/components/PosterCard";

// H1.6c shipped the minimal hub (identity + quick links + sign-out). H1.6e
// adds the doc's "account + stats + recent adds + upcoming + recommendations"
// content, reusing data the app already fetches elsewhere rather than
// inventing a parallel model:
//  - stats + recommendations come straight off /api/home's payload;
//  - "upcoming" is the user's own next-5 wishlist releases off /api/calendar
//    (already release-date sorted).
// "Recent adds" is NOT built here — it needs a library-item add timestamp
// /api/library doesn't expose today (only reviewedAt/releaseDate), and
// threading that through a shared, tested endpoint is bigger than this
// hub-polish pass warrants. Flagged as a follow-up, not silently dropped.
// H4.1's legal-footer link is also not added: the Impressum/ToS pages it
// would point at don't exist yet (blocked on H4.0's pending legal advice).

interface Me { user?: { displayName?: string; provider?: string } | null }
interface HomeStats {
  libraryTotal: number;
  wishlistTotal: number;
  ratedTotal: number;
  bestGenre: { label: string; ba: number } | null;
}

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
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [recommendation, setRecommendation] = useState<any[]>([]);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const meRes = await fetch("/api/auth/me").then((r) => r.json()) as Me;
      if (!meRes.user) { router.replace("/"); return; }
      setMe(meRes.user);

      const [home, calendar] = await Promise.all([
        fetch("/api/home").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/calendar").then((r) => (r.ok ? r.json() : null)),
      ]);
      if (home) { setStats(home.stats ?? null); setRecommendation(home.recommendation ?? []); }
      if (calendar) setUpcoming((calendar.items ?? []).slice(0, 5));
    } catch {
      setError(true);
    }
  }, [router]);

  // Fetch-on-mount: the server can't know the session, so identity + the hub's
  // stats/upcoming/recommendations are all resolved client-side. Same
  // justified disable the discover/insights/item-detail islands already use.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    resetSessionProbe();
    router.replace("/");
  }

  if (me === undefined && !error) {
    return <main className="min-h-screen"><div className="max-w-2xl mx-auto px-6 py-10"><Spinner label="Loading…" /></div></main>;
  }
  if (error) {
    return <main className="min-h-screen"><div className="max-w-2xl mx-auto px-6 py-10"><ErrorState title="Couldn't load your profile" hint="Check your connection and try again." onRetry={load} /></div></main>;
  }

  const provider = me?.provider ? (SOURCE_LABELS[me.provider] ?? me.provider) : null;
  const onSelect = (i: any) => router.push(buildItemHref(i));

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

        {/* Stats strip + best-genre card */}
        {stats && (
          <div className="flex flex-wrap gap-3">
            <StatTile icon={<LibraryIcon className="w-3.5 h-3.5" aria-hidden />} label="Library" value={stats.libraryTotal} />
            <StatTile icon={<Bookmark className="w-3.5 h-3.5" aria-hidden />} label="Wishlist" value={stats.wishlistTotal} />
            <StatTile icon={<Star className="w-3.5 h-3.5" aria-hidden />} label="Rated" value={stats.ratedTotal} />
            {stats.bestGenre && (
              <StatTile icon={<Trophy className="w-3.5 h-3.5" aria-hidden />} label="Your top genre" value={stats.bestGenre.label} />
            )}
          </div>
        )}

        {/* Upcoming — your own next few wishlist releases */}
        {upcoming.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-serif text-serif-md text-text-primary">Coming up</h2>
              <Link href="/calendar" className="text-label text-text-secondary hover:text-text-primary transition-colors">See all</Link>
            </div>
            <div className="space-y-1.5">
              {upcoming.map((item) => (
                <Link
                  key={item.id}
                  href={buildItemHref(item)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-elevated border border-border hover:border-border-strong transition-colors duration-base"
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: TYPE_COLORS[item.type] ?? "#888" }} aria-hidden />
                  <span className="flex-1 min-w-0 text-body-sm text-text-primary truncate">{item.title}</span>
                  <span className="font-mono text-meta text-text-secondary shrink-0">
                    {item.releaseDate ? (() => { try { return format(parseISO(item.releaseDate), "MMM d, yyyy"); } catch { return item.releaseDate; } })() : "TBA"}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Recommendations — same taste-ranked pull Home's rail uses */}
        {recommendation.length > 0 && (
          <Rail title="Recommended for you" forYou seeAllHref="/discover">
            {recommendation.slice(0, 8).map((item) => <PosterCard key={item.id} item={item} onSelect={onSelect} />)}
          </Rail>
        )}

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
