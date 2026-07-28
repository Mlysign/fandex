"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Library as LibraryIcon, Bookmark, Star, Trophy } from "lucide-react";
import SignInDialog from "@/components/auth/SignInDialog";
import Rail from "@/components/Rail";
import Button from "@/components/ui/Button";
import SubBar from "@/components/SubBar";
import PosterCard from "@/components/PosterCard";
import Panel from "@/components/ui/Panel";
import Eyebrow from "@/components/ui/Eyebrow";
import StatTile from "@/components/ui/StatTile";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { SkeletonPoster, SkeletonText } from "@/components/ui/Skeleton";
import { buildItemHref } from "@/lib/itemUrl";
import { usePersistedState } from "@/lib/usePersistedState";
import { MediaType } from "@/types";

// H1.6e — the real Home: `/` is the public browse anchor of the H1 IA. Anon
// gets a compact sign-in hero + the same public Popular/Upcoming rails
// (per ui-overhaul.md's IA table: "public browse — Popular / Upcoming /
// Fandex Recommendation carousels"); Recommendation only ever renders for a
// signed-in visitor with a real taste signal (cold-start accounts get
// Popular/Upcoming same as anon, no invented "for you" row). Replaces the
// H1.6c minimal placeholder (sign-in hero / bare launcher grid).

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
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // SM2's shared key — one media-type setting across Home / Discover / Library
  // / Wishlist / Calendar (2026-07-28). This was plain useState and reset on
  // every visit, so Home ignored a filter the user had set two pages ago.
  const [activeTypes, setActiveTypes] = usePersistedState<MediaType[]>("rr_type_filter", []);
  const [showSignIn, setShowSignIn] = useState(false);

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

  // One media-type filter at the top of the page drives EVERY rail (the
  // mockup shows a single `.filterrow` above all carousels, not per-rail
  // controls). Purely client-side over already-fetched items — no refetch.
  const toggleType = (t: string) =>
    setActiveTypes((prev) => (prev.includes(t as MediaType) ? prev.filter((x) => x !== t) : [...prev, t as MediaType]));
  const byType = (items: any[] | undefined) =>
    !items ? items : activeTypes.length === 0 ? items : items.filter((i) => activeTypes.includes(i.type));

  const rail = (title: string, items: any[] | undefined, seeAllHref: string, forYou = false) => {
    const shown = byType(items);
    return shown && shown.length > 0 ? (
      <Rail title={title} forYou={forYou} seeAllHref={seeAllHref}>
        {shown.map((item) => <PosterCard key={item.id} item={item} onSelect={onSelect} />)}
      </Rail>
    ) : null;
  };

  const hasAnyContent = !!(data && (data.popular.length || data.upcoming.length || data.recommendation.length));

  return (
    <div className="min-h-screen">
      {/* 2026-07-28 (Nils: "no fandex logo on home"): the mobile-only brand row
          — mark + wordmark + an anon "Sign in" button — is gone. Nothing needed
          re-homing: the bottom nav's "You" slot opens the same SignInDialog, and
          the Guest-mode panel just below has "Create account". Desktop never had
          this row (AppNav's top bar carries the brand). */}
      <h1 className="sr-only">Fandex</h1>

      {/* The shared page header, same order as every other list page: media type
          filters first. Home has no tabs, nothing to search and no sort. */}
      <SubBar activeTypes={activeTypes} onToggleType={toggleType} availableViews={[]} />

      <main className="px-5 py-4 md:py-8">
        <div className="max-w-5xl mx-auto space-y-6 md:space-y-8">

        {/* Anon: the mockup's GUEST MODE panel, in place of the old provider
            button stack (sign-in now runs through the same SignInDialog the
            nav's anon "You" slot opens, so there's one auth surface). */}
        {!authed && !loading && (
          <Panel className="px-4 py-4">
            <Eyebrow>Guest mode</Eyebrow>
            <div className="font-serif text-serif-lg text-text-primary mt-1.5 mb-3">
              Sign in to unlock your Fandex Score
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="sm" pill onClick={() => setShowSignIn(true)}>Create account</Button>
              <Link href="/discover" className="text-label text-text-secondary hover:text-text-primary transition-colors">
                Browse without an account →
              </Link>
            </div>
          </Panel>
        )}

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

      {showSignIn && (
        <SignInDialog
          returnTo="/"
          onClose={() => setShowSignIn(false)}
          // RAWG login sets the session in-place (no redirect), so reload to
          // let every island pick it up — same handling AppNav uses.
          onAuthenticated={() => window.location.reload()}
        />
      )}
    </div>
  );
}
