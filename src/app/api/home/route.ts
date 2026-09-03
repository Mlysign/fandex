import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { log, errorFields } from "@/lib/logger";
import { getSession } from "@/lib/session";
import { getUserCountry } from "@/lib/userCountry";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import { personalizedFeed, decorateSection } from "@/lib/liveDiscover";
import { withoutHidden } from "@/lib/hiddenItems";
import { persistDiscoverBatch, annotateUserState } from "@/lib/annotateDiscover";
import { RAIL_SIZE } from "@/lib/homeRails";
import { readHomeSnapshot, buildHomeSnapshot, type SnapshotItem } from "@/lib/homeSnapshot";
import { seedFor, rotationSlot, rotateRailFresh } from "@/lib/dailyRotation";

// Home's three rails + the signed-in stats strip. Reuses the exact discover-feed
// + persist/annotate machinery /api/discover already ships (same shapes, so
// PosterCard's quick actions work identically on Home) rather than inventing a
// parallel path.
//
// PR15's session-gated persist rule applies here too: Home is a public route, so
// an anonymous view must not mint media_items rows either.
// 2026-07-28: `persist`/`annotate` were a verbatim copy of /api/discover's pair;
// both now come from lib/annotateDiscover.ts. That also closed a real gap here —
// the local `persist` never took `userId`, so despite the comment above, an
// ANONYMOUS Home view did mint media_items rows. It no longer does.
//
// ── 2026-07-30 REWRITE: the rails now do what their labels say ──────────────
// Nils: "the popular carousels feel like they show the same items every day and
// it does not match what I am seeing on TMDB under trends or Trakt under
// trending". Both halves were true, and for one root cause — all three rails
// were built from ONE page-1 pull of the providers' 18-month FUTURE window:
//
//   • popular  sorted that upcoming pool by community vote AVERAGE, making it
//     "best-rated unreleased titles". Trending is a released-title,
//     watch-activity ranking, so it could never agree with TMDB or Trakt.
//   • upcoming re-used the same page-1 pool and date-sorted it, so it had none
//     of the cross-source normalisation the calendar spent a whole batch on.
//   • all three took a fixed prefix of a fixed sort → identical every day.
//
// So: `trending` comes from the providers' real trending endpoints (TMDB
// /trending, Trakt /trending, RAWG recent-most-added); `upcoming` calls the
// calendar's own candidatesForMonth; and every rail is drawn from a DEEPER
// ranked pool via a day-seeded rotation instead of a prefix (lib/dailyRotation).
// Public rails are viewer-independent, and since 2026-08-26 they are also
// PRE-BUILT: `home_snapshot` holds the day's trending + upcoming, assembled off
// the request path so that `/` can server-render real links and a crawler costs
// no provider calls at all. This route reads the same snapshot rather than
// re-running the fan-out, so the two surfaces cannot disagree. It falls back
// to a live build only when there is no snapshot at all (a fresh volume, or a
// container whose first scheduled build has not landed yet).
// → src/lib/homeSnapshot.ts


export async function GET(req: NextRequest) {
  try {
    let userId: string | null = null;
    try { userId = (await getSession())?.userId ?? null; } catch { /* anon */ }
    const region = userId ? getUserCountry(userId) : DEFAULT_COUNTRY;

    const now = new Date();

    // ── The public rails come out of the daily snapshot ────────────────────
    //
    // Read, never build: a build is the provider fan-out, and putting it back on
    // a request path is exactly what the snapshot exists to stop. The ONE
    // exception is a missing snapshot (a fresh volume, or a container whose
    // first scheduled build has not landed), where a live build is better than
    // an empty homepage. `buildHomeSnapshot` stores what it makes, so this can
    // happen at most once per process.
    //
    // ⚠️ ONE REGION. The snapshot is built for DEFAULT_COUNTRY, so a signed-in
    // visitor whose country differs now sees the same public rails as everyone
    // else. That is the deliberate cost of making the page cacheable and
    // crawler-cheap: region only ever reached `upcomingPool`'s calendar window,
    // and one shared upcoming list is a far smaller loss than a per-region
    // provider fan-out on the busiest page in the app.
    const snapshot = readHomeSnapshot() ?? await buildHomeSnapshot();

    // `?day=`/`?slot=` used to force the rail rotation; the rotation now happens
    // inside the daily build, so they are no longer read here. `region` is kept
    // for the personalized feed below, which IS still per-user.
    void region;

    // The snapshot's items already carry their catalog uuid and slug: they were
    // persisted once, by the builder. Running `persistDiscoverBatch` over them
    // again would key on `id`, find a uuid where it expects a provider id, and
    // mark every card non-linkable. Only the per-user overlay is applied here.
    const trending = withUserOverlay(snapshot?.trending ?? [], userId);
    const upcoming = withUserOverlay(snapshot?.upcoming ?? [], userId);

    let recommendation: Awaited<ReturnType<typeof personalizedFeed>> = [];
    if (userId) {
      // personalizedFeed already ranks ~54 items (FINAL_KEEP × 3 types) and
      // caches them for 45 min — the old code just took the top 15 of that every
      // time. Rotating the SAME cached list costs no provider calls.
      //
      // keepTop 1, not 3: this is the rail Nils was looking at, and on a phone
      // three pinned cards are most of what's on screen. One pinned card still
      // guarantees the single best match is never rotated out.
      //
      // This rail stays live and per-user. It cannot go in the snapshot: it is
      // built from the viewer's own taste profile, and a snapshot is by
      // definition the half of the page that is the same for everybody.
      const slotParam = process.env.NODE_ENV !== "production" ? req.nextUrl.searchParams.get("slot") : null;
      const slot = slotParam && /^-?d+$/.test(slotParam) ? Number(slotParam) : rotationSlot(now);
      const personalized = await personalizedFeed(userId, getUserCountry(userId));
      if (personalized) {
        const ranked = [...personalized].sort((a, b) => b.score - a.score);
        recommendation = rotateRailFresh(
          ranked, RAIL_SIZE, (e) => seedFor("recommendation", userId!, e), slot,
          { keepTop: 1 },
        );
      }
    }

    return NextResponse.json({
      trending,
      upcoming,
      // ⚠️ Hidden titles come out AFTER persistDiscoverBatch: until it runs, an
      // item's `id` is a provider string like `igdb-402959` and the local uuid
      // the hidden set is keyed by does not exist yet. Only this rail is
      // filtered — it is the one that CHOOSES on the viewer's behalf. Trending
      // and upcoming come out of the viewer-independent snapshot and stay as
      // they are; hiding is "stop recommending", not "erase from the site".
      recommendation: withoutHidden(
        annotateUserState(persistDiscoverBatch(recommendation, userId), userId),
        userId,
        (r: { id?: string }) => r.id,
      ),
      // The signed-in marker. It used to be a `stats` object carrying the day's
      // highlight panels; Nils removed those from Home on 2026-08-26 ("they
      // don't add as much as I'd hoped"), leaving the flag they were bundled
      // with. A plain boolean says what the page actually reads it for.
      authed: !!userId,
      // What the page is serving out of, so a stale or missing snapshot is
      // diagnosable from the response instead of looking like "the rails are
      // broken". That is the standing rule about empty states carrying a reason.
      snapshot: snapshot
        ? { day: snapshot.day, builtAt: snapshot.builtAt, ageMs: Date.now() - snapshot.builtAt }
        : null,
    });
  } catch (e: any) {
    log.error("home_error", { ...errorFields(e) });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * Layer the viewer's own state and Fandex Score onto snapshot rails.
 *
 * The snapshot is decorated for nobody (`decorateSection(…, null)`), which is
 * what makes it shareable across every visitor. This adds back the half that is
 * per-user: watchlist / library / rating from `annotateUserState`, and the
 * viewer's real Fandex Score in place of the snapshot's null.
 */
function withUserOverlay(items: SnapshotItem[], userId: string | null) {
  if (!items.length) return [];
  const scored = userId ? decorateSection(items as never, userId) : items;
  // ⚠️ Hidden titles come out HERE, in the per-user overlay, not out of the
  // snapshot. The snapshot stays viewer-independent by contract (that is what
  // makes it shareable across every visitor and cheap for a crawler); this is
  // the layer that is already per-user, so dropping a row here changes nothing
  // about what was built.
  //
  // 2026-09-03, second pass. The first version filtered only the recommendation
  // rail, on the reasoning that hiding means "stop recommending" rather than
  // "erase from the site". Nils tested it and that reasoning was wrong: "i hid
  // The Bear. It was removed from the progress (good), but not from 'popular
  // right now' (wrong)." A rail on YOUR home page is something Fandex chose to
  // show you, whatever the machinery behind it is called, and the snapshot being
  // viewer-independent is an implementation detail nobody outside this file can
  // see. All three rails now respect it.
  return withoutHidden(
    annotateUserState(scored as never, userId),
    userId,
    (r) => (r as { id?: string }).id,
  );
}
