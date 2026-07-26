"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Library as LibraryIcon, Bookmark, Star, Trophy } from "lucide-react";
import Logo from "@/components/Logo";
import AuthOptions from "@/components/auth/AuthOptions";
import Rail from "@/components/Rail";
import PosterCard from "@/components/PosterCard";
import Panel from "@/components/ui/Panel";
import Eyebrow from "@/components/ui/Eyebrow";
import StatTile from "@/components/ui/StatTile";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { SkeletonPoster, SkeletonText } from "@/components/ui/Skeleton";
import { buildItemHref } from "@/lib/itemUrl";
import { usePageTitle } from "@/lib/usePageTitle";

// H1.6e — the real Home: `/` is the public browse anchor of the H1 IA. Anon
// gets a compact sign-in hero + the same public Popular/Upcoming rails
// (per ui-overhaul.md's IA table: "public browse — Popular / Upcoming /
// Fandex Recommendation carousels"); Recommendation only ever renders for a
// signed-in visitor with a real taste signal (cold-start accounts get
// Popular/Upcoming same as anon, no invented "for you" row). Replaces the
// H1.6c minimal placeholder (sign-in hero / bare launcher grid).

const TYPES = [
  { label: "Games", color: "var(--color-media-game)" },
  { label: "Movies", color: "var(--color-media-movie)" },
  { label: "Shows", color: "var(--color-media-show)" },
];

interface HomeStats {
  libraryTotal: number;
  wishlistTotal: number;
  ratedTotal: number;
  bestGenre: { label: string; ba: number } | null;
}
interface HomeData {
  popular: any[];
  upcoming: any[];
  recommendation: any[];
  stats: HomeStats | null;
}

function RailSkeleton({ title }: { title: string }) {
  return (
    <section>
      <div className="mb-3 px-1">
        <div className="font-serif text-serif-md text-text-primary">{title}</div>
      </div>
      <div className="grid grid-flow-col auto-cols-[150px] gap-3 overflow-hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="space-y-1.5">
            <SkeletonPoster />
            <SkeletonText className="w-4/5" />
            <SkeletonText className="w-2/5" />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function HomePage() {
  usePageTitle("Home");
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    fetch("/api/home")
      .then((r) => { if (!r.ok) throw new Error("home fetch failed"); return r.json(); })
      .then((d: HomeData) => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // Fetch-on-mount: the server can't know the session, so Home's rails/stats
  // are resolved client-side. Same justified disable the discover/insights/
  // item-detail islands already use for this pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const authed = !!data?.stats;
  const onSelect = (i: any) => router.push(buildItemHref(i));

  const rail = (title: string, items: any[] | undefined, seeAllHref: string, forYou = false) =>
    items && items.length > 0 ? (
      <Rail title={title} forYou={forYou} seeAllHref={seeAllHref}>
        {items.map((item) => <PosterCard key={item.id} item={item} onSelect={onSelect} />)}
      </Rail>
    ) : null;

  const hasAnyContent = !!(data && (data.popular.length || data.upcoming.length || data.recommendation.length));

  return (
    <main className="min-h-screen px-4 py-8 md:py-10">
      <div className="max-w-5xl mx-auto space-y-10">
        {/* Header — compact hero. Anon gets sign-in; authed gets a small
            identity strip whose real content is the stats below. */}
        <div className="text-center max-w-sm mx-auto space-y-5">
          <div>
            <Logo size={48} className="mx-auto mb-3" />
            <h1 className="font-serif text-serif-2xl text-text-primary mb-1.5">Fandex</h1>
            <p className="text-body-sm text-text-secondary">
              Track your wishlists, discover what you&apos;ll love, and see what&apos;s coming — games, movies &amp; shows, all in one place.
            </p>
          </div>

          {!authed && !loading && (
            <>
              <AuthOptions />
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

          <div className="flex justify-center gap-6 text-caption text-text-muted pt-1">
            {TYPES.map((t) => (
              <span key={t.label} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />
                {t.label}
              </span>
            ))}
          </div>
        </div>

        {/* Stats strip + best-genre card — signed-in only. */}
        {authed && data?.stats && (
          <div className="flex flex-wrap gap-3">
            <StatTile icon={<LibraryIcon className="w-3.5 h-3.5" aria-hidden />} label="Library" value={data.stats.libraryTotal} />
            <StatTile icon={<Bookmark className="w-3.5 h-3.5" aria-hidden />} label="Wishlist" value={data.stats.wishlistTotal} />
            <StatTile icon={<Star className="w-3.5 h-3.5" aria-hidden />} label="Rated" value={data.stats.ratedTotal} />
            {data.stats.bestGenre && (
              <Panel className="flex-1 min-w-[10rem] px-4 py-3">
                <div className="flex items-center gap-1.5 text-text-secondary mb-1">
                  <Trophy className="w-3.5 h-3.5" aria-hidden />
                  <Eyebrow tone="secondary">Your top genre</Eyebrow>
                </div>
                <div className="font-serif text-serif-lg text-text-primary">{data.stats.bestGenre.label}</div>
              </Panel>
            )}
          </div>
        )}

        {/* Rails — default / loading / empty / error states. */}
        {error ? (
          <ErrorState title="Couldn't load Home" hint="Check your connection and try again." onRetry={load} />
        ) : loading ? (
          <div className="space-y-8">
            <RailSkeleton title="Popular" />
            <RailSkeleton title="Upcoming" />
          </div>
        ) : !hasAnyContent ? (
          <EmptyState
            title="Nothing to show right now"
            hint="The providers didn't return any upcoming releases — try again in a bit."
          />
        ) : (
          <div className="space-y-8">
            {rail("Recommended for you", data?.recommendation, "/discover", true)}
            {rail("Popular", data?.popular, "/discover")}
            {rail("Upcoming", data?.upcoming, "/calendar")}
          </div>
        )}
      </div>
    </main>
  );
}
