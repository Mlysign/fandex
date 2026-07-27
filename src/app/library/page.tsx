import type { Metadata } from "next";
import LibraryPageClient from "./LibraryPageClient";

// S1 (2026-07-27, fixes SM10): a client-side `document.title` effect races
// Next's own metadata sync and loses on a hard load/reload/new-tab open —
// only client-side nav ever showed the real title. A page-level `metadata`
// export is resolved server-side, so there's nothing left to race.
export const metadata: Metadata = { title: "Library" };

export default function Page() {
  return <LibraryPageClient />;
}
