import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { buildUpNext, upNextStatus } from "@/lib/upNext";
import { buildFilterableUpNext } from "@/lib/upNextFacts";

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

// Two shapes, one list:
//   (no params)  Home's rail — capped at 10, entries only.
//   ?full=1      the library's Progress tab — the WHOLE list, each entry
//                carrying the show's filterable facts (lib/upNextFacts.ts).
//
// `?limit=&offset=` paging went with it (2026-08-28). The tab's toolbar filters
// client-side like every other surface in this app, and a filter over one page
// of a paged list finds only what you had already scrolled past.
export const GET = withUser(async (req: NextRequest, session) => {
  // `status` is computed on both paths — it costs a handful of indexed counts,
  // and having it always present means the client never has to make a second
  // request to explain an empty list.
  const status = upNextStatus(session.userId);

  if (req.nextUrl.searchParams.get("full") === "1") {
    const { entries, total } = await buildFilterableUpNext(session.userId);
    return NextResponse.json({ entries, total, status });
  }

  const entries = await buildUpNext(session.userId);
  return NextResponse.json({ entries, status });
});
