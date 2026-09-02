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
import { SkeletonPoster, SkeletonText } from "@/components/ui/Skeleton";
import { buildItemHref } from "@/lib/itemUrl";
import { useEnabledTypes } from "@/lib/useEnabledTypes";
import { typeIsVisible } from "@/lib/mediaTypes";
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
// page, only what the VIEWER's copy of it looks like. It brings back the
// per-user overlay for the same rails (watchlist / library / rating / the
// viewer's Fandex Score) plus the recommendation rail. If it fails, the public
// page it replaces is still standing, which is why an error here no longer
// blanks the rails.
//
// ── 2026-08-26, second pass: NOTHING ABOVE THE PUBLIC RAILS MAY APPEAR LATE ──
//
// Nils: *"the page first only shows the 2 public rails and then the user content
// pops in and messes with the scroll position."* Both personal sections live
// above the public ones and both rendered `null` until their own fetch landed,
// so a signed-in load painted, then shoved everything down by two rails.
//
// The fix has two halves and BOTH are needed:
//
//   · `signedIn` comes from the SERVER (page.tsx). The client cannot reserve the
//     space on its own, because "is anyone signed in" only arrives with the very
//     round-trip that causes the shift.
//   · Each personal section renders a SKELETON of its real height while its data
//     is in flight, instead of nothing. See `RailSkeleton` here and the loading
//     branch in ProgressRail.
//
// A skeleton alone would not have worked, and neither would the flag alone.

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
  /**
   * Whether the server saw a session, so the personal sections can hold their
   * space from the very first paint. See the note above; this is the half of the
   * layout-shift fix that a skeleton cannot supply on its own.
   */
  signedIn: boolean;
}

/**
 * The body height of a real `<PosterCard>` at a 150px column: the block under
 * the poster holding title, meta, rating and the action bar.
 *
 * ⚠️ MEASURED, not estimated, and it is the whole reason this skeleton is worth
 * having. The first version composed its own stack of bars and came out **36px
 * short of the real card**, which is a smaller version of exactly the shift this
 * is here to prevent. Measured in the browser against a loaded rail: poster 223 +
 * body 102 inside a 1px-bordered box, 327 total.
 *
 * If PosterCard's body ever grows a line, re-measure rather than reasoning: the
 * gap only shows up as a jump on a real page load.
 */
const POSTER_CARD_BODY_H = 102;

/**
 * A rail-shaped hole, the size of the rail that is about to fill it.
 *
 * Mirrors `<Rail>` + `<PosterCard>`'s actual BOX — the same header, the same
 * 150px columns, the same bordered card with a 2:3 poster over a fixed-height
 * body — rather than approximating it with a stack of bars. The entire point is
 * that swapping the real rail in moves nothing.
 */
function RailSkeleton({ title }: { title: string }) {
  return (
    <section aria-hidden>
      <div className="flex items-center justify-between gap-3 mb-3 px-1">
        <div className="font-serif text-serif-md text-text-primary">{title}</div>
      </div>
      {/* `pb-1` mirrors <Rail>'s scroller. It is 4px, and leaving it out was 4px
          of the residual jump after the card body was fixed — worth copying
          rather than eyeballing, since every one of these deltas is additive. */}
      <div className="grid grid-flow-col auto-cols-[150px] gap-3 overflow-hidden pb-1">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rounded-md border border-border bg-surface-elevated overflow-hidden">
            <SkeletonPoster className="rounded-none" />
            <div
              className="px-2.5 py-2.5 flex flex-col gap-[7px]"
              style={{ height: POSTER_CARD_BODY_H }}
            >
              <SkeletonText className="w-4/5" />
              <SkeletonText className="w-2/5" />
              <SkeletonText className="mt-auto h-7 w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function HomePageClient({
  initialTrending, initialUpcoming, people, hasSnapshot, signedIn,
}: HomePageClientProps) {
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState(false);
  // SM2's shared key — one media-type setting across Home / Discover / Library
  // / Wishlist / Calendar (2026-07-28). This was plain useState and reset on
  // every visit, so Home ignored a filter the user had set two pages ago.
  const [activeTypes, setActiveTypes] = usePersistedState<MediaType[]>("rr_type_filter", []);
  const { stored: storedTypes } = useEnabledTypes();
  const [showSignIn, setShowSignIn] = useState(false);

  const load = useCallback(() => {
    setError(false);
    fetch("/api/home")
      .then((r) => { if (!r.ok) throw new Error("home fetch failed"); return r.json(); })
      .then((d: HomeData) => setData(d))
      .catch(() => setError(true));
  }, []);

  // Fetch-on-mount: the server tells us WHETHER someone is signed in, but the
  // per-user payload still has to be resolved client-side. Same justified
  // disable the discover/insights/item-detail islands already use.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // Optimistic from the server, corrected by the API once it answers. The
  // correction only ever fires when a cookie expired between the render and the
  // fetch, and getting it wrong the other way (assuming anon, then discovering a
  // session) is exactly the shift being fixed.
  const authed = data ? data.authed : signedIn;

  // True while a signed-in viewer's personal sections are still in flight. Every
  // section that is per-user reads this and holds its space.
  const personalPending = authed && !data;

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
  // The chip selection AND the account's enabled types, resolved in one place:
  // an empty chip row means "every type you use", not "every type there is".
  const byType = (items: any[] | undefined) =>
    !items ? items : items.filter((i) => typeIsVisible(i.type, activeTypes, storedTypes));

  const rail = (title: string, items: any[] | undefined, seeAllHref: string, forYou = false) => {
    const shown = byType(items);
    if (shown && shown.length > 0) {
      return (
        <Rail title={title} forYou={forYou} seeAllHref={seeAllHref}>
          {shown.map((item) => <PosterCard key={item.id} item={item} onSelect={onSelect} />)}
        </Rail>
      );
    }
    // ⚠️ A rail that HAD items and lost them all to a filter must say so.
    //
    // This is SM36's failure mode: with the Games chip on and RAWG down, the
    // whole "Popular right now" section vanished with nothing explaining it.
    // "What you track" reintroduces the same risk from further away — the rails
    // are sliced to 15 at snapshot-build time, so a games-heavy day plus Games
    // turned off can empty one, and the setting that did it is on another
    // screen. A silent `null` is indistinguishable from a broken rail.
    //
    // Only when the source list was non-empty: a genuinely empty rail (nothing
    // fetched, still loading) keeps returning null, which is the existing and
    // correct behaviour for that case.
    if (items && items.length > 0) {
      return (
        <Rail title={title} forYou={forYou} seeAllHref={seeAllHref}>
          <p className="text-body-sm text-text-secondary py-6">
            Nothing here matches the types you track.{" "}
            <Link href="/settings" className="text-accent hover:text-accent-hover underline underline-offset-2">
              Change that
            </Link>
            .
          </p>
        </Rail>
      );
    }
    return null;
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
      {/* No `availableTypes`: the chip row shows every type, always. The media-type
          setting is a DEFAULT (what an un-narrowed list resolves to), not a scope,
          so hiding its chip would remove the only control that undoes it. */}
      <SubBar activeTypes={activeTypes} onToggleType={toggleType} storedTypes={storedTypes} availableViews={[]} />

      <main className="px-5 py-4 md:py-8">
        <div className="max-w-5xl mx-auto space-y-6 md:space-y-8">

        {/* Anon: the mockup's GUEST MODE panel, in place of the old provider
            button stack (sign-in now runs through the same SignInDialog the
            nav's anon "You" slot opens, so there's one auth surface).

            Keyed off `authed`, which the SERVER supplies, so it is present in the
            first paint for an anonymous visitor and never appears for a signed-in
            one. It used to wait for the fetch, which meant an anon load pushed
            the rails down by a panel exactly the way the personal sections
            pushed them down for everyone else. */}
        {!authed && (
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

        {/* "Up next" — its own island and its own request, because it may heal a
            show's episode catalog from TMDB and that must never sit in front of
            Home's rails. It holds its own space while loading (a skeleton, not
            `null`), so mounting it early costs no shift and starts its fetch in
            parallel with `/api/home` rather than after it.

            2026-08-26: the day's rotating highlight panels used to sit above
            this. Nils removed them ("they don't add as much as I'd hoped") and
            the progress rail took the slot outright. */}
        {/* Gated on the type filter (2026-09-02). ProgressRail is episodes, and
            upNext.ts is `WHERE m.type = 'show'`, so it is a SHOWS rail — but it
            rendered unconditionally and was the one thing on this page that
            ignored the filter. Filtering Home to Games left "Up next" sitting on
            top of the page full of shows. Pre-existing; found while verifying
            the default-types change on the same page. */}
        {authed && typeIsVisible("show", activeTypes, storedTypes) && <ProgressRail />}

        {/* Rails. There is no page-level loading state: the public two are
            already here, server-rendered, on the first paint. */}
        {!hasRails && !personalPending ? (
          <EmptyState
            title="Nothing to show right now"
            hint={hasSnapshot
              ? "The providers didn't return any releases for today's page. It rebuilds itself daily."
              : "Today's page hasn't been built yet. It's assembled once a day on the server and should appear shortly."}
          />
        ) : (
          <div className="space-y-8">
            {/* Reserved from the first paint for a signed-in viewer. This rail
                is the biggest of the two personal sections, so it was most of
                the jump. */}
            {personalPending
              ? <RailSkeleton title="Recommended for you" />
              : rail("Recommended for you", data?.recommendation, "/discover", true)}

            {/* "Popular right now" per the mockup's own headline — and now
                literally true: real provider trending, released titles included. */}
            {rail("Popular right now", trending, "/discover")}
            {rail("Upcoming", upcoming, "/calendar")}

            {/* Popular people, deliberately NOT filtered by media type: a
                director is not a movie, and hiding the whole rail because
                somebody ticked "Games" would be a dead control, not a filter.
                It also renders a wider column than a poster: these are circles
                with two lines of text under them. */}
            {people.length > 0 && (
              <Rail title="Popular people" seeAllHref="/discover" colsClass="auto-cols-[110px]">
                {people.map((p) => <PersonCard key={p.key} person={p} />)}
              </Rail>
            )}
          </div>
        )}

        {/* The per-user overlay failed. Says so instead of hiding, and the
            public page underneath is untouched, so this is a note rather than a
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
