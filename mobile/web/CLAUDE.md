# The website (fandex.org)

fandex.org is files a build writes, served without running code. Addresses, the publish command and the nightly task are in `docs/website.md`; the incidents are in memory [[website-static-build]].

- **Publish with `node mobile/web/publish.mjs`, never `wrangler deploy` by hand.** A deploy replaces every file on the site with what is in `dist/site`, a half-built folder included. `build | tail && deploy` deploys after a failed build: a pipe's exit code is its last command's.
- **Stop the `app-web` dev server before publishing.** Metro watches the output folder and Windows won't rename a watched folder (`EPERM`).
- **The files live on their own Worker, `fandex-web`**, so an API deploy from a checkout with no build can't empty the site.
- **No `not_found_handling` in this folder's `wrangler.jsonc`.** With it, Cloudflare answers a browser's navigation to an unknown address itself and never runs `worker.ts`: a 404 in a browser, a 200 in curl. Test a route with `Sec-Fetch-Mode: navigate`. A new facet page kind goes in `worker.ts`'s `appRoute` too.
- **A static item page starts the app only for a signed-in browser, and `/v1/` is disallowed in `robots.txt`.** Both keep crawlers from spending the API's daily budget on a catalog sync.
- **The `/catalog/` files are the PRODUCTION catalog; only an app with no API address configured starts from them** (`CATALOG_FILES_URL`). Decide "production" by whether an address was configured, never by comparing addresses, which would put the address in the bundle.
- **Anything `ItemPage` or `LegalLinks` imports must render on a server** (no database, session, router or `window` at render time), and a page keeps its heading: the build throws without one.
- **The item page's two columns are their own box (`columns`), and the full-width band comes after it, never inside.** Chrome doesn't stop a sticky grid item at the end of its row. → `mobile/src/components/itemLayout.ts`
- **`mobile/patches/expo-sqlite+*.patch` is what lets a second tab start**, and it must survive an upgrade. A database file per tab and a Web Lock hand-over were both tried and failed. After bumping expo-sqlite, re-make the patch and open the site in two tabs.
- **Pageviews are counters per kind of page, with no identifier, and the privacy policy describes exactly what `worker/src/telemetry.ts` keeps.** Change what is counted and the policy text in `src/lib/legal` changes in the same publish, in both languages. The Android app never sends the beacon. → [[telemetry-self-hosted]]
