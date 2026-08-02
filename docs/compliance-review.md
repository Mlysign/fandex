# Compliance review (H4.10)

**A document, not a page** — same convention as `cookie-assessment.md` (H4.4). This is the
closeout pass H4.10 calls for: verify the legal footer's reachability claim on every route,
cross-check every legal doc's factual claims against what the code actually does, and check
the current state against the three statutes H4 targets. It is not legal advice.

**Fix authority exercised on this pass:** correct only a *checkable* fact a legal doc gets
wrong, cited to `file:line`. Nothing found here needed that — every doc-vs-code check below
passed. The one real finding is architectural, not textual (see §1), and is logged rather
than fixed, since fixing it is a nav/UX decision outside a docs-review task's authority.

**Verified against the codebase: 2026-08-02.**

---

## 1. Two-click reachability — the finding

H4.1 (2026-07-30) put `LegalFooter` at the bottom of `/profile` only, on this stated
rationale: *"the BGH two-click rule needs `/profile` reachable from everywhere, which H1's
nav already guarantees — a global footer is convention, not a legal requirement."*
(`docs/archive/history.md`, H4.1 entry; the same claim is repeated in `TASKS.md`'s live H4.1
line.)

**That rationale is checkably wrong for anonymous visitors.** Tracing the actual chain:

- `AppNav` renders unconditionally on every route — it's mounted once in the root layout
  (`src/app/layout.tsx:84`), and that is the **only** `layout.tsx` in the whole app
  (`find src/app -name layout.tsx` returns exactly one file). So "does the nav render" is
  never the failure mode; every route passes that half.
- But the nav's "You" slot is **not a link to `/profile` for an anonymous visitor.** Its
  behaviour branches on session state (`src/components/AppNav.tsx:103`,
  `const youAsButton = authed === false;`): when `youAsButton` is true, "You" renders as a
  `<button onClick={() => setShowSignIn(true)}>` (lines 133–141 desktop, 165–166 mobile) —
  it opens `SignInDialog`, it does not navigate anywhere.
- And even a visitor who types `/profile` directly (bypassing the nav entirely) never sees
  the footer: `ProfilePageClient.tsx:66` does `if (!meRes.user) { router.replace("/"); return; }`
  before any of the page's JSX — including `<LegalFooter />` at line 245 — ever renders.

**Net effect: there is no click path, and no direct-URL path, by which an anonymous visitor
can reach any `/legal/*` document through the app's UI.** Only a signed-in visitor gets the
2-click chain (nav → "You" → `/profile` → footer link) H4.1's decision describes. This
matters because §5 DDG's two-click rule is specifically about reachability for **any**
visitor, not just authenticated ones — an anonymous visitor is exactly who needs to find the
Impressum.

**Currently low-stakes, not urgent:** the Impressum itself is still the deliberate "in
preparation" placeholder pending H4.0 (`src/lib/legal/content/en/imprint.ts:3-9`), and it's
`noindex`ed + excluded from `sitemap.ts` on purpose. So nothing is live yet that this gap
actually blocks. But it means **H4.1's own written justification will stop being true the
day H4.2 ships real Impressum content**, unless the nav or the anon `/profile` gate changes
first.

**Not fixed here — this needs a product decision, not a doc correction:**
- Make anonymous "You" clicks navigate to `/profile` (which would then need to render
  *something* for anon — currently the whole page is gated behind the redirect, so this
  isn't a one-line change), or
- Give anonymous visitors a different, always-reachable path to the footer (e.g. render
  `LegalFooter` somewhere that doesn't require a session), or
- Accept the gap until H4.2 and revisit then.

Logged as a finding, not touched: this is squarely a nav/UX decision (touching
`AppNav.tsx` and/or `ProfilePageClient.tsx`'s anon gate), outside an unattended docs-review
pass's fix authority.

### Reachability table

Since `AppNav` is global and unconditional, the pass/fail split is uniform by auth state
rather than by route — every route below behaves identically. Enumerated via
`find src/app -name page.tsx` (17 routes); two are pure server-side redirects with no
rendered content a visitor could click through from, so they're noted but not scored.

| Route | AppNav renders | Logged-in: `/profile` in ≤2 clicks | Anon: `/profile` in ≤2 clicks |
|---|---|---|---|
| `/` | ✅ | ✅ (You → /profile) | ❌ (You opens sign-in dialog) |
| `/discover` | ✅ | ✅ | ❌ |
| `/calendar` | ✅ | ✅ | ❌ |
| `/library` | ✅ | ✅ | ❌ |
| `/wishlist` | ✅ | ✅ | ❌ |
| `/profile` | ✅ | ✅ (already there) | ❌ (redirects to `/` before render) |
| `/settings` | ✅ | ✅ | ❌ |
| `/insights` | ✅ | ✅ | ❌ |
| `/item` | ✅ | ✅ | ❌ |
| `/item/debug` | ✅ (unlinked dev tool, no auth gate) | ✅ | ❌ |
| `/dev/scoring` | ✅ (404s for non-admin via `notFound()`, `page.tsx:10`) | ✅ (admin only) | n/a — 404 |
| `/legal/[locale]/[doc]` | ✅ | ✅ | ❌ |
| `/[type]/[id]/[slug]` (item detail) | ✅ | ✅ | ❌ |
| `/person/[slug]` | ✅ | ✅ | ❌ |
| `/tag/[slug]` | ✅ | ✅ | ❌ |
| `/studio/[slug]` | ✅ | ✅ | ❌ |
| `/dashboard` | n/a — `permanentRedirect("/wishlist")` before any render (`page.tsx:8`), never shows the nav | | |
| `/insights/facet` | n/a — `permanentRedirect`/`redirect` before any render (`page.tsx:21,23`) | | |

**Verdict: holds for every logged-in route, fails for every anonymous route.** This is the
one finding from this section — see above, logged rather than fixed.

---

## 2. Docs vs. code — five cross-checks

All five pass. No corrections needed to any legal doc.

### 2.1 Privacy policy's data inventory vs. the live schema

`userScopedTables()` (`src/lib/account.ts:28-39`) is the authoritative definition of
"personal data table" this codebase already uses for GDPR erasure — any table with a
`user_id` column, found by reading `sqlite_master` directly rather than a hardcoded list.
Ran the same query against `data/rr.db`:

| Table (has `user_id`) | Named in privacy policy's "What Fandex stores about you"? |
|---|---|
| `user_identities` | ✅ "Connected providers" |
| `user_library` | ✅ "Your library" |
| `user_watchlist` | ✅ "Your wishlist" |
| `user_item_state` | ✅ "Per-provider item state" |
| `sync_log` | ✅ "Sync history" |

All 5 match a described category (`src/lib/legal/content/en/privacy.ts:23-33`); nothing in
the schema is undisclosed, and nothing disclosed is absent from the schema. **Pass.**

### 2.2 Cookie count vs. `docs/cookie-assessment.md`'s "exactly three"

Re-grepped every `.cookies.set(` call in `src/` from scratch (not trusting the existing
assessment's own list): `src/lib/session.ts:89` (`rr2_session`), `src/lib/oauthState.ts:34`
(`rr2_oauth_state`), `src/lib/oauthState.ts:83` (`rr2_oauth_return`) — three call sites,
three distinct names, matching the assessment exactly. Max-ages checked against the actual
constants: `session.ts:94` → `60*60*24*30` = 2,592,000s = 30 days (matches "30 days" in both
the assessment and the privacy policy); `oauthState.ts`'s `STATE_MAX_AGE = 600` = 10 minutes,
used by both the state and return cookies (matches "10 minutes" in both docs). **Pass.**

### 2.3 Privacy policy's provider recipients section vs. each adapter's real push/pull functions

Read `src/lib/sources/adapters/{tmdb,trakt,rawg,steam}.ts` directly rather than trusting the
doc:

| Provider | Doc claims | Code (adapter file) |
|---|---|---|
| TMDB | bidirectional (metadata always; ratings/watchlist synced if connected) | `pullLibrary` (line 69) + `pushRating` (line 85) — both present |
| Trakt | bidirectional | `pullLibrary` (line 143) + `pushRating` (line 85) — both present |
| RAWG | bidirectional | `pullLibrary` (line 57) + `pushRating` (line 70) — both present |
| Steam | read-only, "does not support writing... back" | only `pullLibrary` (line 53); adapter's own header comment: *"read-only: Steam exposes no write API"* — no push function exists at all |
| IGDB | "metadata only, via an app-level API key" | no file under `src/lib/sources/adapters/` at all — confirmed there is no user-library sync adapter for IGDB, only the metadata client in `src/lib/metadata/providers/igdb.ts` |

Every claim matches the code exactly. **Pass.**

### 2.4 Litestream 24h retention figure vs. the actually-shipped config

`Dockerfile:74` pins `litestream-v0.3.13-linux-amd64.deb` — exact version match to what H4.3
cites. `litestream.yml` (the file the Dockerfile copies to `/etc/litestream.yml`,
`Dockerfile:76`) sets `dbs[].replicas[].{type,bucket,path,endpoint,region,access-key-id,
secret-access-key,force-path-style}` and nothing else — no `retention` key anywhere in the
file, confirming the doc's premise that v0.3.13's unset-retention default is what actually
applies in prod. (Verifying that v0.3.13's own docs say that default is 24h is an
external-source check already done when H4.3 shipped, not re-litigated here — this check
only confirms the in-repo half: the pinned version and the absence of an override.) **Pass.**

### 2.5 Terms of Service's factual claims vs. the auth code

- *"You don't create a Fandex-specific password... Fandex has no separate credential to
  protect on its side."* — checked against `src/app/api/auth/*`. Three providers
  (Trakt/TMDB/Steam) are OAuth — Fandex never sees a password. RAWG is the one exception:
  `src/app/api/auth/rawg/route.ts:20` does accept `{ email, password }` and passes it to
  `rawgLogin()` — but that's RAWG's own account password being used to obtain a RAWG
  session token, not a Fandex-issued credential, and the code confirms it isn't kept:
  `route.ts:34-36`, *"the password is NOT stored — only the RAWG session token is kept."*
  The ToS claim is technically accurate (no *Fandex* password exists), but **doesn't
  distinguish RAWG's transit-a-password flow from the other three providers' pure-OAuth
  flow** — a user connecting RAWG does type their password into a Fandex-hosted form, which
  is a materially different privacy posture than "connect" implies for Trakt/TMDB/Steam.
  Not a factual error in the ToS as written, but a **disclosure gap worth flagging** — logged
  below rather than added silently, since it's new legal content, not a correction.
- *"There is no payment feature today."* — grepped `src/` (excluding legal content and
  tests) for `stripe|paddle|lemonsqueezy|payment.*process|checkout`, case-insensitive: zero
  matches. **Pass.**
- *"You sign in by connecting a provider account (Trakt, Steam, TMDB or RAWG)"* — matches
  the four routes with a real, UI-reachable connect flow. `letterboxd` has a route directory
  but no key configured (per the standing `letterboxd-hidden` memory / `provider-config-gaps`
  note) and its connect option is hidden from the UI, so correctly omitted from the ToS's
  user-facing list. **Pass.**

---

## 3. Statutory checklist

### §5 DDG (Impressum)
Deliberately not published — `src/lib/legal/content/{en,de}/imprint.ts` is an explicit
"in preparation" placeholder, `noindex`ed (`page.tsx:39`) and excluded from `sitemap.ts`
(`sitemap.ts:29-32`), gated on H4.0's advice on the address requirement. Correctly scoped:
nothing here claims to be a final Impressum. **The only thing this pass adds:** once H4.2
ships real content, §1's reachability gap becomes live-consequential, not just theoretical.

### GDPR
- **Art. 13 (information to controller processing)** — `privacy.ts` covers identity,
  purpose, categories, recipients, retention, rights; two facts remain honestly marked
  `TODO(H4.3)` (transfer basis per US provider, supervisory authority) pending H4.0. Not
  filled in this pass — the plan's own decision keeps those TODOs untouched until H4.0.
- **Art. 15 (access) / Art. 20 (portability)** — `GET /api/account/export`, described
  accurately in `privacy.ts:80` ("download a JSON file of everything the app holds about
  you"). Matches H4.7's shipped behavior (explicit column lists, no `SELECT *`, credential
  fields scrubbed).
- **Art. 17 (erasure)** — `DELETE /api/account` via `deleteAccount()`
  (`src/lib/account.ts:74-120`), described accurately in `privacy.ts:81` ("erases every
  table holding anything about you... irreversible"). §2.1 above independently confirms the
  same `userScopedTables()` function backs both the doc's inventory claim and the actual
  deletion — they can't drift apart from each other by construction.

### §25 TDDDG (cookie consent exemption)
Re-confirmed exhaustive at exactly 3 cookies (§2.2), all strictly-necessary, matching
`cookie-assessment.md`'s conclusion that no banner is required today. The standing guard
naming **H3.4 (affiliate implementation)** as the task most likely to trip this exemption is
still accurate and still unstarted — nothing in this batch touches it. (See
`docs/monetization-legal.md`, written this same session, for the H3.4-specific cookie
question in more depth.)

---

## Findings logged (not fixed here)

1. **Anonymous visitors cannot reach any `/legal/*` page through the app's UI** — see §1.
   Needs a product decision (change the nav, change the anon `/profile` gate, or accept
   until H4.2). Logged in `TASKS.md` under this batch's id.
2. **The ToS's "connect a provider account" language doesn't distinguish RAWG's
   password-transit flow from the other three providers' pure OAuth** — see §2.5. Not
   inaccurate, but a disclosure gap; whether to add a sentence is a legal-content judgment
   call, not a correction, so it's logged rather than written.

## Housekeeping found in passing

`src/app/api/auth/{trakt` was a stray, empty, git-untracked directory tree
(`{trakt/callback,steam/callback,logout,me}` — literal shell brace-expansion debris from
some earlier `mkdir -p src/app/api/auth/{trakt,steam}/...`-style command that didn't expand
as intended). Confirmed empty of any files and absent from `git ls-files` before removing —
zero risk, not part of the app. Removed.

---
_Last verified against the codebase: 2026-08-02. Re-run the five checks in §2 whenever the
schema, cookie set, provider adapters, Litestream config, or ToS/auth code changes._
