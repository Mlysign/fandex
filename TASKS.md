# Fandex: Task Tracker

> **This file holds only what is still open.** Settled calls and standing constraints → [docs/decisions.md](docs/decisions.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it; never read it end to end). One-page state → [STATUS.md](STATUS.md).
>
> ⚠️ **A decision is not a task and a constraint is not a task.** Both kept accumulating here and crowding out the actual work — 280 lines on 2026-09-02, of which most was already closed. If an entry has no next action, it belongs in one of the two files above.

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2 to 4 sentences plus a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session.** This file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ⚠️ Needs Nils: this is the whole list

Four items. Everything else in this file is work I can do without him, and every settled call moved to [docs/decisions.md](docs/decisions.md).

0. **🔵 APP + WEBSITE ON CLOUDFLARE: the website is online (2026-10-10). One thing needs Nils.** The plan is [docs/app-plan.md](docs/app-plan.md); the references are [docs/website.md](docs/website.md), [docs/worker.md](docs/worker.md) and [docs/app.md](docs/app.md).
   - **(a) Keep using the app and the site, and say what is off.** Fixed from his three passes on 2026-10-10: the episode section on title pages (now with dates and a details sheet), Settings, "Available on", the filter button under Android's bar, the widget's look, Up next listing unscheduled episodes, facet pages with one title, the poster under the trailer. He confirmed a rating, an episode tick and a default-types change work. **Asked of him and not answered yet:** a tick on the widget, a tag page he knows (its titles come from TMDB by name, and a wrong match is possible), and the episode sheet on the phone. Answered 2026-10-16: fandex.org/tag/steampunk reads "Fandex impact +4.3" for his account, and the CD PROJEKT RED studio page on his phone (27 titles) "looks fine". Download, Delete, a change of country or platforms, and Review's Accept and Deny were all run on a test account on 2026-10-11 and work (the smoke test section below). **Still never run by anybody: disconnecting one of two sign-ins, and Save weights, a category, an alias, a name or an attach on `/dev/scoring`.**
   - **Next, mine:** nothing queued. The 2026-10-17 list (SM79 to SM84, the parity list, the game twins, the restore drill and the export's reads) is done and in the archive (grep "2026-10-17, his list"), and so is his second list that day: books, board games and the photo gallery (grep "books and board games"), plus joining two accounts in the app. The obvious next piece is **Google sign-in on Android** (docs/app.md, "Not built yet"); it needs an Android OAuth client in Google Cloud, made through Nils's Chrome at his word. When the BGG token arrives: item 4 below.
   - **(e) Google sign-in is live in the browser (2026-10-11).** Its privacy and terms paragraphs, and the 2026-10-16 export and deletion lines, were read and approved by Nils on 2026-10-16 ("privacy looks fine"). A real sign-in passed on fandex.org with his account. Never run: the button pressed signed out, and a Google account Fandex has not seen ([docs/app.md](docs/app.md), "Google sign-in, in a browser").
   - **Not built:** Google sign-in on Android, at the bottom of docs/app.md. (Joining two accounts is built since 2026-10-17, docs/app.md.) (The widget: Nils, 2026-10-17, "works fine for now"; do not redesign it unasked.)

2. **Android TWA (P15/P16): ⏸️ PAUSED until the developer account is a BUSINESS account.** (Nils, 2026-08-23.) The package is built and sideloaded on the Pixel 8 with no address bar, and the Play Console entry exists (name `Fandex`, package `org.fandex.twa`, Free). ⚠️ **The 12-testers/14-days gate applies to PERSONAL accounts only**, so a closed test now is likely throwaway work: upgrade first, then re-check whether the gate applies at all. Remaining steps, and the trap that Google re-signs the store build so `TWA_CERT_FINGERPRINT` needs a SECOND fingerprint appended → [docs/twa-play-store.md](docs/twa-play-store.md).

3. **🔵 Discord sign-in is ON since 2026-10-17** (the three redirect addresses added through his Chrome at his word, published, and in the 0.3.2 APK on the phone). Two things left, both his: (a) **reset the client secret** in the Discord developer portal (Fandex → OAuth2 → Reset Secret): it reached a session transcript on 2026-09-02, and the new stack does not use it at all, so nothing needs the new value except the old site's `.env`; (b) **sign in with Discord once**, on fandex.org and on the phone, since a real sign-in has never been run. → [docs/app.md](docs/app.md) ("Discord sign-in")

4. **🔵 Board games are built and switched off until a BoardGameGeek token exists** (2026-10-17). BGG's terms (2025-07-02) require a registered application and a Bearer token on every call, and a donation-funded site registers as commercial ("most likely free"). **Applied 2026-10-17, status "pending"** at boardgamegeek.com/applications (account Ramses3006; as Nils Mlynarek, Düsseldorf, hello@fandex.org, commercial through donations, 1 user). Nils: once BGG approves it, create the token there and add `BGG_TOKEN=` to the repo's `.env` (a token never passes through a session). Then mine: `node worker/scripts/push-secrets.mjs`, check `/v1/features` says `boardgames: true`, find the official "Powered by BGG" logo and put it where the text credit is now (the terms require the logo), publish, build an APK. → [PLATFORMS.md](PLATFORMS.md)

## H3: Monetization 🔵 ads-first, waiting on traffic

**Nothing to do until a gate is hit, and both gates are traffic.** Ads at **10,000 pageviews/mo**,
freemium at **3,500 sustained weekly actives**; `/dev/analytics` measures both. Donations are
live, affiliate is built and dark behind `MONETIZATION_ENABLED` and demoted rather than cancelled.

⚠️ The economics, the two gates and the numbers behind them moved to
[docs/decisions.md](docs/decisions.md) on 2026-09-03 — they are a decision record with no next
action, and this file is for open work. Runbook →
[docs/monetization-go-live.md](docs/monetization-go-live.md). The one thing to know before touching
the code: only **GOG** of the catalog’s store rows is affiliate-capable, so `affiliate.ts` has
two mechanisms. → [[monetization-h3]]

---

## Smoke tests, 2026-10-11 (13th and 14th run, the first two on the new stack)

The 13th run swept the live site, the 14th every write on a test account. All twenty-two findings are fixed and in the archive (grep "13th smoke test", "14th smoke test", "SM66"). Plan: [smoketest.md](smoketest.md), "The new stack".

**Never run by anybody**, and a test account cannot reach the first two: an episode tick or a rating's Trakt half on an account that is not Nils's; disconnecting one of two sign-ins; Add on a Review card; Save weights, a category, an alias, a name or an attach on `/dev/scoring`.

**Not re-logged, still true:** `/dashboard` is 404; Profile's "Coming up" uses the worldwide date (Street Fighter 13 Oct, the calendar says 15); Steam is listed as connected and does not sync; a title removed from the pool between two site builds sends new visitors back to the API for their first sync until the next publish.

## Smoke test, 2026-10-16 (15th run): all fixed

SM76 to SM84 are fixed and in the archive (grep "15th smoke test" and "2026-10-17, his list").

---

## Still open elsewhere

### Added 2026-09-02 (Nils)

- **🔵 Search Console: 4,089 of 4,090 sitemap URLs are "Discovered – currently not indexed", 1 is
  indexed.** (Breakdown from Nils, 2026-09-02.) **ONE reason, and it is the crawl-priority bucket,
  not the quality one**: Google has found these URLs and has not fetched them. So there is nothing
  in the pages to fix — verified independently against live prod, where `sitemap.xml` answers 200
  with 4,341 URLs (4,334 in the canonical 2-segment shape, so no redirect chains) and a Googlebot-UA
  fetch of `/movie/the-innocents` returns 200, `index, follow`, a self-referencing canonical and 29
  internal links. ⚠️ **"Crawled – currently not indexed" is the bucket that would mean thin content,
  and it is EMPTY.** Do not go thickening pages; that is answering a question nobody asked.
  What actually moves this: **external links** (the domain is ~2 weeks old with near-zero authority,
  and crawl budget is rationed to unproven sites), then internal link depth. ⚠️ Dumping several
  thousand URLs at once on a new domain is itself part of the signal. **Mostly it is time.** →
  [docs/seo.md](docs/seo.md). ⚠️ The sitemap total moves daily with the catalog (2,037 → 4,341 →
  4,507 in a month), so count it rather than quoting one: `curl -s https://fandex.org/sitemap.xml
  | grep -c '<loc>'`.

  **The ranked plan, after Nils asked "would a link from nilsmlynarek.eu be enough?" (2026-09-02).**
  Short answer no, and the goal itself is wrong: ⚠️ **"all 4,341 indexed" is not achievable and not
  worth chasing.** Item pages are provider-derived metadata that appears on dozens of other sites,
  so once Google does crawl them many will land in "Crawled – currently not indexed" on merit. The
  target is the pages that can actually rank: calendar months, facet pages, and items where we add
  something. In order of what actually moves the needle:
  1. **External links.** nilsmlynarek.eu is real, live and topically relevant (a game developer's
     portfolio), so it is worth adding and costs nothing. But it is a small static site with **no
     robots.txt, no sitemap.xml and one outbound link (LinkedIn)**, so its own authority is thin.
     Treat it as one nudge, not a fix.
  2. **Places with real traffic**: Show HN, Product Hunt, the subreddits for the trackers we import
     from. Mostly `nofollow`, so no PageRank, but they get the domain crawled and can earn real
     editorial links, which is the thing that compounds.
  3. **Internal link depth**, the only lever that is ours. "Discovered, not crawled" usually means a
     URL is known ONLY from the sitemap with little pointing at it. Fixing the facet under-linking
     (open, below) and then putting facet pages in the sitemap deepens the graph into the item
     pages, which is exactly the shape that raises crawl priority.
  4. **A smaller sitemap.** 4,341 URLs at a uniform 0.7 priority tells Google nothing about which
     matter. Speculative, cheap, reversible.


### Added 2026-09-03

- **⬜ The tag tail: ~9,000 tags in Other appearing three times or fewer.** The Review tab's rules
  deliberately stop at the head (91% of everything appearing 20+ times). The tail is not worth a
  card each and is not worth hand-triage either; if it is ever worth doing, it is a bulk-select
  pass in the Tags table against a search, not more rules. ⚠️ **Do not judge coverage by tag COUNT**
  — a rule claiming 12 tags seen 900 times changes more of the site than one claiming 80 nobody
  carries twice.

### Older

- **⬜ Desktop mockups for the filter panel**, once the mobile one has been used in anger.

- **⬜ Nothing uses the media-type setting to SPEND less.** Three places could, in value order:
  `/api/discover?q=` still fetches disabled types (the only real provider-call saving, since search
  is uncached and games are 2 of its 4 calls); `/api/library` and `/api/calendar` already take
  `?type=` and could default it from the setting, cutting a 1,942-item payload instead of filtering
  it in the browser; and the Discover fan-out could skip a disabled section. ⚠️ Only the first saves
  QUOTA — `_pageCache` keys carry no userId, so another visitor's games request in the same
  15-minute window pays anyway.

- **⬜ The list payload carries ~4.7 MB that only the DETAIL page reads.** `/api/library`, 1,943
  items: `cast` 1,183 KB · `description` 1,014 KB · `images` 966 KB · `storeLinks` 853 KB ·
  `links` 697 KB — 54%, and `MediaCardItem` names none of them. `tags` + `keywords` (552 KB) lost
  their last client reader when `itemFacetIds` went. ⚠️ **Below compression, and riskier**: the
  2026-07-30 audit kept cast/images/description deliberately, and dropping a field from a payload
  two routes and one component share is the exact shape of the bug this list keeps recording.
  Verify every consumer on BOTH routes first.

- **`/library` + `/wishlist` + `/settings` dead under `next dev`: DEV ONLY, and the fix is DECIDED.** ⚠️ **`/settings` joined the list 2026-08-27**, with a worse symptom: it has no loading state, so the dead tree renders the SIGNED-IN chrome with every field empty (four "Connect" buttons, "Watchlist items 0") for an account that has all four connected. That reads as data loss, not as a dead page. **Nils decided 2026-08-17: option 1, leave it.** Do not restructure `MyStuffView`. **Re-test on the next `next` bump**; a Dependabot PR is the moment. Diagnostic: `Object.keys(document.querySelector("main")).some(k => k.startsWith("__reactFiber"))` false on `<main>` but true on `body` means an unhydrated subtree, not a slow fetch. ⚠️ **Re-check first**: `/wishlist` hydrated normally under `next dev` on 2026-08-18, and `MyStuffView` changed that session, so it may be fixed or intermittent. → grep the archive for `library + wishlist dead under next dev`.

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
