# Fandex: Task Tracker

> **This file holds only what is still open.** Settled calls and standing constraints → [docs/decisions.md](docs/decisions.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it; never read it end to end). One-page state → [STATUS.md](STATUS.md).
>
> ⚠️ **A decision is not a task and a constraint is not a task.** Both kept accumulating here and crowding out the actual work: 280 lines on 2026-09-02, of which most was already closed. If an entry has no next action, it belongs in one of the two files above.

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2 to 4 sentences plus a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session.** This file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ⚠️ Needs Nils: this is the whole list

Five items. Everything else in this file is work I can do without him, and every settled call moved to [docs/decisions.md](docs/decisions.md).

6. **🔵 Say go on the re-derive of the pool** (2026-10-26). The score's data fixes changed what a title's FACETS are (`DERIVE_VERSION` 4: tag tiers, the anime facet, a game's people), and nothing re-derives a stored doc on a timer. The cron's `runRederiveStep` walks every pool item whose doc is behind, ten a run, and is priced at **three row writes an item, about 14,000 for the 4,614 pool items, over about three days of runs** (the day's allowance is 100,000). It runs only once this is executed on prod, from `worker/`:

   ```bash
   npx wrangler d1 execute fandex --remote --command "INSERT INTO kv (key, value) VALUES ('rederive_go', '4')"
   ```

   Until then the item page already shows the new facets (a stale doc is re-merged on read), while the pool copy on every device and the site's catalog files keep the old ones. Two decisions the numbers left open, both knobs on `/dev/scoring`: the reference population (`pullReference`) lifts games' rating order and lowers the held-out wishlist bar (§3.7), and `artstyle` at weight 0 keeps the new `anime` facet out of both axes (§3.9).

0. **🔵 APP + WEBSITE ON CLOUDFLARE: online since 2026-10-10.** The plan is [docs/app-plan.md](docs/app-plan.md); the references are [docs/website.md](docs/website.md), [docs/worker.md](docs/worker.md) and [docs/app.md](docs/app.md).
   - **(a) Keep using the app and the site, and say what is off.** **Asked of him and not answered yet:** the list header no longer flickering when a thumb stays down after scrolling (on the phone since 0.3.11, 2026-10-23), a tick on the widget, a tag page he knows (its titles come from TMDB by name, and a wrong match is possible), the episode sheet on the phone, a franchise page (Harry Potter: the books rail on a book, the films rail on a film), the type filter's one-tap, and the widget's smaller heading. Every admin write, Review's Add and disconnecting one of two sign-ins were run on the local stack on 2026-10-23 and work (archive: grep "the open tasks").
   - **(b) Google sign-in on Android** is the obvious next piece (docs/app.md, "Not built yet"). It needs an Android OAuth client in Google Cloud, made through his Chrome at his word.
   - **(e) Google sign-in in the browser** is live (2026-10-11). Never run: the button pressed signed out, and a Google account Fandex has not seen ([docs/app.md](docs/app.md), "Google sign-in, in a browser").
   - **(f) Hardcover's key expires 2027-10-24** (renewed 2026-10-24, the old one revoked). A new one is made at hardcover.app/account/api with the `read:catalog` scope and goes into `.env` and through `push-secrets.mjs`; a session can do it without seeing the key (select the field, Ctrl+C, write `.env` from the clipboard). → [PLATFORMS.md](PLATFORMS.md)

2. **The native app on Google Play: ⏸️ PAUSED until the developer account is a BUSINESS account.** Play gets the native app, not the TWA (Nils, 2026-10-23). His first step is the account upgrade, then re-reading whether the 12-testers/14-days rule still applies (it is for PERSONAL accounts only). The existing Play entry is for the TWA's package and cannot be reused: the app needs a new `org.fandex.app` entry. The signing plugin and the version are built (2026-10-23) and an `.aab` builds; **his next step is the upload key**, a `keytool` command and four lines in `~/.gradle/gradle.properties`, after which I build the real bundle. The plan, the command and its order → [docs/play-store.md](docs/play-store.md).

4. **🔵 Board games are built and switched off until a BoardGameGeek token exists** (2026-10-17). **Applied 2026-10-17, still "pending" on 2026-10-24** at boardgamegeek.com/applications (account Ramses3006). Nils: once BGG approves it, create the token there and add `BGG_TOKEN=` to the repo's `.env` (a token never passes through a session). Then mine: `node worker/scripts/push-secrets.mjs`, check `/v1/features` says `boardgames: true`, put the official "Powered by BGG" logo where the text credit is now (the terms require the logo), publish, build an APK. → [PLATFORMS.md](PLATFORMS.md)

5. **🔵 One check from the 2026-10-23 codebase review** (the signed-in CSP check passed 2026-10-24 and the policy is enforced):
   - **If he ever has a token from another Trakt app, try signing in to Fandex with it.** The Worker assumes Trakt refuses a token issued to another app; nobody has proven it. A Trakt identity is keyed on Trakt's uuid since 2026-10-23, and his old username row moves to it on his next Trakt sign-in.

## Mine, open

- 🔵 **The score's data fixes are built (2026-10-25/26, `DERIVE_VERSION` 4)**; the pool still runs on version 3 until the re-derive is switched on (Needs Nils, item 6). What the Worker's cron does on its own once deployed: Steam's voted tags onto the pool's 1,313 games with a Steam page (`runSteamTagsStep`, about a day and a half) and Wikidata's people onto its 2,675 games (`runWikidataPeopleStep`, about two days), three row writes a game. After both walks, check a game page shows "core" and "detail" on its Why rows and Kojima on Metal Gear Solid, and that `/catalog/reference.json` is on the site after the next nightly build. The numbers per fix: [docs/fandex-score.md](docs/fandex-score.md) §3.9 and §3.7.
- ⬜ **Zero the seven no-signal tag categories on prod** (character, object, audience, artstyle, source, perspective, other): measured 2026-10-25, dropping them together costs nothing (films 0.216 → 0.211, games unchanged) and removes 17% of the counted tag rows. Done at the 2026-10-25 deploy by SQL if this line is gone; otherwise `UPDATE tag_category SET weight = 0 …` plus deleting `kv` `taxonomy` and `taxonomy_etag`.
- 🔵 **The TMDB projection walk** (2026-10-23): the cron refetches the 1,698 TMDB links stored before projection v4, four per run, so a film's novelist becomes a writer facet (Stephen King on his adaptations). About three days; watch `tmdb_projection_step` in the logs and `kv` key `tmdb_projection_cursor` reading `done:4`. Then check a King film's page shows him.

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

- **Discord sign-in** ✅ (2026-10-24): the leaked secret reset (the old one answers 401), and Nils's first real Discord sign-in is on his account (`user_identities`, 08:38 UTC), after the phone's return through fandex.org. → `docs/app.md` ("Discord sign-in").
- **The product review, RV1 to RV35, and the cause behind RV11's mixed-up games** ✅ (2026-10-23 and 24, APK 0.3.17). By Nils's call: the calendar stays a top-40, Search keeps rated titles, remasters stay folded. → grep `Product review, 2026-10-23`.
- **The 2026-10-23 review, the open tasks after it, and Steam sync** ✅: hand-made taxonomy rows marked (`source`, migration 0005), the `exhaustive-deps` warnings, the old-site docs moved to `docs/archive/old-site/`, THE FINALS PLAYTEST folded, the TMDB writer jobs, the never-run admin checks. → grep `2026-10-23`.
- **Smoke tests 13 to 15** ✅ (2026-10-11 to 10-17). → grep `13th smoke test`, `14th smoke test`, `15th smoke test`.
- **Backups** ✅ proven restorable (2026-10-05 on D1). → grep `restore drill`.
- **Legal pages** ✅. **The rule that outlives it: strings in `src/lib/legal/content/{de,en}/*.ts` `body:` arrays RENDER to users; they are not code comments.**
- Earlier work (the old site's phases, smoke tests 1 to 12, monetization v1) is archived too.
