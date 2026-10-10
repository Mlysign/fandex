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
| `/{type}/{slug}` | `{type}/{slug}.html`, one per pool title (4,561 on 2026-10-10) | The app's own `ItemPage` rendered to HTML, with title, description, canonical, Open Graph, and JSON-LD (`Movie` / `TVSeries` / `VideoGame` + a two-step breadcrumb). 46 to 60 KB. |
| `/legal/{en,de}/{privacy,terms,support,imprint}` | static pages | Written from `src/lib/legal`. The imprint is `noindex, nofollow, noarchive, nosnippet` twice over (meta tag and header) and out of the sitemap; its address is decoded in the browser. |
| `/search`, `/library`, `/browse`, `/you`, `/item/{id}`, `/open/…`, `/auth/trakt`, an unknown `/{type}/{slug}` | the Worker → `app-shell.html` | The app with nothing else. `noindex`. |
| `/{type}/{uuid}` and `/{type}/{uuid}/{slug}` | the Worker → 308 | The addresses items had before 2026-08-21. Redirects to the stored slug, never the one in the link. |
| `/v1/*` | the Worker → the API Worker (service binding) | Same origin for the app in a browser, so no preflight. |
| anything else | the Worker → `404.html`, status 404 | |
| `www.fandex.org/*` | Worker `fandex-www` | 301 to fandex.org, path and query kept. |
| `robots.txt`, `sitemap.xml` | files | `/v1/` is disallowed except `/v1/calendar/`. The sitemap lists `/`, every item page and six legal pages. |

Three Workers exist: `fandex-api` (worker/, the API), `fandex-web` (the files and `mobile/web/worker.ts`),
`fandex-www` (the redirect). `fandex-web` also answers on `fandex-web.fandex-worker.workers.dev`,
which is where to look at a build if the domain has a problem.

## An item page, for a visitor and for somebody signed in

The static page is complete without JavaScript: artwork, facts, cast, where to watch, tags, links,
the trailer. **It starts the app only when the browser holds a Fandex session**
(`localStorage["fandex.session"]`). Everybody else, crawlers included, would get nothing from the
app but a 3.7 MB download and a catalog sync of about thirty API requests.

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
| Build only | `node mobile/web/build.mjs` |
| A quick try-out, never deployed | `node mobile/web/build.mjs --limit=40` |
| The www redirect (rarely) | `cd worker && npx wrangler deploy --config ../mobile/web/www/wrangler.jsonc` |

A full build takes about a minute: 8 to 40 s for the Expo export, 30 s to fetch 4,561 titles the
first time (one request each; a later build only asks for titles whose `updatedAt` moved), 13 s to
render. The first upload was 4,607 files in 77 s; later ones send only files that changed.
⚠️ A change to the app's bundle changes every item page, because each names the bundle's hashed
file, so that deploy uploads all of them again.

Output is `mobile/web/dist/` (ignored by git): `app/` the Expo export, `site/` what is published,
`cache/items/` the fetched titles, `build.json` what the last build counted.

## Rules specific to the website

- **Publish with `publish.mjs`, never with `wrangler deploy` by hand.** A deploy replaces every
  file on the site with what is in `dist/site`. `publish.mjs` refuses unless the build finished
  and the folder holds exactly the files the build counted. On 2026-10-10 a build died at its last
  step and a chained shell command deployed anyway (`node build.mjs | tail && wrangler deploy`:
  the pipe's exit code is `tail`'s). It went to the test address and changed nothing, by luck.
- **A build that fails leaves nothing to deploy.** Every step throws instead of carrying on short,
  the page count is checked against the pool (98% or it stops), the new folder is swapped in with
  two renames, and `build.json` is written last.
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
- **The site sends no COOP or COEP header, on purpose.** The app's SQLite works without
  cross-origin isolation (checked on the live build: catalog synced, 4,561 titles), Safari has no
  `COEP: credentialless` at all, and an isolated page blocks the YouTube trailer in Firefox.
- **A font URL in a static page is written `%40expo-google-fonts`.** Cloudflare answers a raw `@`
  in a path with a 307 to the encoded form.

## What was checked, and what was not

Checked on the published build, 2026-10-10: every address kind above as a browser navigation;
the security headers the old site sent; the static item page at 375 px and 1100 px (no horizontal
or page-level scroll); fonts with no redirect; the trailer; the handoff to the app with the scroll
kept; the home page booting into the calendar; Browse after a full catalog sync; the imprint's
address decoded in the page and absent from its HTML; that a real Chrome on the site's origin can
reach Trakt (the built-in browser pane cannot: Trakt's bot protection refuses its preflight, which
reads as a CORS error and is not one).

**Not checked:**

- **Signing in on the website.** It is Trakt's code flow in a browser, and approving a code is a
  grant on Nils's Trakt account, so it is his to run.
- **What Google's renderer makes of `/`.** The links in the placeholder are in the HTML Google
  fetches. What it indexes for the page is whatever the app shows after it boots there.
- Anything signed in, in a browser: the Library, the score, rating and saving, and the handoff
  with a real session (it was triggered by hand, by loading the bundle on a static page).

fandex.org did not resolve on Nils's network for its first half hour: the zone had answered "no
such name" since 2026-10-05 and resolvers remember that for 30 minutes. It does now.

## Not built yet

- **The daily build.** The site changes when somebody runs `publish.mjs`. A scheduled GitHub
  Actions job needs a Cloudflare API token as a repository secret, which is Nils's to create.
- **Export and delete buttons.** The Worker has both routes and no screen calls them, so the
  privacy policy says to write to hello@fandex.org. They belong on the You tab (app-parity.md).
- **The 30-day backup retention the privacy policy states** is a lifecycle rule on the R2 bucket
  that does not exist yet (TASKS.md). No export is older than 30 days before 2026-11-04.
- **Tag, person, studio and calendar-month pages.** The old site had them and Google knows their
  addresses; here they answer 404 until their screens exist (app-parity.md, stage 7).
- **Pageview counting, the KPI feed, `assetlinks.json`, a web manifest, a social card image for `/`.**
- **The item page's browser title in the app** stays "Fandex" on `/item/{id}`.
