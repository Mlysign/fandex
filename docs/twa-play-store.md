# Putting Fandex in the Play Store (P15/P16)

**Written 2026-08-22, for Nils, in plain steps.** Everything Claude can build is already
built. What is left needs your identity, your money and your phone, which is why it has
sat open since June.

---

## What you are actually making

An Android app whose entire content **is fandex.org**, drawn by the user's own Chrome.
No second codebase. You deploy the website, the app changes. That is the whole thing.

The only reason it is not just a bookmark is that this kind of app can **hide the browser
address bar**, which is what makes it feel native. Hiding that bar is the one part that
needs proving you own the domain, and that proof is the file Claude already wrote
(`/.well-known/assetlinks.json` — it currently serves `[]`, meaning "no app claims this
site yet").

**Read this before anything else:** a broken deploy breaks the app too, instantly, for
everyone who installed it. There is no separate release to hold back.

---

## ✅ Steps 1-8 are DONE (2026-08-22)

The package is built, the app is installed on the Pixel 8, and **it runs with no address
bar** — so the whole Digital Asset Links chain is proven working end to end, on a real
device, before the Play upload.

- Package lives at **`android-package/`** in this repo, **gitignored** (`signing.keystore`
  is the upload key and `signing-key-info.txt` holds its passwords in plaintext). It is
  inside OneDrive, so it is backed up without ever reaching GitHub. Contents: `Fandex.aab`
  (the upload), `Fandex.apk` (sideload/testing), the keystore, the key info, and
  PWABuilder's own generated `assetlinks.json`.
- **Upload key SHA-256:**
  `F7:75:02:5D:E1:BA:DB:ED:3A:27:FA:31:BF:61:D3:DD:54:C8:5E:DC:6C:82:03:30:E7:62:D9:44:54:38:B3:5E`
- `TWA_PACKAGE_NAME=org.fandex.twa` and `TWA_CERT_FINGERPRINT=<the above>` are **set on
  Railway**, and `https://fandex.org/.well-known/assetlinks.json` serves the real claim.
- Sideload verified: `adb install`, launch, **no address bar**, already signed in (Custom
  Tabs shares Chrome's cookie jar, which is the payoff for that setting).

⚠️ **Android caches the asset-link verification result.** It ran once against the old `[]`
and kept the failure, so the bar stayed until a full uninstall/reinstall. If you ever
change the fingerprint, reinstall — do not just relaunch and conclude it is broken.

**What is left:** the App content forms, upload the `.aab` to a closed track, **append the
Play App Signing fingerprint** to `TWA_CERT_FINGERPRINT` (comma-separated — Google re-signs
the store build with a different cert, so the sideload fingerprint alone will NOT verify
the Play copy), then twelve testers for fourteen days.

## Where you already are (2026-08-22)

**You have a Play Console account, and it is 4 days into a 12-tester / 14-day closed test
for Bubblewrap, under the mobilegameportfolio project.** That changes the cost of this
task, in both directions.

**Cheaper than it looked.** The $25 is paid. Identity verification is done. You have run
this flow once, so none of it is unfamiliar. Most importantly you have already recruited
twelve testers, and recruiting is the only genuinely hard part.

**⚠️ But Fandex still needs its own 14 days.** The requirement is **per app, not per
account** — Google's help page says "your app" throughout, and you apply for production
access separately for each one. Bubblewrap clearing its test does not carry over. Fandex
gets its own closed track, its own opt-in link, its own twelve testers (the same twelve
people are fine, they just have to opt in again) and its own fourteen days.

**So the move is to start Fandex's clock now, in parallel with Bubblewrap's.** Nothing
stops two apps testing at once, the fourteen days run unattended, and the work to produce
an uploadable package is about an hour. Every day you wait is a day the clock is not
running.

⚠️ **Before the clock can start, the App content section has to be complete** — privacy
policy URL, Data safety, content rating questionnaire, target audience, ads declaration.
A closed-track release will not roll out until those are answered, so do them first, not
after. Step 9 has the values.

### A naming note, because it has already cost one round-trip

**"Bubblewrap" is two different things here.** It is your game, and it is also the name of
Google's command-line tool for building this kind of app. That collision is why the TWA
task read as belonging to another project when it came up on 2026-08-17. These
instructions use **PWABuilder** instead, which does the same job in a browser, so the word
does not need to appear again.

---

## Step by step

### 1. Register — ✅ already done

Account exists, $25 paid, identity verified. Skip.

### 2. Make the app package

Go to **pwabuilder.com**, paste `https://fandex.org`, let it scan, then choose to package
for **Android / Google Play**.

**Walked through together on 2026-08-22.** PWABuilder reads the manifest, so nearly
everything fills itself in correctly: package ID `org.fandex.twa` (it derives that from the
domain, and it happens to match what the assetlinks route expects), app + short name
`Fandex`, host `fandex.org`, start URL `/`, all seven colour fields `#100E0C`, both icon
URLs, manifest URL, version `1.0.0.0` / version code `1`.

Under **All Settings**, four things are worth a decision and three of those were wrong or
worth changing out of the box:

| Setting | Default | Use | Why |
|---|---|---|---|
| **Fallback behavior** | Custom Tabs | **Custom Tabs** — do not switch | This is what runs when a device's browser can't do a TWA. Web View is an embedded browser with its own cookie jar, and **Google blocks OAuth sign-in inside WebViews**. Fandex's only way in is OAuth, so Web View would ship an app nobody can log into. |
| **Notification delegation** | ✅ on | **off** | It routes web notifications to the Android notification tray. Fandex has no push at all — no `PushManager`, no `showNotification`, nothing. Leaving it on declares a notification permission the app never uses, which is one more thing to justify on the Data safety form for zero benefit. Turn it back on the day push actually ships. |
| **Key country code** | `US` | **`DE`** | Goes into the signing cert. Cosmetic, and wrong. |
| **Key alias** | `my-key-alias` | **`fandex`** | Cosmetic. You will read it in `signing-key-info.txt` later and want it to say something. |

Everything else is already right: **Signing key: New** (you have no key for this app yet),
**Display mode: Standalone** (Fullscreen is for games — you want the clock and battery
visible), **Location delegation off** (region comes from `users.country`, not GPS),
**Google Play billing off** (turning it on commits you to Play's billing and its cut; a
decision for if premium ever sells *inside* the app), ChromeOS-only and Meta Quest off.
`Include source code` is off and can stay off unless you ever want to rebuild the Android
side without PWABuilder. Monochrome icon URL is empty, which is fine — it is only for
Android 13 themed icons and we don't ship one.

⚠️ **Version code must increase on every future upload.** Since the content is the
website, you will rarely upload again at all.

Download the zip. Inside you get an **`.aab`** (the thing you upload) and a
**`signing.keystore`** plus **`signing-key-info.txt`**.

### ⚠️ Ignore PWABuilder's "no service worker" warning

Its report card says Fandex has no service worker. **It does** — `public/sw.js`, served at
200, registered at runtime by `src/components/ServiceWorkerRegister.tsx`. PWABuilder scans
for a registration it can see statically and misses one that a client component makes on
mount. **Do not click "Generate Service Worker"** on that page; it would hand you a second,
conflicting one. A TWA does not require a service worker in any case.

The other three warnings (no screenshots, no orientation, no manifest `id`) are all
optional and none of them block packaging. Screenshots are worth adding one day because
they improve the Android install prompt, but they are not the store listing screenshots and
not on this critical path.

### 3. Back up the keystore

`signing.keystore` and the passwords in `signing-key-info.txt`. Put both in your password
manager and somewhere offline.

**Correcting an earlier version of this doc:** it said losing them means you can never
update the app again. That is the old pre-2021 rule and it is not your situation. Every
new app must enroll in **Play App Signing**, which means Google holds the *app signing*
key and what PWABuilder gave you is only the *upload* key. An upload key can be reset —
Play Console → Play Store protection → Manage Play app signing → request an upload key
reset. So losing it costs you a support round-trip and some days, not the app. Back it up
anyway, because those days are real.

### 4. Upload it

In the Play Console: **Create app** → name it Fandex, App, Free. Then go to
**Test and release → Testing → Closed testing** and upload the `.aab` there. Not
production. Production is not available to you yet (see the warning above).

### 5. Get the fingerprint — the RIGHT one

**Play Console → Test and release → Setup → App integrity → App signing key certificate →
SHA-256 certificate fingerprint.** Copy it.

⚠️ **This is the step everyone gets wrong.** Google re-signs your upload with its own key,
so the fingerprint in your downloaded zip is *not* the one users' phones will check. Use
the one Play Console shows you. If the address bar refuses to disappear later, this is
why, 90% of the time. Copy the **upload key certificate** SHA-256 from the same page too —
you can register both and then it does not matter which is which.

### 6. Tell the website about the app

Railway → the `releaseradar` service → **Variables** → add two:

```
TWA_PACKAGE_NAME=org.fandex.twa
TWA_CERT_FINGERPRINT=AA:BB:CC:...,DD:EE:FF:...
```

Colon-separated hex, exactly as Play Console prints it. Comma-separate the two
fingerprints from step 5. Railway redeploys on its own.

### 7. Check it worked

Open `https://fandex.org/.well-known/assetlinks.json` in a browser. It should no longer be
`[]` — it should show your package name and fingerprints. If it still shows `[]`, one of
the two variables is missing or misspelled.

### 8. Install it on your phone

Play Console gives the closed test an opt-in link. Open it on your phone, join, install.

**No address bar at the top = everything above worked.** If you see one, the assetlinks
file and the fingerprint disagree: go back to step 5.

### 9. The store listing (you will need these anyway)

- Short description (80 chars) and full description
- A 512×512 icon and a 1024×500 feature graphic
- At least two phone screenshots
- Privacy policy URL: `https://fandex.org/legal/en/privacy`
- The content rating questionnaire and the Data safety form. Answer the Data safety form
  honestly against the privacy policy — the app stores an account and library data, and
  the policy already says exactly what.

### 10. Twelve testers, fourteen days, then apply

Send the Fandex closed-test opt-in link to the same twelve people testing Bubblewrap. They
have to opt in again — it is a different app, so a different link and a separate count.
Wait fourteen days. Then **Dashboard → apply for production access**.

The fourteen days only start once Google has approved the build *and* twelve testers have
actually opted in, so the real finish date is "roughly two weeks after the last person
clicks the link", not two weeks after upload. Testers who install and then uninstall still
count.

---

## What is already done, so you don't redo it

- **P14** — the PWA manifest and service worker. This is why PWABuilder has anything to
  scan.
- **P15** — `src/app/.well-known/assetlinks.json/route.ts`. Env-driven, serves `[]` until
  you set the two variables, and already accepts a comma-separated list so both
  fingerprints fit.

## What Claude will not do, and why

Creating the signing key and the Play account. Both are credentials tied to your identity;
one of them is the thing that makes an update provably yours. That is not a tooling limit,
it is the right line.
