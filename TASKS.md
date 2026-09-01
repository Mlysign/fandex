# Fandex: Task Tracker

> **This file holds only what is still open.** Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it for the "why" behind a past decision; never read it end to end). One-page state → [STATUS.md](STATUS.md).

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2 to 4 sentences plus a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session.** This file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ⚠️ Needs Nils: this is the whole list

Everything else in this file is either done or a standing constraint.

1. **⚠️ The catalog backfill has FINISHED and it did not get where it was going. This needs a decision, not a wait.** (2026-09-01.) Every doc still says the only remaining action is one env var once `/api/health` → `catalog.browse.windows` reaches 200. **That will never happen.** All three `:future` lanes read `exhausted: true`, so nothing refills them, and the future window is a rolling 18 months that DRAINS as release dates pass: movie **49 → 35** and show **49 → 26** in the four days since 2026-08-28, against a `min` of 200. Game is 74, up from 29, and also retired. Catalog is 4,476 items.

   Two separate things fell out of the same reading:
   - **`game:past` is retired at page 1 with 0 added**, which is the exact incident `EMPTY_STRIKES = 3` was written to prevent, happening again. RAWG is still quota-latched, `fetchGamePageAllSources` swallows the failure and answers `[]`, and three empty pages from a DOWN provider retire a lane just as permanently as three from a finished one. The strike counter cannot tell those apart. → the comment at `src/lib/catalogBackfill.ts:96` predicts this in as many words.
   - **`resetBackfill()` exists (`catalogBackfill.ts:222`) and is wired to nothing.** No route, no script. There is currently no way to un-retire a lane on prod.

   **The decision:** "browse served from our own catalog" needs a source of UPCOMING titles that a one-shot paginated sweep cannot provide, because the target is a window that empties itself. Options, cheapest first: (a) drop `CATALOG_BROWSE_MIN` to something the windows actually reach and accept a shorter local feed; (b) expose `resetBackfill()` and re-run the future lanes on a schedule, so the window is topped up rather than filled once; (c) leave `CATALOG_BROWSE` off and keep paying the provider calls on browse. **Not chosen here** — (b) is the only one that matches the original intent, and it is also the most work.

2. **✉️ One email to `partner@igdb.com`, no longer blocking.** ✅ **Decided 2026-08-28: carry on with IGDB, behind a kill switch.** `IGDB_ENABLED=0` stops every IGDB call at once (default ON, verified no `fetch` happens when off) and `scripts/purge-igdb.mjs` removes what is stored (proven on a copy: 1,008 links and 908 projections gone, all 2,770 items and 2,482 user rows untouched, 100 items left source-less and none acted on). → [docs/catalog-growth.md](docs/catalog-growth.md). **The question is still worth asking; it is just no longer holding anything up.** (2026-08-28, → [docs/catalog-growth.md](docs/catalog-growth.md).) The provider terms were read from the primary sources before sizing the backfill. TMDB is fine — its cap is on cache AGE (six months), which a refresh tier satisfies, and `lib/retention.ts` now enforces it. Steam states no limit. **IGDB is the one that does not resolve on its own.**

   The Twitch Developer Services Agreement, which IGDB's own docs name as its licence, permits storing copies only with **prior written authorization** or a **24-hour cache**. Fandex holds 1,008 igdb links indefinitely, so on a literal reading it is *already* outside that, before any backfill. But IGDB's own API ships **webhooks whose only purpose is keeping your copy of their data current**, and its docs open on the accessibility of their data. A product built to maintain your local mirror does not square with a 24-hour cache limit.

   **What to ask:** whether maintaining a local mirror of IGDB game metadata, refreshed by their webhooks, is covered by the free non-commercial tier, or needs the commercial partnership they advertise. ⚠️ The standing "do not contact TMDB or Trakt about commercial terms" rule is about not inviting scrutiny **while monetizing on a free tier**; IGDB is not in that rule and Fandex is not monetizing yet, so the calculus differs — but sending it is still your call. **Until it is answered, be ready to flip the switch.**

3. **Android TWA (P15/P16): ⏸️ PAUSED BY NILS 2026-08-23 until the developer account is a BUSINESS account.** The app package is built and proven (sideloaded on the Pixel 8 with no address bar), and **the Play Console entry exists**: created 2026-08-23, name `Fandex`, package `org.fandex.twa`, App, Free. Nothing else on the Play side is done, deliberately.

   ⚠️ **The upgrade is not only about invoicing: the 12-testers/14-days gate applies to PERSONAL developer accounts ONLY.** Google's wording is "Google Play requires *personal* developer accounts created after November 13, 2023, to test their apps before those apps are eligible for distribution" (support.google.com/googleplay/android-developer/answer/14151465, checked 2026-08-23). InFlucx is currently a **Personal account**; an organization account is not subject to it. **So running a closed test now would very likely be throwaway work.** Do the account upgrade first, then re-check whether the gate applies at all.

   **When the account is upgraded, the remaining steps are, in order:** (a) `Test and release → App content`: privacy policy `https://fandex.org/legal/en/privacy`, Data safety, content rating, target audience; (b) upload `android-package/Fandex.aab`; (c) ⚠️ **APPEND the Play App Signing SHA-256** (`Test and release → Setup → App integrity`) to `TWA_CERT_FINGERPRINT` in Railway, comma-separated. **Google re-signs the store build**, so the fingerprint already live in `assetlinks.json` (`F7:75:02:5D:…`) is the upload key and will NOT verify the copy testers install; (d) confirm `https://fandex.org/.well-known/assetlinks.json` lists BOTH fingerprints; (e) testers, only if the gate still applies. Full walkthrough → [docs/twa-play-store.md](docs/twa-play-store.md).

4. **RAWG's monthly quota is exhausted, so the cross-link sweep cannot run.** Measured 2026-08-20: `api.rawg.io` answers `401 {"error": "The monthly API limit reached"}` in 0.17 s. **Not** the timeouts and Cloudflare 522s of the 2026-08-17 outage.

   ✅ **2026-08-28: IGDB RECOVERED and the paragraph below is history, not state.** Re-measured on prod: `api.igdb.com` 9 requests, **8 ok, 1 networkError, `lastStatus 200`**, circuit closed. So the reading below was a transient, not a standing outage, and games are arriving again. RAWG is unchanged (5 requests, 5 × 401, 277 blocked) — the known quota latch, which no longer touches the facet paths. **The RAWG half of this item stands; the IGDB half is closed.**

   ⚠️ **2026-08-27: IGDB is failing too, so the dual-source consolation below is currently FALSE and prod's browse feed has NO GAMES AT ALL.** `/api/health` after 15 min of uptime: `api.rawg.io` 5 requests / 5 clientError / `lastStatus 401` / `latchedOnAuth: true` / 21 blocked (the same quota 401 as below), and `api.igdb.com` 9 requests / **9 networkError** / 156 blocked, circuit open. `id.twitch.tv` answers 200, so the token is fine and the failures are on `api.igdb.com` itself — a timeout or an abort against `BROWSE_BUDGET_MS` counts as a network error (`http.ts:572`) and opens the breaker, which then blocks 17× more calls than it let through. Measured symptom: `GET /api/discover` on prod returns **20 movies + 20 shows, 0 games**, and `?section=games` returns `{"items":[]}`. That is also why the Filters sheet reads 0 on every chip. **Check whether IGDB is genuinely down before assuming the breaker is at fault** — and if it is a self-inflicted abort latch, that is a real bug in how browse treats a slow provider. ⚠️ **Discover no longer goes empty when this happens** (2026-08-27): an empty provider section falls back to stored catalog rows, so the symptom is now "no NEW games arriving" rather than "no games at all". That makes this less urgent and easier to miss.

   **What to do: wait for the quota to reset, then run the sweep.** Survey as of 2026-08-20: **rawg 157**, steam 113, igdb 59 of 760 games. Not urgent for the sweep itself, because the dual-source design normally covers it (see the warning above for why it is not covering it today). ⚠️ **Do not use Steam as the control**: its cursor drained on 2026-08-17, so it links 0 whether or not anything is wrong.

   ⚠️ **What SPENT the 20,000 is still unidentified, and the obvious answer (the facet crawler) is NOT proven**, because every RAWG number we hold was measured *after* the quota was gone, so it counts wasted calls rather than spent ones. **Do not pick between the candidates by reasoning**: this repo has mis-diagnosed a resource ramp twice that way. The 401/403 latch (2026-08-22) makes next month's counter measure calls we actually chose to make, and that is what will answer it. ⚠️ **It undercuts a monetization assumption either way**: `docs/monetization-go-live.md` records RAWG as "safe, free commercially to 20k req/mo", and we exhaust that at *pre-launch* traffic.

5. **Optional, not urgent: the GOG affiliate signup.** Demoted 2026-08-19 with the rest of the affiliate plan. Worth one email anyway, because GOG's dashboard is a free click meter on a site that deliberately collects no click data of its own. **Do NOT apply to Amazon**: its 180-day / 3-sale clock starts at signup, and the self-referral shortcut is a terms breach that closes the account rather than a loophole.

6. **Calendar: two things want your eyes on a real desktop browser, not a fix** (2026-08-26, `0bc9b7a` `d36952e` `1026550`). The page is now exactly one viewport tall and never scrolls, which meant **desktop day cells went from 128px to ~97px** so a six-week month fits without one; that is a visible change nobody has looked at outside the measurement. And the **rail cards' hover tooltip is unverified**: `(hover: hover)` is false in the browser pane, so neither the changed code nor a control can be exercised there. **A third joined them 2026-08-26:** does the height budget **re-fit when the window is resized**? `boxH` comes from a `ResizeObserver`, and the browser pane never delivers one, so no Claude session can test it. If it does not re-fit, the symptom is cells keeping their old height inside a shrunken `overflow-hidden` box, i.e. **weeks clipped with nothing to scroll to them**. Open `/calendar`, drag the window shorter, count the week rows. The other two are settled enough to state: desktop cells measure **95px** at 1280×900, and everything else in 13j/13ja passes at 375 and 1280, anon and authed, dev and prod. Checks are in [smoketest.md](smoketest.md) 13j/13ja/13jb.

7. **SM50's data repair still has to run against PROD.** The code fix ships with this commit and
   migration 23 applies itself on the next boot, so **no new cross-type merge can happen on prod
   from the moment it deploys**. The rows already merged there do not fix themselves.

   **✅ FULLY DONE ON PROD, 2026-09-01.** `--apply` ran: **3 repaired, 4 blobs scrubbed**, and a re-run reports **0 offenders**. Two further layers of the same damage were found and fixed in the same pass, neither of which the link repair touches. Kept here only as the record of what was wrong:

   | link | sits on (wrong) | belongs to |
   |---|---|---|
   | `tmdb:387` SpongeBob SquarePants | **Being John Malkovich** (movie) | SpongeBob SquarePants (show) |
   | `tmdb:67195` Legion | **The Raid 2** (movie) | Legion (show) |
   | `tmdb:1425` House of Cards | **Ratatouille** (movie) | House of Cards (show) |

   Each has `episodeRowsOnWrongItem: 0` and one `user_item_state` row the script deliberately leaves alone (it is the movie's own row and legitimate).

   ✅ **The two leftovers, both fixed by the new `scripts/repair-cross-type-slugs.mjs`.** Neither was reachable from the link repair, and **both were found by reading the rendered page after it reported success**, which is the reusable lesson: a data repair that reports "3 repaired" has not told you the page is right.

   1. **The slug.** All three movies wore the show's, and slugs are immutable by contract (`ensureItemSlug` assigns once, `grep -n slug` on the link repair shows it only READS the column). Now `being-john-malkovich` / `the-raid-2` / `ratatouille`; the three old urls 404, which is correct because they never named those works; the three `/show/…` urls are untouched. ⚠️ **43 of the 46 slugs shared across types are CORRECT** and must not be "fixed": slugs are unique PER TYPE, so `/game/batman` and `/movie/batman` are two right answers. Only a shared slug whose holder's title cannot produce it is damage.
   2. **An `item_ip_override`.** `/movie/being-john-malkovich` rendered a rail headed **"More from SpongeBob SquarePants"** full of Nickelodeon games. The 2026-08-14 Wikidata sweep resolved the item by its title, which was the show's at the time, and wrote a `mode: "add"` override. Removed; the rail is gone. ⚠️ **Prod holds 498 overrides and exactly ONE was wrong.** A crude title-vs-label word-overlap test flags 53, and 52 of those are correct and are the feature working (Prometheus → Alien, Andor → Star Wars, Better Call Saul → Breaking Bad, every Harry Potter → Wizarding World). **Do not turn that heuristic into a sweep.**

   ⬜ **One unrelated thing noticed while verifying, NOT caused by this and not chased:** `/movie/being-john-malkovich` renders no "More like this" rail, where `/movie/ratatouille` does and `/movie/the-raid-2` shows "More from The Raid". It was already absent before the repair (checked against the captured pre-fix HTML), and all three items have an identical link/projection shape (`imdb` pv=0, `trakt` pv=0, `tmdb` pv=3), so the stale-projection explanation is ruled out. One item, cosmetic.

   **How to run it, corrected.** ⚠️ **There is no `scripts/` directory in the runtime image** — it holds only `.next`, `data`, `docker-entrypoint.sh`, `node_modules`, `package.json`, `public`, `server.js`. The command this section used to give could never have worked. Ship the script in first, and write it to **`/app/`** (not `/tmp`) so Node resolves `better-sqlite3` from `/app/node_modules`:
   ```
   railway ssh -- sh -c "echo '<base64 of the script>' | base64 -d > /app/repair.mjs"
   railway ssh -- sh -c "node /app/repair.mjs /app/data/rr.db"            # report
   railway ssh -- sh -c "node /app/repair.mjs /app/data/rr.db --apply"    # repair
   railway ssh -- sh -c "rm -f /app/repair.mjs"
   ```
   → [[railway-cli-and-tool-sandbox]] for the CLI setup this depends on.
   It is idempotent and prints its whole plan before touching anything. On the local database it
   moved 4 links (with their episode rows and external ids) and scrubbed 4 merged payloads.
   ⚠️ **Prod's numbers may differ** — it syncs the same Trakt account, so expect the same four, but
   read the report rather than assuming. ⚠️ **Copy the `-wal` and `-shm` alongside the `.db` if you
   rehearse on a copy**; a plain `cp data/rr.db` reads an older database and invented a 9-row
   discrepancy while this was being written.
   ✅ **The restore drill PASSED 2026-09-01, and it is no longer due.** Run over `railway ssh`, so
   any future session can repeat it without Nils. Generation `c62d7dc17a0fd0cb`, replication lag
   **369 ms**, snapshot index 6512 plus **475 WAL files** replayed, restored file
   **142,024,704 bytes = byte-for-byte the size of live**, `integrity_check ok` on both, and **all
   eight tables identical**: users 1 · user_identities 5 · media_items 4,556 · media_links 8,630 ·
   media_external_ids 7,040 · user_library 1,941 · user_watchlist 97 · user_item_state 2,458.
   Scratch file and uploaded scripts removed; `/app/data/rr.db` never touched. This proves
   migrations 23–26 restore. Repeat it after the next schema change:
   ```
   railway ssh -- sh -c "litestream restore -config /etc/litestream.yml -o /tmp/restore-test.db /app/data/rr.db"
   railway ssh -- sh -c "node /app/verify-restore.mjs /tmp/restore-test.db"   # ship it in first, see below
   railway ssh -- sh -c "rm -f /tmp/restore-test.db*"
   ```

   **The half that COULD be done locally was, 2026-09-01, and both parts passed.** They are the two
   ways this has actually broken before, so a red drill is now less likely, not merely unmeasured:
   - **The schema carries nothing Litestream's older SQLite would reject.** That is the exact
     failure from August: migration 16's `ORDER BY` inside an aggregate parses on the 3.53 that
     `better-sqlite3` ships and not on the ~3.40 Litestream embeds, so replication died for two days
     while every test, the build and `/api/health` stayed green. Dumped the live schema and checked:
     **zero** aggregate-with-`ORDER BY`, no `string_agg`, no `concat()`, no `jsonb_*`, no
     `GENERATED`/`STRICT`. All four `ORDER BY`s in the schema sit in a subquery, which is the shape
     the invariant asks for.
   - **The real upgrade path applies clean.** Ran `node scripts/migrate.mjs` against a copy of the
     July backup (all three files, per the WAL rule): **user_version 6 → 26**, all 20 migrations,
     then `integrity_check ok` and 8 populated tables via `verify-restore.mjs`. Green tests never
     exercise this: every DB test starts fresh. ⚠️ The upgraded copy is missing the indexes `db.ts`
     creates at boot, which is expected — `migrate.mjs` runs migrations only, and that is the
     documented two-apply-path split, not a fault.

8. **SM53 is a design call, not a fix, and it is yours** (12th smoke test). At 375×812 the calendar's
   sticky filter bar takes **175px, 22% of the viewport**: two wrapped rows of seven 40px icon-only
   circles, plus a 38px view-toggle row, leaving the grid 486px. Nothing is broken (hit areas pass,
   `.tap-44` gives each chip a 44×44 target with no overlap) — the point is that on the one page
   whose whole design is now a fixed height budget, the chips are the biggest single claim on it.
   **Deliberately not changed**: it is a visual decision on a page already waiting for your eyes
   (item 5), and the standing rule here is no unprompted visual passes. Three ways out, cheapest
   first: (a) shrink the chips so all seven fit ONE row, ~48px back; (b) collapse them into a single
   "Filters" button with a count, ~90px back; (c) leave it, and accept the grid at 486px. Say which
   and it is a small change.

9. **Search has no relevance term at all, and whether it should is a ranking call, not a bug** (2026-08-29). Two real faults were fixed this session — the search branch never attached crowd stats, so "Popularity" silently sorted oldest-first, and the dedupe dropped any second work sharing a title, which is what actually hid the new *Lucky* → [archive](docs/archive/history.md), grep `could not find a new title`. What is left is that nothing anywhere scores a title against what was TYPED: `find()` is `title.includes(q)` and then a global sort, so an exact match on *Lucky* still ranks below *Mr. Lucky* when *Mr. Lucky* has more votes. **Deliberately not changed**, because "exact match first" overrides all four sorts on the page and that is a visible ranking decision. Say the word and it is a small change; the alternative is to leave search meaning "filter, then sort by what you picked".

**Standing constraints. Not tasks, but do not violate them:**
- **Ko-fi: no tiers, no perks, no memberships.** A donation with consideration is a taxable supply *and* a much stronger "commercial use" reading against TMDB's non-commercial-only free tier.
- **The support page never quotes a running-cost figure** (H3.0, closed as won't-do 2026-08-17). The qualitative line stays; no number ever joins it.
- **Do NOT contact TMDB or Trakt about commercial terms** while monetizing on their free tiers. The accepted risk is key revocation, and asking invites it.
- **Watch that prod stays up.** Continuous since 2026-08-12; both prior outages were un-routings, never crashes.

---

## ✅ Decisions LOCKED 2026-08-17: do not re-open these

Nils answered the full open-decision list in one pass. Treat every line as settled; a future session that re-raises one is wasting his time. **One (#2) was later superseded by Nils himself on 2026-08-19; it is struck through rather than removed, and that is the only kind of change this list takes.**

1. **Impressum: APPROVED as-is.** H4.2 closes. **All of H3 is unblocked.**
2. **~~Affiliate signups: GO, starting with GOG, now.~~ SUPERSEDED 2026-08-19 by Nils**: the plan is ads-first and affiliate is demoted. Recorded rather than deleted, so the reversal is visible. The original text, still true as of 2026-08-17: the "prod stably up for days, not hours" gate is met. Sequence unchanged: GOG → Humble → Fanatical → GMG → **Amazon LAST**. Claude does not do the signups; they carry his tax/payment identity.
3. **H3.0 is CLOSED as WON'T DO. The support page must NEVER quote a running-cost figure**, permanently, not "until we have one". The qualitative line ("Hosting, Domain und die Dienste … gehen auf eigene Rechnung") stays; no number ever joins it. Do not re-add H3.0 as an open item.
4. **Fandex Score range: RELABEL (option c).** 0–100 is a **target, not a rule**. His reasoning, worth keeping: *exceeding 100 is rare and makes an item stand out, which promotes the score rather than making it unbelievable.* So **no re-tune, no top-N change, `ip` stays at 3.** ⚠️ **Not violated by the 2026-08-22 selection fix**, which changes no top-N *count* and refits no gain: the buckets simply now rank by `dev · classWeight` (what §3.3's spec always said) instead of the raw `dev`. It does move scores where a weight is not 1, and generally widens the spread, which this decision already accepts.
7. **Android TWA (P15/P16): NEEDS MORE DETAIL** before he acts. "Bubblewrap" read as belonging to a different project. See the P15/P16 section.
8. **H3.8 thresholds: APPROVED.** Ads at **10,000 pageviews/mo**, freemium at **3,500 sustained weekly-actives**. The long-standing "defined but explicitly NOT approved" guard is **retired**; these are real triggers.
9. **`PRUNE_ON_BOOT` stays ON** (the guard has held in prod three times). **`priorStrength` / role-weight re-tune: NOT needed, current tuning approved as good.**

---

## Open: carried forward from Phase 6

### P15/P16: the Android app

**State is "Needs Nils" item 3; the click-by-click is [docs/twa-play-store.md](docs/twa-play-store.md).** A TWA is an Android app whose whole content is fandex.org rendered by the user's Chrome, so there is no second codebase; the only reason it beats a browser shortcut is that it can hide the address bar, and hiding that bar is what needs proof of domain ownership. `assetlinks.json` and the PWA manifest are already built. Only the signing key and the Play Console account are Nils's, being a credential and an identity.

⚠️ **"Bubblewrap" is two things**, which is why locked decision #7 read as cross-project contamination: it is Nils's first published game (`mobilegameportfolio`) *and* Google's TWA CLI. The doc uses PWABuilder so the word never appears. Older context → [archive](docs/archive/history.md), grep `P15/P16 Android TWA`.

---

## H3: Monetization 🔵 ads-first since 2026-08-19

**Goal:** revenue covers upkeep (Railway, domain, third-party APIs).

**⚠️ THE PLAN CHANGED 2026-08-19.** Nils's call, after a per-1,000-user revenue model: **go live → wait for traction → ads → premium (ad-free + extras)**. Affiliate is **demoted, not cancelled**; the code stays built and dark. Full reasoning → [docs/monetization-go-live.md](docs/monetization-go-live.md), the "DIRECTION CHANGED" section.

The three findings that decided it, so nobody re-derives them:
- **Per 1,000 monthly actives: ads ~€150, premium ~€60, donations ~€14, affiliate ~€3.** Affiliate is last by 20 to 50 times.
- **Fandex is past-tense.** People log what they already played or watched, so a buy link on an item already in a library arrives after the purchase decision. Only the **wishlist** and the **calendar** are pre-purchase surfaces.
- **Affiliate is the only method that cannot clear its own cliff.** Covering upkeep once TMDB's $149/mo commercial tier applies needs ~1,000 users on ads, ~2,300 on premium, and **~45,000 on affiliate**.

**The economics pivot on TMDB, not on hosting.** Upkeep is small (Railway Hobby $5/mo + usage, domain ~€10/yr, all APIs currently €0), but TMDB's free API is **non-commercial only** and commercial use is **$149/mo**. So "commercial" multiplies upkeep ~10× overnight; any paid model must clear ~$155/mo before netting a cent. Trakt requires case-by-case approval for monetizing apps. RAWG is free commercially to 20k req/mo (⚠️ which we have already exhausted; see Needs Nils item 2). **Donations are the gray zone**: TMDB doesn't say whether donation-funded counts as commercial.

**Consciously accepted risk:** Fandex monetizes on the free TMDB/Trakt tiers. Failure mode is **API-key revocation without notice**, not a fine.

**Built 2026-08-03: H3.3 ✅ donations live · H3.4 ✅ affiliate DARK behind `MONETIZATION_ENABLED` · H3.9 ✅ go-live checklist.** → grep the archive for `H3 monetization v1`. **The one thing to know before touching any of it:** the catalog's store rows are Steam/PSN/GOG/Xbox/Nintendo/Epic/itch.io and only **GOG** is affiliate-capable, so `affiliate.ts` has *two* mechanisms, a rewriter for GOG-shaped links and `buildBuyLinks()` synthesizing per-title search links. → [[monetization-h3]]

**H3.8 gates, approved 2026-08-17 and instrumented 2026-08-19** (`/dev/analytics` measures both directly):
- **Ads → 10,000 pageviews/mo** (Monumetric's stated minimum). A better-RPM tier exists at 50k+ pv (Freestar/Mediavine, $15–40+ vs Monumetric's $10–20). Not a second gate, just worth re-checking which network fits.
- **Freemium → 3,500 sustained weekly actives.** The old "roughly 1k+" napkin figure never netted out TMDB's $149/mo license. Actives needed to clear **just** the license (≈€137, no margin): 2%/1€ → 6,850 · 2%/2€ → 3,425 · 5%/1€ → 2,740 · 5%/2€ → 1,370. Even the best-case corner is above 1k. 3,500 clears it with real margin at a *conservative* 3%/1.50€.
- ⚠️ **A client beacon does NOT exclude crawlers**, whatever this line used to say: the big ones render the page and POST to it. They are filtered by user agent, and since 2026-08-31 the dashboard also skips the days before that filter shipped, so **the ads gate reads 4% and not 62%**. Both numbers were of the same two counters. Right population for an ads decision either way, wrong one for SEO (use Search Console). → [[telemetry-self-hosted]]
- **The WAU meter is `users.last_seen_at`**, stamped in `getSession()` once per user per UTC day. The action-based union over `user_library`/`user_watchlist`/`user_item_state` stays as the conservative cross-check; it counts only users who took a WRITE action, so a pure browser is captured by nothing in this schema. Both live in `src/lib/telemetry.ts` (`userMetrics`) and `src/lib/userAnalytics.ts` — read them there rather than from a copy here.

**If affiliate is ever revived:** sign up → set the env vars → flip `MONETIZATION_ENABLED` → run the post-go-live cookie check. The runbook is still accurate and still in the go-live doc; only its priority changed.

---

## Smoke test — 2026-08-26 (12th run) ✅ WORKED THROUGH 2026-08-27

**SM49, SM50, SM51 and SM52 are fixed; SM53 is a decision for Nils and lives in "Needs Nils" item 9
above.** The findings, their measured before/after and the four things they taught are in
[docs/archive/history.md](docs/archive/history.md) — grep `12th run`. The rules that outlived them
are in [AGENTS.md](AGENTS.md) and their memory files ([[cross-type-identity-merge]],
[[shared-view-two-routes]], [[anon-gates-must-ask-not-bounce]], [[unhydrated-page-diagnosis]]).
The checks are in [smoketest.md](smoketest.md) 1c-i, 13e-i and 13n-i.

## Nils's feedback, 2026-08-27 (post-smoketest) — ✅ ALL SHIPPED, closed 2026-09-01

The filter panel (Option A), Discover's pagination, the platform chips and the Settings picker all
landed 2026-08-27; the Fandex Score colour, the last one open, landed 2026-09-01 (`fcfe431`).
Panel analysis → [docs/advanced-filters.md](docs/advanced-filters.md), read it before touching the
panel. Score write-up → [the archive](docs/archive/history.md), grep `ramp was written twice`.
Settings → grep the archive for `Two per-user preferences`; rules → [AGENTS.md](AGENTS.md) and
[[user-display-preferences]]; checks → [smoketest.md](smoketest.md) 13e-iii. **The three things
that outlived the section are in "Still open elsewhere" below.**

## Still open elsewhere

- **⬜ The 0–10 user rating colour is written twice with different palettes** (`ActionCells.tsx:32`
  brand, `QuickActions.tsx:6` stock Tailwind). Left over from feedback item A, deliberately not
  bundled with the Fandex Score fix: same class of duplication, different ramp, wants its own look.

- **⬜ Desktop mockups for the filter panel**, once the mobile one has been used in anger.

- **⬜ Nothing uses the media-type setting to SPEND less.** Three places could, in value order:
  `/api/discover?q=` still fetches disabled types (the only real provider-call saving, since search
  is uncached and games are 2 of its 4 calls); `/api/library` and `/api/calendar` already take
  `?type=` and could default it from the setting, cutting a 1,942-item payload instead of filtering
  it in the browser; and the Discover fan-out could skip a disabled section. ⚠️ Only the first saves
  QUOTA — `_pageCache` keys carry no userId, so another visitor's games request in the same
  15-minute window pays anyway.

- **✅ Facet pills matched nothing on Library + Wishlist: FIXED 2026-08-28**, verified on the real
  account (0 → 5 titles). Both routes ship server-computed `facetIds`; the client derivation is
  deleted. → [the archive](docs/archive/history.md) "The facet pills that matched nothing"

- **✅ `/api/*` compression: DONE and LIVE on prod, 2026-09-01** (`a4edd5d`). `/api/library` is
  **9.77 MB → 2.23 MB, 4.39×**, and Railway's edge passes it through unchanged (`/api/discover` on
  fandex.org answers `Content-Encoding: gzip`, `Content-Length: 12901`, `Vary: Accept-Encoding`),
  which was the one thing that could only be checked after deploying. The cause was Next's, not
  ours: `send-response.js` copies a route handler's headers with `appendHeader`, which stores even a
  single value as an ARRAY, so `compression`'s `compressible(Content-Type)` filter rejects every
  JSON response in the app. `lib/compressResponse.ts` does it instead. Full write-up →
  [the archive](docs/archive/history.md), grep `gzip /api/`.

  ⚠️ **The field-trimming item below is now worth far less than it reads.** Its 4.7 MB was priced
  against an 8.63 MB raw payload; the same fields gzip down with everything else, so the saving is
  roughly a quarter of the stated figure and still carries the whole risk.

- **⬜ The list payload carries ~4.7 MB that only the DETAIL page reads.** `/api/library`, 1,943
  items: `cast` 1,183 KB · `description` 1,014 KB · `images` 966 KB · `storeLinks` 853 KB ·
  `links` 697 KB — 54%, and `MediaCardItem` names none of them. `tags` + `keywords` (552 KB) lost
  their last client reader when `itemFacetIds` went. ⚠️ **Below compression, and riskier**: the
  2026-07-30 audit kept cast/images/description deliberately, and dropping a field from a payload
  two routes and one component share is the exact shape of the bug this list keeps recording.
  Verify every consumer on BOTH routes first.

- **✅ Catalog growth: DONE, and the backfill is running** (Nils 2026-08-27, built out 2026-08-27/28, `4ab0066`…`7ef2c62`). All five phases shipped: the catalog is served from our own DB, scores and the pool no longer scale with it, TMDB's six-month cache cap is enforced, and blobs are reclaimed by size. **The runbook — the env switches, what to watch in `/api/health`, the open IGDB question — is [docs/catalog-growth.md](docs/catalog-growth.md)**; every measurement and the phase history are in [the archive](docs/archive/history.md).

  ⚠️ **"The only open action is one env var" was true until 2026-09-01 and is not any more.** All three `:future` lanes are `exhausted`, the windows are DRAINING (movie 49 → 35, show 49 → 26 in four days) and none will reach 200 by waiting. It is a decision now → **"Needs Nils" item 1**. ⚠️ Do not raise `BACKFILL_PAGES` without checking Railway spend first — the pacing is the safety feature, not a conservative default.

- **`/library` + `/wishlist` + `/settings` dead under `next dev`: DEV ONLY, and the fix is DECIDED.** ⚠️ **`/settings` joined the list 2026-08-27**, with a worse symptom: it has no loading state, so the dead tree renders the SIGNED-IN chrome with every field empty (four "Connect" buttons, "Watchlist items 0") for an account that has all four connected. That reads as data loss, not as a dead page. **Nils decided 2026-08-17: option 1, leave it.** Do not restructure `MyStuffView`. **Re-test on the next `next` bump**; a Dependabot PR is the moment. Diagnostic: `Object.keys(document.querySelector("main")).some(k => k.startsWith("__reactFiber"))` false on `<main>` but true on `body` means an unhydrated subtree, not a slow fetch. ⚠️ **Re-check first**: `/wishlist` hydrated normally under `next dev` on 2026-08-18, and `MyStuffView` changed that session, so it may be fixed or intermittent. → grep the archive for `library + wishlist dead under next dev`.

- **Facet pages link only titles we already hold** (13 of 60 on `/person/christopher-nolan`). Under-linking, not a rendering bug; they stay out of the sitemap until it is fixed. → [docs/seo.md](docs/seo.md)

- **Fandex Score `priorStrength` (C=5) + per-role class weights may want re-tuning** now the aggregate is a raw sum rather than a damped mean. **Time-gated**: revisit after a few weeks of real scores under the new formula. ⚠️ **Re-read this after 2026-08-22.** The class weights now decide WHICH facets are selected, not just how much a selected one counts, so a re-tune is a bigger lever than when this was written, and **any measurement taken before that date describes the old selection**.

- **The 2026-08-23 optimization sweep is DONE, all six items.** What is left, and why the WAL is deliberately NOT being reclaimed → [docs/optimization-plan.md](docs/optimization-plan.md) §5.

- **Platform integrations: the open questions were answered 2026-08-23.** What survives as standing context: AniList is **connector-blocked** on a terms clause barring "competing non-complementary services… anime and manga list or tracker services", while its metadata half is unaffected and could ship alone; books (Hardcover + Open Library) stay ⏸️ **postponed as a media type, 2026-08-03**. Capability reference → [PLATFORMS.md](PLATFORMS.md).
  - **Hardcover ⏸️ PARKED**, same call as Backloggd (Nils, 2026-08-03). The deciding fact was the usage terms, not OAuth: the docs call the API *"only for offline use at this time"*, reachable *"from localhost or APIs"*, with site allowlisting *"a way down the line"*. A hosted multi-user site is the case they haven't provided for. Secondary: no third-party OAuth (promised, not shipped), tokens expire on a **shared Jan 1 reset** so every user breaks the same day, no app-level credential, and the write mutations are undocumented. → grep the archive for `platform deep dives`.
  - **The media-type cost is measured** and lives in the archive under `What adding a media type actually costs`. Two things worth knowing before any future type proposal: **no migration is needed** (`media_items.type` is plain TEXT, no CHECK constraint), and **`tsc` won't help you**: only one `Record<MediaType, …>` exists, so adding a union member compiles clean while silently doing nothing at the other ~9 enumeration points.

- **Two light-theme contrast gaps stay deliberately unfixed and are Nils's to call** (they change the design, not a value): `--color-accent-hover` is **3.47:1**, accent text on `--color-surface-inset` is **4.32:1**. No light-theme toggle is wired, so neither is user-visible yet.

---

## Closed: pointers only

Fully written up in [docs/archive/history.md](docs/archive/history.md). **Grep it; don't read it.**

- **Backups** ✅ proven restorable twice (2026-08-20, 2026-08-23), `ALL TABLES MATCH` on all eight tables. The two live rules are in [STATUS.md](STATUS.md) and [AGENTS.md](AGENTS.md). → grep `restore drill`.
- **PL: the platform capability sweep** ✅ all six shipped 2026-08-23. The import's design → [docs/letterboxd-import.md](docs/letterboxd-import.md) (read it before touching `src/lib/import/`); the games two-provider scope split → [AGENTS.md](AGENTS.md). → grep `PL: the platform capability sweep`.
- **Legal pages, all `TODO(...)` resolved** ✅ 2026-08-17. **The rule that outlives it: strings in `src/lib/legal/content/{de,en}/*.ts` `body:` arrays RENDER to users; they are not code comments.** → grep `TODO(H4.3)`.
- **Cache tables dropped** ✅ 2026-08-17, migration 16. `user_library` / `user_watchlist` are VIEWS now. **Two traps live on in migration 16's comment and in `src/lib/cacheViews.ts`.** → grep `migration 16` · [[cache-tables-are-views]]
- **SM39, the Fandex Score range** ✅ CLOSED 2026-08-17, relabelled rather than re-tuned. → grep `SM39`.
- **Franchise / IP as a scoring factor** ✅ CLOSED 2026-08-17. `ip` stays at **3**. → grep `Franchise / IP`.
- **Advanced search's Fandex Score (SM43–SM48)** ✅ FULLY CLOSED 2026-08-17. → grep `SM44 heal budget`.
- **PR17 post-outage verification** ✅ 2026-08-12. Two corrected beliefs before touching backups: an **unchanged** Litestream generation is the HEALTHY signal, and `wal-truncate` reclaims nothing while Litestream runs. → grep `PR17`.
- **Smoke test 2026-08-12 (11th run)** ✅ SM38–SM42 fixed. → grep `Smoke test 2026-08-12 11th run`.
- Earlier sessions (G#/SM34–37, the eight closed questions, `P18 streaming links`, `H3 monetization v1`) are archived too.
