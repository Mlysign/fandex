import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { BadRequestError } from "@/lib/validate";
import { getUserCountry } from "@/lib/userCountry";
import { decorateSection } from "@/lib/liveDiscover";
import { persistDiscoverBatch, annotateUserState } from "@/lib/annotateDiscover";
import { popularForMonth } from "@/lib/popularMonthFeed";

// The calendar's "Popular" scope (2026-07-28): the month's biggest releases
// straight from the providers, independent of anything the user has saved.
// One month per request — the calendar fetches lazily as you page through it.
//
// The fetch + rank + 6h cache moved to lib/popularMonthFeed.ts on 2026-07-30 so
// Home's Upcoming rail runs the identical algorithm off the identical cache
// (Nils: Upcoming "should use the same algorithm the calendar page uses" — the
// only way for that to stay true is one implementation, not two).
//
// This route is withUser, not public, for three reasons: it's only reachable
// from an already-auth-gated page; it gets the shared 300/60s per-user cap for
// free (these are OUR provider keys being spent); and persistDiscoverBatch's
// session gate means an anonymous crawler can never mint media_items rows here
// — the failure mode that grew the pool to ~676k rows on /discover. Don't
// relax it.

const MONTH_RE = /^(\d{4})-(\d{2})$/;
// Providers have nothing useful outside roughly this range, and an unbounded
// month lets a caller walk us through thousands of upstream requests.
const MIN_YEAR = 1950;
const MAX_YEAR = 2100;

function parseMonth(raw: string | null): string {
  const m = raw?.match(MONTH_RE);
  if (!m) throw new BadRequestError("month must be YYYY-MM");
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new BadRequestError("month must be YYYY-MM");
  if (year < MIN_YEAR || year > MAX_YEAR) throw new BadRequestError(`year must be between ${MIN_YEAR} and ${MAX_YEAR}`);
  return `${m[1]}-${m[2]}`;
}

export const GET = withUser(async (req: NextRequest, session) => {
  const month = parseMonth(req.nextUrl.searchParams.get("month"));
  const region = getUserCountry(session.userId);

  const ranked = await popularForMonth(month, region);
  // decorate → persist (strips `raw`, mints uuids) → annotate with this user's
  // wishlist/library state, so a popular item they already track renders with
  // the same bookmark/check the rest of the calendar shows.
  const decorated = decorateSection(ranked, session.userId);
  const items = annotateUserState(persistDiscoverBatch(decorated, session.userId), session.userId);

  return NextResponse.json({ month, items });
});
