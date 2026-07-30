import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { buildAccountExport } from "@/lib/account";

// H4.7 — data export (GDPR Art. 20). Returns everything held about the calling
// user as a downloadable JSON file. The leak boundary (no tokens, ever) lives in
// account.ts's explicit column lists and is pinned by account.test.ts.

export const dynamic = "force-dynamic";

export const GET = withUser(async (_req: NextRequest, session) => {
  const data = buildAccountExport(session.userId);
  const stamp = data.exportedAt.slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="fandex-export-${stamp}.json"`,
      // Personal data: never let a proxy or the browser keep a copy.
      "Cache-Control": "no-store",
    },
  });
});
