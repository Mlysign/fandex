import { NextResponse } from "next/server";
import { getLetterboxdAuthUrl } from "@/lib/sources/letterboxd";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  const state = Buffer.from(
    JSON.stringify({ userId: session?.userId ?? null, ts: Date.now() })
  ).toString("base64url");
  return NextResponse.redirect(getLetterboxdAuthUrl(state));
}
