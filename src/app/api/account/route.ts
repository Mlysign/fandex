import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { accountFootprint, deleteAccount } from "@/lib/account";
import { SESSION_COOKIE } from "@/lib/session";
import { parseJsonBody } from "@/lib/validate";
import { AccountDeleteSchema } from "@/lib/schemas";

// H4.6 — self-serve account deletion (GDPR Art. 17).
//
// GET  → what deletion would remove (drives the confirm dialog's counts).
// DELETE → erase the account, then clear the session cookie.

export const dynamic = "force-dynamic";

export const GET = withUser(async (_req: NextRequest, session) => {
  return NextResponse.json(accountFootprint(session.userId));
});

export const DELETE = withUser(async (req: NextRequest, session) => {
  // Type-to-confirm is enforced server-side too, not just in the dialog: this
  // route is a single unauthenticated-looking fetch away from being triggered by
  // something that isn't our UI, and the action is irreversible.
  await parseJsonBody(req, AccountDeleteSchema);

  const result = deleteAccount(session.userId);

  // The cookie is now unusable anyway — getSession() rejects a token whose user
  // row is gone (see session.ts) — but leaving a dead cookie in the browser
  // means every subsequent request carries it and gets a silent 401. Clear it.
  const res = NextResponse.json({ ok: true, deleted: result.total, perTable: result.perTable });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
