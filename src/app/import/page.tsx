import type { Metadata } from "next";
import { getSession } from "@/lib/session";
import ImportPageClient from "./ImportPageClient";

// PL4 — the import surface. Design → docs/letterboxd-import.md.
//
// ⚠️ Reachable while LOGGED OUT, deliberately. Nils approved importing before
// signup (2026-08-23): drop the archive, see the films matched, then make an
// account to keep them. So this page must NOT bounce an anonymous visitor the
// way /profile and /settings do. It is also the one gate in the app that has a
// reason to greet a stranger, since the whole point is reaching people who are
// on Letterboxd and not yet here.
//
// The session is read only to decide which CTA to show. Nothing on the anonymous
// path writes, and /api/import/analyze passes a real null session through rather
// than inventing a placeholder id (PR15's write gate).

export const metadata: Metadata = {
  title: "Import your films",
  description: "Bring your ratings and watchlist from Letterboxd or IMDb into Fandex.",
};

export default async function Page() {
  const session = await getSession().catch(() => null);
  return <ImportPageClient signedIn={!!session} />;
}
