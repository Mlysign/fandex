# The list import: Letterboxd first, IMDb alongside

**Status: BUILT 2026-08-23** (`1ea3619` engine + migration 20, `f875b70` the page). Verified end to end against the running app and the real database, not just by tests. ⚠️ **The one thing still owed: confirm the CSV column headers against a REAL export** (§6). The parser is header-driven and fails loudly rather than silently, so a rename is survivable, but the names themselves are still unverified. This is PL4's design doc. `TASKS.md` carries the one-line pointer; everything below is the detail, and every factual claim here was verified against Letterboxd's own pages, their app association files, a real Pixel 8, or the live database. **Nothing here is quoted from documentation alone**, because the last three platform surprises in this repo all came from trusting a doc over a measurement.

Visual version of the flow: `https://claude.ai/code/artifact/d641d234-4f2d-41e0-8a4f-54b7188c7d79`

---

## 1. Why Letterboxd, and why the file

**Nils's goal (2026-08-23):** Letterboxd is the userbase most worth reaching, and the import is the entire switching cost. That framing is what promoted this above the IMDb-only plan written earlier the same day.

**Two corrections got it here.** `PLATFORMS.md` recorded the Letterboxd export as "Pro, $35/yr", which demoted it to a follow-on. That was wrong: their [Pro page](https://letterboxd.com/about/pro/) lists nine Pro and five Patron benefits and **export is not among them**, and the help centre describes an account export that bundles everything into a ZIP of CSVs with no gate. And the API is not merely keyless: [letterboxd.com/api-beta](https://letterboxd.com/api-beta/) is request-only and excludes *"data-analysis, visualization or recommendation projects"* and anything *"that recreates current or planned features of our paid subscription tiers"*. **Fandex is both.**

### ⛔ The username import is closed, and it is not a gray area

A "type your username and press import" flow means reading public profile pages server-side. Letterboxd's [Terms of Use](https://letterboxd.com/legal/terms-of-use/) (December 2025) forbid it three separate ways:

- *"you must not employ any robot, spider, scraper, deep-link, or other automated data gathering or extraction tool, program, or algorithm to access, acquire, copy, or monitor any portion of the Service."*
- *"You agree to access the Service through the interface we provide."* (word for word the clause that parked Backloggd)
- *"You must not export any content from the Service (except your own Posted Content) unless expressly permitted by us."*

Two more bite: no using the Service *"to build or operate a competing business"*, and no recreating paid-tier features *"either through our API **or another means**"*, which deliberately closes the scrape-instead-of-API route. ⚠️ **Their robots.txt does NOT block `/{user}/films/` or `/{user}/watchlist/`**, which is exactly why this looks feasible from outside. robots.txt is not the binding document.

**And a second objection that stands even if Letterboxd allowed it:** a username box has no proof of ownership, so anyone could type a stranger's handle and pull their ratings into a Fandex account. That is third-party personal data with no lawful basis and no consent step.

> **The file is not a worse version of the username box. It is the thing that makes this lawful.** Only the account owner can generate that archive, so **possessing the file IS the consent.** The step that feels like friction is the step doing the legal work.

---

## 2. Platform reality, measured on a real device

| Platform | Verdict | Why |
|---|---|---|
| **Desktop** | 🟢 Works | Already signed in, downloads land somewhere known, drag and drop is natural. **Design for this first.** |
| **iOS** | 🟢 Works | Their `apple-app-site-association` **explicitly excludes** `/settings/`, `/settings/*` and `/user/*`, so the link opens Safari and the app never intercepts. |
| **Android** | 🔴 Silent dead end | See below. The break is Letterboxd's, and the person hitting it will blame us. |

### ⚠️ The Android failure, precisely (tested on a Pixel 8, 2026-08-23)

1. The Letterboxd app declares an intent filter for `letterboxd.com` / `st.letterboxd.com` / `boxd.it` with **no path restriction at all** and `AutoVerify=true`. Verified via `adb shell dumpsys package com.letterboxd.letterboxd`.
2. It **beats Chrome in the resolver**: `match=0x308000` against Chrome's `0x208000`. So a plain link opens the app, not the browser.
3. Inside the app's in-app webview the export page renders as **raw unstyled HTML**, because `/user/exportdata/` is a **656-byte fragment**, not a standalone page.
4. Pressing **Export Data** there pushes a blank view titled "Loading" and **downloads nothing**: `/sdcard/Download` unchanged after 13 s, and a device-wide search found no archive written in the last 10 minutes.
5. Forcing Chrome renders the real, styled page at `/settings/data/`, **but Chrome had a separate signed-out session** while the app was signed in. So even the workaround costs a login.

**Consequences for the build:**
- **Link to `letterboxd.com/settings/data/`, NEVER `/user/exportdata/`.** The latter is the unstyled fragment.
- **Warn Android users before the tap, do not outsmart the problem.** An `intent://…;package=com.android.chrome;end` URI can force Chrome, but it hardcodes a browser package and breaks on Samsung Internet and Firefox. One accurate sentence beats a hack that fails for a third of devices.
- **This flow is desktop-first, and that is Letterboxd's constraint rather than our choice.** Do not paper over it.

---

## 3. The flow

Seven steps, three of which belong to the person.

1. **Offer it where the absence is felt.** Empty library, settings, and the signed-out page. Not buried in a connectors list.
2. **Say what will happen before it happens.** Three lines, visible before anything is clicked. On mobile this is the fork in §4.
3. **They press Export Data on Letterboxd.** Generated on the spot, no email and no waiting. Requires a signed-in *browser* session.
4. **Take the archive whole.** Accept the `.zip` exactly as downloaded; we open it and pull `ratings.csv` and `watchlist.csv`. Accept loose `.csv` files too, and several at once. **Nobody should need to know which of the five files matters.**
5. **Match in the open**, with the count moving. A progress number is what makes a slow thing feel fast.
6. **Show the misses before committing.** Name what did not match and let them import anyway.
7. **Land somewhere worth arriving at.** Not a success toast: drop them into what the new profile unlocked, which is the only argument for having come over.

### Matching

- **Local first**, on normalized title + year (±1). Measured 2026-08-23: **1,112 movies, 1,108 TMDB-linked, 100% carrying `norm_title` and `release_date`, and exactly ONE `norm_title`+year collision catalog-wide.** Title+year is effectively a unique key here.
- **Title+year is a GOOD key, not a fallback.** The export carries no TMDB or IMDb id, only title, year and a Letterboxd URI, and third-party converters solve that by fetching each film page to scrape the IMDb link. We do not need to: **Letterboxd "sources all film-related data from The Movie Database (TMDb)"**, so its strings are TMDB's, matched against a catalog that is 99.6% TMDB-linked.
- **Misses go to TMDB search.** ⚠️ **The "2,000 rows means 2,000 provider searches" warning does NOT bind here.** That came from RAWG's 20k/month cap. **TMDB has no monthly cap** (50 req/s, IP-based; the old 40-per-10s limit was dropped in 2019), so the tail costs minutes, not quota. Movies are the cheap medium to import. Budget the fallback **per import, not per row**, and still report what was skipped.
- **Ratings convert by doubling.** Letterboxd is 0.5 to 5.0 in half-steps, we are 0 to 10, so doubling is exact. **Never round.**
- **IMDb uses the same machinery with a different parser**, and gets the better path: its CSV carries `tconst`, a hard id. Store it as an **`imdb` pseudo-source row** in `media_links` (`source='imdb'`, `source_id='tt…'`), which fits the existing `UNIQUE(source, source_id)` and `idx_links_source`, so no new table and no new index.

### Write-path rules (inherited, not negotiable)

- **An importer is a WRITE PATH into `media_items`**: insert-only, never bypassing `matcher.ts`.
- ⚠️ **Imported titles are a real library, so they must NOT stamp `browsed = 1`.** That flag is what the boot prune deletes.
- **An import that gave up must say so.** Report "n matched locally, m looked up, k unmatched" and list the k. Silently dropping a tail is the same failure as the Android one, only ours.

---

## 4. Mobile: offer both paths, let the person choose

**Nils's call (2026-08-23): do not pick for them.** Some people will happily escape the app via "Open in browser"; forcing a handoff would be patronizing, and hiding the problem would be dishonest. So on mobile, show **two** clearly labelled options with the cost of each stated:

- **Continue here.** The export link, plus the accurate Android warning: *"This may open the Letterboxd app, where the download does not work. If it does, tap the three dots and choose Open in browser."*
- **Continue on a computer.** The handoff, for the people who would rather not fight it.

**Pair the handoff with a `share_target` on the manifest.** `src/app/manifest.ts` has none today. With one, a downloaded archive can be shared straight into Fandex from the system share sheet instead of hunted for in a file picker. Android and ChromeOS only (iOS Safari does not implement Web Share Target), it requires the PWA to be installed, and it needs `method: "POST"` with `enctype: "multipart/form-data"`. **It also carries into the TWA**, so it is worth doing alongside P15/P16 rather than twice.

---

## 5. Import before signup ✅ APPROVED (Nils, 2026-08-23)

Someone drops their archive while logged out, we parse it, show the matched films and a preview of the taste profile, and *then* ask them to create an account to keep it. **The data becomes the pitch**, which is far stronger than a signup wall. This is the highest-leverage part of the feature for the goal that started it.

It is also the part with the most ways to go wrong. Five constraints, four of them lifted from incidents this repo already had:

- ⚠️ **Nothing may touch the database until they sign up.** PR15's anon write gate exists precisely so an anonymous visitor cannot mint catalog rows. Match locally (read-only) and resolve misses **without persisting**; defer every write until the account exists. Pass the real `null` session through, never a placeholder id.
- ⚠️ **The staging store is a table written on a request path by anonymous strangers, which is the exact shape that filled `facet_page_cache` to 222 MB.** So it needs a **row or byte ceiling, not just a TTL**; the sweep must run **on an interval, unref'd, in bounded batches**, never boot-only, because prod runs for days; and it must **evict by write time**.
- ⚠️ **It holds personal data before an account exists**, so it needs a short TTL that is actually enforced, and it will **not** be covered by `deleteAccount()`, which finds tables by a literal `user_id` column. Pre-signup rows have no user. The TTL is the only thing protecting them, which is why the interval sweep above is a correctness requirement rather than housekeeping.
- **Cap the upload.** A file size limit and a row limit, both stated in the UI before the drop, and an `anonLimit` on the endpoint sized to what it actually spends (`withOptionalUser` in `src/lib/withUser.ts`).
- **On signup, promote the staged result in one transaction**, then delete the staging row. If promotion fails, the staged data must survive so the person can retry rather than losing a 1,400-film import to a transient error.

---

## 6. Before writing the parser

⚠️ **Confirm the exact filenames and column headers against a REAL export.** Everything this doc says about the CSV schema comes from secondary sources; Letterboxd does not publish it. One export takes two minutes and removes all of the guesswork. This is the same rule that `/api/dev/trakt-shape` exists to enforce: **a mocked test of an assumed shape proves nothing.**
