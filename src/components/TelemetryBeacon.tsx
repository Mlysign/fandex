"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Fires one pageview beacon per route change. Renders nothing.
//
// ── usePathname, deliberately, and NOT useSearchParams ──────────────────────
//
// `useSearchParams()` postpones its Suspense boundary and the `next dev` client
// never resumes it. That is the whole cause of /library and /wishlist being dead
// under the dev server (STATUS.md). This component mounts in the ROOT LAYOUT, so
// the same mistake here would take the entire app down in dev rather than two
// pages. `usePathname()` needs no boundary. Query strings are not part of a path
// key anyway (normalizePathKey strips them), so there is nothing to gain by
// reading them.
//
// ── The referrer subtlety ───────────────────────────────────────────────────
//
// `document.referrer` does NOT update on a client-side navigation: it keeps the
// value from the initial document load for the life of the tab. Sending it on
// every beacon would therefore re-report the original acquisition source once per
// in-app click and turn one Google visit into a session's worth of "search"
// referrals. Only the first beacon of a page session carries it; the rest report
// our own origin, which classifies as "internal".
export default function TelemetryBeacon() {
  const pathname = usePathname();
  const lastSent = useRef<string | null>(null);
  const isFirst = useRef(true);

  useEffect(() => {
    if (!pathname) return;
    // The admin surface is not traffic. The server drops it too; this just saves
    // the round trip while looking at the dashboard.
    if (pathname === "/dev" || pathname.startsWith("/dev/")) return;
    // React StrictMode double-invokes effects in dev, and a repeated pathname
    // means a re-render rather than a navigation. Either would double-count.
    if (lastSent.current === pathname) return;
    lastSent.current = pathname;

    const ref = isFirst.current ? document.referrer || "" : window.location.origin;
    isFirst.current = false;

    // keepalive so a beacon fired as the user navigates away still goes out.
    // Errors are swallowed whole: telemetry must never surface to a visitor, and
    // an offline or blocked request is an expected state, not a fault.
    void fetch("/api/telemetry/pv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname, ref }),
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);

  return null;
}
