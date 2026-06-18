import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { setUserCountry } from "@/lib/userCountry";

// Profile settings writes (T22). Currently just the country that drives
// region-aware release dates + streaming availability.
export const POST = withUser(async (req: NextRequest, session) => {
  const body = await req.json().catch(() => ({}));
  const country = setUserCountry(session.userId, String(body.country ?? ""));
  if (!country) return NextResponse.json({ error: "Unknown country code" }, { status: 400 });
  return NextResponse.json({ ok: true, country });
});
