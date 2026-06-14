import { NextRequest, NextResponse } from "next/server";
import { createTmdbRequestToken } from "@/lib/sources/tmdb";

// Start the TMDB connect flow: create a request token and send the user to TMDB
// to approve, with redirect_to pointing back at our callback. The user's existing
// session cookie (if any) is read in the callback for account linking.
export async function GET(req: NextRequest) {
  try {
    const token = await createTmdbRequestToken();
    const callback = `${req.nextUrl.origin}/api/auth/tmdb/callback`;
    const url = `https://www.themoviedb.org/authenticate/${token}?redirect_to=${encodeURIComponent(callback)}`;
    return NextResponse.redirect(url);
  } catch (e) {
    console.error("[TMDB auth]", e);
    return NextResponse.redirect(new URL("/settings?error=tmdb_failed", req.url));
  }
}
