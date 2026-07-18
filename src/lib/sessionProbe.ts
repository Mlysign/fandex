"use client";

// SM6 + Q1 — one cached "is this browser signed in?" probe, shared by every
// client island that would otherwise fire an authed API call doomed to 401 for
// anonymous viewers (NavBar, the item page's PersonalSection, the facet
// overlay, Discover's catalog search). /api/auth/me answers 200 {user:null}
// for anon, so probing never 401-spams the console/server logs.
//
// Module-level cache: each page renders several of these islands and client
// navigation remounts them, so an uncached probe would refetch on every hop.
// Anything that changes the session (login, logout) must resetSessionProbe().
let probe: Promise<boolean> | null = null;

export function probeSession(): Promise<boolean> {
  return (probe ??= fetch("/api/auth/me")
    .then((r) => r.json())
    .then((d) => Boolean(d.user))
    .catch(() => false));
}

export function resetSessionProbe(): void {
  probe = null;
}
