# Fandex: Task Tracker

> **This file holds only what is still open.** Settled calls and standing constraints → [docs/decisions.md](docs/decisions.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it; never read it end to end). One-page state → [STATUS.md](STATUS.md).
>
> ⚠️ **A decision is not a task and a constraint is not a task.** Both kept accumulating here and crowding out the actual work: 280 lines on 2026-09-02, of which most was already closed. If an entry has no next action, it belongs in one of the two files above.

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2 to 4 sentences plus a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session.** This file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ⚠️ Needs Nils: this is the whole list

Five items. Everything else in this file is work I can do without him, and every settled call moved to [docs/decisions.md](docs/decisions.md).

0. **🔵 APP + WEBSITE ON CLOUDFLARE: online since 2026-10-10.** The plan is [docs/app-plan.md](docs/app-plan.md); the references are [docs/website.md](docs/website.md), [docs/worker.md](docs/worker.md) and [docs/app.md](docs/app.md).
   - **(a) Keep using the app and the site, and say what is off.** **Asked of him and not answered yet:** the list header no longer flickering when a thumb stays down after scrolling (on the phone since 0.3.11, 2026-10-23), a tick on the widget (on 2026-10-20 a tick moved its taps while the rows stayed old; the rows travel inside the widget's own update since 0.3.26), a tag page he knows (its titles come from TMDB by name, and a wrong match is possible), the episode sheet on the phone, a franchise page (Harry Potter: the books rail on a book, the films rail on a film), the type filter's one-tap, and the widget's smaller heading. Every admin write, Review's Add and disconnecting one of two sign-ins were run on the local stack on 2026-10-23 and work (archive: grep "the open tasks").
   - **(b) Google sign-in on the phone** is in 0.3.23 (2026-10-29), through a browser sheet that comes back via fandex.org, with no Android client. **Asked of him:** in Settings on the phone, Disconnect Google, then Connect it again: the same browser sheet, without signing out (which would drop the phone's Trakt sign-in too). Nobody has pressed it on a phone yet.
   - **(e) Google sign-in in the browser** is live (2026-10-11). Never run: the button pressed signed out, and a Google account Fandex has not seen ([docs/app.md](docs/app.md), "Google sign-in, in a browser").
   - **(g) Book languages (2026-11-03): English plus the country's languages, audiobook works folded in.** Not deployed. Hardcover's edition language field (`editions { language { language } }`) is from their docs, never probed with the token: after `npx wrangler deploy`, search a book on the phone and check `wrangler tail` for `hardcover_failed`. A refusal only empties Hardcover's list half. Titles already in the catalog (the three "Die Alchemisten" books) keep their Italian names: that is the ingest's title, one per title for everybody, and not yet decided.
   - **(f) Hardcover's key expires 2027-10-24** (renewed 2026-10-24, the old one revoked). A new one is made at hardcover.app/account/api with the `read:catalog` scope and goes into `.env` and through `push-secrets.mjs`; a session can do it without seeing the key (select the field, Ctrl+C, write `.env` from the clipboard). → [PLATFORMS.md](PLATFORMS.md)

2. **The native app on Google Play: ⏸️ PAUSED until the developer account is a BUSINESS account.** Play gets the native app, not the TWA (Nils, 2026-10-23). **⚠️ Deadline 2027-02-01: declare the trader status in Play Console** (Google's email of 2026-11-04; missing it removes the developer profile from Play), in the same sitting as the upgrade; which status and why → [docs/play-store.md](docs/play-store.md), "Trader status". His first step is the account upgrade, then re-reading whether the 12-testers/14-days rule still applies (it is for PERSONAL accounts only). The existing Play entry is for the TWA's package and cannot be reused: the app needs a new `org.fandex.app` entry. The signing plugin and the version are built (2026-10-23) and an `.aab` builds; **his next step is the upload key**, a `keytool` command and four lines in `~/.gradle/gradle.properties`, after which I build the real bundle. The plan, the command and its order → [docs/play-store.md](docs/play-store.md).

4. **🔵 Board games are built and switched off until a BoardGameGeek token exists** (2026-10-17). **Applied 2026-10-17, still "pending" on 2026-10-24** at boardgamegeek.com/applications (account Ramses3006). Nils: once BGG approves it, create the token there and add `BGG_TOKEN=` to the repo's `.env` (a token never passes through a session). Then mine: `node worker/scripts/push-secrets.mjs`, check `/v1/features` says `boardgames: true`, put the official "Powered by BGG" logo where the text credit is now (the terms require the logo), publish, build an APK. → [PLATFORMS.md](PLATFORMS.md)

5. **🔵 One check from the 2026-10-23 codebase review** (the signed-in CSP check passed 2026-10-24 and the policy is enforced):
   - **If he ever has a token from another Trakt app, try signing in to Fandex with it.** The Worker assumes Trakt refuses a token issued to another app; nobody has proven it. A Trakt identity is keyed on Trakt's uuid since 2026-10-23, and his old username row moves to it on his next Trakt sign-in.

6. **🔵 Shows with no cast (Adolescence and 50 more, 2026-11-02).** A show's TMDB `credits` lists only regulars, so a miniseries filed as guest stars had no Cast rail; `getTmdbShow` now fills it from the latest season's `aggregate_credits`. Deployed, and the data fix run on 2026-11-05 (51 shows queued for the retention refresh, about a day). ⚠️ The aggregate shape is from TMDB's docs, not a live probe: check Adolescence's cast on 2026-11-06, and publish the website again once it shows.

## Mine, open

- **Check Insights on the phone** (0.3.32, 2026-11-05): the taste impacts in the facet boxes are worked out in slices, measured only in Node (about 0.5 ms a facet); on Nils's profile watch how long "Weighing…" shows. If it is seconds, give `ScoreProvider` a per-facet impact lookup instead of `impactsFor` per row (`lib/insightsImpacts.ts`).

- **The trailer plays in the app** (on the phone in 0.3.29, 2026-11-05, not tried yet): the trailer plays, fullscreen works (letterboxed, the app is portrait-locked), the sound stops on going back. Error 153 on the player means the referrer fix in `Trailer.tsx` did not take.
- **Check 0.3.29's merged work on the phone** (installed 2026-11-05): a facet page names a provider that failed and offers a retry (PR #58), and books follow the country's languages with one card per book (PR #59).
- **Check Search's Picks signed in** (site 2026-11-02, APK 0.3.26): a different hand after ten minutes away, none from the library, and how long the first hand takes, since it scores the whole catalog copy. Signed out on fandex.org it opened on Picks with no console error. → `docs/app.md` (Search row)

- **Deploy the Hardcover walk and watch its first day** (2026-11-02, branch `ccr-dc16fb2a-o3p6tz`): `npx wrangler deploy`, no migration. Then `wrangler tail` for `hardcover_walk_step`: `hardcover_isbn_query_refused` in the log means the unprobed `editions` ISBN query's shape is wrong (books still link through the search, one request dearer). After a day, check Dune Messiah shows Dark, Reflective and Tense, and publish the site. → `docs/worker.md`
- **Refit the gains whenever the pool or the weights change**: `scripts/score-backtest.mjs --fit-gains`, then the pair on `/dev/scoring`. Due again once the Hardcover walk is through: every book gains voted tags. Last done 2026-10-29 (`mappingConstantUp` 1.3). The four cron walks of 2026-10-23 to 26 and the baseline test are done and archived (grep `2026-10-29`).

## Later: feature ideas (Nils, 2026-11-02) ⬜

Parked, not started. Each needs a design talk with Nils before any code.

- **A proper profile page, with following.** Users can follow each other and open each other's profiles. Clashes with a standing call: the You tab is lighter than the old site's profile page on purpose ([docs/decisions.md](docs/decisions.md), "The You tab"), so settle where a profile lives before building. A public profile also needs a privacy setting and an erasure path (→ [[account-erasure-and-export]]).
- **A notification when a wishlisted title is released.** The app has no push today; Expo push needs an FCM setup and a nightly Worker job that finds wishlist rows whose release date is today in the user's country (→ [[region-country-setting]]).
- **A "what now?" page**: help pick something to watch, binge, play or read right now. Overlaps Search's Picks (`docs/app.md`, Search row); decide whether this grows Picks or is its own screen, and whether it draws from the library, the wishlist or the whole catalog. Pull (what you seek out) and Follow come back here: they are hidden from the app since 2026-11-05 behind `PULL_SHOWN` (`mobile/src/lib/scoreReasons.ts`). When they do, Follow and Not interested become icons at the top right, and Not interested is the same button as a title's "Hide from suggestions" (Nils, Miro board).
- **A series' order, and main entry vs spin-off**, on the "More from…" rail of a book, film or game (Nils, 2026-11-05). Needs a data source per medium.
- **A customisable Insights page with showcases**, the way Steam profiles have them: graphs, favourite titles (Nils, 2026-11-05). Overlaps the profile page above.

## H3: Monetization 🔵 ads-first, waiting on traffic

**Nothing to do until a gate is hit, and both gates are traffic.** Ads at **10,000 pageviews/mo**,
freemium at **3,500 sustained weekly actives**; `/dev/analytics` measures both. Donations are
live. The economics and the gates are in [docs/decisions.md](docs/decisions.md); the runbook is
[docs/archive/old-site/monetization-go-live.md](docs/archive/old-site/monetization-go-live.md). Only **GOG** of the catalog's store
rows is affiliate-capable. The old site's `affiliate.ts` went with it (tag `old-site-final`); the
app has no affiliate code yet. → [[monetization-h3]]

---

## Closed: pointers only

Fully written up in [docs/archive/history.md](docs/archive/history.md). **Grep it; don't read it.**

- **The Miro board's UI notes** ✅ (2026-11-05, 0.3.31 and 0.3.32): all 31 items but one. Not doable: whether a dub in your language exists, since no provider says. → grep `Miro board's UI notes`.

- **Discord sign-in** ✅ (2026-10-24): the leaked secret reset (the old one answers 401), and Nils's first real Discord sign-in is on his account (`user_identities`, 08:38 UTC), after the phone's return through fandex.org. → `docs/app.md` ("Discord sign-in").
- **The product review, RV1 to RV35, and the cause behind RV11's mixed-up games** ✅ (2026-10-23 and 24, APK 0.3.17). By Nils's call: the calendar stays a top-40, Search keeps rated titles, remasters stay folded. → grep `Product review, 2026-10-23`.
- **The 2026-10-23 review, the open tasks after it, and Steam sync** ✅: hand-made taxonomy rows marked (`source`, migration 0005), the `exhaustive-deps` warnings, the old-site docs moved to `docs/archive/old-site/`, THE FINALS PLAYTEST folded, the TMDB writer jobs, the never-run admin checks. → grep `2026-10-23`.
- **Smoke tests 13 to 15** ✅ (2026-10-11 to 10-17). → grep `13th smoke test`, `14th smoke test`, `15th smoke test`.
- **Backups** ✅ proven restorable (2026-10-05 on D1). → grep `restore drill`.
- **Legal pages** ✅. **The rule that outlives it: strings in `src/lib/legal/content/{de,en}/*.ts` `body:` arrays RENDER to users; they are not code comments.**
- Earlier work (the old site's phases, smoke tests 1 to 12, monetization v1) is archived too.
