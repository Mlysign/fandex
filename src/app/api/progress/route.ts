import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { buildUpNext, buildUpNextPage, upNextStatus } from "@/lib/upNext";

// Home's progress module — the episodes you'd watch next, per show.
//
// A SEPARATE route from /api/home on purpose. This one may heal a show's episode
// catalog from TMDB (bounded — see lib/upNext.ts), and Home is already the
// heaviest page in the app; folding it into /api/home would put that latency in
// front of the three public rails. As its own island it loads independently and
// a slow or failed fetch costs this module alone.
//
// Marking an episode done goes through POST /api/episodes, not here — that route
// already owns the push-to-Trakt-then-write ordering, and a second writer for the
// same state is how the two would drift.

export const dynamic = "force-dynamic";

// Paging (MB16): `?limit=&offset=` serves the library's Progress tab, which is
// not capped at 10 and loads more on scroll. No params → Home's behaviour,
// unchanged, so the rail keeps its cap without passing anything.
const MAX_PAGE = 50;

function intParam(v: string | null, fallback: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export const GET = withUser(async (req: NextRequest, session) => {
  const { searchParams } = req.nextUrl;
  const paged = searchParams.has("limit") || searchParams.has("offset");

  // `status` is computed even when entries come back full — it costs a handful
  // of indexed counts, and having it always present means the client never has
  // to make a second request to explain itself.
  const status = upNextStatus(session.userId);

  if (!paged) {
    const entries = await buildUpNext(session.userId);
    return NextResponse.json({ entries, status });
  }

  const limit = intParam(searchParams.get("limit"), 20, MAX_PAGE);
  const offset = intParam(searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER);
  // Only the FIRST page pays for the bounded catalog heal. Paging through the
  // list is scrolling, and making every scroll tick fire provider calls is the
  // shape of the 2026-08-02 latency incident; the sync's bulk backfill is what
  // fills coverage now anyway.
  const page = await buildUpNextPage(session.userId, {
    limit,
    offset,
    ...(offset > 0 ? { maxHealShows: 0 } : {}),
  });
  return NextResponse.json({ ...page, status });
});
