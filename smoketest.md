# Fandex smoke test plan

Living plan for the `/smoketest` skill. **Findings do not go here.** They go into
[TASKS.md](TASKS.md) as a dated "Smoke test, YYYY-MM-DD" section with id prefix **`SM#`**. Check
TASKS.md and a grep of `docs/archive/history.md` before logging, so a known finding is not logged
twice.

**Etiquette:** observe, don't fix. Functional bugs, data that disagrees with itself, lost
navigation or state, console and server errors, and concrete UX findings (readability, touch
targets, layout) are all in scope. Nils does his own pass for taste calls.

## The stack under test

fandex.org is static files, the Expo app in a browser, and a Cloudflare Worker on D1
([docs/website.md](docs/website.md), [docs/worker.md](docs/worker.md), [docs/app.md](docs/app.md)),
plus the native Android app. Runs so far on this stack: the 13th (2026-10-11, SM54 to SM70), the
14th the same day on a test account (SM71 to SM75), the 15th (2026-10-16, randomised, web plus the
native app, SM76 to SM84). The plan the old Next.js site used is in
[docs/archive/old-site/smoketest.md](docs/archive/old-site/smoketest.md).

### How to reach it

| State | Tool | Notes |
|---|---|---|
| Static pages, API | `curl` | Send `-H "Sec-Fetch-Mode: navigate"` for a page, or an app-only address reads 404 where a browser gets the app. API: `https://api.fandex.org` (the edge cache works only there; workers.dev stays on for old APKs). |
| The app, signed out | the in-app Browser pane on `https://fandex.org` | Genuinely anonymous. It cannot call Trakt. |
| The app, signed in | Nils's Chrome (`claude-in-chrome`) | His real account, admin included. **Read only**: every write is a real write to Trakt. |
| The phone | `adb` | It is his phone and he may be holding it. Check `dumpsys window | grep mCurrentFocus` first, read with `uiautomator dump`, open a screen with `am start -a android.intent.action.VIEW -d "fandex://movie/inception" org.fandex.app`, and leave it on the home screen. |

| **Anything that WRITES** | the pane on `http://localhost:8081`, a Worker and database on this machine | Since 2026-10-11. See below. |

**On the live site and the phone, write nothing.** Do not rate, tick, hide, save a setting,
disconnect, download, delete, or press Accept or Deny on Review there.

**Writes are tested on the local stack, with a test account** (built for SM70):

1. `node worker/scripts/dev-stack.mjs` once. It writes `worker/.dev.vars`, migrates a local D1
   and loads the catalog with nobody's library. `--reseed` throws the local database away.
2. Start the launch configurations `worker-local` (:8787) and `app-web-local` (:8081).
3. Open `http://localhost:8081/profile` and press **Test account**. "Second test account" is
   the other one, for anything that needs two people.
4. Check a write where it lands: `npx wrangler d1 execute fandex --local --json --command "SELECT …"`
   from `worker/`.
5. **Stop both servers before `node mobile/web/publish.mjs`**: Metro watches the build's folder.

What to know about them: the first is an admin on this machine, so `/dev/*` opens. Their
identity is `google` and they have no Trakt, so nothing reaches Trakt, no Trakt sync runs, and
"Disconnect Trakt" has nothing to act on. They start EMPTY, so the score panel shows its
cold-start face until a few titles are rated. The app there syncs its catalog through the local
Worker, never from the live site's files.

⚠️ **Since 2026-10-11 Settings shows a test account a "Connect" row for Trakt. Do not finish it.**
Confirming the code links a real Trakt account to the test account, and from then on its ratings
are real writes to Trakt. Pressing Connect only asks Trakt for a code and is harmless.

**Google sign-in, what a session can run here:** the button on a signed-out card leaves for
Google (Google lists `http://localhost:8081/auth/google`), and `/auth/google#state=x&id_token=y`
opened by hand is refused on the screen. Approving at Google is a grant on a real account and is
Nils's, here and on fandex.org.

### What bites, read before the first probe

- **The pane does not draw unless something makes it, and the app waits for a draw.** `rAF` and
  `ResizeObserver` do not fire, so a grid stays on its spinner and a load "takes 12 seconds". Take
  a small screenshot (`scale: 0.2`) straight after `navigate` and before any timing or list read.
  Control from the 13th run: the same warm load read 12.4 s without a screenshot and 1.7 s with.
  When screenshots time out (Claude's window is behind another), lists that are already mounted
  can still be read and clicked; a fresh hard load of a list screen cannot be trusted.
- **`#root`'s `innerText` includes every screen you have visited.** The tab screens stay mounted
  with `aria-hidden="true"`. Read only what has no hidden ancestor:
  ```js
  const V = () => [...document.querySelectorAll('#root *')].filter((e) => { for (let x = e; x && x.id !== 'root'; x = x.parentElement) { if (x.getAttribute('aria-hidden') === 'true') return false; const cs = getComputedStyle(x); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } return true; });
  const T = () => V().filter((e) => e.children.length === 0 && e.textContent.trim()).map((e) => e.textContent.trim());
  ```
- **Click with `element.click()`**, found by `aria-label` or text among `V()`. A click by ref does
  nothing in a hidden Chrome window. Type into a field with the native value setter and an `input` event.
- **In Chrome, navigate INSIDE the app** (click an `a[href]`). Each hard load there is a second
  tab on an in-memory database: it downloads the catalog and every row again (about 30,000 D1
  rows read) and runs a full Trakt sync. Six in ten minutes got Trakt answering 429 (SM55).
- **Rows read are the budget.** Before and after a sweep: `npx wrangler d1 insights fandex
  --timePeriod 1d --sort-type sum --sort-by reads --limit 6 --json` from `worker/`. It is a rolling
  24 hours. Never loop an API probe.
- To time a first visit, open a legal page (the app is not running there), delete the stored
  database, then load `/`: `for await (const [n] of (await navigator.storage.getDirectory()).entries()) …removeEntry(n, {recursive: true})`.

### Checklist

**N-A. Static site (curl).**
1. Every address kind in docs/website.md's table: status, size, `<title>`. Unknown path 404, unknown `/{type}/{slug}` the app shell (200, `noindex`), `/legal/fr/…` 404.
2. Headers on a title page: HSTS, `frame-ancestors`, `nosniff`, `X-Frame-Options`, referrer and permissions policy. The bundle is `immutable`, `app-boot.js` is `no-cache`.
3. `http://fandex.org/` must redirect to https (301 since 2026-10-11; a Cloudflare dashboard switch, so nothing in the repo holds it).
4. `robots.txt` as documented; `sitemap.xml` count = 1 + pool + 6 legal; 30 random entries all 200.
5. A film, a show and a game page: canonical, Open Graph, JSON-LD, `/person/` and `/tag/` links, one `loading="eager"` image, no `<script src>`. The imprint is `noindex` in the meta tag AND the header.
6. `/{type}/{uuid}` and `/{type}/{uuid}/{junk}` 308 to the stored slug; `www.` 301 with path and query.
7. **What a signed-out visitor can DO on a title page** (SM57): the HTML has "Sign in" twice, "Rate" once, and five `href="/profile"`.
7a. `/catalog/index.json` is 200 with `Access-Control-Allow-Origin: *` and `X-Robots-Tag: noindex`; its `pages` count is the pool ÷ 150 rounded up; `robots.txt` disallows `/catalog/`. `/movie/Alien` is a 308 to `/movie/alien`.

**N-B. API (curl), no session.**
8. `health`, an item by id and by `type/slug`, `?region=DE` and a junk region, an unknown slug (404), a bad type (400).
9. Bad input: malformed JSON, wrong shape, 201 ids, a 300 KB body (413), a forged bearer (401), `PUT /v1/me/state` (401), `/v1/admin/*` (404, never 401 or 403).
10. Wrong method on a real route (405 with `Allow`), `HEAD /v1/health` (200), a film's id on `/v1/shows/{id}/episodes` (404), a foreign `Origin` (no CORS headers, preflight 403), `If-None-Match` on `/v1/taxonomy` (304).
10a. **`POST /v1/dev/login` is 404 on BOTH live hosts**, `fandex.org/v1/…` and the workers.dev one, with and without a `Host: localhost` header. Anything else is an open door.
11. Game search: `marvel's`, a double quote, a semicolon, an accent, 300 characters, `<script>` (200 since 2026-10-11). **Never send five failing ones in a row**, that is the credential latch's threshold.

**N-C. The app, signed out (pane).**
12. Home: guest panel, Popular and Upcoming, 30 cards, each with "Sign in to rate this" and "Sign in to add this to your wishlist". No Up next, no Recommended.
13. Discover: with nothing typed, `titles · N` is the pool PLUS the upcoming titles from the providers that the catalog does not hold (about 65 on 2026-10-16), so it is larger than Settings' "Titles" on purpose; the type chips must still sum to it; search a title (count = cards), a nonsense string ("Nothing found"), one character; each type chip and two together (the counts must add up); each sort; Filters: a streaming service (`Netflix N` → `Show N titles`), a person (the count must equal the cards), both together, Reset all.
14. Open a result, press Back: the query and the results must still be there.
15. Calendar: Next twice, Previous four times, Today; a busy day (the rail's cards = the day's label), an empty day ("Nothing releasing on this day."), the list view; `scrollHeight - innerHeight` is 0 throughout.
16. Gates: `/wishlist`, `/library`, `/profile`, `/settings`, `/insights` stay on their address and ask; `/dev/scoring` says "Nothing here".
17. `/person/ridley-scott`, `/tag/space`, `/studio/cd-projekt-red`, an unknown person; an unknown title; `/open/tmdb/movie/603`; `/open/tmdb/movie/abc`.
18. At 375 px: a static title page, a legal page, the imprint: no sideways overflow, bottom nav shown, top nav hidden.
19. `document.title` per route ("Search · Fandex", a title's name and year) and where a card leads (`/{type}/{slug}`, no `/item/` among a grid's links).
19a. **A first visit**: clear the stored database on a legal page (see above), load `/discover`, then count resources: 24 or so under `/catalog/`, and exactly ONE `/v1/catalog/delta`. More than one means the device did not start from the files.
19b. Discover's default order mixes the three types in the first row; "Rating" does not open on single-vote 10.0s.

**N-D. Signed in (Chrome, reading only, client navigation only).**
20. Profile's three numbers = the Lists tabs' counts = Settings' Account block.
21. Insights: the three type tiles sum to "Rated items", and so does "How you rate". A bar with no number is a zero.
22. Home: Up next's boxes all unchecked; **no "No connection" line while online** (SM55); compare the rail with the phone's.
23. A title page: the panel's number, then "Why?": baseline + the counted rows = the number. Rows under "Not counted" show what they would be worth and are not part of the sum.
24. Settings: connected accounts, region, default types, platforms; read the copy against what sign-in really offers (SM62).
25. `/dev/scoring` → Taxonomy → Review: the card counts, and "N suggestions denied and hidden".

**N-E. Cost.** One full catalog page reads 300 rows for 150 titles (2026-10-11). Re-measure after any change to the delta query. A first-time visitor no longer pays it (check 19a); a second browser tab and an app pointed at another Worker still do.

**N-F. Writes (the local stack, a test account).** All of it ran on 2026-10-11 (14th run, SM71 to SM75, fixed the same day) and every write worked. Read each one back from the local D1; the screen alone proves nothing.
26. Settings: change the country (`users.country`), switch a default type off (`media_types`), pick a platform (`platforms`). Reload: each holds. Search must follow WITHOUT a reload: the type chips, the count (movies + shows = 1,663 with Games off), and Filters → "Available on" offering only the picked platform. ⚠️ "Your platforms" lists what your OWN library is on, so add a title first; with an empty library it says so and offers nothing.
27. Settings → Download. Do not let a file land: before pressing, replace `HTMLAnchorElement.prototype.click` for anchors with a `download` attribute and wrap `URL.createObjectURL` to keep the blob, then read `await blob.text()`. Expect `itemState`, `hidden`, `identities`, `episodes`, `user` with this account's rows only, and the readme lines.
28. Settings → Disconnect on the only sign-in: a dialog, then "… is the only way you sign in to this account, so it cannot be disconnected", and `user_identities` unchanged.
29. `/dev/scoring` → Taxonomy → Review. Locally there are 38 cards, not 7: the 34 old denials exist on the live database only. Accept a tag batch (`tag_category_override`), Deny a merge (`taxonomy_suggestion_dismissed`), Bundle a merge (`ip_alias`); the four counters drop by one each time. **Then reload at once**: the counters must read the same (SM71: accepted cards came back for five minutes, because the page read a cached taxonomy). Never pressed: Add on a missing member, and everything on the other three tabs.
30. Rate a title that is on the wishlist: one `library` row with the rating, no `wishlist` row. Reload: "You rated it N". "Remove your rating": the row stays as `watched` with no rating, by design.
31. Hide a title that is on Search's first row: `user_hidden_items` has it, the page says "Hidden, unhide", Search's default list no longer has its card and `titles · N` is one lower, and typing its name finds it (SM72).
32. Two accounts on one device: sign out, "Second test account", check Profile is 0 / 0 / 0, the first account's rated title reads "Not rated" and its hidden title offers "Hide"; add something; sign out and back in as the first: its rows are back and the second's are not there.
33. Delete, last: the dialog counts your library and wishlist, wants `DELETE` typed (lowercase leaves the button disabled; set the field with the native value setter and an `input` event). After: the account is in none of `users`, `user_identities`, `user_item_state`, `user_episode_state`, `user_hidden_items`, the other account is untouched, and "Test account" again starts at 0 with the United Kingdom and all three types. A toast says the account was deleted; poll for it, it is gone in three seconds.
34. Small ones the 14th run found, each one line to re-check: Settings with nothing picked says "the filter offers every service" and names no number (SM73); a show's page says "Episodes are tracked through Trakt, and this account is not connected to it." and has no `Mark …` label at all (SM74); the type toggles in Settings and the bookmark on a card carry `aria-pressed`; a show's header runtime ends "/ep"; a season with no episodes reads "No episodes yet"; a row under "Recently added" on Profile leads to `/{type}/{slug}`.

⚠️ **Since about 2026-10-14 the first test account also carries a `trakt` identity** (`dev:smoketest-trakt`, no tokens). That changes what its Sync button does (SM77) and Settings shows "Sign in to Trakt" for it. Never press that.

What the test accounts cannot reach: **an episode tick** (it goes to Trakt first, so the tracker shows them the list without boxes), the Trakt half of a rating or a wishlist change, Up next, and disconnecting one of two sign-ins.

How this section is driven, since screenshots usually time out: the session survives a restart of both servers (it is in `localStorage`), so "Test account" may not be on screen; define the `V()` / `T()` helpers again after every hard load; press things with `element.click()` found by `aria-label` (the stars are "Rate N out of 10", the episode boxes "Mark {title} watched"); and catch a toast by polling the body's text for a few seconds straight after the click, because it is gone in three.

⚠️ **`element.click()` does not press a Pressable inside a sheet** (Filters' "Show N titles", Reset all): the sheet stays open and reads as a bug. Send `pointerdown`, `mousedown`, `pointerup`, `mouseup` at the element's centre, then `click()`. The Country picker opens only to a real click (`computer` at the element's centre, scaled from `innerWidth` to the 800-wide frame).

**N-G. The native app on a test account** (15th run, 2026-10-16). "Mobile" means the native app, not Chrome on the phone. The installed app talks to the live Worker, where no test account exists, so build a second copy pointed at this machine and install it NEXT TO the real one:

1. Refresh the short-path copy as in docs/app.md ("Building the APK"): `robocopy mobile\src C:\fx\mobile\src /MIR`, the same for the site's `src`, and `mobile/app.json`.
2. In the COPY only, back up and edit three files: `android/app/build.gradle` `applicationId 'org.fandex.app.smoketest'` (keep `namespace`), `src/main/AndroidManifest.xml` add `android:usesCleartextTraffic="true"` to `<application>` (a release build refuses `http://localhost`), `res/values/strings.xml` `app_name` "Fandex Test".
3. Build with `EXPO_PUBLIC_API_URL=http://localhost:8787` and `:app:createBundleReleaseJsAndAssets --rerun assembleRelease -PreactNativeArchitectures=arm64-v8a` (2 min warm).
4. `adb reverse tcp:8787 tcp:8787`, then install. Play Protect asks "App zum Sicherheitsscan senden?": answer "Nicht senden". "Test account" is on the You tab.
5. **After**: `adb uninstall org.fandex.app.smoketest`, restore the three files, and DELETE `app/build/generated/assets/react/release`, `intermediates/assets/release/mergeReleaseAssets` and `outputs/apk/release`. The bundle task does not see the env var, so the next real build would otherwise ship the localhost bundle.

In Git Bash every adb path needs `MSYS_NO_PATHCONV=1`: without it `/sdcard/ui.xml` becomes `/Files/Git/sdcard/ui.xml`, the dump fails silently and you read the previous file. Drive the app with `uiautomator dump` + `input tap` by text or content-desc, and only when `dumpsys window` says the test package has focus. `fandex://…` with the test package opens any screen. `adb logcat -s ReactNativeJS:E AndroidRuntime:E` after a run.

Targeted checks from that run, each one line: Home → a card → **Android** Back must return to Home, never "Opening…" (SM76); rate on the web while the app is open, then the app's Sync must bring it into Library (SM77); `pokemon` must find the Pokémon games (SM78); Insights' two crowd columns must not share a title (SM79).

**N-H. Randomised runs** (asked for 2026-10-16). Shuffle the checklist from a printed seed so a run can be replayed, draw the search strings, ratings, viewports and pick indexes from the same generator, and add monkey runs: a seeded loop of ~45 steps that taps a random visible control (12% Back, some scrolls), skips anything destructive or external (delete, sign out, connect, Google, download, support, Accept/Deny/Bundle, legal, store links), and logs the screen and any error text. Persist the web log in `sessionStorage`, because a hard load ends the script. Match `NaN` case-sensitively or "Resonance" trips it. The monkey's writes are real: read the account back from D1 afterwards and check every screen agrees.
