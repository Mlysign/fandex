// The throwaway account a smoke test is allowed to wreck (2026-09-03).
//
// Nils: "can you create a new user account for you to use when running
// smoketests? this would allow you to really mess with the library and find more
// bugs like the rate game no longer working."
//
// He is right about the cause. Every logged-in check until now ran through
// `DEV_LOGIN_USER_ID`, which points at HIS account, so any test that wrote
// something had to be undone by hand afterwards — and a rating on a movie is a
// real write-back to Trakt and TMDB before it is undone. That made destructive
// testing expensive enough to avoid, which is exactly why "you can no longer
// rate games" survived a whole session of verification: nobody rated a game.
//
// ── Why a plain constant and not an env var ─────────────────────────────────
//
// An env var would need writing into `.env`, and appending to that file is how a
// secret got concatenated onto DISCORD_CLIENT_SECRET and had to be rotated. A
// fixed id costs nothing: the account only exists if `scripts/smoketest-account.mjs`
// created it, and `/api/dev/login` still refuses to mint a session for it in
// production or off loopback.
//
// ⚠️ LEAF MODULE. It is imported by a route AND by a standalone script under
// plain node, so it must import nothing. See the `import type` rule in AGENTS.md.

/** The users.id row a smoke test signs in as. */
export const SMOKETEST_USER_ID = "smoketest";

/**
 * The identity provider the account carries.
 *
 * `google` because it is IDENTITY-ONLY (syncClient's IDENTITY_ONLY_PROVIDERS):
 * it can mint a session and holds no library, so `staleProviders()` never reads
 * it as overdue and no doomed POST /api/sync fires on every /library load. A
 * `steam` or `trakt` identity with a fake token would do exactly that, and a
 * smoke test would then be testing a sync failure it created itself.
 */
export const SMOKETEST_PROVIDER = "google";

/** Shown wherever a display name is. Deliberately obvious in a screenshot. */
export const SMOKETEST_DISPLAY_NAME = "Smoke Test";
