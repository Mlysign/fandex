# Fandex: Task Tracker

> **This file holds only what is still open.** Settled calls and standing constraints → [docs/decisions.md](docs/decisions.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it; never read it end to end). One-page state → [STATUS.md](STATUS.md).
>
> ⚠️ **A decision is not a task and a constraint is not a task.** Both kept accumulating here and crowding out the actual work: 280 lines on 2026-09-02, of which most was already closed. If an entry has no next action, it belongs in one of the two files above.

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2 to 4 sentences plus a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session.** This file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ⚠️ Needs Nils: this is the whole list

Eight items. Everything else in this file is work I can do without him, and every settled call moved to [docs/decisions.md](docs/decisions.md).

0. **🔵 APP + WEBSITE ON CLOUDFLARE: online since 2026-10-10.** The plan is [docs/app-plan.md](docs/app-plan.md); the references are [docs/website.md](docs/website.md), [docs/worker.md](docs/worker.md) and [docs/app.md](docs/app.md).
   - **(a) Keep using the app and the site, and say what is off.** **Asked of him and not answered yet:** only **0.3.45's first run** (a new account's two windows: run end to end on the local stack in a browser 2026-11-07, never on the phone, and a real new account through Trakt, Google or Discord has not been made). Feedback on feel goes into numbers in `mobile/src/lib/feel.ts` and `components/pressFeel.ts`, never back to him as a question (memory `rating-feel-from-bubblewrap`). Everything else asked here was checked by Nils on 2026-11-13 (archive: grep `2026-11-13`). The episode sheet, the Harry Potter rails and the type filter's one tap were checked over adb on 2026-11-06 (archive: grep `2026-11-06`). Every admin write, Review's Add and disconnecting one of two sign-ins were run on the local stack on 2026-10-23 and work (archive: grep "the open tasks").
   - **(e) Google sign-in in the browser** is live (2026-10-11). Never run: the button pressed signed out, and a Google account Fandex has not seen ([docs/app.md](docs/app.md), "Google sign-in, in a browser").
   - **(f) Hardcover's key expires 2027-10-24** (renewed 2026-10-24, the old one revoked). A new one is made at hardcover.app/account/api with the `read:catalog` scope and goes into `.env` and through `push-secrets.mjs`; a session can do it without seeing the key (select the field, Ctrl+C, write `.env` from the clipboard). → [PLATFORMS.md](PLATFORMS.md)

2. **The native app on Google Play: 🔵 waiting on Google.** Play gets the native app, not the TWA (Nils, 2026-10-23). On 2026-11-22 the D-U-N-S number was accepted, the organization form was sent and its documents uploaded; Google is verifying. The upload key exists (2026-11-22), so I can build the real `.aab`. **⚠️ Deadline 2027-02-01: declare the trader status in Play Console** (Google's email of 2026-11-04; missing it removes the developer profile from Play). Nils chose "trader" (2026-11-22) and declares it once Google approves. Then he re-reads whether the 12-testers/14-days rule still applies (PERSONAL accounts only). The existing Play entry is for the TWA's package and cannot be reused: the app needs a new `org.fandex.app` entry. The plan and its order → [docs/play-store.md](docs/play-store.md).

7. **🔵 The legal texts wait for his OK:** `docs/release-plan/drafts/legal-texts.md` (the privacy text for the usage counts and the rest). Until he approves it, the usage counters stay off (`USAGE_COUNTERS` in the Worker, `USAGE_COUNTS_LIVE` in the app). After his OK: the texts go into `src/lib/legal`, then the two switches, then a publish, a Worker deploy and an APK, in that order.

8. **🔵 The mockups of the app additions wait for his answers** on the release plan page (`docs/release-plan/index.html`), with the six decisions at its top.

9. **🔵 One real Steam connect, by him** (Settings, "Connect Steam", on the phone and once in a browser). Built and covered by tests; the real Steam page has not been through it.

4. **🔵 Board games are built and switched off until a BoardGameGeek token exists** (2026-10-17). **Applied 2026-10-17, still "pending" on 2026-11-21** (read in his Chrome) at boardgamegeek.com/applications (account Ramses3006, application "Fandex"), and no mail from BGG in his Gmail since 2024. Nils: once BGG approves it, create the token there and add `BGG_TOKEN=` to the repo's `.env` (a token never passes through a session). Then mine: `node worker/scripts/push-secrets.mjs`, check `/v1/features` says `boardgames: true`, put the official "Powered by BGG" logo where the text credit is now (the terms require the logo), publish, build an APK. → [PLATFORMS.md](PLATFORMS.md)

5. **🔵 One check from the 2026-10-23 codebase review** (the signed-in CSP check passed 2026-10-24 and the policy is enforced):
   - **If he ever has a token from another Trakt app, try signing in to Fandex with it.** The Worker assumes Trakt refuses a token issued to another app; nobody has proven it. A Trakt identity is keyed on Trakt's uuid since 2026-10-23, and his old username row moves to it on his next Trakt sign-in.

6. **🔵 Google indexes 5 of 10,125 URLs (Search Console, 2026-11-06).** Facet pages under 10 titles are `noindex, follow` and out of the sitemap on `main` since 2026-11-06 (`FACET_INDEX_MIN`, `mobile/web/buildChecks.mjs`); they go live with the next nightly site build. Nothing technical blocks indexing (robots, status codes, canonicals and the rendered page checked that day). **Answered 2026-11-06 (read in Search Console): "Discovered", so the domain needs links, not better pages.** 10,116 URLs "Discovered – currently not indexed" (never fetched, last crawled N/A), 1 "Crawled – currently not indexed", 2 redirects, 1 404 (report as of 2026-10-23). Crawl stats: 452 Googlebot requests in 90 days, 96% refreshes and 4% discovery, 80% answered 200, 131 ms average; the 4% DNS errors are `swordartonline.fandex.org`, a name that does not exist. The sitemap was read 2026-11-05 (10,020 URLs, success), and the live HTML carries plain links (120 on `/`). **2026-11-15:** sitemap resubmitted (Google had read it that day: 6,073 URLs, so the noindex cut is live), 6 pages indexed, `/` among them. Indexing requested for nine pages until the daily quota ran out: `/tag/action`, `/game/elden-ring`, `/show/breaking-bad`, `/movie/oppenheimer`, `/show/severance`, `/game/the-witcher-3-wild-hunt`, `/movie/dune-part-two`, `/calendar/2026-11`, `/show/the-last-of-us` (`/tag/drama` hit the quota). Look again in a week. **His:** links to fandex.org from outside, held for the launch (below). Text of their own on the big facet pages waits until pages get crawled and judged. → [docs/website.md](docs/website.md)

## Launch: Fandex and the Android app together 🔵

**Planned 2026-11-22: the plan is the page `docs/release-plan/index.html`** (double-click it), with the market data, the message, every asset, channel and admin step, each with an owner, a date and a status. Target: Tuesday 2027-02-16, if the D-U-N-S number is there by mid-December. **Waiting on Nils:** the six decisions at the top of the page, and his comments on it (he pastes them from the page's "Copy for Claude"). The bullets below are the same work in less detail; the page is the list that gets updated.

One launch, on the day the native app goes live on Google Play (item 2), so every post can point at both fandex.org and the store page. It is also the answer to item 6: Google has not fetched the site because nothing links to it.

- **Images**: screenshots and feature graphics for the Play store page, images for the subreddit and forum posts, and ones that could serve as ads later. The phone captures from the Miro board are the starting point (→ [[ui-review-miro-board]]); Play's sizes are in [docs/play-store.md](docs/play-store.md).
- **The posts themselves**: one text per place, in the plainest words (AGENTS.md's audience-facing rule).
- **Usage tracking, live before the launch** (Nils, 2026-11-07): **built 2026-11-22 and switched off.** Day totals with no id (`worker/src/usage.ts`, the app's `lib/usageCounts.ts`, the admin Usage page). The website still counts pageviews only, and the app sends nothing until the switches flip, so the privacy policy is still true. Open: his OK on the privacy text (item 7), then the policy text in both languages (`src/lib/legal/content/*/privacy.ts`), then `USAGE_COUNTERS` and `USAGE_COUNTS_LIVE`. → [[telemetry-self-hosted]], [[launch-run-2026-11-22]]
- **The launch pages are written and hidden.** `/app`, `/press`, `/whats-new` and `/delete-account` go live by setting `LAUNCHED` (and `PLAY_STORE_URL`, once there is a listing) in `mobile/src/lib/launch.ts`, then a publish. → [docs/website.md](docs/website.md)

## Mine, open

- 🔵 **A second audit pass after the Play sign-in changes** (the assetlinks file, the `https://` Trakt redirect and Google sign-in on Android; [docs/play-store.md](docs/play-store.md), step 4). The audit of 2026-11-22 covered what exists today.

Phone checks on 0.3.62 back to 0.3.58; everything else waits on Nils (above), BoardGameGeek, Google Play or the launch. **Next session starts with the first bullet's check**, which needs only a query.

- 🔵 **Titles in every language, 0.3.60 (2026-11-21): live; one walk was still running on 2026-11-22.** One entry per title, titled in the account's language, found by the original, a romanization, English and the account's language (decisions.md, "A title's names"). Measured 2026-11-22: the re-derive (`rederive_cursor` = `done:5`), the Hardcover titles and the Open Library titles (`ol_titles_cursor` = `done`) are through; the TMDB refetch had 808 of 5,457 links left. **Next:** `npx wrangler d1 execute fandex --remote --command "SELECT value FROM kv WHERE key = 'tmdb_projection_cursor'"` reads `done:5`. Then on the phone: "your name" shows "Your Name. - Gestern, heute und für immer" (production holds the German title since 2026-11-22; the phone needs one catalog sync), and "der weg der könige" shows one card. Seen on the phone already: "Kimi no Na wa" finds it once, in German. Two loose ends: a book NOT in the catalog, searched in English by a German account, is listed under its English title (the card knows only the edition it matched); and the Open Library titles walk has no second pass, so the 4 books whose editions failed to load get titles only when next resolved (`worker/src/openLibraryTitles.ts` says "asked again on the next pass", which is not what it does).
- 🔵 **Release reminders, 0.3.61 and 0.3.62 (2026-11-21): set on the phone, not yet seen arriving.** Three kinds (a wishlisted title's release, a new season, the next episode of a show you are caught up on), 12 set, `seasonsFailed` and `episodesFailed` false. `adb shell dumpsys alarm` lists them as `expo.modules.notifications.NOTIFICATION_EVENT`, the first at 2026-11-24 09:00; Android gives each a one-hour window. Open: Nils sees one arrive and a tap opens the title. A weekly show's next episode is set one at a time, so the following week's needs the app opened once in between.
- 🔵 **0.3.59 (2026-11-21), three fixes not yet seen on the phone.** (1) Rating a show with episodes ticked no longer marks every episode watched on Trakt. (2) Up next follows the device's ticks when Trakt names an earlier episode (Scavengers Reign showed E01, should be E05). (3) Der Kanon mechanischer Seelen shows once in Search, dated 2017 (its re-derive is through).

- 🔵 **Own gains lost across a sign-out: fixed in 0.3.58, the phone check is open.** Timed on the phone 2026-11-15 (0.3.57): after Nils signed back in, the profile was built in 653 ms (the two minutes are gone), but `fandex_calibration` said `moved: true` and every score shifted once. Cause: the profile is built right after the sign-in before the ratings arrive, and that fit (0 rated, the shared gains) overwrote the gains kept under the account. 0.3.58 keeps no fit made while rows are syncing or with nothing rated, and reads the account row first. Next sign-in: `moved: false` is the pass.
## Later: feature ideas (Nils, 2026-11-02) ⬜

Parked, not started. Each needs a design talk with Nils before any code.

- **A proper profile page, with following.** Users can follow each other and open each other's profiles. Clashes with a standing call: the You tab is lighter than the old site's profile page on purpose ([docs/decisions.md](docs/decisions.md), "The You tab"), so settle where a profile lives before building. A public profile also needs a privacy setting and an erasure path (→ [[account-erasure-and-export]]).
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
