import { NextResponse, type NextRequest } from "next/server";
import { withOptionalUser } from "@/lib/withUser";
import { parseImport, ImportParseError } from "@/lib/import/parse";
import { matchLocally, resolveMissesAtProvider } from "@/lib/import/match";
import { stageImport, StagingFullError } from "@/lib/import/staging";
import { log } from "@/lib/logger";

// PL4 — read an uploaded export, match it against the catalog, and report what
// would be imported. WRITES NOTHING except the staging row.
//
// ⚠️ ANONYMOUS BY DESIGN (Nils, 2026-08-23). Someone drops their archive, sees
// their films matched and a preview of what it says about them, and only then
// makes an account. The data is the pitch, which is a far better reason to sign
// up than a wall is.
//
// ⚠️ So NOTHING here may touch media_items or user state. `withOptionalUser`
// hands over `session | null`; the null is passed straight through and no
// placeholder id is ever invented, which is the same rule PR15's write gate
// runs on. `matchLocally` is read-only by construction: it resolves against
// rows that already exist and mints none.
//
// ⚠️ The upload is the DoS surface. Three ceilings, all before any parsing:
// the request body, the row count (in staging), and the decompressed archive
// size (in the zip reader). `anonLimit` is sized well below the default because
// this is the most expensive anonymous endpoint in the app: it inflates an
// archive and scans the whole catalog.

export const dynamic = "force-dynamic";

/** Hard body ceiling. A Letterboxd archive for a heavy account is ~1–2 MB. */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** What a single client may do per minute. An import is a rare, heavy action. */
const ANON_IMPORT_LIMIT = 6;

export const POST = withOptionalUser(async (req: NextRequest, session) => {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the export as a file upload." }, { status: 400 });

  const uploads = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!uploads.length) return NextResponse.json({ error: "No file was attached." }, { status: 400 });

  let total = 0;
  const files: { name: string; data: Buffer }[] = [];
  for (const f of uploads) {
    total += f.size;
    if (total > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "That file is larger than this import accepts. A Letterboxd export is usually a couple of megabytes." },
        { status: 413 },
      );
    }
    files.push({ name: f.name, data: Buffer.from(await f.arrayBuffer()) });
  }

  try {
    const parsed = parseImport(files);
    const local = matchLocally(parsed.rows);

    // ── The provider half, which the docs specified and nobody wired up ──────
    //
    // Until 2026-09-03 this route stopped at `matchLocally` and reported every
    // other row as "could not be found in our catalog". True, and read exactly
    // as Nils read it: "its a big deal breaker if half my export would be lost".
    // His 607-row export missed 56 titles, of which Reservoir Dogs, American
    // Beauty and The Intouchables are not obscure — they were simply not in OUR
    // catalog yet, and TMDB has had all of them for years.
    //
    // Resolving here rather than at apply time does three things at once: the
    // preview stops lying, the lookup is paid for ONCE, and the ids ride into
    // staging so the apply step can create the rows. It still writes nothing,
    // which is what keeps this endpoint safe to leave anonymous.
    const matched = await resolveMissesAtProvider(local);

    // Staged whether or not there is a session. A signed-in user could apply
    // immediately, but going through the same token keeps ONE apply path rather
    // than two that can drift.
    //
    // ⚠️ The rows STAGED are the matched ones, not the parsed ones, and that is
    // load-bearing: they carry the resolved `tmdbId`. Staging `parsed.rows` here
    // would throw the whole provider pass away and put the data loss straight
    // back, invisibly, because the preview would still show the better numbers.
    const staged = stageImport(parsed.source, matched.rows);

    log.info("import_analyzed", {
      source: parsed.source,
      rows: parsed.rows.length,
      matched: matched.matchedLocally,
      matchedAtProvider: matched.matchedAtProvider ?? 0,
      unmatched: matched.unmatched,
      signedIn: !!session,
    });

    return NextResponse.json({
      token: staged.token,
      source: parsed.source,
      filesRead: parsed.filesRead,
      total: parsed.rows.length,
      // `matched` is what WILL be imported: the catalog's answer plus TMDB's.
      // Split out so the UI can say where each half came from, and so a future
      // reader can tell a catalog problem from a provider one.
      matched: matched.matchedLocally + (matched.matchedAtProvider ?? 0),
      matchedLocally: matched.matchedLocally,
      matchedAtProvider: matched.matchedAtProvider ?? 0,
      unmatched: matched.unmatched,
      // Rows past the per-import provider budget. "We stopped looking" is not
      // the same statement as "it does not exist", and collapsing the two is
      // how a cap becomes a silent filter.
      overBudget: matched.overBudget,
      ratings: matched.rows.filter((r) => r.relation === "library" && r.rating != null).length,
      wishlist: matched.rows.filter((r) => r.relation === "wishlist").length,
      // A sample, not the whole set: enough to prove it read the right file,
      // small enough not to ship a 2,000-row payload to a browser.
      // ⚠️ Both of these test `mediaItemId || tmdbId`, not `mediaItemId` alone.
      // A row TMDB resolved has no local uuid yet (it gets one at apply time),
      // so testing only the uuid would list every provider-resolved title under
      // "could not be found" while the counts above said it was matched. Two
      // halves of one screen disagreeing is worse than either number alone.
      sample: matched.rows.filter((r) => r.mediaItemId || r.tmdbId != null).slice(0, 12).map((r) => ({
        title: r.title, year: r.year, rating: r.rating,
      })),
      // The misses are shown BEFORE anything is applied. An import that quietly
      // drops a tail is the failure this whole feature is meant to avoid.
      unmatchedSample: matched.rows.filter((r) => !r.mediaItemId && r.tmdbId == null).slice(0, 25).map((r) => ({
        title: r.title, year: r.year,
      })),
      signedIn: !!session,
    });
  } catch (e) {
    if (e instanceof ImportParseError || e instanceof StagingFullError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}, { anonLimit: ANON_IMPORT_LIMIT });
