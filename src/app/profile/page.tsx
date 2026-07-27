import type { Metadata } from "next";
import ProfilePageClient from "./ProfilePageClient";

// S1 (2026-07-27, fixes SM10) — see src/app/library/page.tsx for the full
// rationale: a client-effect title races Next's own metadata sync and loses
// on a hard load. Server-side metadata has nothing left to race. "You" to
// match the nav slot's label, same text usePageTitle used to set.
export const metadata: Metadata = { title: "You" };

export default function Page() {
  return <ProfilePageClient />;
}
