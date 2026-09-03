import { NextResponse, type NextRequest } from "next/server";
import { withUser } from "@/lib/withUser";
import { readStagedImport, discardStagedImport } from "@/lib/import/staging";
import { applyImport } from "@/lib/import/apply";
import { log } from "@/lib/logger";

// PL4 — claim a staged import into the signed-in account.
//
// `withUser`, not `withOptionalUser`: analyze is the anonymous half, and this is
// the half that writes. The split is the whole point of importing before signup.
//
// ⚠️ The staging row is discarded only AFTER the write succeeds. If applyImport
// throws, the staged data survives and the person can retry, rather than losing
// a 1,400-film import to one transient error. That ordering is deliberate and is
// the kind of thing that reads as a detail until somebody hits it.

export const dynamic = "force-dynamic";

export const POST = withUser(async (req: NextRequest, session) => {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : null;
  if (!token) return NextResponse.json({ error: "No import to apply." }, { status: 400 });

  const staged = readStagedImport(token);
  if (!staged) {
    // Expired, already claimed, or never existed. All three read the same to the
    // caller on purpose, and all three have the same fix.
    return NextResponse.json(
      { error: "That import has expired. Upload the export again and it will only take a moment." },
      { status: 404 },
    );
  }

  const result = await applyImport(session.userId, staged.rows);
  discardStagedImport(token);

  log.info("import_applied", {
    userId: session.userId,
    source: staged.source,
    imported: result.imported,
    ratings: result.ratings,
    wishlist: result.wishlist,
    unmatched: result.unmatched,
  });

  return NextResponse.json(result);
});
