import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { buildUpNext } from "@/lib/upNext";

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

export const GET = withUser(async (_req: NextRequest, session) => {
  return NextResponse.json({ entries: await buildUpNext(session.userId) });
});
