"use client";
import { useEffect, useState } from "react";
import type { PlatformOption } from "@/lib/platformKeys";
import { probeSession } from "@/lib/sessionProbe";

// "Which platforms and services could this account possibly care about?" — the
// same per-user survey Settings → Your platforms is built from, read by the
// Filters sheet so it can list a service that nothing currently loaded is on.
//
// Why the filter needs it (2026-08-27): the sheet used to derive its whole
// option list from the items on screen, so Discover — a feed of UPCOMING
// releases, which TMDB holds no watch providers for — showed a Games section
// and nothing else. Streaming had not been "removed"; it had never had a row to
// count. A section that silently disappears is indistinguishable from a broken
// one, so the chips are now drawn from this list and carry a 0 when nothing
// loaded matches.
//
// One request per browser, module-cached like sessionProbe: the sheet mounts
// only when it opens, and the server side is cached per (user, region, catalog
// signature) so a repeat open costs nothing either way. Anonymous visitors get
// a 401 → null, and the sheet falls back to the loaded set alone.

export interface KnownPlatforms {
  /** Every platform this account's own catalog touches, most common first. */
  options: PlatformOption[];
  /** Keys the account says it owns. Empty = not configured, never "owns nothing". */
  selected: string[];
  /** Region the streaming half was resolved for. */
  region: string | null;
}

let cache: Promise<KnownPlatforms | null> | null = null;

export function loadKnownPlatforms(): Promise<KnownPlatforms | null> {
  // Behind the shared session probe (SM6/Q1): the sheet is reachable logged
  // out, and firing an authed call doomed to 401 is what that probe exists to
  // stop. The probe is cached, so a signed-in open still costs one request.
  return (cache ??= probeSession()
    .then((signedIn) => (signedIn ? fetch("/api/settings/platforms") : null))
    .then((r) => (r?.ok ? r.json() : null))
    .then((d) =>
      d ? { options: d.options ?? [], selected: d.selected ?? [], region: d.region ?? null } : null
    )
    .catch(() => null));
}

/** Call after saving Settings → Your platforms, or the sheet keeps the old list. */
export function resetKnownPlatforms(): void {
  cache = null;
}

export function useKnownPlatforms(): KnownPlatforms | null {
  const [known, setKnown] = useState<KnownPlatforms | null>(null);
  // Fetch-on-mount: the session is not knowable to this client island.
  useEffect(() => {
    let live = true;
    void loadKnownPlatforms().then((k) => { if (live) setKnown(k); });
    return () => { live = false; };
  }, []);
  return known;
}
