import type { Metadata } from "next";
import DiscoverPageClient from "./DiscoverPageClient";

// S1 (2026-07-27, fixes SM10) — see src/app/library/page.tsx for the full
// rationale: a client-effect title races Next's own metadata sync and loses
// on a hard load. SM26 (2026-07-28): this page was a "use client" file until
// now, so it had no metadata export at all and fell back to the root title
// ("Fandex — your index of every game, movie & show") on every hard load —
// split out exactly like Library/Calendar/Settings already were.
export const metadata: Metadata = { title: "Discover" };

export default function Page() {
  return <DiscoverPageClient />;
}
