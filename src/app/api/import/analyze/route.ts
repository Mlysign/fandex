import { NextResponse, type NextRequest } from "next/server";
import { withOptionalUser } from "@/lib/withUser";
import { parseImport, ImportParseError } from "@/lib/import/parse";
import { matchLocally } from "@/lib/import/match";
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
    const matched = matchLocally(parsed.rows);

    // Staged whether or not there is a session. A signed-in user could apply
    // immediately, but going through the same token keeps ONE apply path rather
    // than two that can drift.
    const staged = stageImport(parsed.source, parsed.rows);

    log.info("import_analyzed", {
      source: parsed.source,
      rows: parsed.rows.length,
      matched: matched.matchedLocally,
      signedIn: !!session,
    });

    return NextResponse.json({
      token: staged.token,
      source: parsed.source,
      filesRead: parsed.filesRead,
      total: parsed.rows.length,
      matched: matched.matchedLocally,
      unmatched: matched.unmatched,
      ratings: matched.rows.filter((r) => r.relation === "library" && r.rating != null).length,
      wishlist: matched.rows.filter((r) => r.relation === "wishlist").length,
      // A sample, not the whole set: enough to prove it read the right file,
      // small enough not to ship a 2,000-row payload to a browser.
      sample: matched.rows.filter((r) => r.mediaItemId).slice(0, 12).map((r) => ({
        title: r.title, year: r.year, rating: r.rating,
      })),
      // The misses are shown BEFORE anything is applied. An import that quietly
      // drops a tail is the failure this whole feature is meant to avoid.
      unmatchedSample: matched.rows.filter((r) => !r.mediaItemId).slice(0, 25).map((r) => ({
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
