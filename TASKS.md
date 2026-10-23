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
   - **(a) Keep using the app and the site, and say what is off.** **Asked of him and not answered yet:** the list header no longer flickering when a thumb stays down after scrolling (on the phone since 0.3.11, 2026-10-23), a tick on the widget, a tag page he knows (its titles come from TMDB by name, and a wrong match is possible), the episode sheet on the phone, a franchise page (Harry Potter: the books rail on a book, the films rail on a film), the type filter's one-tap, and the widget's smaller heading. Every admin write, Review's Add and disconnecting one of two sign-ins were run on the local stack on 2026-10-23 and work (archive: grep "the open tasks").
   - **(b) Google sign-in on Android** is the obvious next piece (docs/app.md, "Not built yet"). It needs an Android OAuth client in Google Cloud, made through his Chrome at his word.
   - **(e) Google sign-in in the browser** is live (2026-10-11). Never run: the button pressed signed out, and a Google account Fandex has not seen ([docs/app.md](docs/app.md), "Google sign-in, in a browser").
   - **(f) Hardcover's key expires 2027-10-17.** A new one is made at hardcover.app/account/api with the `read:catalog` scope and goes into `.env` and through `push-secrets.mjs`. → [PLATFORMS.md](PLATFORMS.md)

2. **The native app on Google Play: ⏸️ PAUSED until the developer account is a BUSINESS account.** Play gets the native app, not the TWA (Nils, 2026-10-23). His first step is the account upgrade, then re-reading whether the 12-testers/14-days rule still applies (it is for PERSONAL accounts only). The existing Play entry is for the TWA's package and cannot be reused: the app needs a new `org.fandex.app` entry. The signing plugin and the version are built (2026-10-23) and an `.aab` builds; **his next step is the upload key**, a `keytool` command and four lines in `~/.gradle/gradle.properties`, after which I build the real bundle. The plan, the command and its order → [docs/play-store.md](docs/play-store.md).

3. **🔵 Discord sign-in is ON since 2026-10-17.** Two things left, both his: (a) **reset the client secret** in the Discord developer portal (Fandex → OAuth2 → Reset Secret): it reached a session transcript on 2026-09-02, and the new stack does not use it at all; (b) **sign in with Discord once**, on fandex.org and on the phone, since a real sign-in has never been run. → [docs/app.md](docs/app.md) ("Discord sign-in")

4. **🔵 Board games are built and switched off until a BoardGameGeek token exists** (2026-10-17). **Applied 2026-10-17, status "pending"** at boardgamegeek.com/applications (account Ramses3006). Nils: once BGG approves it, create the token there and add `BGG_TOKEN=` to the repo's `.env` (a token never passes through a session). Then mine: `node worker/scripts/push-secrets.mjs`, check `/v1/features` says `boardgames: true`, put the official "Powered by BGG" logo where the text credit is now (the terms require the logo), publish, build an APK. → [PLATFORMS.md](PLATFORMS.md)

5. **🔵 Two checks from the 2026-10-23 codebase review**, both needing his session or his tools:
   - **(a) Open fandex.org signed in and use it for a minute** (a title page with a trailer, Settings, a Trakt sync), then say so. The site sends its full Content-Security-Policy as report-only; signed-out pages showed no violation. Once a signed-in session is clean too, mine: move it to the enforced header in `mobile/web/build.mjs` (`docs/website.md`, "The Content-Security-Policy is report-only").
   - **(b) If he ever has a token from another Trakt app, try signing in to Fandex with it.** The Worker assumes Trakt refuses a token issued to another app; nobody has proven it. A Trakt identity is keyed on Trakt's uuid since 2026-10-23, and his old username row moves to it on his next Trakt sign-in.

## Mine, open

- 🔵 **The TMDB projection walk** (2026-10-23): the cron refetches the 1,698 TMDB links stored before projection v4, four per run, so a film's novelist becomes a writer facet (Stephen King on his adaptations). About three days; watch `tmdb_projection_step` in the logs and `kv` key `tmdb_projection_cursor` reading `done:4`. Then check a King film's page shows him.

## Product review, 2026-10-23 (ids RV#)

A journalist-style pass over fandex.org (signed out and signed in) and the native app, plus a curl probe of the API and static pages. Decisions Nils took on it are in [docs/decisions.md](docs/decisions.md) ("Added 2026-10-23, the product review"). Not fixed, by his call: the calendar is a top-40 on purpose, and Search keeps titles you already rated.

**The Fandex Score.** Backtest on his 1,707 ratings (rank correlation with what he really rated): 0.84 as shown, 0.29 honestly, and no retune of the prior, the weights or the top-N beat 0.29.
- ⬜ **RV1** A rated title's score reads its own rating (The Last of Us Part I: 101, its own franchise +11.3). Fix: score it leave-one-out, as if unrated.
- ⬜ **RV2** Scores pass 100 and go below 0. Fix: a soft knee, linear up to halfway between your average and 100 (or 0), then bending toward it; the breakdown scales with it so it still adds up.
- ⬜ **RV3** "Weak match. You rate BoulderLight Pictures highly.": the line named the top row whatever the band said. Fix: name the reason that agrees with the band.
- ⬜ **RV4** A fresh tab built five profiles in seven seconds and every score moved. Fix: no rebuild while the catalog copy fills.
- ⬜ **RV5** The breakdown's "Not counted for this title, being outside the top matches this item selects". Fix: plain copy.

**Search.**
- ⬜ **RV6** `pokémon` returns no games (IGDB gets the accent). Fix: fold accents on the Worker before IGDB.
- ⬜ **RV7** Games search is IGDB's text order: bundles, DLC and fan games above Zelda, Baldur's Gate 3, Spider-Man. Fix: ask for 50, rank exact title first, then main games by votes, add-ons last.
- ⬜ **RV8** Books search: nine identical "The Witcher" works and Hardcover's "Summary of…" knock-offs. Fix: drop summary and study-guide titles; fold same title and author.
- ⬜ **RV9** No typo tolerance ("witchr", "cyberpnk"). Fix later: a one-edit fallback on the device when few titles match.

**Catalog data.**
- ⬜ **RV10** DLC, season passes, packs and bundles fill "More like this", franchise and series rails. Fix (Nils: rank down, keep out of rails): an `addon` flag on the game vector from IGDB `game_type`/`parent_game`, set on the live catalog once; rails and Recommended skip add-ons, Search ranks them last.
- ⬜ **RV11** Duplicate and mixed-up games at the best addresses: `/game/final-fantasy-vii` (2013 title, Remake link, SFC text), four Dead Space, an empty `/game/baldurs-gate-3`, 123 same-title groups. Fix: a fold pass with the twins tooling, its own session (his library rows point at some).
- ⬜ **RV12** Seven books at `/book/untitled-…` (Crime and Punishment is `untitled-1866`). Fix: transliterate Cyrillic and Greek in `slugify`, and re-slug the seven (their old addresses carry nothing).
- ⬜ **RV13** Book descriptions show raw Markdown (links, `**`, `----------`, "From [wikipedia]"). Fix: strip it where Open Library's text is read.
- ⬜ **RV14** Impossible book years (Interview with the Vampire 1672, a year 30). Fix: a book date before 1450 or more than five years ahead is no date.
- ⬜ **RV15** A game's headline date is Steam's (The Last of Us Part I: PC 2023, not PS5 2022). Fix: the earliest of the game's dates.
- ⬜ **RV16** The tag group "Meta / Noise" (an ignored category) is shown on item pages. Fix: ignored categories are not displayed.
- ⬜ **RV17** Platforms twice: "PC" and "PC (Microsoft Windows)" on a page, "PS Vita" and "PlayStation Vita" in Settings. Fix: the page's chips through `platformLabel`, and a Vita alias.
- ⬜ **RV18** A stale RAWG rating chip (retired provider) and two Steam chips for one fact. Fix: no RAWG chip; one Steam pill, "84% · Very Positive".
- ⬜ **RV19** Two provider dates a day apart under "Released" (TMDB 15 Jul, Trakt 16 Jul). Fix: list them only when they differ by more than a week.
- ⬜ **RV20** Unreleased films carry 8.5 and 9.0 crowd ratings from a handful of votes. Fix: no crowd number under 20 votes.

**The app and the site.**
- ⬜ **RV21** "Remove from library" drops a rated title in one tap. Fix (Nils): an undo toast; the removal waits for it.
- ⬜ **RV22** Signing out signs out every device. Fix (Nils): Sign out is this device; "Sign out everywhere" keeps today's behaviour.
- ⬜ **RV23** Recommended suggests wishlisted titles. Fix (Nils): keep them, at most two per rail.
- ⬜ **RV24** Web: Home → title → Search tab → title → Back returns to the first title. Fix: investigate the tab history (one shared item route).
- ⬜ **RV25** The phone's month grid truncates every title to two letters. Fix: a busy day on a phone shows its top title's poster and "+N".
- ⬜ **RV26** Home's guest panel offers only Trakt; the profile offers three. Fix: one "Sign in" that opens the full card.
- ⬜ **RV27** "Your index of every game, movie & show" leaves out books. Fix: name books in the tagline and the home description.
- ⬜ **RV28** "1 of your titles are still downloading." Fix: grammar, "still loading".
- ⬜ **RV29** Settings: Google sign-in "in this app is not built yet". Fix: say what it does, not what is missing.
- ⬜ **RV30** Signed out with a browser language without a region ("de"), stores are US and the rating reads FSK first. Fix: guess the country from the time zone; the viewer's own certification first.
- ⬜ **RV31** The app holds about 945 MB (PSS) on the phone, and posters come back blank after a cold start. Fix: measure what holds it (catalog copy, image cache), then decide.

**Static site and API.**
- ⬜ **RV32** Meta descriptions cut mid-word at 200 characters, three `<h1>` per title page. Fix: cut at a word with an ellipsis; one `<h1>`.
- ⬜ **RV33** `robots.txt` has two `User-agent: *` groups. Fix: one group.
- ⬜ **RV34** The calendar for a region nobody saved is built once and served stale forever (FR from 2026-10-10). Fix: a stale month older than three days is rebuilt in the background, under a daily cap.
- ⬜ **RV35** API odds: `/v1/shows/abc/episodes` answers 405, HEAD on an item 405, a 413 says `bad-request`. Fix: 404, HEAD as GET, `payload-too-large`.

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

- **The 2026-10-23 review, the open tasks after it, and Steam sync** ✅: hand-made taxonomy rows marked (`source`, migration 0005), the `exhaustive-deps` warnings, the old-site docs moved to `docs/archive/old-site/`, THE FINALS PLAYTEST folded, the TMDB writer jobs, the never-run admin checks. → grep `2026-10-23`.
- **Smoke tests 13 to 15** ✅ (2026-10-11 to 10-17). → grep `13th smoke test`, `14th smoke test`, `15th smoke test`.
- **Backups** ✅ proven restorable (2026-10-05 on D1). → grep `restore drill`.
- **Legal pages** ✅. **The rule that outlives it: strings in `src/lib/legal/content/{de,en}/*.ts` `body:` arrays RENDER to users; they are not code comments.**
- Earlier work (the old site's phases, smoke tests 1 to 12, monetization v1) is archived too.
