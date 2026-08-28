import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { withOptionalUser } from "@/lib/withUser";
import { find } from "@/lib/discovery";
import { parseJsonBody } from "@/lib/validate";
import { FindSchema } from "@/lib/schemas";

// Taste Match — rank the whole local catalog by the user's preference profile
// (refined with seeds + like/dislike pills), with filters + sort. POST body is a
// FindRequest; see src/lib/discovery.ts.
//
// 2026-08-28 — was `withUser`, which is why a logged-out visitor's search on
// /discover showed nothing from our own catalog and fell through to the provider
// half alone: five UNCACHED provider calls per query (RAWG, IGDB, TMDB×2,
// Letterboxd, two of which 401 on prod every time) to answer a question the
// catalog often already held. → docs/catalog-growth.md phase 2.
//
// Public is the right answer rather than an anon-only twin, for the same reason
// /api/discover/facets is public: everything this returns for a null session is
// catalog data the site already serves anonymously at /discover, /person, /tag
// and /studio. Every per-user field comes back null/empty BY CONSTRUCTION —
// find() builds no profile and never fetches a state map without a userId — so
// there is no branch that could hand one visitor another's state.
//
// ⚠️ `anonLimit` is sized to what this SPENDS, and it spends CPU, not quota: no
// provider call, but a warm find() is ~32 ms of synchronous work on a process
// that serves every other request. 120/min per IP is well clear of the client's
// 300 ms-debounced search (a fast typist reaches ~3/s in bursts, not sustained)
// and caps one IP at ~4 s of CPU a minute.
export const POST = withOptionalUser(async (req: NextRequest, session) => {
  const body = await parseJsonBody(req, FindSchema, { allowEmpty: true });
  return NextResponse.json(find(session?.userId ?? null, body));
}, { anonLimit: 120 });
