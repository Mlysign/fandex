import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withUser } from "@/lib/withUser";
import { createSession, setSessionCookie } from "@/lib/session";
import { get } from "@/lib/db";
import { log, errorFields } from "@/lib/logger";
import { accountFootprint, mergeConflicts, mergeAccounts, providersFor } from "@/lib/accountMerge";
import { readPendingMerge, clearPendingMerge } from "@/lib/pendingMerge";

// The merge form's two ends (2026-09-02). GET describes the pending merge, POST
// executes it with the resolution the user picked.
//
// ⚠️ TWO INDEPENDENT CHECKS ON EVERY CALL, and neither is sufficient alone:
//
//   1. The signed `rr2_pending_merge` cookie, minted only inside an OAuth
//      callback that had just proved the caller controls the OTHER account.
//   2. The live session must BE the `from` account. A capability that outlives
//      its session would let a shared or stale browser fold away an account the
//      current person never proved they own.
//
// Both, every time. The cookie says "this pair may be joined"; the session says
// "and you are still the one who may join them".

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  // No default, deliberately: the whole point of the form is that a winner is
  // chosen explicitly. A default here would reintroduce the silent pick.
  resolution: z.enum(["keep-mine", "keep-theirs"]),
});

/** Display name for an account, so the form names sides rather than ids. */
function describe(userId: string) {
  const identity = get<{ display_name: string | null; provider: string }>(
    "SELECT display_name, provider FROM user_identities WHERE user_id = ? ORDER BY created_at LIMIT 1",
    [userId],
  );
  const f = accountFootprint(userId);
  return {
    displayName: identity?.display_name ?? null,
    provider: identity?.provider ?? null,
    providers: providersFor(userId),
    titles: f.itemState,
    episodes: f.episodeState,
  };
}

export const GET = withUser(async (req: NextRequest, session) => {
  const pending = await readPendingMerge(req);
  if (!pending) return NextResponse.json({ pending: null });
  if (pending.from !== session.userId) {
    // The token is for a different account than the one now signed in. Report it
    // as "nothing pending" rather than an error: from the caller's side there is
    // no actionable difference, and saying more would only help someone probing.
    return NextResponse.json({ pending: null });
  }

  return NextResponse.json({
    pending: {
      provider: pending.provider,
      mine: describe(pending.from),
      theirs: describe(pending.into),
      conflicts: mergeConflicts(pending.from, pending.into),
    },
  });
});

export const POST = withUser(async (req: NextRequest, session) => {
  const pending = await readPendingMerge(req);
  if (!pending || pending.from !== session.userId) {
    return NextResponse.json({ error: "No pending merge" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose which side to keep" }, { status: 400 });
  }

  try {
    const outcome = mergeAccounts(pending.from, pending.into, parsed.data.resolution);
    if (!outcome.ok) {
      return NextResponse.json({ error: "provider-taken", provider: outcome.provider }, { status: 409 });
    }

    // The session was for the account that no longer exists. Mint one for the
    // survivor before returning, or the browser holds a cookie for a deleted row
    // and the very next request logs them out.
    const identity = get<{ id: string; provider: string; display_name: string | null }>(
      "SELECT id, provider, display_name FROM user_identities WHERE user_id = ? ORDER BY created_at LIMIT 1",
      [pending.into],
    );
    const token = await createSession({
      userId: pending.into,
      identityId: identity?.id ?? "",
      provider: (identity?.provider ?? pending.provider) as any,
      displayName: identity?.display_name ?? null,
    });

    log.info("account_merge_executed", {
      resolution: parsed.data.resolution, movedTables: outcome.movedTables,
    });

    const res = NextResponse.json({ ok: true, moved: outcome.movedTables });
    clearPendingMerge(res);
    res.cookies.set(setSessionCookie(token));
    return res;
  } catch (e: any) {
    log.error("account_merge_failed", errorFields(e));
    return NextResponse.json({ error: "Merge failed. Nothing was changed." }, { status: 500 });
  }
});
