import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { withOptionalUser } from "@/lib/withUser";
import { BadRequestError } from "@/lib/validate";
import { getUserCountry } from "@/lib/userCountry";
import { DEFAULT_COUNTRY } from "@/lib/countries";
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
// 2026-08-18 — this route was `withUser`. It is now `withOptionalUser`, because
// the release calendar is public (Nils: "the release calendar should be public
// access") and Popular is the only scope an anonymous visitor can see at all.
//
// Two of the three reasons the old comment gave for gating it survive intact and
// must stay that way:
//   · The per-user 300/60s cap becomes a per-IP 60/60s cap for an anonymous
//     caller (withOptionalUser) — these are still OUR provider keys, and an
//     un-attributable caller gets the tighter one.
//   · persistDiscoverBatch's SESSION GATE is untouched: it takes the userId, and
//     the null branch resolves already-known rows read-only and writes nothing.
//     An anonymous crawler still cannot mint media_items rows here — the failure
//     mode that grew the pool to ~676k rows on /discover. Do not "simplify" that
//     by passing a placeholder id.
// The third reason ("only reachable from an auth-gated page") is no longer true.

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

export const GET = withOptionalUser(async (req: NextRequest, session) => {
  const month = parseMonth(req.nextUrl.searchParams.get("month"));
  const userId = session?.userId ?? null;
  const region = userId ? getUserCountry(userId) : DEFAULT_COUNTRY;

  const ranked = await popularForMonth(month, region);
  // decorate → persist (strips `raw`, mints uuids) → annotate with this user's
  // wishlist/library state, so a popular item they already track renders with
  // the same bookmark/check the rest of the calendar shows. All three take a
  // nullable userId and degrade to the public shape on their own.
  const decorated = decorateSection(ranked, userId);
  const items = annotateUserState(persistDiscoverBatch(decorated, userId), userId);

  return NextResponse.json({ month, items });
// One request per month paged, and every one of them can fan out to TMDB, Trakt
// and RAWG on our keys — so this takes a much lower anon cap than the default.
}, { anonLimit: 60 });
