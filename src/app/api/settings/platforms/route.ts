import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { getUserCountry } from "@/lib/userCountry";
import { surveyUserPlatforms } from "@/lib/userPlatformSurvey";
import { getUserPlatforms } from "@/lib/userPlatforms";

// The option list for Settings → Your platforms: every service and console this
// user's own library + wishlist touches, with how many of their titles are on
// each, plus what they have already selected.
//
// GET-only and per-user. `withUser` supplies the 401 and the rate limit; the
// survey itself is cached per (user, region, catalog signature) so repeat opens
// of the settings page cost nothing.
//
// ⚠️ Region matters: the streaming half is resolved for the user's own country,
// the same one mergeLinks uses, so a German account sees WOW and MagentaTV
// rather than a US list it cannot act on.
export const GET = withUser(async (_req, session) => {
  const region = getUserCountry(session.userId);
  return NextResponse.json({
    options: surveyUserPlatforms(session.userId, region),
    selected: getUserPlatforms(session.userId),
    region,
  });
});
