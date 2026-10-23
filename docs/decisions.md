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
[monetization-go-live.md](archive/old-site/monetization-go-live.md).

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

⚠️ **The WAU meter is `users.last_seen_at`**, stamped by the Worker at most once per user per
UTC day and counted in `worker/src/telemetry.ts`. A visitor who never signs in is in no user
count at all; the pageview counters are the only measure of them. → [[telemetry-self-hosted]]

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

## Decided 2026-10-04: the direction

The plan is [app-plan.md](app-plan.md). Nils took every recommendation as given.

- **Fandex becomes a native Android app AND a website on one Cloudflare backend (Workers +
  D1, free tiers); Railway goes.** Bill target: the domain only. The Next.js site is a private
  tool until the switch-over, with the public catalog OFF (`PUBLIC_CATALOG=0`,
  `BACKFILL_ENABLED=0`, `FACET_SWEEP_ENABLED=0` on Railway) so it sits at the $5 floor.
- **Stack: React Native / Expo. Kotlin only for the home-screen widget.** Reason: one
  codebase for the app and the website's personal layer, a third of today's TypeScript and its
  tests carry over, and the widget is native code in every stack anyway. ⚠️ Expo with custom
  native code means Gradle dev builds, not Expo Go.
- **The Up Next widget is a requirement, not a nice-to-have:** tick episodes watched from the
  home screen. Written in Kotlin (Glance) inside the Expo app, reading the on-device SQLite,
  posting to Trakt directly.
- **Trakt tokens live ON THE DEVICE (and in the browser), not in D1.** Each client syncs
  Trakt itself and writes the result to the user's rows. Consequence accepted: no background
  sync with the app closed; the widget covers the one case that matters.
- **Accounts stay, in D1.** Google, Trakt and Steam are three ways to prove it is you; no
  provider is the identity. Game ratings and wishlists have no provider home, which is the
  reason. Export, erasure and counters come back with them.
- **Steam: KEPT, but phase 5, not the minimal app.** The only provider that forces a browser
  page for sign-in.
- **The public web pages: ONE React component for crawlable HTML and interactive page, no
  template.** Where it renders is decided by a measurement at the start of phase 3 (free
  Worker if the heaviest item page renders well under 10 ms; else the daily Pages build by
  default, $5 Workers Paid as the upgrade). Exactly one route gets built.
- **IGDB licence email: SEND IT NOW** (reverses the 2026-09-02 hold). The Worker's design
  differs depending on the answer.
- **Step 0, whatever else happens: the Litestream replica moves to R2 and the restore drill
  re-runs BEFORE the Railway plan is touched.** The only backup lives in a Railway-provisioned
  bucket.
  - _How it was carried out, 2026-10-04:_ as a SECOND replica beside the Railway one, not a
    move (`litestream-r2.yml`), so the existing replica keeps its generation until the drill
    has passed against R2. It is inert until Nils sets the two R2 secrets. A verified snapshot
    is in R2 meanwhile. The "before the Railway plan is touched" condition still stands.

### Added 2026-10-05

- **Railway was deleted ahead of the website** (Nils), to stop the cost and to prove nothing
  depended on it. fandex.org serves nothing until phase 3 does. The Litestream step above was
  overtaken: the database left Railway as two verified snapshots, not a replica.
- **UI and feature parity with the old site is a requirement, not a later phase** (Nils: the app
  "looks vastly different and is missing features"). The list, the order and the rule for when
  a screen counts as done are in [app-parity.md](app-parity.md).
- **The public pages are a daily static build.** The measurement the bullet above called for came
  out at a median 4 ms and a worst 35 ms against the free Worker's 10 ms, so the plan's own rule
  picked the build. Workers Paid at $5 stays the upgrade.

### Added 2026-10-15

- **Trakt and Fandex are kept in sync, and the sync may write to Trakt to do it** (Nils: "always
  keep trakt and fandex accounts in sync"). First case, SM63: a title rated on Trakt while on its
  watchlist is taken off Trakt's watchlist by the next sync (`ratedButWishlisted`,
  `mobile/src/lib/traktSync.ts`). A watched, unrated title stays on it.

### Added 2026-10-17 (Nils, going through the open list)

- **Every date is the one in your country, on every screen.** Not only the calendar, Home and the
  item page: the lists too. A film's local date is what `catalog.release_date` holds on a device
  (`mobile/src/lib/localDates.ts`). A title the catalog does not hold yet shows its provider's date.
- **"More like this" is the app's own ranking now**, delegated to me: every shared facet counts,
  weighted by kind and rarity, a shared genre is required, another medium counts less, and the
  better-known title wins a tie (`rankLike` in `mobile/src/lib/related.ts`). The old site's
  `similarItems.ts` is untouched.
- **The type filter opens whenever the bar has room, from 768 px; a phone keeps it folded** (SM53
  stands for phones).
- **Discord sign-in comes back**, without a client secret (implicit grant, checked against
  `/oauth2/@me`), and the leaked secret is rotated.
- **Dropped, not to be raised again:** the IGDB licence email, pressing Import for his Letterboxd
  file, and rotating the Steam key. The widget's look "works fine for now".
- **"Recommended for you" carries the green band only.** The rail uses the badge's own threshold
  (`scoreBand`, `BAND_MARGIN` over your average); a title it would paint orange is not a
  recommendation. An empty rail is the right answer when nothing upcoming is a strong match.
- **The You tab is lighter than the site's profile page, on purpose.** No "Recently added" and
  "Coming up" lists and no Wishlist or Your ratings rows: the tabs already are those. An Import row
  instead. A parity pass must not put them back.
- **One book per language.** Open Library files a translation as a work of its own; every shelf
  answer keeps the works with an English edition (or no language given) and drops split editions
  and box sets (`isWholeBook`). The English work stands for the book. A book's series is read off
  its English editions when the search row has none.
- **Hardcover is the SECOND book source, facts only, behind `HARDCOVER_TOKEN`** (Nils: "please
  add the token yourself", 2026-10-17, which settled the yes). Its API Rules now allow a
  professional project to use facts about books, editions and series; what they forbid is used
  nowhere: no Hardcover rating, review, list or count of readers is asked for, stored or shown
  (`src/lib/sources/hardcoverPure.ts` is the guarantee), and its covers are copied into R2 and
  served from Fandex, never linked. The one aggregate touched is the sort key of the upcoming
  query (most shelved first, Hardcover's own order), and that number is neither kept nor shown.
- **A book's identity is its Open Library work; a Hardcover id is a fallback, not a second
  identity.** `GET /v1/resolve/hardcover/book/{id}` asks Open Library by the book's ISBNs first
  and, when a work comes back, resolves that and attaches the Hardcover link to it. Only a book
  Open Library has no edition of (announced and not out: "The Doors of Stone") is created under
  source `hardcover`, with its Hardcover id as the only cross id. A STUB at Open Library (no
  cover and not one rating, which is how it holds "Untitled Rothfuss 3 Of 3" under the very ISBNs
  Hardcover's placeholder editions carry) cannot claim a Hardcover book: the book would take the
  stub's title. ISBNs are not cross ids: the
  matcher holds one id per namespace per item, and two editions' ISBNs would read as two works.
  In every list, Open Library's card wins a book both know (same ISBN-13, or same title and
  author), and Hardcover's cards follow.
- **A Hardcover cover only where Open Library has none** (Nils: "covers only if the other
  provider has none", 2026-10-17). On an item, the poster priority puts Open Library ahead of
  Hardcover; in a merged list, a book both know keeps Open Library's cover and takes Hardcover's
  only when Open Library's card has no cover. The 4,000-a-day budget with the Open Library
  fallback is his too ("4000 limit is ok").
- **A Hardcover-fed book page credits Open Library and Hardcover, though neither asks for it.**
  Hardcover's docs warn that its images are user-uploaded, so the support page names
  hello@fandex.org for takedown requests, in both languages.

### Added 2026-10-18 (Nils, answering the 2026-10-17 list, and his new one)

- **The Joker films join Batman and keep their own series** (TMDB's Joker Collection is that
  series already). **The MCU films and shows join "Marvel" by ATTACH, keeping their own
  collections**: attach, never bundle, is the pattern for an umbrella franchise.
  `docs/archive/franchise-decisions-2026-10-18.sql`, undo beside it.
- **The game twins and test builds are folded** (PUBG, ABZÛ, Google Blocks; the playtests,
  betas and demos into their games, six of which were created for it). Serious Sam Fusion
  2017 (beta) stays: it is a product. THE FINALS PLAYTEST stays: IGDB's search did not find
  THE FINALS.
- **A series rail beside the franchise rail**, read from the provider's own franchise key and
  shown OLDEST first: a series is read in order, where "More from" (newest first, 2026-08-23)
  is a shelf. Both stand.
- **Recommended and Upcoming give each media type on screen an even share.** The calendar
  month itself is NOT re-balanced (2026-07-28 stands); books get a floor of five in a month
  because their reach signal cannot place them at all.
- **The type filter: one tap on a type means "only this type" from a full row.** Add and drop
  from a narrowed row, long press to hide one, the logo shows all and folds the row.
- **The weekly taxonomy sweep APPLIES its changes** (Nils: "the sweep should do all things"),
  with an undo file and a report per run, under per-kind limits, and never over a row made
  by hand. Monday 08:00 on this PC, `scripts/taxonomy-sweep/`. Review stays for the rules'
  own proposals.
- **A franchise has a page**, `/franchise/{key}`, static like the other facet pages. The old
  site's "ip is not a linkable kind" (`src/lib/facetUrl.ts`) was about that site's lint gate
  and is left as it is.

### Added 2026-10-23 (a hygiene pass Nils asked for)

- **Agent rules live in a `CLAUDE.md` per package** (`worker/`, `mobile/`, `mobile/web/`,
  `src/`, `scripts/taxonomy-sweep/`), and the root `AGENTS.md` keeps only what spans packages.
  This supersedes 2026-09-02's "keep every invariant inline": Claude Code loads a folder's
  file as soon as a file there is read, so the reader who doesn't know which subsystem they
  are in still gets its rules, which was the reason for keeping them inline. Always-loaded
  context went 61.4 to 16.6 KB with no live rule dropped.
- **The old site's docs, smoke-test plan and memory are archive, not reference.** They sit in
  `docs/archive/old-site/` and `memory/old-site/`, read only when porting that feature.

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
- **IGDB licence email: HOLD OFF.** ~~Nothing is blocked, the kill switch is proven, and asking
  invites a "no" we do not have to live with. Revisit if Fandex monetizes.~~ **Superseded
  2026-10-04: send it now** (see "Decided 2026-10-04"); the Cloudflare Worker's design depends
  on the answer. ⚠️ The "do not contact TMDB or Trakt" constraint does not cover IGDB.
- **The 0–10 rating colour and the Fandex Score ramp: one definition each, on the tokens.**
  ✅ Shipped.

---

## Earlier decisions still in force

- **2026-06-18: public website first, Android as a PWA/TWA wrapper.** Fandex ships to the
  Play Store as a thin app displaying fandex.org, not a second codebase.
- **2026-10-17: books and board games ARE media types** (Nils), superseding the 2026-08-03
  postponement below. Books come from Open Library, board games from BoardGameGeek behind
  `BGG_TOKEN`. Neither has a two-way sync: a rating is stored as source `local`.
- **2026-08-03 (superseded 2026-10-17): books POSTPONED as a media type**, and
  **Backloggd/Hardcover parked** — Hardcover's docs call its API "only for offline use at
  this time", which a hosted multi-user site is not.
- **2026-08-19: monetization is ADS-FIRST.** Go live → wait for traction → ads → premium.
  Affiliate demoted, code built and dark behind `MONETIZATION_ENABLED`. Per 1,000 monthly
  actives: ads ~€150, premium ~€60, donations ~€14, affiliate ~€3.
- **2026-08-23: AniList is connector-blocked** on a terms clause barring "competing
  non-complementary services… anime and manga list or tracker services". Its metadata half is
  unaffected and could ship alone.
- **2026-08-28: IGDB continues, behind a kill switch.** `IGDB_ENABLED=0` stops every call;
  removing what is stored is a separate step (the old site's `scripts/purge-igdb.mjs`, at
  the tag `old-site-final`; nothing does it on D1 yet). Default ON, because a typo must leave
  the site working.
