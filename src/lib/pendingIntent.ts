// H2c login-with-intent — the CLIENT half. When an anonymous viewer interacts
// with the real rating / wishlist controls on an item page, the action they
// wanted is stashed here BEFORE the OAuth redirect leaves the page, then drained
// by PersonalSection when they land back on the same item after signing in.
//
// It rides localStorage, NOT a cookie or the URL: it stays entirely client-side
// (never sent to the server, never in logs), and same-origin localStorage
// survives the full-page OAuth round-trip. The matching return PATH is a separate
// concern carried server-side (oauthState's return cookie) — this module only
// answers "what did they want to do".
//
// Pure browser util: no imports, no server code, safe in a "use client" bundle.

export type IntentAction =
  | { kind: "rate"; value: number | null }
  | { kind: "watched" }
  | { kind: "wishlist" };

export interface PendingIntent {
  /** location.pathname of the item the intent belongs to. */
  path: string;
  action: IntentAction;
}

const KEY = "fandex.pendingIntent";

// Persist the intent for the current page. Best-effort: storage can throw
// (private mode, quota, disabled) — a failure just means no auto-resume, never a
// crash of the sign-in flow.
export function stashIntent(intent: PendingIntent): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(intent));
  } catch {
    /* storage unavailable → silently skip auto-resume */
  }
}

// Read-and-remove. Returns the intent ONLY when it belongs to `path`; anything
// stored for a different item (the user navigated elsewhere before finishing
// login) is discarded rather than executed on the wrong page. Always clears, so
// an intent can never fire twice.
export function takeIntent(path: string): PendingIntent | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw != null) localStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingIntent;
    if (parsed && parsed.path === path && parsed.action) return parsed;
  } catch {
    /* corrupt value → treat as absent (already removed above) */
  }
  return null;
}
