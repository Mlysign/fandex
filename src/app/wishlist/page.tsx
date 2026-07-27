import type { Metadata } from "next";
import WishlistPageClient from "./WishlistPageClient";

// S1 (2026-07-27, fixes SM10) — see src/app/library/page.tsx for the full
// rationale: a client-effect title races Next's own metadata sync and loses
// on a hard load. Server-side metadata has nothing left to race.
export const metadata: Metadata = { title: "Wishlist" };

export default function Page() {
  return <WishlistPageClient />;
}
