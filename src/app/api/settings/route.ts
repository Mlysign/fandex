import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { setUserCountry } from "@/lib/userCountry";
import { setUserPlatforms, setUserMediaTypes } from "@/lib/userPlatforms";
import { parseJsonBody } from "@/lib/validate";
import { SettingsPostSchema } from "@/lib/schemas";

// Profile settings writes (T22 country, 2026-08-27 platforms).
//
// Both fields are optional and each is applied ONLY when present. The settings
// page saves them from two independent controls, so a body carrying just one
// must leave the other alone — sending `country: undefined` alongside a
// platforms save would otherwise blank a region the user never touched.
// An empty body is a no-op rather than an error: nothing was asked for, so
// nothing changed, and 400ing it would be a distinction without a difference.
export const POST = withUser(async (req: NextRequest, session) => {
  const body = await parseJsonBody(req, SettingsPostSchema);
  const out: { ok: true; country?: string; platforms?: string[]; mediaTypes?: string[] } = { ok: true };

  if (body.country !== undefined) {
    const country = setUserCountry(session.userId, body.country);
    if (!country) return NextResponse.json({ error: "Unknown country code" }, { status: 400 });
    out.country = country;
  }

  if (body.platforms !== undefined) {
    // Returns what was actually stored: malformed and duplicate keys are
    // dropped, so the client should adopt the response rather than assume its
    // own list round-tripped intact.
    out.platforms = setUserPlatforms(session.userId, body.platforms);
  }

  if (body.mediaTypes !== undefined) {
    out.mediaTypes = setUserMediaTypes(session.userId, body.mediaTypes);
  }

  return NextResponse.json(out);
});
