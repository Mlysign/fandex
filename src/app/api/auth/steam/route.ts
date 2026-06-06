import { NextRequest, NextResponse } from "next/server";
import { getSteamLoginUrl } from "@/lib/sources/steam";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const session = await getSession();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:3000`;
  // Encode existing userId in the return URL so we can link accounts
  const returnTo = `${baseUrl}/api/auth/steam/callback${session?.userId ? `?link=${session.userId}` : ""}`;
  return NextResponse.redirect(getSteamLoginUrl(returnTo));
}
