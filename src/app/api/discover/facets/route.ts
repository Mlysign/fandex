import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { withOptionalUser } from "@/lib/withUser";
import { searchFacets, searchTitles } from "@/lib/discovery";

// Autocomplete for Taste Match: facet pills (kind=tag|person|company) and
// example-title seeds (kind=title), searched against the local catalog vocab.
//
// 2026-08-18 — was `withUser`, which made the DESKTOP NAV'S SEARCH BOX dead for
// every logged-out visitor: NavSearch debounces onto this endpoint, treats a
// non-OK response as "keep the dropdown closed" (deliberately, so a 401 doesn't
// render a misleading "No matches"), and has no other source of options — so the
// field accepted typing, showed nothing, and Enter did nothing, because Enter
// picks from those options. Nils, 2026-08-18: "the search icon next to the
// profile icon does not do anything."
//
// Public is the right answer rather than a second anon-only endpoint: both
// functions read the SAME local catalog vocab that /discover, /person, /tag and
// /studio already serve to anonymous visitors and to crawlers, so there is
// nothing here a logged-out caller can't already see. No provider call, no
// write, no user-scoped data — the session is not even read. The tighter anon
// per-IP cap in withOptionalUser bounds the vocab scan.
export const GET = withOptionalUser(async (req: NextRequest) => {
  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q") ?? "";
  const kind = searchParams.get("kind");
  if (kind === "title") return NextResponse.json({ matches: searchTitles(q) });
  return NextResponse.json({ matches: searchFacets(q, kind) });
});
