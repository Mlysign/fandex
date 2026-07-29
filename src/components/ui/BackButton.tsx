"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { buttonClasses } from "./Button";
import { hasPriorPageView } from "@/lib/navHistory";

// T14 (2026-07-29) — item detail + facet pages had no back affordance at all
// (SM: "the facet and details page have no back button anymore"). router.back()
// alone would be a DEAD control on a hard-loaded or shared link (no history to
// go back TO); router.push(fallbackHref) alone would ignore real in-app history
// (Discover -> item -> Back should return to Discover with scroll position
// intact, which only a real history.back() gives you). This picks whichever is
// actually safe, using navHistory.ts's session-wide page-view counter rather
// than document.referrer (stale across Next.js's client-side <Link>
// navigations) or window.history.length alone (can't tell in-app history apart
// from a different origin visited earlier in the same tab).
export default function BackButton({ fallbackHref, className = "" }: { fallbackHref: string; className?: string }) {
  const router = useRouter();
  // Read during RENDER, not an effect — see navHistory.ts for why this is
  // what makes the check ordering-independent from AppNav's own effect.
  const [canGoBack] = useState(() => hasPriorPageView());

  return (
    <button
      type="button"
      onClick={() => (canGoBack ? router.back() : router.push(fallbackHref))}
      aria-label="Back"
      className={buttonClasses("ghost", "sm", `!px-2 ${className}`)}
    >
      <ArrowLeft className="w-4 h-4" aria-hidden />
      Back
    </button>
  );
}
