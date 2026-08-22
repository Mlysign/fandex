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

## ⚠️ Read this before you spend the $25

**A brand-new personal Play developer account cannot publish anything until it has run a
closed test with at least 12 people, opted in continuously for 14 days.** This applies to
every personal account created after 13 November 2023, so it applies to you. The 14 days
only start counting once Google has approved the build *and* 12 testers have actually
opted in. Testers who install and then uninstall still count, but you need twelve real
Google accounts that are not yours.

There is one way around it: an **organization** account is exempt. That needs a registered
business and a D-U-N-S number. If you already have a Gewerbe, this is worth checking
before you register as an individual, because you cannot switch afterwards.

**So the honest cost is: $25, about two hours of clicking, and then a two-week wait during
which you have to find twelve people.** That last part is the real cost, and it is the
reason to decide "do it" or "park it" rather than leaving it open.

---

## Step by step

### 1. Register (one-off, $25)

Go to the Play Console and sign up. Google will ask for ID and an address and can take a
few days to verify. Nothing else can start until this clears.

### 2. Make the app package

Go to **pwabuilder.com**, paste `https://fandex.org`, let it scan, then choose to package
for **Android / Google Play**.

- Package ID: `org.fandex.twa`
- App name: `Fandex`
- Leave everything else at its default. The manifest at
  `https://fandex.org/manifest.webmanifest` already has the name, the colours and all
  three icons, so there is nothing to fill in by hand.

Download the zip. Inside you get an **`.aab`** (the thing you upload) and a
**`signing.keystore`** plus **`signing-key-info.txt`**.

### 3. ⚠️ Back up the keystore, now, before you do anything else

`signing.keystore` and the passwords in `signing-key-info.txt` are the only proof that a
future update is really from you. **Lose them and you can never update the app again** —
not "it's annoying", you have to publish a new app under a new name and everyone has to
reinstall. Put both in your password manager and somewhere offline.

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

Get twelve Google accounts opted in via the closed-test link. Wait fourteen days without
them dropping out. Then **Dashboard → apply for production access**.

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
