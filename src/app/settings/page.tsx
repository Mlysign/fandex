import type { Metadata } from "next";
import SettingsPageClient from "./SettingsPageClient";

// S1 (2026-07-27, fixes SM10) — see src/app/library/page.tsx for the full
// rationale: a client-effect title races Next's own metadata sync and loses
// on a hard load. Server-side metadata has nothing left to race.
// SM26 (2026-07-28): this used to say "Profile", contradicting the page's own
// <h1>"Settings" — a stale carry-over from before /profile and /settings were
// split into separate pages. Match the h1.
export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return <SettingsPageClient />;
}
