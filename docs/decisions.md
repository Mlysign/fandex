# Fandex: settled decisions

**Every line here is closed. Do not re-open one without Nils saying so.**

This file exists because `TASKS.md` kept filling up with things that were not tasks.
A decision is not open work, and a standing constraint is not a task either — but both
need to be somewhere a session will actually read before acting.

- **Open work** → [TASKS.md](../TASKS.md)
- **One-page state** → [STATUS.md](../STATUS.md)
- **How things were built, and why** → [docs/archive/history.md](archive/history.md) (grep it)
- **Rules you must not break while coding** → [AGENTS.md](../AGENTS.md)

⚠️ **A decision recorded here is the ANSWER, not the argument.** If you want the reasoning,
the commit and the archive have it. Re-litigating one of these in a new session is the exact
waste this file was created to stop.

---

## Standing constraints

Not tasks. Not decisions to be revisited. Things that must stay true.

- **Ko-fi: no tiers, no perks, no memberships.** A donation with consideration is a taxable
  supply *and* a much stronger "commercial use" reading against TMDB's non-commercial-only
  free tier.
- **The support page never quotes a running-cost figure.** Permanently, not "until we have
  one". The qualitative line stays; no number ever joins it.
- **Do NOT contact TMDB or Trakt about commercial terms** while monetizing on their free
  tiers. The accepted risk is key revocation, and asking invites it. ⚠️ This does not cover
  IGDB (see below).
- **Do NOT apply to the Amazon affiliate programme.** Its 180-day / 3-sale clock starts at
  signup, and the self-referral shortcut closes the account rather than being a loophole.
- **Watch that prod stays up.** Continuous since 2026-08-12; both prior outages were
  un-routings, never crashes.

---

## H3 monetization: the economics, settled 2026-08-19

**The plan is ads-first**: go live → wait for traction → ads → premium (ad-free + extras).
Affiliate is **demoted, not cancelled**; the code stays built and dark behind
`MONETIZATION_ENABLED`. Moved here from TASKS.md on 2026-09-03: it is a decision record with
no next action, and that file is for open work. Runbook →
[monetization-go-live.md](monetization-go-live.md).

The three findings that decided it, so nobody re-derives them:

- **Per 1,000 monthly actives: ads ~€150, premium ~€60, donations ~€14, affiliate ~€3.**
  Affiliate is last by 20 to 50 times.
- **Fandex is past-tense.** People log what they already played or watched, so a buy link on
  an item already in a library arrives after the purchase decision. Only the **wishlist** and
  the **calendar** are pre-purchase surfaces.
- **Affiliate is the only method that cannot clear its own cliff.** Covering upkeep once
  TMDB’s $149/mo commercial tier applies needs ~1,000 users on ads, ~2,300 on premium, and
  **~45,000 on affiliate**.

**The economics pivot on TMDB, not on hosting.** Upkeep is small (Railway Hobby $5/mo +
usage, domain ~€10/yr, all APIs currently €0), but TMDB’s free API is **non-commercial only**
and commercial use is **$149/mo**, so “commercial” multiplies upkeep ~10× overnight. Trakt
requires case-by-case approval for monetizing apps. ⚠️ **RAWG no longer figures in this** — it
was retired 2026-09-02, so the old “$298/mo commercial minimum” is TMDB alone. **Donations are
the gray zone**: TMDB does not say whether donation-funded counts as commercial.

**Consciously accepted risk:** Fandex monetizes on the free TMDB/Trakt tiers. The failure
mode is **API-key revocation without notice**, not a fine.

**The two gates, approved 2026-08-17 and instrumented 2026-08-19** (`/dev/analytics` measures
both directly):

- **Ads → 10,000 pageviews/mo** (Monumetric’s stated minimum). A better-RPM tier exists at
  50k+ pv (Freestar/Mediavine, $15–40+ vs Monumetric’s $10–20). Not a second gate, just worth
  re-checking which network fits.
- **Freemium → 3,500 sustained weekly actives.** The old “roughly 1k+” napkin figure never
  netted out TMDB’s $149/mo licence. Actives needed to clear **just** the licence (≈€137, no
  margin): 2%/1€ → 6,850 · 2%/2€ → 3,425 · 5%/1€ → 2,740 · 5%/2€ → 1,370. Even the best-case
  corner is above 1k. 3,500 clears it with real margin at a conservative 3%/1.50€.

⚠️ **The WAU meter is `users.last_seen_at`**, stamped in `getSession()` once per user per UTC
day. The action-based union over `user_library`/`user_watchlist`/`user_item_state` stays as the
conservative cross-check; it counts only users who took a WRITE action, so a pure browser is
captured by nothing in this schema. Both live in `src/lib/telemetry.ts` (`userMetrics`) and
`src/lib/userAnalytics.ts` — read them there rather than from a copy. → [[telemetry-self-hosted]]

---

## Locked 2026-08-17

Nils answered the whole open-decision list in one pass. One was later superseded by him and
is struck through rather than deleted, so the reversal stays visible.

1. **Impressum: APPROVED as-is.** H4.2 closes, and all of H3 is unblocked.
2. **~~Affiliate signups: GO, starting with GOG.~~ SUPERSEDED 2026-08-19 by Nils**: the plan
   is ads-first and affiliate is demoted. (GOG itself was then dropped outright, below.)
3. **H3.0 is CLOSED as WON'T DO**, permanently. See the support-page constraint above.
4. **Fandex Score range: RELABEL, not re-tune.** 0–100 is a target, not a rule. His
   reasoning, worth keeping: *exceeding 100 is rare and makes an item stand out, which
   promotes the score rather than making it unbelievable.* No re-tune, no top-N change, `ip`
   stays at 3. ⚠️ Not violated by the 2026-08-22 selection fix, which changed no top-N count
   and refitted no gain.
5. **H3.8 thresholds: APPROVED.** Ads at **10,000 pageviews/mo**, freemium at **3,500
   sustained weekly actives**. These are real triggers, not placeholders.
6. **`PRUNE_ON_BOOT` stays ON.** The guard has held in prod three times.
7. **`priorStrength` / role-weight re-tune: NOT needed.** Current tuning approved as good.
8. **Android TWA: needs more detail before he acts** — since answered; see P15/P16 in
   `TASKS.md`, which is still genuinely open on the account upgrade.

---

## Decided 2026-09-02

Answered in one rapid-fire pass.

- **Catalog future windows: WIDEN THE BACKFILL QUERY.** Drop `region` and
  `with_release_type` from the backfill's fetch only, never from browse. Rejected: lowering
  `CATALOG_BROWSE_MIN` (a 25-title local section runs out under the reader) and leaving it
  (converges for `past` on its own but never for `future`, which is the direction the initial
  feed uses). ✅ Shipped.
- **Search: exact title match ranks FIRST.** ⚠️ Accepted trade, stated when asked: it
  overrides all four sort controls for that row. ✅ Shipped.
- **SM53 filter bar: COLLAPSE, do not shrink.** Three groups (type filters, list filters,
  view toggle), each one chip that expands on tap. ⚠️ **"shrinking the type filter must apply
  to all pages, not just calendar. consitency is key."** ✅ Shipped: 175px → 65px.
- **RAWG: RETIRED as a data provider.** It had answered 401 since 2026-08-20 and still did on
  2026-09-02. ⚠️ Games are now single-sourced on IGDB, which is the provider with the
  unresolved licence and a kill switch. ⚠️ 16 games are RAWG-only and all 16 are in the
  user's library, so the stored links stay and there is no purge script. ✅ Shipped.
- **GOG affiliate: DROPPED PERMANENTLY.** Not "later", not "if ads stall". ~€3 per 1,000
  monthly actives, and the free click meter was its only remaining argument.
- **IGDB licence email: HOLD OFF.** Nothing is blocked, the kill switch is proven, and asking
  invites a "no" we do not have to live with. **Revisit if Fandex monetizes**, which is when
  the calculus changes. ⚠️ The "do not contact TMDB or Trakt" constraint does not cover IGDB.
- **The 0–10 rating colour and the Fandex Score ramp: one definition each, on the tokens.**
  ✅ Shipped.

---

## Earlier decisions still in force

- **2026-06-18: public website first, Android as a PWA/TWA wrapper.** Fandex ships to the
  Play Store as a thin app displaying fandex.org, not a second codebase.
- **2026-08-03: books (Hardcover + Open Library) POSTPONED as a media type**, and
  **Backloggd/Hardcover parked** — Hardcover's docs call its API "only for offline use at
  this time", which a hosted multi-user site is not.
- **2026-08-19: monetization is ADS-FIRST.** Go live → wait for traction → ads → premium.
  Affiliate demoted, code built and dark behind `MONETIZATION_ENABLED`. Per 1,000 monthly
  actives: ads ~€150, premium ~€60, donations ~€14, affiliate ~€3.
- **2026-08-23: AniList is connector-blocked** on a terms clause barring "competing
  non-complementary services… anime and manga list or tracker services". Its metadata half is
  unaffected and could ship alone.
- **2026-08-28: IGDB continues, behind a kill switch.** `IGDB_ENABLED=0` stops every call;
  `scripts/purge-igdb.mjs` removes what is stored. Default ON, because a typo must leave the
  site working.
