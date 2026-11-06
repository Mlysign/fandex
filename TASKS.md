# Fandex: Task Tracker

> **This file holds only what is still open.** Settled calls and standing constraints → [docs/decisions.md](docs/decisions.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it; never read it end to end). One-page state → [STATUS.md](STATUS.md).
>
> ⚠️ **A decision is not a task and a constraint is not a task.** Both kept accumulating here and crowding out the actual work: 280 lines on 2026-09-02, of which most was already closed. If an entry has no next action, it belongs in one of the two files above.

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2 to 4 sentences plus a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session.** This file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ⚠️ Needs Nils: this is the whole list

Four items. Everything else in this file is work I can do without him, and every settled call moved to [docs/decisions.md](docs/decisions.md).

0. **🔵 APP + WEBSITE ON CLOUDFLARE: online since 2026-10-10.** The plan is [docs/app-plan.md](docs/app-plan.md); the references are [docs/website.md](docs/website.md), [docs/worker.md](docs/worker.md) and [docs/app.md](docs/app.md).
   - **(a) Keep using the app and the site, and say what is off.** **Asked of him and not answered yet:** the in-app trailer's picture and fullscreen (0.3.29; sound plays and Back stops it, checked over adb 2026-11-06, but `screencap` cannot see the video), the list header no longer flickering when a thumb stays down after scrolling (on the phone since 0.3.11, 2026-10-23), a tick on the widget (on 2026-10-20 a tick moved its taps while the rows stayed old; the rows travel inside the widget's own update since 0.3.26), a tag page he knows (its titles come from TMDB by name, and a wrong match is possible), the episode sheet on the phone, a franchise page (Harry Potter: the books rail on a book, the films rail on a film), the type filter's one-tap, and the widget's smaller heading. Every admin write, Review's Add and disconnecting one of two sign-ins were run on the local stack on 2026-10-23 and work (archive: grep "the open tasks").
   - **(b) Google sign-in on the phone** is in 0.3.23 (2026-10-29), through a browser sheet that comes back via fandex.org, with no Android client. **Asked of him:** in Settings on the phone, Disconnect Google, then Connect it again: the same browser sheet, without signing out (which would drop the phone's Trakt sign-in too). Nobody has pressed it on a phone yet.
   - **(e) Google sign-in in the browser** is live (2026-10-11). Never run: the button pressed signed out, and a Google account Fandex has not seen ([docs/app.md](docs/app.md), "Google sign-in, in a browser").
   - **(g) Book titles already in the catalog keep the ingest's language** (the three "Die Alchemisten" books show Italian names): one title per item for everybody. **His call:** leave it, or title a book by the viewer's country. The language filter itself is live and works (archive: grep `2026-11-06`).
   - **(f) Hardcover's key expires 2027-10-24** (renewed 2026-10-24, the old one revoked). A new one is made at hardcover.app/account/api with the `read:catalog` scope and goes into `.env` and through `push-secrets.mjs`; a session can do it without seeing the key (select the field, Ctrl+C, write `.env` from the clipboard). → [PLATFORMS.md](PLATFORMS.md)

2. **The native app on Google Play: ⏸️ PAUSED until the developer account is a BUSINESS account.** Play gets the native app, not the TWA (Nils, 2026-10-23). **⚠️ Deadline 2027-02-01: declare the trader status in Play Console** (Google's email of 2026-11-04; missing it removes the developer profile from Play), in the same sitting as the upgrade; which status and why → [docs/play-store.md](docs/play-store.md), "Trader status". His first step is the account upgrade, then re-reading whether the 12-testers/14-days rule still applies (it is for PERSONAL accounts only). The existing Play entry is for the TWA's package and cannot be reused: the app needs a new `org.fandex.app` entry. The signing plugin and the version are built (2026-10-23) and an `.aab` builds; **his next step is the upload key**, a `keytool` command and four lines in `~/.gradle/gradle.properties`, after which I build the real bundle. The plan, the command and its order → [docs/play-store.md](docs/play-store.md).

4. **🔵 Board games are built and switched off until a BoardGameGeek token exists** (2026-10-17). **Applied 2026-10-17, still "pending" on 2026-10-24** at boardgamegeek.com/applications (account Ramses3006). Nils: once BGG approves it, create the token there and add `BGG_TOKEN=` to the repo's `.env` (a token never passes through a session). Then mine: `node worker/scripts/push-secrets.mjs`, check `/v1/features` says `boardgames: true`, put the official "Powered by BGG" logo where the text credit is now (the terms require the logo), publish, build an APK. → [PLATFORMS.md](PLATFORMS.md)

5. **🔵 One check from the 2026-10-23 codebase review** (the signed-in CSP check passed 2026-10-24 and the policy is enforced):
   - **If he ever has a token from another Trakt app, try signing in to Fandex with it.** The Worker assumes Trakt refuses a token issued to another app; nobody has proven it. A Trakt identity is keyed on Trakt's uuid since 2026-10-23, and his old username row moves to it on his next Trakt sign-in.

## Mine, open

- **A facet page names a provider that failed and offers a retry** (PR #58, on the phone since 0.3.29): not seen yet, since it needs a provider to fail. Try it on the local stack with a provider switched off.
- **Search's Picks deals a different hand after ten minutes away** (signed in). The rest is checked: on 0.3.34 it opened on Picks in about 2.7 s with a first hand unrated and not on the wishlist (2026-11-06). → `docs/app.md` (Search row)

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

- **Shows' cast, the Hardcover walk, book languages, Insights, the trailer's sound** ✅ (2026-11-06, checked live and over adb). → grep `2026-11-06`.
- **The Miro board's UI notes** ✅ (2026-11-05, 0.3.31 and 0.3.32): all 31 items but one. Not doable: whether a dub in your language exists, since no provider says. → grep `Miro board's UI notes`.

- **Discord sign-in** ✅ (2026-10-24): the leaked secret reset (the old one answers 401), and Nils's first real Discord sign-in is on his account (`user_identities`, 08:38 UTC), after the phone's return through fandex.org. → `docs/app.md` ("Discord sign-in").
- **The product review, RV1 to RV35, and the cause behind RV11's mixed-up games** ✅ (2026-10-23 and 24, APK 0.3.17). By Nils's call: the calendar stays a top-40, Search keeps rated titles, remasters stay folded. → grep `Product review, 2026-10-23`.
- **The 2026-10-23 review, the open tasks after it, and Steam sync** ✅: hand-made taxonomy rows marked (`source`, migration 0005), the `exhaustive-deps` warnings, the old-site docs moved to `docs/archive/old-site/`, THE FINALS PLAYTEST folded, the TMDB writer jobs, the never-run admin checks. → grep `2026-10-23`.
- **Smoke tests 13 to 15** ✅ (2026-10-11 to 10-17). → grep `13th smoke test`, `14th smoke test`, `15th smoke test`.
- **Backups** ✅ proven restorable (2026-10-05 on D1). → grep `restore drill`.
- **Legal pages** ✅. **The rule that outlives it: strings in `src/lib/legal/content/{de,en}/*.ts` `body:` arrays RENDER to users; they are not code comments.**
- Earlier work (the old site's phases, smoke tests 1 to 12, monetization v1) is archived too.
