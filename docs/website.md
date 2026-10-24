# The website: fandex.org

_Phase 3 of [app-plan.md](app-plan.md), online since 2026-10-10. This is the reference for
`mobile/web/`: what fandex.org serves, how it is published, and the rules that are specific to it.
The app it is built from is [app.md](app.md); the API behind it is [worker.md](worker.md)._

## What is live

fandex.org is files. A build renders them on a machine, and Cloudflare serves them without running
any code, so a visitor or a crawler costs no Worker request, no CPU and no database read.

| Address | What answers | Notes |
|---|---|---|
| `/` | `index.html` | The app (it opens on the calendar), plus a placeholder a crawler can read: the name, the tagline, the 30 most-voted titles of each type as links, the legal links. The app removes it once it is up. |
| `/{type}/{slug}` | `{type}/{slug}.html`, one per pool title (4,561 on 2026-10-10) | The app's own `ItemPage` rendered to HTML, with title, description, canonical, Open Graph, and JSON-LD (`Movie` / `TVSeries` / `VideoGame` + a breadcrumb through the title's first tag that has a page). Since 2026-10-15 with both related rails, picked by the build with the app's `lib/related.ts` over the whole pool (4,526 of 4,561 pages have one). About 135 KB on average, up from 55: a card is about 4 KB of HTML. |
| `/{tag,person,studio,franchise}/{slug}` | `{kind}/{slug}.html`, one per facet three or more pool titles carry (4,869 on 2026-10-15: 2,554 tags, 1,487 people, 828 studios; franchises since 2026-10-18, the franchise after the taxonomy, as the app's FacetScreen reads it) | The app's FacetScreen as a visitor sees it: `FacetHeader`, the numbers over every title, and the 36 most popular as static cards (`cardFace.tsx`; drawing all of them made "Action" 10 MB). The old site's title and description. In the sitemap. Fewer than three titles, or a key with punctuation, stays app-only. |
| `/calendar/{YYYY-MM}` | `calendar/{month}.html`, last month and the next six (8 on 2026-10-15) | The old site's month pages, which Google still held: the month's releases in US dates from `/v1/calendar`, as static cards with the day on each, chips to the other months, `ItemList` JSON-LD. No app on them (it has no per-month address). Fewer than three releases is written but `noindex` and out of the sitemap. `robots.txt` allows `/calendar/` and disallows `/calendar`, the longer match winning. A month outside the window is a 404. |
| `/legal/{en,de}/{privacy,terms,support,imprint}` | static pages | Written from `src/lib/legal`. The imprint is `noindex, nofollow, noarchive, nosnippet` twice over (meta tag and header) and out of the sitemap; its address is decoded in the browser. |
| `/discover`, `/calendar`, `/wishlist`, `/library`, `/profile`, `/settings`, `/insights`, a `/tag/`, `/person/`, `/studio/` or `/franchise/` address with no file, `/item/{id}`, `/open/…`, `/auth/trakt`, an unknown `/{type}/{slug}` | the Worker → `app-shell.html` | The app with nothing else. `noindex`. The one-word addresses are the old site's. |
| `/{type}/{uuid}` and `/{type}/{uuid}/{slug}` | the Worker → 308 | The addresses items had before 2026-08-21. Redirects to the stored slug, never the one in the link. |
| `/{type}/{old-slug}` of a title folded into another | `_redirects` → 301 | Written by the build from `mobile/web/folded.json` (66 game ports on 2026-10-15). Cloudflare applies it before any file, so the build leaves out an address a live title holds again. |
| `/{type}/{Slug}` with a capital letter in it | the Worker → 308 to lowercase | Stored slugs are lowercase; before 2026-10-11 `/movie/Alien` was a hard 404. |
| `/catalog/index.json`, `/catalog/pNNN.json` | files (23 pages of 150 on 2026-10-11, 1.35 MB over the wire) | The whole scoring pool, in the exact shape `/v1/catalog/delta` answers with. A device that holds nothing starts here and then asks the API for what changed since the build. `noindex`, `max-age=300`, readable from any origin (the Android app fetches it). |
| `/v1/*` | the Worker → the API Worker (service binding) | Same origin for the app in a browser, so no preflight. |
| anything else | the Worker → `404.html`, status 404 | |
| `www.fandex.org/*` | Worker `fandex-www` | 301 to fandex.org, path and query kept. |
| `robots.txt`, `sitemap.xml` | files | `/v1/` is disallowed except `/v1/calendar/`, and so is `/catalog/`. The sitemap lists `/`, every item page, every facet page, the calendar months and six legal pages (9,449 on 2026-10-15). |

Three Workers exist: `fandex-api` (worker/, the API), `fandex-web` (the files and `mobile/web/worker.ts`),
`fandex-www` (the redirect). `fandex-web` also answers on `fandex-web.fandex-worker.workers.dev`,
which is where to look at a build if the domain has a problem.

## An item page, for a visitor and for somebody signed in

The static page is complete without JavaScript: artwork, facts, cast, where to watch, tags, links,
the trailer. **It starts the app only when the browser holds a Fandex session**
(`localStorage["fandex.session"]`). Everybody else, crawlers included, would get nothing from the
app but a 3.7 MB download and a catalog sync.

**What a signed-out visitor can do there is links** (`personal` in `mobile/web/render.tsx`): the
score panel's signed-out face, Rate and Add to wishlist, all three leading to `/profile`, where the
app asks them to sign in. Nothing on a static page has a handler. Before 2026-10-11 the page
offered nothing at all, and it is the page a search engine sends people to.

## The catalog as files

The build already downloads every pool title, so it also writes them out the way the API would
have answered: `catalog/index.json` (`{version, pages}`) and one `pNNN.json` per 150 titles, each
`{items, next}` with the cursor to continue from. `startFromFiles` in
`mobile/src/lib/catalogSync.ts` reads them when a device's cursor is at zero, stores each page the
way a delta page is stored, and leaves the cursor at the last file's `next`. The ordinary sync then
asks the API once for what changed since.

- **Why:** a first visit was 31 API requests and 9,122 D1 rows read, so about 550 new visitors in
  a day would have spent D1's 5 million and stopped the API for everybody. Seen on the live site
  on 2026-10-11 with storage cleared: 24 files, then one `/v1/catalog/delta`.
- ⚠️ **They are the PRODUCTION catalog.** `CATALOG_FILES_URL` (`mobile/src/lib/config.ts`) is `""`
  on the website, `https://fandex.org` in an app built with no API address configured, and `null`
  for an app pointed anywhere else, which then syncs through its own API. A local test stack that
  started from these files would hold another database's ids and cursor.
- ⚠️ **"Production" is spelled "no address was configured", never a comparison with the API's
  address.** The build throws if the web bundle names any API address but `/`, and a comparison
  put that address in the bundle: the first publish with this feature was refused.
- **It never throws.** A missing index, a failed page or a wrong shape leaves the cursor where it
  was, and the device carries on through the API from there.
- **Not written by `--limit` builds**, which hold a fraction of the pool.
- A title removed from the pool after a build is still in the files. A device that started from
  them then holds more than the pool, starts over once through the API, and is right after that.
  The next publish ends it.

When it does start, the app renders underneath the static copy (`<div id="prerender">` lies over
`#root`) and removes the copy once the same page is on screen, carrying the scroll position over
(`mobile/src/lib/prerender.ts`). Checked 2026-10-10: scrolled 900 px down, the app took over at
900 px. If the app never gets that far, the static page stays.

## Commands

From the repo root.

| Task | Command |
|---|---|
| Build and publish | `node mobile/web/publish.mjs` |
| Publish the last build again (a `worker.ts` change) | `node mobile/web/publish.mjs --skip-build` |
| Build and run every check, and stop before deploying | `node mobile/web/publish.mjs --check` |
| Build only | `node mobile/web/build.mjs` |
| A quick try-out, never deployed | `node mobile/web/build.mjs --limit=40` |
| Publish although facet pages or rails dropped more than 10% (a drop known to be right) | `node mobile/web/publish.mjs --accept-shrink` (or `nightly.mjs --accept-shrink`) |
| The www redirect (rarely) | `cd worker && npx wrangler deploy --config ../mobile/web/www/wrangler.jsonc` |

A full build takes about a minute: 8 to 40 s for the Expo export, 30 s to fetch 4,561 titles the
first time (one request each; a later build only asks for titles whose `updatedAt` moved, or for
all of them when the Worker's merge rule changed, which it reads as `deriveVersion` in the delta), 13 s to
render. The first upload was 4,607 files in 77 s; later ones send only files that changed.
⚠️ A change to the app's bundle changes every item page, because each names the bundle's hashed
file, so that deploy uploads all of them again.

Output is `mobile/web/dist/` (ignored by git): `app/` the Expo export, `site/` what is published,
`cache/items/` the fetched titles, `build.json` what the last build counted (item pages, facet
pages per kind, item pages with rails, files). A `--limit` try-out carries the last full build's
counts on in `baseline`, so it does not reset what the next full build is held to.

### The nightly rebuild (since 2026-10-16)

The Windows task **"Fandex nightly site"** on Nils's PC runs `node mobile/web/nightly.mjs` daily at
06:30 local time, after the D1 export, or as soon as the PC is on if it was off then. It builds a
worktree of `origin/main` of its own at `C:\fx\site`, never this checkout (other sessions'
half-finished edits live here), runs `git clean -fd` there so no untracked file reaches the
bundle, runs `npm ci` only when a lockfile or a `patches/` file changed, copies `mobile/.env` in, and runs
`publish.mjs`. Logs, one a day, the last 14 kept: `C:\fx\site-logs`; a failed run, a thrown
error included, also leaves `LAST-RUN-FAILED.txt` there, because the task's own result reads 0
either way.

**It publishes the newest commit on main whose CI passed** (since 2026-10-23). It asks
`gh run list --workflow=ci.yml --branch main`; when the head commit failed CI, is still in it, or
has no run yet, the log says so and the night builds the newest earlier commit that passed. When
`gh` cannot be asked (not installed, or logged in only inside the Claude app, the same trap as
Wrangler's login below), the log warns and the head is built unchecked. When `gh` answers and
none of main's last 30 commits passed, nothing is built and the run fails. Wrangler's
browser login does the deploy, so no Cloudflare token exists; when that login lapses, the log says
so and `npx wrangler login` in `worker/` fixes it.

⚠️ **Where that login lives.** The Claude desktop app is a packaged Windows app, and what runs inside
it writes AppData into its own folder: a `wrangler login` from a Claude session is at
`%LOCALAPPDATA%\Packages\Claude_…\LocalCache\Roaming\xdg.config\.wrangler`, invisible to the task.
The first scheduled run failed on exactly that ("In a non-interactive environment, it's necessary to
set a CLOUDFLARE_API_TOKEN"). `nightly.mjs` uses a login in the real AppData when there is one and
otherwise points Wrangler at the packaged copy through `XDG_CONFIG_HOME`. Never copy the file: a
refresh replaces the refresh token, so two copies means one stops working.

- Run it now: `node mobile/web/nightly.mjs` (or `--check` to stop before the deploy), or start the
  task: `Start-ScheduledTask "Fandex nightly site"` in PowerShell.
- ⚠️ It publishes only what is on `origin/main` and green in CI. A fix that is committed and not
  pushed, or pushed with CI red, is not on the next night's site.
- `.github/workflows/site.yml` is the same job for GitHub, by hand only now. Giving it a timer
  again without removing the task would publish twice a day.

## Rules specific to the website

- **Publish with `publish.mjs`, never with `wrangler deploy` by hand.** A deploy replaces every
  file on the site with what is in `dist/site`. `publish.mjs` refuses unless the build finished
  and the folder holds exactly the files the build counted. On 2026-10-10 a build died at its last
  step and a chained shell command deployed anyway (`node build.mjs | tail && wrangler deploy`:
  the pipe's exit code is `tail`'s). It went to the test address and changed nothing, by luck.
- **A build that fails leaves nothing to deploy.** Every step throws instead of carrying on short,
  the item page count is checked against the pool (98% or it stops), the new folder is swapped in
  with two renames, and `build.json` is written last. If the second rename fails, the first is
  undone and the old `build.json` written back, so `--skip-build` still has the last good build.
- **Facet pages and rails are held to the last full build** (since 2026-10-23): below 90% of its
  facet pages, or of its item pages with rails, or a kind of facet page (tag, person, studio,
  franchise) gone entirely, and the build stops. `--accept-shrink` lets a drop that is right
  through, such as a sweep that folded many tags. A delta with titles and no facet page at all
  always stops. The checks are `mobile/web/buildChecks.mjs`, tested in
  `mobile/src/lib/webBuildChecks.test.ts`.
- **No `not_found_handling` in `wrangler.jsonc`.** With `"404-page"` set, Cloudflare answers a
  browser's navigation to an unknown address itself and never runs `worker.ts`: `/search`,
  `/library` and every old item link were a 404 in a browser while curl got the right answer,
  because curl sends no `Sec-Fetch-Mode: navigate`. Test routes with that header.
- **The website's own Worker, not the API's, carries the files.** If `fandex-api` did, deploying
  an API change from a checkout with no build would take the site down.
- **`ItemPage` must render on a server**: no database, session or router in it (app.md says why).
  The build fails a page that comes out without a heading.
- **The app's API address for the website is `/`**, set inside `build.mjs`. Not on a command line:
  Git Bash rewrites a lone `/` in an environment variable to `C:/Program Files/Git/`, and the
  bundle then calls that. The build throws if the bundle names any other API address.
- **The Content-Security-Policy is ENFORCED since 2026-10-24** (report-only from 2026-10-23).
  `_headers` sends one `Content-Security-Policy`, built by `contentSecurityPolicy` in
  `mobile/web/buildChecks.mjs`, which lists why each source is there. The build's inline scripts
  (the pageview beacon, the item page's boot check, the imprint's address) are allowed by their
  sha256, computed by the build from the exact text it writes, so editing one needs no change
  here. It has no `report-uri`: a violation shows only in a browser's console. Checked before the
  switch: locally enforced on 2026-10-23 (an item page with its trailer, the imprint, `/discover`
  storing the catalog, a control script blocked), and on fandex.org signed in on 2026-10-24 (Home
  with the Trakt and Steam syncs, Search, a film with its trailer, the Library, a book page,
  Profile and Settings) with no violation. Not checked: a sign-in itself, which is a page
  navigation the policy does not cover, and a board game page (switched off).
  ⚠️ A new third party the browser fetches from (not a page it navigates to) needs its origin in
  `connect-src`, or it is blocked on the live site.
- **The site sends no COOP or COEP header, on purpose.** The app's SQLite works without
  cross-origin isolation (checked on the live build: catalog synced, 4,561 titles), Safari has no
  `COEP: credentialless` at all, and an isolated page blocks the YouTube trailer in Firefox.
- **A font URL in a static page is written `%40expo-google-fonts`.** Cloudflare answers a raw `@`
  in a path with a 307 to the encoded form.

- **A build with a Google button is published only where the button works** (2026-10-11).
  `publish.mjs` looks for a Google client id in the bundle. If there is one it asks Google whether
  `https://fandex.org/auth/google` is a return address the client lists, and asks the live API
  whether it checks the nonce, and refuses on either "no". Both are settings outside this folder
  whose absence nothing else shows: the first is a line in Google's console, the second is the
  API Worker's deploy. To publish without the button, take `EXPO_PUBLIC_GOOGLE_CLIENT_ID` out of
  `mobile/.env`. → [app.md](app.md) ("Google sign-in, in a browser")
- **Stop the app's dev server before publishing.** Metro watches `mobile/`, the build's output folder included, and on Windows a watched folder cannot be renamed: the build's last step failed with `EPERM` for as long as `app-web` was running, retries and all. The moved route files also came back as OneDrive placeholders that Metro could not read (`EINVAL: readlink`) until they were rewritten. The same error on the next `app-web` start after a build, naming a different file under `web/dist` each time, is Metro's own file list from before the build: delete `metro-file-map-expo-*` in the temp folder and start again.
- **A build started straight after another can wait up to a minute at "exporting the app".** The checkout is in OneDrive, which holds a file open while it uploads it; `build.mjs` retries the delete of the last export instead of failing with `EPERM`.
- **An upload can fail with `fetch failed` and be retried as is**: `node mobile/web/publish.mjs --skip-build`. It failed five times in a row once, on 250 MB.
- **A static page names `/app-boot.js`, never the app's bundle.** The bundle's file name changes with every build of the app; a page that carried it was rewritten and re-uploaded each time, all 4,561 of them. `app-boot.js` is the one small file that knows the current name. A change to the app now uploads six files. A change to `ItemPage`, `AppNav` or `itemLayout.ts` still rewrites every page, because it changes their HTML.
- **A static item page carries both navigation bars** and its CSS shows the one for the window's width (`data-nav`), because a server cannot know the width. The app picks in JavaScript.

## What was checked, and what was not

Checked on the published build, 2026-10-10: every address kind above as a browser navigation;
the security headers the old site sent; the static item page at 375 px and 1100 px (no horizontal
or page-level scroll); fonts with no redirect; the trailer; the handoff to the app with the scroll
kept; the home page booting into the calendar; Browse after a full catalog sync; the imprint's
address decoded in the page and absent from its HTML; that a real Chrome on the site's origin can
reach Trakt (the built-in browser pane cannot: Trakt's bot protection refuses its preflight, which
reads as a CORS error and is not one).

**Not checked:**

- **Signing in with Trakt on the website.** It is Trakt's code flow in a browser, and approving a
  code is a grant on Nils's Trakt account, so it is his to run. Google's sign-in was run on the
  live site on 2026-10-11 ([app.md](app.md), "Google sign-in, in a browser"), though not from the
  button and not signed out.
- **What Google's renderer makes of `/`.** The links in the placeholder are in the HTML Google
  fetches. What it indexes for the page is whatever the app shows after it boots there.
- Anything signed in, in a browser: the Library, the score, rating and saving, and the handoff
  with a real session (it was triggered by hand, by loading the bundle on a static page).

fandex.org did not resolve on Nils's network for its first half hour: the zone had answered "no
such name" since 2026-10-05 and resolvers remember that for 30 minutes. It does now.

## Not built yet

- **The KPI feed, `assetlinks.json`, a web manifest, a social card image for `/`.**
- **Plain http redirects to https** because "Always Use HTTPS" is on in the Cloudflare dashboard
  (SSL/TLS, Edge Certificates, since 2026-10-11). Nothing in the repo holds that switch.
