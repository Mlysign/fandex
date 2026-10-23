# Fandex: Task Tracker

> **This file holds only what is still open.** Settled calls and standing constraints → [docs/decisions.md](docs/decisions.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it; never read it end to end). One-page state → [STATUS.md](STATUS.md).
>
> ⚠️ **A decision is not a task and a constraint is not a task.** Both kept accumulating here and crowding out the actual work — 280 lines on 2026-09-02, of which most was already closed. If an entry has no next action, it belongs in one of the two files above.

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

2. **Android TWA (P15/P16): ⏸️ PAUSED until the developer account is a BUSINESS account.** (Nils, 2026-08-23.) The package is built and sideloaded on the Pixel 8 with no address bar, and the Play Console entry exists (name `Fandex`, package `org.fandex.twa`, Free). ⚠️ **The 12-testers/14-days gate applies to PERSONAL accounts only**, so a closed test now is likely throwaway work: upgrade first, then re-check whether the gate applies at all. Remaining steps, and the trap that Google re-signs the store build so `TWA_CERT_FINGERPRINT` needs a SECOND fingerprint appended → [docs/twa-play-store.md](docs/twa-play-store.md).

3. **🔵 Discord sign-in is ON since 2026-10-17.** Two things left, both his: (a) **reset the client secret** in the Discord developer portal (Fandex → OAuth2 → Reset Secret): it reached a session transcript on 2026-09-02, and the new stack does not use it at all; (b) **sign in with Discord once**, on fandex.org and on the phone, since a real sign-in has never been run. → [docs/app.md](docs/app.md) ("Discord sign-in")

4. **🔵 Board games are built and switched off until a BoardGameGeek token exists** (2026-10-17). **Applied 2026-10-17, status "pending"** at boardgamegeek.com/applications (account Ramses3006). Nils: once BGG approves it, create the token there and add `BGG_TOKEN=` to the repo's `.env` (a token never passes through a session). Then mine: `node worker/scripts/push-secrets.mjs`, check `/v1/features` says `boardgames: true`, put the official "Powered by BGG" logo where the text credit is now (the terms require the logo), publish, build an APK. → [PLATFORMS.md](PLATFORMS.md)

5. **🔵 Two checks from the 2026-10-23 codebase review**, both needing his session or his tools:
   - **(a) Open fandex.org signed in and use it for a minute** (a title page with a trailer, Settings, a Trakt sync), then say so. The site sends its full Content-Security-Policy as report-only; signed-out pages showed no violation. Once a signed-in session is clean too, mine: move it to the enforced header in `mobile/web/build.mjs` (`docs/website.md`, "The Content-Security-Policy is report-only").
   - **(b) If he ever has a token from another Trakt app, try signing in to Fandex with it.** The Worker assumes Trakt refuses a token issued to another app; nobody has proven it. A Trakt identity is keyed on Trakt's uuid since 2026-10-23, and his old username row moves to it on his next Trakt sign-in.

## Mine, open

- ⬜ **Steam sync on the new stack.** Steam is listed as connected on his account and syncs nothing; the old site's adapter went with it (tag `old-site-final`, `src/lib/sources/adapters/steam.ts`). It needs a Worker route (the Steam key may not ship in an APK), a map from Steam app ids to IGDB games (IGDB's `external_games`, as THE FINALS was found on 2026-10-23), and the prune invariant on the device. A feature of its own, not a fix.
- 🔵 **The TMDB projection walk** (2026-10-23): the cron refetches the 1,698 TMDB links stored before projection v4, four per run, so a film's novelist becomes a writer facet (Stephen King on his adaptations). About three days; watch `tmdb_projection_step` in the logs and `kv` key `tmdb_projection_cursor` reading `done:4`. Then check a King film's page shows him.

## H3: Monetization 🔵 ads-first, waiting on traffic

**Nothing to do until a gate is hit, and both gates are traffic.** Ads at **10,000 pageviews/mo**,
freemium at **3,500 sustained weekly actives**; `/dev/analytics` measures both. Donations are
live. The economics and the gates are in [docs/decisions.md](docs/decisions.md); the runbook is
[docs/monetization-go-live.md](docs/monetization-go-live.md). Only **GOG** of the catalog's store
rows is affiliate-capable. The old site's `affiliate.ts` went with it (tag `old-site-final`); the
app has no affiliate code yet. → [[monetization-h3]]

---

## ⚑ Flagged 2026-10-23: probably outdated, waiting for Nils to say "archive"

These were written for the old Next.js site or are overtaken by later work. Nothing was done on
them; each says why it looks stale. One word from Nils and they move to the archive.

- **Search Console, 4,089 of 4,090 URLs "Discovered – currently not indexed"** (2026-09-02). Written against the old site's 4,341-URL sitemap. Since then the sitemap is the static site's (10,132 URLs, facet pages included, which was the internal-depth step the plan asked for). What is left is his: external links (nilsmlynarek.eu, Show HN, Product Hunt, subreddits). The reasoning is in [docs/archive/old-site/seo.md](docs/archive/old-site/seo.md).
- **The tag tail: ~9,000 tags in Other appearing three times or fewer** (2026-09-03). Other was emptied on 2026-10-18 by the AI sweep, and the weekly sweep keeps placing new tags.
- **Desktop mockups for the filter panel** (older). The old site's `FilterPanel.tsx`; the app has its own Filters sheet.
- **Nothing uses the media-type setting to SPEND less** (older). About the old site's `/api/discover`, `/api/library` and `/api/calendar`, which no longer exist.
- **The list payload carries ~4.7 MB only the detail page reads** (older). The old site's `/api/library`.
- **`/library`, `/wishlist`, `/settings` dead under `next dev`** (2026-08-17). The old site is deleted.
- **Fandex Score `priorStrength` (C=5) and class weights may want re-tuning** (2026-08). Time-gated to "after a few weeks of real scores"; the live config already reads C=2 since then, and a re-tune is a design call for him, not a cleanup. Keep if he wants it looked at.
- **The 2026-08-23 optimization sweep pointer** and **the platform-integrations standing context** (AniList blocked on its terms, books postponed then shipped 2026-10-17). Neither has a next action; the first is about the old site, the second belongs in [docs/decisions.md](docs/decisions.md) and [PLATFORMS.md](PLATFORMS.md).
- **Two light-theme contrast gaps** (`--color-accent-hover` 3.47:1, accent on `--color-surface-inset` 4.32:1). Old-site tokens; the app has one dark theme.
- **From the 2026-10-11 smoke test, "not re-logged":** `/dashboard` 404 is fixed (a 301 to `/wishlist` since 2026-10-23), Profile's "Coming up" no longer exists (Profile was made lighter on 2026-10-17), Steam is now the task above, and "a title removed from the pool between two site builds sends new visitors to the API" is how a static site works, not a bug.

---

## Closed: pointers only

Fully written up in [docs/archive/history.md](docs/archive/history.md). **Grep it; don't read it.**

- **The 2026-10-23 review and the open tasks after it** ✅: hand-made taxonomy rows marked (`source`, migration 0005), the `exhaustive-deps` warnings, the old-site docs moved to `docs/archive/old-site/`, THE FINALS PLAYTEST folded, the TMDB writer jobs, the never-run admin checks. → grep `2026-10-23`.
- **Smoke tests 13 to 15** ✅ (2026-10-11 to 10-17). → grep `13th smoke test`, `14th smoke test`, `15th smoke test`.
- **Backups** ✅ proven restorable (2026-10-05 on D1). → grep `restore drill`.
- **Legal pages** ✅. **The rule that outlives it: strings in `src/lib/legal/content/{de,en}/*.ts` `body:` arrays RENDER to users; they are not code comments.**
- Earlier work (the old site's phases, smoke tests 1 to 12, monetization v1) is archived too.
