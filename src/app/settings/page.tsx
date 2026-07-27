import type { Metadata } from "next";
import SettingsPageClient from "./SettingsPageClient";

// S1 (2026-07-27, fixes SM10) — see src/app/library/page.tsx for the full
// rationale: a client-effect title races Next's own metadata sync and loses
// on a hard load. Server-side metadata has nothing left to race. "Profile"
// (not "Settings") — /settings doubles as the Profile sub-page, same text
// usePageTitle used to set.
export const metadata: Metadata = { title: "Profile" };

export default function Page() {
  return <SettingsPageClient />;
}
