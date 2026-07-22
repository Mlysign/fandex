import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withScoringAdmin } from "@/lib/devAdmin";
import { parseJsonBody } from "@/lib/validate";
import {
  previewPrune, runPrune, runVacuum, volumeInfo, orphanCheck,
  walDiagnostics, checkpointTruncate,
} from "@/lib/dbPrune";
import { readDbSize } from "@/lib/dbSize";

// Reads + mutates live DB state — never prerender.
export const dynamic = "force-dynamic";

// PR16 — reclaim the catalog-pool blowup. Admin-gated behind the same
// SCORING_ADMIN_USER_IDS allowlist as /api/dev/dbsize (non-admins get 404).
//
// GET  — DRY RUN. Pure counts: what would be deleted, what is protected and by
//        which table, whether there is room to VACUUM. Safe to hit any time.
// POST — applies, and only with an exact confirmation string in the body. There
//        is no query-param shortcut on purpose: this deletes hundreds of
//        thousands of rows from production, and a URL someone can fat-finger or
//        a browser can prefetch is the wrong shape of trigger for that.
//
// `prune` is resumable — it works in bounded batches under a wall-clock budget
// and returns `remaining`, so the caller repeats until that reaches 0. VACUUM is
// a SEPARATE action because the prune alone fixes the memory problem (freed
// pages stop being read); VACUUM only returns disk, and carries the real risk.

export const GET = withScoringAdmin(async () => {
  return NextResponse.json({
    mode: "dry-run",
    preview: previewPrune(),
    volume: volumeInfo(),
    orphans: orphanCheck(),
    // Pure pragma reads — no PASSIVE probe here, that's a mutation (POST).
    wal: walDiagnostics(),
    db: readDbSize(),
  });
});

const PruneBodySchema = z.object({
  action: z.enum(["prune", "vacuum", "wal-probe", "wal-truncate"]),
  // Optional at the schema level because only `prune` and `vacuum` require it,
  // and those check the exact value themselves below — a required-but-ignored
  // field just makes the WAL diagnostics fail with a confusing validation
  // error. Deliberately not a boolean: typing the word is the speed bump.
  confirm: z.string().optional(),
  batchSize: z.number().int().positive().optional(),
  budgetMs: z.number().int().positive().optional(),
});

export const POST = withScoringAdmin(async (req: NextRequest) => {
  const body = await parseJsonBody(req, PruneBodySchema);

  // Diagnostics for the 2026-07-22 checkpoint stall. Neither needs a confirm
  // string: PASSIVE only copies frames into the main DB (it can't remove
  // anything), and TRUNCATE is protected by SQLite itself — it cannot discard
  // frames another connection, Litestream included, still needs. Both are
  // recoverable; the prune and the vacuum are not, which is why only those two
  // demand typing a word.
  if (body.action === "wal-probe") {
    return NextResponse.json({ mode: "probe", wal: walDiagnostics({ probe: true }), volume: volumeInfo() });
  }
  if (body.action === "wal-truncate") {
    const result = checkpointTruncate();
    return NextResponse.json({ mode: "applied", action: "wal-truncate", result, wal: walDiagnostics(), volume: volumeInfo() });
  }

  if (body.action === "prune") {
    if (body.confirm !== "PRUNE") {
      return NextResponse.json(
        { error: 'Refusing to prune: send {"confirm":"PRUNE"} to proceed.', preview: previewPrune() },
        { status: 400 },
      );
    }
    const before = previewPrune();
    const result = runPrune({ batchSize: body.batchSize, budgetMs: body.budgetMs });
    return NextResponse.json({
      mode: "applied",
      action: "prune",
      before,
      result,
      orphans: orphanCheck(),
      volume: volumeInfo(),
      // Non-zero here means a cascade reached user data — it should be
      // impossible given the predicate, which is exactly why it is asserted
      // rather than assumed.
      userRowsTouched:
        result.libraryRowsAfter !== result.libraryRowsBefore ||
        result.watchlistRowsAfter !== result.watchlistRowsBefore,
      hint: result.remaining > 0 ? "Repeat this request until result.remaining is 0." : "Prune complete.",
    });
  }

  if (body.confirm !== "VACUUM") {
    return NextResponse.json(
      { error: 'Refusing to vacuum: send {"confirm":"VACUUM"} to proceed.', volume: volumeInfo() },
      { status: 400 },
    );
  }
  return NextResponse.json({ mode: "applied", action: "vacuum", result: runVacuum(), volume: volumeInfo() });
});
