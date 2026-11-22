# Google Play Console: "App content" answers

_Draft for Nils, 2026-11-22. For `plan-data.js` item `ad-entry` (due 2027-01-10). One section per page of "App content" (Policy and programs → App content), in the order Play lists them. Each answer is what to click or type, then the proof. Answers are based on the code as of app version 0.3.63 (`mobile/app.json`). One planned change is marked **PLANNED**: leave it out until it ships, then update the form the same day._

_The questions are written from how the form looked when this was drafted. Play changes its wording now and then, so match by meaning if a label differs._

---

## 1. Privacy policy

**Privacy policy URL:**

```text
https://fandex.org/legal/en/privacy
```

Proof: `docs/website.md`, the `/legal/{en,de}/{privacy,terms,support,imprint}` row; text in `src/lib/legal/content/en/privacy.ts`.

Before submitting: the policy needs three updates (plan item `ad-privacy`). (1) It says "Fandex is a one-person hobby project, not a company", which no longer fits a trader account. (2) It doesn't mention the follows list (`user_facet_follows`), which the database stores and the export includes. (3) When the usage counters ship, the line "The Android app sends no counts" stops being true.

---

## 2. Ads

**Does your app contain ads?** No.

Proof: no ad SDK in `mobile/package.json`; the privacy policy says "no third-party analytics or advertising identifiers" (`privacy.ts`, "What Fandex does NOT store"); `AGENTS.md`, "Monetization is off".

---

## 3. App access

**Is all functionality available without special access?** No. Choose "All or some functionality is restricted".

What works without signing in: Home, Search, Calendar and every title page (`privacy.ts`, "What Fandex stores about you": "the calendar, search and every title page work signed out").

What needs a sign-in: rating, wishlist and library, Progress and episode ticks, Insights, the Fandex Score, the release reminders (they follow the wishlist), Settings' data download and account deletion.

**Instructions to type** (my recommendation: a Trakt account made only for Google's reviewers, because it is a plain username and password with no phone check):

```text
Name: Reviewer sign-in
Username: [the reviewer Trakt account's username]
Password: [its password]
Any other information:
Open the You tab and tap "Sign in with Trakt". Trakt's sign-in page opens. Enter the username and password above and approve Fandex. You return to the app signed in.
Without signing in you can use Home, Search, Calendar and every title page.
After signing in, rate a few titles from 1 to 10 to see the Fandex Score on other titles. Add a title with an upcoming date to the wishlist to get a release reminder at 09:00 on its release day.
```

Proof: sign-in providers Trakt, Google and Discord (`privacy.ts`, "Sign-in provider"); the You tab's sign-in card (`docs/app.md`, You row).

You make the Trakt account and type its password into Play Console yourself. Don't put it in the repo. The local "Test account" button cannot be used: it exists only with `DEV_LOGIN=1` on a developer's machine (`docs/worker.md`, "The test accounts").

---

## 4. Content rating (IARC questionnaire)

**Email address:** `hello@fandex.org` (plan item `ad-mail`).

**Category:** the one for apps that are not games and that show information about entertainment. In the current form that is most likely "Reference, News, or Educational". If an "Entertainment" or "Content aggregator" option is offered, pick that instead, since Fandex shows film and game material it doesn't make itself.

**Answers:**

| Question (by meaning) | Answer | Why |
|---|---|---|
| Violence, blood, gore in the app's content | Yes, mild or as depicted in third-party posters, descriptions and trailers | The catalog shows posters, descriptions and YouTube trailers of any film, show or game, which can depict violence (`docs/app.md`, Item page row) |
| Sexual content or nudity | Yes, suggestive themes in third-party descriptions and art; no explicit content | TMDB is always asked with `include_adult=false` (`mobile/src/lib/tmdb.ts`, lines 42, 164, 196). IGDB adult games: see "Could not determine" |
| Strong language | Yes, possible in titles and descriptions of third-party works | Same catalog |
| Controlled substances (drugs, alcohol, tobacco) | Yes, references in third-party descriptions and art | Same catalog |
| Gambling, simulated gambling | No | No such feature |
| Does the app let users interact or exchange content with each other? | No | No messages, comments, reviews or public profiles. A rating is private to the account (`docs/app.md`, no review field; `privacy.ts`) |
| Does the app share the user's current physical location with other users? | No | No location permission or code; the country is a setting (`mobile/src/lib/region.ts` reads the phone's language region, not GPS) |
| Does the app allow purchases of digital goods? | No | No payment feature (`privacy.ts`, "no payment feature today") |
| Unrestricted internet access (a web browser inside the app) | No | External links open the system browser; the only web view is the YouTube trailer on a title page (`docs/app.md`, Item page row) |
| Is this a web browser or search engine? | No | |

Expected result: a rating of about 12 / Teen. That's the cost of showing posters and trailers for mature films and games. Answering "No" to the content questions would be wrong, and a mismatch found later can pull the app.

---

## 5. Target audience and content

**Target age groups:** 18 and over.

Why: the catalog shows mature films and games, there is no age gate, and picking any group under 13 puts the app under the Families policy. The 13 to 17 groups are allowed without that, but the terms say nothing about age, so 18+ is the simplest true answer. If you want teenagers, 16 and over is the next choice: 16 is the age of digital consent in Germany.

**Could the app unintentionally appeal to children?** No. It's a tracker with no characters, games or child-themed design.

**Store presence / ads to children:** not applicable, no ads.

Proof: `src/lib/legal/content/en/terms.ts` has no age clause (grep for "age", "years", "child": none).

---

## 6. News app

**Is your app a news app?** No.

It shows release dates and catalog information, not news articles or journalism.

---

## 7. COVID-19 contact tracing and status apps

**No.** (Shown only for some accounts.)

---

## 8. Data safety

### 8.1 Overview questions

| Question | Answer | Proof |
|---|---|---|
| Does your app collect or share any of the required user data types? | Yes | The tables in 8.2 |
| Is all of the user data collected by your app encrypted in transit? | Yes | Every call is HTTPS: the API is `https://api.fandex.org` on Cloudflare (`AGENTS.md`); TMDB, Trakt, Google and Discord calls are HTTPS (`mobile/src/lib/tmdb.ts`, `trakt.ts`, `google.ts`, `discord.ts`) |
| Which account creation methods does your app support? | OAuth | Trakt, Google and Discord, no email or password (`privacy.ts`, "What Fandex stores about you") |
| Account deletion URL | `https://fandex.org/delete-account` | **Page being built** (plan item `ad-delurl`). In the app: Settings → Your data → Delete, type DELETE (`privacy.ts`, "Your rights"; `mobile/src/app/(tabs)/settings.tsx`) |
| Do you provide a way for users to request that some or all of their data is deleted, without deleting their account? | Yes | In the app a user can clear a rating (tap it again), take a title off the wishlist or out of the library, and untick episodes (`docs/app.md`, Item page and Wishlist rows). Anything else by mail to hello@fandex.org (`privacy.ts`) |
| Has your app successfully completed an independent security review (MASA)? | No | Optional. The planned audit (`pr-secaudit`) is not a MASA review |
| Is your app's data collection limited to users 18+ / Families? | Not applicable | Target audience is 18+, no Families |

### 8.2 Data types: what to tick

Every row: **Collected = yes, Shared = no** unless said otherwise. "Required" means a signed-in account always has it. Nothing is collected from a user who doesn't sign in, except the search terms in the last table.

**Personal info**

| Data type | Collected | Shared | Ephemeral | Required or optional | Purposes | Proof |
|---|---|---|---|---|---|---|
| Name | Yes | No | No | Required | App functionality, Account management | The provider's display name (`user_identities.display_name`, `worker/migrations/0001_init.sql`; `privacy.ts`, "Sign-in provider") |
| Email address | No | | | | | Never asked for (`privacy.ts`, "What Fandex does NOT store"; Google scope `openid profile`, Discord scope `identify`, `privacy.ts` header comment) |
| User IDs | Yes | No | No | Required | App functionality, Account management | Internal account id (`users.id`), each sign-in provider's account id (`user_identities.provider_user_id`), a connected Steam account id (same table) |
| Address, phone, race, religion, sexual orientation, political or religious beliefs, other info | No | | | | | Nothing in the user tables (`worker/migrations/0001_init.sql`, `0007`, `0006`) |

**App activity**

| Data type | Collected | Shared | Ephemeral | Required or optional | Purposes | Proof |
|---|---|---|---|---|---|---|
| Other actions | Yes | No | No | Required | App functionality, Analytics | Library, wishlist, ratings, status and source per title (`user_item_state`), watched episodes (`user_episode_state`), hidden titles (`user_hidden_items`), followed and avoided tags, people, studios and franchises (`user_facet_follows`, `0007`). Analytics covers two things: the day the account was last seen, once a day (`users.last_seen_at`; `privacy.ts`, "Usage statistics"), and the daily score-fit counts per medium, which name no title and no rating (`score_report`, `0006`; `privacy.ts`, "Usage statistics", last paragraph) |
| In-app search history | Yes | Yes, with TMDB | Yes | Optional | App functionality | A search term goes from the phone straight to TMDB (`mobile/src/lib/tmdb.ts` line 42) and from the phone to the Fandex API for games and books (`/v1/search/games`, `/v1/search/books`, `worker/src/index.ts`). Fandex stores no search terms (no table for them) |
| App interactions (page views and taps) | No today. **PLANNED: Yes** | No | No | **PLANNED: Optional** | **PLANNED: Analytics** | Today the Android app sends no counts (`mobile/src/lib/pageview.ts` header; `privacy.ts`, "Only pages opened in a web browser are counted"). **PLANNED:** anonymous usage counters, daily totals per kind of screen, no user id, a switch in Settings that is on by default. Optional because of the switch. Update the form and the privacy policy on the day it ships |
| Other user-generated content | No | | | | | The app has no review field (`docs/app.md`, Item page row). The `review` column in `user_item_state` exists from the old site and the app writes nothing to it. See "Could not determine" |
| Installed apps | No | | | | | |

**App info and performance**

| Data type | Collected | Why |
|---|---|---|
| Crash logs | No | No crash SDK (`mobile/package.json`). Crashes are read in Play's own Android vitals (plan item `pr-vitals`), which Google collects, not the app |
| Diagnostics, other performance data | No | Same |

**Everything else: not collected**

| Category | Why |
|---|---|
| Location (approximate and precise) | No location permission and no location code. The country is picked by the user and stored as a preference (`users.country`); its default comes from the phone's language region on the device (`mobile/src/lib/region.ts`) |
| Financial info | No payment feature (`privacy.ts`) |
| Health and fitness | None |
| Messages, contacts, calendar | None. Reminders are local notifications; the app doesn't read or write the phone's calendar (`docs/app.md`, Release reminders row) |
| Photos and videos | None uploaded. The avatar is a URL the sign-in provider gives, not a photo the user sends (`user_identities.avatar_url`). See "Could not determine" |
| Audio | None |
| Files and docs | A Letterboxd or IMDb export file is read on the phone and only the titles and ratings it holds are saved, as library rows (`docs/app-parity.md`, Import row: "read on the device"). The file itself is not sent |
| Web browsing history | None |
| Device or other IDs | None. No advertising id, no push token (local notifications only, `docs/app.md`, Release reminders: "no server, no push service"; no `getExpoPushTokenAsync` or `getDevicePushTokenAsync` in `mobile/src`) |

### 8.3 Why "Shared = no" for Trakt, Google, Discord, Steam and Cloudflare

- **Trakt:** the phone talks to the user's own Trakt account, because the user connected it. Play exempts a transfer the user starts and expects (`privacy.ts`, "Providers", Trakt; "Art. 49(1)(a)").
- **Google, Discord:** sign-in only. Fandex sends Google nothing; Discord gets one request to check the token, at the user's request (`privacy.ts`, Google and Discord bullets).
- **Steam:** only for an account the user connected; Fandex's server sends Steam the Steam id it already knows (`privacy.ts`, Steam bullet).
- **Cloudflare:** processes data on Fandex's behalf, which Play counts as a service provider, not sharing (`privacy.ts`, "The provider that processes data on Fandex's behalf").
- **Images and trailers** load from TMDB, IGDB, Steam, RAWG and YouTube with the phone's IP address and nothing from the account (`privacy.ts`, "Images", "Trailers"). Not a data type on the form.

### 8.4 Deletion and retention (for the "data deletion" notes)

```text
Users can delete their account in the app (Settings, Your data, Delete) or at https://fandex.org/delete-account. Deleting erases every table that holds data about the account in one step. Backups made before the deletion keep the old state for up to 30 days, then expire.
```

Proof: `privacy.ts`, "How long we keep it" (7 days of D1 Time Travel, nightly R2 copy kept 30 days; the 30 days is an R2 lifecycle rule, not code, per the file's header comment).

---

## 9. Government apps

**Is your app developed by or on behalf of a government?** No.

---

## 10. Financial features

**Does your app provide any financial features?** No. Choose "My app doesn't provide any financial features".

Proof: no payment, banking, loan or crypto code; `privacy.ts`, "no payment feature today".

---

## 11. Health apps

**Does your app have health features?** No. Choose "My app does not have any health features".

---

## 12. Advertising ID

**Does your app use an advertising ID?** No.

Proof: no ad or analytics SDK in `mobile/package.json`. Check before submitting: build the release bundle and look for `com.google.android.gms.permission.AD_ID` in the merged manifest. A library can add it without asking (see "Could not determine").

---

## Could not determine

1. **IGDB adult games.** TMDB adult titles are filtered out (`include_adult=false`). I found no filter on IGDB's erotic theme in `src/lib/sources/`. If adult games can show up, the content rating answers about sexual content get stronger. Search the catalog for one before filling the questionnaire.
2. **The IARC category name.** I wrote it from memory of the form. Pick by meaning.
3. **Search terms as "shared".** Sending a search term from the phone to TMDB may count as a user-started transfer, which would make it "not shared". I ticked "shared" because it is the safer over-statement. Your call.
4. **Name as "required".** Signing in is optional, but once signed in the display name is always stored. Play's help reads that as required. If Play says optional fits a feature the user can skip, change both Personal info rows.
5. **The avatar.** It is a URL to the provider's picture, not a photo the user uploads. I didn't tick "Photos". Tick it if you'd rather over-state.
6. **The `review` column.** The privacy policy lists "any written review" and the column exists, but no app code writes text to it that I found (`mobile/src/lib/traktSync.ts` carries `review` as a field; I didn't trace whether a Trakt pull fills it). If a pull does fill it, tick "Other user-generated content", collected, optional, App functionality.
7. **IP address.** Cloudflare keeps request logs with the IP and country for a few days (`privacy.ts`). Fandex never reads them. Play has no IP data type; I left it out. If you want to be safe, tick "Approximate location", collected, ephemeral, purpose "Fraud prevention, security, and compliance" (the rate limit).
8. **The AD_ID permission.** `expo-notifications` brings in Firebase on Android. I didn't check whether any dependency adds `AD_ID` to the merged manifest, because the release bundle isn't built yet (`pr-aab` is blocked).
9. **The country default.** `region.ts` reads the phone's language region. I didn't check whether that default is sent to the server before the user sets a country, or only once they do. Either way it is a preference, not location.
10. **Google sign-in on Android** is not yet tried on a phone and needs Play's signing certificate (`pr-links`). That's why the reviewer instructions use Trakt.
11. **The delete-account page** at `https://fandex.org/delete-account` doesn't exist yet (`ad-delurl`). Play checks that the link works.
12. **Terms are out of date.** `terms.ts` says "monetization today is donations and affiliate links", while `AGENTS.md` says no affiliate code is live. Not part of App content, but a reviewer may read it.
