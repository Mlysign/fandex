"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SignInDialog from "@/components/auth/SignInDialog";
import Rail from "@/components/Rail";
import Button from "@/components/ui/Button";
import SubBar from "@/components/SubBar";
import PosterCard from "@/components/PosterCard";
import PersonCard from "@/components/PersonCard";
import Panel from "@/components/ui/Panel";
import Eyebrow from "@/components/ui/Eyebrow";
import ProgressRail from "@/components/ProgressRail";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { buildItemHref } from "@/lib/itemUrl";
import { usePersistedState } from "@/lib/usePersistedState";
import type { PopularPerson } from "@/lib/personRail";
import type { MediaType } from "@/types";

// H1.6e — the real Home: `/` is the public browse anchor of the H1 IA. Anon
// gets a compact sign-in hero + the same public Popular/Upcoming rails
// (per docs/archive/ui-overhaul.md's IA table: "public browse — Popular / Upcoming /
// Fandex Recommendation carousels"); Recommendation only ever renders for a
// signed-in visitor with a real taste signal (cold-start accounts get
// Popular/Upcoming same as anon, no invented "for you" row). Replaces the
// H1.6c minimal placeholder (sign-in hero / bare launcher grid).
//
// ── 2026-08-26: the public rails arrive as PROPS ────────────────────────────
//
// They used to be fetched here on mount, which meant they existed only for a
// client that runs JS *and* is allowed to fetch `/api/home`, and `/api/` is
// robots-disallowed, so a crawler is not. The day's trending / upcoming / people
// now come from the daily `home_snapshot` through page.tsx, so this component's
// FIRST render (which is server HTML) already carries every link.
//
// The fetch stays, and its job changed: it no longer decides what is on the
// page, only who is looking. It brings back the per-user overlay for the same
// rails (watchlist / library / rating / the viewer's Fandex Score) plus the
// recommendation rail, and it is what flips `authed`. If it fails, the public
// page it replaces is still standing, which is why an error here no longer
// blanks the rails.

interface HomeData {
  trending: any[];
  upcoming: any[];
  recommendation: any[];
  authed: boolean;
}

interface HomePageClientProps {
  /** The day's public rails, from `home_snapshot`. Rendered before any fetch. */
  initialTrending: any[];
  initialUpcoming: any[];
  people: PopularPerson[];
  /** False when no snapshot exists yet. The poster rails' empty state needs
   *  to say WHY it is empty rather than reading as a broken feature. */
  hasSnapshot: boolean;
}

export default function HomePageClient({
  initialTrending, initialUpcoming, people, hasSnapshot,
}: HomePageClientProps) {
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState(false);
  // SM2's shared key — one media-type setting across Home / Discover / Library
  // / Wishlist / Calendar (2026-07-28). This was plain useState and reset on
  // every visit, so Home ignored a filter the user had set two pages ago.
  const [activeTypes, setActiveTypes] = usePersistedState<MediaType[]>("rr_type_filter", []);
  const [showSignIn, setShowSignIn] = useState(false);

  const load = useCallback(() => {
    setError(false);
    fetch("/api/home")
      .then((r) => { if (!r.ok) throw new Error("home fetch failed"); return r.json(); })
      .then((d: HomeData) => setData(d))
      .catch(() => setError(true));
  }, []);

  // Fetch-on-mount: the server can't know the session, so the per-user overlay
  // is resolved client-side. Same justified disable the discover/insights/
  // item-detail islands already use for this pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const authed = !!data?.authed;
  const onSelect = (i: any) => router.push(buildItemHref(i));

  // Prefer the overlaid copy once it lands; until then (and for a crawler,
  // forever) render the snapshot's. Both are the same titles in the same order:
  // the fetch adds the viewer's state, it does not re-pick the rail, so this
  // swap never moves a card under someone's finger.
  const trending = data?.trending ?? initialTrending;
  const upcoming = data?.upcoming ?? initialUpcoming;

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

  const hasRails = !!(trending.length || upcoming.length || data?.recommendation?.length);

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
            nav's anon "You" slot opens, so there's one auth surface).

            Rendered only once the session probe has answered. It used to key off
            `!loading`, which was the same thing; now that the rails no longer
            wait for a fetch, `data === null` is the only "we don't know yet"
            left, and flashing "Guest mode" at a signed-in visitor for one
            round-trip is worse than showing it a moment later. */}
        {data && !authed && (
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

        {/* Its own island + its own request: it may heal a show's episode
            catalog from TMDB, and that must never sit in front of Home's rails.
            Renders nothing when there's nothing to continue.

            2026-08-26: the day's rotating highlight panels used to sit above
            this. Nils removed them ("they don't add as much as I'd hoped") and
            the progress rail took the slot outright. */}
        {authed && <ProgressRail />}

        {/* Rails. There is no loading state any more: the public two are already
            here, server-rendered, on the first paint. */}
        {!hasRails ? (
          <EmptyState
            title="Nothing to show right now"
            hint={hasSnapshot
              ? "The providers didn't return any releases for today's page. It rebuilds itself daily."
              : "Today's page hasn't been built yet. It's assembled once a day on the server and should appear shortly."}
          />
        ) : (
          <div className="space-y-8">
            {rail("Recommended for you", data?.recommendation, "/discover", true)}
            {/* "Popular right now" per the mockup's own headline — and now
                literally true: real provider trending, released titles included. */}
            {rail("Popular right now", trending, "/discover")}
            {rail("Upcoming", upcoming, "/calendar")}

            {/* Popular people, deliberately NOT filtered by media type: a
                director is not a movie, and hiding the whole rail because
                somebody ticked "Games" would be a dead control, not a filter.
                It also renders a wider column than a poster: these are circles
                with two lines of text under them.

                And no `seeAllHref`: there is no "all people" page to send
                anyone to, and a "See all" landing on /discover (which lists
                titles, not people) is a dead control dressed as navigation. */}
            {people.length > 0 && (
              <Rail title="Popular people" colsClass="auto-cols-[110px]">
                {people.map((p) => <PersonCard key={p.key} person={p} />)}
              </Rail>
            )}
          </div>
        )}

        {/* The per-user overlay failed. Says so instead of hiding, and the
            public page underneath is untouched, so this is a note, not a
            replacement for the content. */}
        {error && (
          <ErrorState
            title="Couldn't load your personal view"
            hint="The page below is the public one. Your ratings and watchlist state are missing."
            onRetry={load}
          />
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
