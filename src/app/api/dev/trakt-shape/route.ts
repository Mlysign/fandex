import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { traktSource } from "@/lib/sources/adapters/trakt";
import { probeWatchedShowsShape, probeEpisodeSources } from "@/lib/sources/trakt";

// One-look answer to "why did the Trakt pull carry no episodes?" — see
// probeWatchedShowsShape. Admin-gated like every /api/dev route (404 for anyone
// else), and a GET so it can be opened in a phone browser rather than needing a
// console, which is the whole reason it exists.
//
// It returns SHAPE ONLY: counts, key names, types. No titles, no ids, no token,
// no watch history — the summary is built inside the trakt module so this route
// never handles a raw payload it could accidentally echo.

export const dynamic = "force-dynamic";

export const GET = withScoringAdmin(async (_req: NextRequest, session) => {
  const ctx = await traktSource.context(session.userId);
  if (!ctx?.token) {
    return NextResponse.json({ error: "Trakt is not connected for this account" }, { status: 400 });
  }
  const sample = Number(_req.nextUrl.searchParams.get("showId") ?? 116129);
  const [watched, candidates] = await Promise.all([
    probeWatchedShowsShape(ctx.token),
    probeEpisodeSources(ctx.token, sample),
  ]);
  return NextResponse.json({ ...watched, candidates });
});
