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
