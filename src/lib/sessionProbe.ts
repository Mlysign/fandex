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
// The cache holds the PAYLOAD, not just the boolean, so a caller that needs a
// field off the signed-in user (their platforms, their region) reuses this one
// request instead of firing a second /api/auth/me. Callers that only want
// "signed in?" keep the old boolean API.
export interface SessionUser {
  userId?: string;
  displayName?: string;
  provider?: string;
  country?: string | null;
  /** Platform/service keys this account says it owns. Empty = not narrowed. */
  platforms?: string[] | null;
}

let probe: Promise<SessionUser | null> | null = null;

function load(): Promise<SessionUser | null> {
  return (probe ??= fetch("/api/auth/me")
    .then((r) => r.json())
    .then((d) => (d.user ?? null) as SessionUser | null)
    .catch(() => null));
}

export function probeSession(): Promise<boolean> {
  return load().then(Boolean);
}

/** The signed-in user's own row, or null. Shares probeSession's cached request. */
export function sessionUser(): Promise<SessionUser | null> {
  return load();
}

export function resetSessionProbe(): void {
  probe = null;
}
