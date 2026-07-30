# Cookie / consent assessment (H4.4)

**A document, not a page.** H4.4's own scope note is "document, don't build" — this
records the assessment the app already relies on; it is not itself a UI surface, and it
is not legal advice.

**Conclusion: no cookie-consent banner is required today.** Every cookie this app sets is
strictly necessary for a service the visitor explicitly requested, which is exempt from
consent under **§25 Abs. 2 Nr. 2 TDDDG** (Germany's implementation of the ePrivacy
directive's "strictly necessary" carve-out). A privacy-policy notice describing them
(see `/legal/{en,de}/privacy`) is sufficient; no Accept/Reject banner is needed.

## Every cookie the app sets

Found by grepping every `.cookies.set(` / cookie-name constant in `src/` — this list is
exhaustive as of 2026-07-30, not a sample.

| Cookie | Set in | Purpose | Lifetime | Why strictly necessary |
|---|---|---|---|---|
| `rr2_session` | `src/lib/session.ts:87` (`setSessionCookie`), written from `src/app/api/auth/{disconnect,rawg}/route.ts`, `src/app/api/auth/{steam,tmdb}/callback/route.ts`, `src/app/api/dev/login/route.ts`, `src/lib/oauthConnect.ts:109` | Identifies the logged-in session so the app can show your library, wishlist and ratings instead of the anonymous view. `httpOnly`, `secure` in production, `sameSite=lax`. | 30 days (`maxAge: 60*60*24*30`) | Without it there is no way to keep a visitor signed in between requests — the entire point of the cookie is the feature the visitor asked for by signing in. |
| `rr2_oauth_state` | `src/lib/oauthState.ts:32` (`setOAuthStateCookie`) | CSRF nonce for the OAuth connect/link flow: the value is echoed back by the provider and compared on callback (`verifyOAuthState`, same file) to prove the redirect was started by this browser, not forged by an attacker linking their account to a victim's session. `httpOnly`, `secure` in production, `sameSite=lax`. | 10 minutes (`STATE_MAX_AGE = 600`), single-use — cleared on every callback exit via `clearOAuthState` | This is a security control, not a preference or tracking cookie. It cannot be replaced with a non-cookie mechanism without losing the CSRF protection, and it lives only as long as the login/connect flow it protects. |
| `rr2_oauth_return` | `src/lib/oauthState.ts:83` (`setOAuthReturnCookie`) | Remembers which page to return to after login so a "sign in to rate this" click lands back on the same item instead of the default page (H2c login-with-intent's server-side half). Value is validated both when set and when read (`isSafeReturnPath`) against open-redirect. `httpOnly`, `secure` in production, `sameSite=lax`. | 10 minutes, single-use — cleared on every callback exit via `clearOAuthReturn` | Same category as the state cookie: scoped entirely to completing the login flow the visitor just initiated, gone within minutes either way. |

**Not a cookie, included for completeness:** the login-with-intent *action* (what you
were trying to do — rate, wishlist) is stashed in `localStorage`
(`src/lib/pendingIntent.ts`), not a cookie. It never leaves the browser and is not sent to
the server, so it isn't in scope for a cookie assessment at all, but it's worth naming
since it's part of the same login-with-intent feature as `rr2_oauth_return` above and a
privacy-policy reader would reasonably ask about it in the same breath.

## What's explicitly NOT present

No analytics script, no advertising script, no third-party tracking pixel, and no
cross-site cookie of any kind — every cookie above is `sameSite=lax` and first-party. This
matches the "very favorable starting position" already noted in `TASKS.md`'s H4 recon:
identity-less users, no email/real name stored, zero analytics.

## The standing guard

**Any analytics script, affiliate-click tracking, or ad script added later triggers the
consent-banner requirement** — the moment a non-essential cookie is set, the §25 TDDDG
exemption this assessment relies on no longer covers it, and an equal-prominence
Accept/Reject banner becomes mandatory before that cookie can be set.

The specific task this applies to first: **H3.4 (affiliate implementation)** — some
affiliate programs set click-attribution cookies, and per H3's own scoping notes this must
be checked against this exemption before H3.4 ships, not after. If H3.4's chosen affiliate
programs turn out to be cookie-free (a straight outbound link with no tracking redirect),
this assessment continues to hold without change; if any of them sets a cookie, this
document must be revisited and H4.4's real banner-build task un-parked.

---
_Last verified against the codebase: 2026-07-30. Re-verify whenever a new server route adds
`.cookies.set(...)` or the client gains a new `document.cookie` write — grep for both before
assuming this table is still exhaustive._
