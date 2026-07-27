"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  TrendingUp, Bookmark, Star, Settings as SettingsIcon, ChevronRight,
} from "lucide-react";
import { TYPE_COLORS } from "@/lib/constants";
import { resetSessionProbe } from "@/lib/sessionProbe";
import { buildItemHref } from "@/lib/itemUrl";
import { sortItems } from "@/lib/sortItems";
import Avatar from "@/components/ui/Avatar";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import ErrorState from "@/components/ui/ErrorState";
import Rail from "@/components/Rail";
import PosterCard from "@/components/PosterCard";

// 2026-07-27 (Nils, mockup-vs-live pass) — the hub is a MERGE of two source
// documents that turned out to describe different pages:
//  - profile.html (Claude Design mockup): identity header (avatar, name,
//    handle · joined year, a settings-gear button) + a plain stat3 row
//    (tracked/rated/wishlist) + a 4-row entry list (Insights/Wishlist/Your
//    ratings/Settings, each icon+title+subtitle+chevron) + a full-width
//    "Sign out" button. No rails, no recommendations.
//  - ui-overhaul.md §4 (Nils's own Miro board): "stats + recent library adds
//    + upcoming wishlist + recommendations" — the carousel content actually
//    built in H1.6e.
// Nils's call: the mockup wins for the top of the page (literally, not
// reinterpreted), and the carousels are APPENDED below it rather than
// dropped — hence "recently added"/"coming up"/"recommended" all survive
// unchanged beneath a rebuilt header+stats+entries+sign-out block.
// "Notifications" (the mockup's 4th entry row) is omitted — D-C dropped the
// whole reminders feature, so there is nothing for that row to open.

interface Identity { provider: string; created_at: number; avatar_url: string | null }
interface Me { user?: { displayName?: string; provider?: string } | null; identities?: Identity[] }
interface HomeStats {
  libraryTotal: number;
  wishlistTotal: number;
  ratedTotal: number;
  bestGenre: { label: string; ba: number } | null;
}

export default function ProfilePageClient() {
  const router = useRouter();
  const [me, setMe] = useState<Me["user"] | null | undefined>(undefined);
  const [joinedYear, setJoinedYear] = useState<number | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [recommendation, setRecommendation] = useState<any[]>([]);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [recentlyAdded, setRecentlyAdded] = useState<any[]>([]);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const meRes = await fetch("/api/auth/me").then((r) => r.json()) as Me;
      if (!meRes.user) { router.replace("/"); return; }
      setMe(meRes.user);
      const identities = meRes.identities ?? [];
      if (identities.length > 0) {
        setJoinedYear(new Date(Math.min(...identities.map((i) => i.created_at)) * 1000).getFullYear());
        setAvatarUrl(identities.find((i) => i.avatar_url)?.avatar_url ?? null);
      }

      const [home, calendar, library] = await Promise.all([
        fetch("/api/home").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/calendar").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/library").then((r) => (r.ok ? r.json() : null)),
      ]);
      if (home) { setStats(home.stats ?? null); setRecommendation(home.recommendation ?? []); }
      if (calendar) setUpcoming((calendar.items ?? []).slice(0, 5));
      if (library) setRecentlyAdded(sortItems(library.items ?? [], "addedAt").slice(0, 5));
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

  const onSelect = (i: any) => router.push(buildItemHref(i));
  const name = me?.displayName ?? "You";
  const handle = name.toLowerCase().replace(/\s+/g, "");

  const entries = [
    { href: "/insights", label: "Insights", hint: "Your taste in numbers", Icon: TrendingUp },
    { href: "/wishlist", label: "Wishlist", hint: stats ? `${stats.wishlistTotal} saved` : "", Icon: Bookmark },
    { href: "/library", label: "Your ratings", hint: stats ? `${stats.ratedTotal} titles` : "", Icon: Star },
    { href: "/settings", label: "Settings", hint: "Account, theme, privacy", Icon: SettingsIcon },
  ];

  return (
    <div className="min-h-screen">
      <main className="max-w-2xl mx-auto px-6 py-8 space-y-7">
        {/* Identity header — 72px avatar, serif name, "@handle · joined YYYY",
            a settings-gear icon button in place of the mockup's own (this app
            already has a dedicated Settings entry below, so the gear button
            here is a shortcut to the same destination, not a duplicate
            surface). */}
        <header className="flex items-center gap-4">
          <Avatar src={avatarUrl} name={name} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-serif-xl text-text-primary truncate">{name}</h1>
            <p className="font-mono text-meta text-text-secondary mt-1">
              @{handle}{joinedYear ? ` · joined ${joinedYear}` : ""}
            </p>
          </div>
          <Link
            href="/settings"
            aria-label="Settings"
            className="tap-44 flex-none w-10 h-10 rounded-xl bg-surface-elevated border border-border flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
          >
            <SettingsIcon className="w-4 h-4" aria-hidden />
          </Link>
        </header>

        {/* Stats — tracked / rated / wishlist, per the mockup's `.stat3`. */}
        {stats && (
          <div className="flex items-center bg-surface-elevated border border-border rounded-xl overflow-hidden">
            {[
              { n: stats.libraryTotal, l: "tracked" },
              { n: stats.ratedTotal, l: "rated" },
              { n: stats.wishlistTotal, l: "wishlist" },
            ].map(({ n, l }, i) => (
              <div key={l} className={`flex-1 text-center py-3 px-2 ${i > 0 ? "border-l border-border" : ""}`}>
                <div className="font-serif text-serif-lg leading-none text-text-primary">{n}</div>
                <div className="font-mono text-micro text-text-secondary mt-1">{l}</div>
              </div>
            ))}
          </div>
        )}

        {/* Entry list — icon · title+subtitle · chevron, each a full-row link. */}
        <nav aria-label="Your pages" className="divide-y divide-border border-y border-border">
          {entries.map(({ href, label, hint, Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 py-3.5 hover:bg-surface-elevated transition-colors duration-base -mx-1 px-1"
            >
              <span className="flex-none w-9 h-9 rounded-lg bg-surface-elevated border border-border flex items-center justify-center text-text-secondary">
                <Icon className="w-4 h-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-label text-text-primary">{label}</span>
                {hint && <span className="block text-caption text-text-secondary truncate mt-0.5">{hint}</span>}
              </span>
              <ChevronRight className="w-4 h-4 text-text-secondary shrink-0" aria-hidden />
            </Link>
          ))}
        </nav>

        {/* Sign out — full-width secondary, per the mockup's `.btn.sec`. */}
        <Button variant="secondary" size="lg" onClick={logout} className="w-full">
          Sign out
        </Button>

        {/* ── Appended below the mockup's own content, per Nils's merge call ── */}

        {/* Recently added — your own last few library adds */}
        {recentlyAdded.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-serif text-serif-md text-text-primary">Recently added</h2>
              <Link href="/library" className="text-label text-text-secondary hover:text-text-primary transition-colors">See all</Link>
            </div>
            <div className="space-y-1.5">
              {recentlyAdded.map((item) => (
                <Link
                  key={item.id}
                  href={buildItemHref(item)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-elevated border border-border hover:border-border-strong transition-colors duration-base"
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: TYPE_COLORS[item.type] ?? "#888" }} aria-hidden />
                  <span className="flex-1 min-w-0 text-body-sm text-text-primary truncate">{item.title}</span>
                  <span className="font-mono text-meta text-text-secondary shrink-0">
                    {item.addedAt ? (() => { try { return format(new Date(item.addedAt * 1000), "MMM d, yyyy"); } catch { return null; } })() : ""}
                  </span>
                </Link>
              ))}
            </div>
          </section>
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
      </main>
    </div>
  );
}
