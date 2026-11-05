# Putting the Fandex app on Google Play

**Decided 2026-10-23 (Nils): Play gets the native app, not the TWA.** The native app is what is
on his phone already: the catalog offline, the widget, Trakt and Steam synced on the device. The
TWA would have put a wrapper around the website in the store instead. The TWA plan, with the
steps it shares with this one written out click by click, is archived at
[archive/twa-play-store.md](archive/twa-play-store.md).

## Where it stands

| | State |
|---|---|
| Play developer account | Exists (InFlucx), $25 paid, identity verified. **Personal**, and the Play work is paused until it is a business account. |
| The business behind it | Einzelunternehmen in Düsseldorf: Gewerbe registered 2026-09-01 (NRW Wirtschafts-Service-Portal), tax registration (FsE EUn) sent through ELSTER the same day, Steuernummer and USt-IdNr issued by letter, W-IdNr ready in ELSTER since 2026-10-25. **No D-U-N-S number yet**, and it is the one thing the upgrade can't go without: none exists in D&B's UPIK directory, and the free request (dnb.com/de-de/kleinunternehmen/duns/duns-request.html) was filled 2026-11-05 under "Nils Mlynarek", since D&B stores a sole trader under the owner's name. The organization website is **nilsmlynarek.eu**, verified in Search Console (HTML file `google42413e863d201e6e.html` in its docroot; deleting it un-verifies) and in Play on 2026-11-05, so "Change account type" is unlocked. |
| Trader status | ⚠️ **Not declared. Deadline 2027-02-01**, the one hard date in this plan (below). |
| Play Console app entry | One exists, but for the TWA's package `org.fandex.twa`. **A package name can never change in Play**, so the native app (`org.fandex.app`) needs a new entry. The old one was never published and can stay a draft. |
| Upload key | **Nils makes it** (the command is below). Until then a Play build cannot run; every other release build signs with the debug key, as the sideloaded APKs always have. `android-package/signing.keystore` is the TWA's upload key, not this one. |
| The signing | ✅ Built 2026-10-23: `mobile/plugins/withPlayUploadSigning.js`, a config plugin, so it survives `expo prebuild`. A build run with `-PfandexPlay` signs with the upload key; without it, nothing changes. |
| Version | ✅ `version` and `android.versionCode` live in `mobile/app.json` since 2026-10-23 (`0.3.14`, `314`). |
| A build Play accepts | ✅ The `.aab` builds for all four architectures: 80 MB, 8 min 17 s cold, signed by a throwaway key on 2026-10-23 and then deleted. The real one waits for the key. Targets API 36 (React Native 0.86's default); re-check Play's minimum before the first upload. |
| Store listing, Data safety, content rating | Not started. |

## What changes compared with the TWA plan

- **Same as before:** the account upgrade, Play App Signing (Google holds the app signing key, the
  key you keep is only an upload key and can be reset), the listing (short and full description,
  512×512 icon, 1024×500 graphic, two screenshots, privacy policy
  `https://fandex.org/legal/en/privacy`), the content rating questionnaire, and the check after
  the upgrade on whether the 12-testers / 14-days rule applies (it is for PERSONAL accounts only).
  → memory [[twa-play-store-gates]]
- **Gone:** PWABuilder, the service worker, the TWA's `assetlinks.json` claim and its second
  fingerprint.
- **New:**
  - An upload key for `org.fandex.app`, and a release build that signs with it without the key
    or its passwords entering the repo (built, below).
  - `versionCode` and `version` in `mobile/app.json`, raised on every upload (set, below).
  - **The Data safety form describes the app, not the website**: the app stores your library on
    the device and in the Worker, signs in with Trakt, Google or Discord, reads Steam, and sends no
    pageview counter (the beacon is website-only). Check each answer against
    `src/lib/legal/content/en/privacy.ts`.
  - **Two things docs/app.md says to do before the store, both keyed to the Play app signing
    certificate**, which only exists once Play has the app: the Trakt redirect moved from
    `fandex://` to an `https://` App Link (an `assetlinks.json` on fandex.org naming
    `org.fandex.app`), and Google sign-in on Android (an Android OAuth client with that
    certificate's SHA-1).
  - Re-check Play's current target API level requirement against the Expo SDK the app is on
    before the first upload.

## Trader status

Google's email of 2026-11-04 (to both the Gmail and the InFlucx address): every developer
account must declare trader or non-trader under the EEA and UK rules **by 2027-02-01**. Missed,
the account can submit no updates and its profile and every app are removed from Play. Where:
Play Console, Manage account > Account details > About you > Trader status. A trader then
confirms the status on each app as well (App content > Needs attention), optionally with a link
to terms of service.

- **Non-trader is accurate today**: nothing is published and monetization is off.
- **Ads make it trader.** Google counts ad revenue as commercial, and ads-first is the plan
  (STATUS.md, "Monetization"). Switch before the first ad goes live; a false non-trader
  declaration breaches §11.4 of the Developer Distribution Agreement.
- **What goes public**: an individual trader must verify a phone number, and Play shows it and
  the address. The address is already public in the Impressum; the phone number would be new.
- ⚠️ Unverified: the email describes only an individual's declaration. Read what the business
  account asks for when upgrading, since the declaration belongs to that sitting.

## The order

1. Nils: upgrade the account to a business account and declare the trader status in the same
   sitting (below), then re-read the testing rule. **The upgrade converts the existing account**
   (checked 2026-11-05, support.google.com/googleplay/android-developer/answer/16260648): Manage
   account > Account details > About you. First the organization website (fandex.org) is verified
   through Search Console (automatic when the Search Console owner is the Play Console owner's
   Google account), then "Change account type" appears. It asks for a new organization payments
   profile with the **D-U-N-S number** (free from Dun & Bradstreet, dnb.com/de-de/kleinunternehmen/duns.html;
   paid "services" are not needed), organization type and size, an organization phone, and a
   contact plus a public developer email and phone, each confirmed by a one-time code. Google may
   ask for documents (the Gewerbe receipt). Wait 72 hours after the switch before submitting an
   app. One way only: it can't go back to personal. Steuernummer and USt-IdNr are not asked for.
2. ✅ Mine: the upload-key plugin and `versionCode` (2026-10-23). Nils: make the key and its
   settings (below). Then mine: build the real `.aab`.
3. Nils: create the `org.fandex.app` entry, fill App content (privacy policy, Data safety,
   content rating, target audience, ads: none), upload the `.aab` to a test track.
4. Mine, once Play shows the app signing certificate: `assetlinks.json` on fandex.org, the
   `https://` Trakt redirect, Google sign-in on Android.
5. Testers if the rule still applies, then production.

## The upload key

Made once, by Nils, in his own terminal: `keytool` asks for the password, so it never passes
through a session. The keystore goes next to the TWA's in `android-package/`, which is gitignored
and backed up by OneDrive. Keep the password in the password manager as well.

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v -storetype PKCS12 -keystore "C:\Users\n-mly\OneDrive\Documente\09_Projects\Personal\ReleaseCalendar\releaseradar2\android-package\fandex-app-upload.jks" -alias fandex-app-upload -keyalg RSA -keysize 2048 -validity 10000
```

Then four lines in `C:\Users\n-mly\.gradle\gradle.properties` (outside the repo; create the
file if it is not there). A PKCS12 keystore has one password, so both password lines carry it:

```properties
FANDEX_UPLOAD_STORE_FILE=C:/Users/n-mly/OneDrive/Documente/09_Projects/Personal/ReleaseCalendar/releaseradar2/android-package/fandex-app-upload.jks
FANDEX_UPLOAD_KEY_ALIAS=fandex-app-upload
FANDEX_UPLOAD_STORE_PASSWORD=<the password>
FANDEX_UPLOAD_KEY_PASSWORD=<the password>
```

⚠️ A session never reads that file or prints those properties. The same four names also work as
environment variables.

## Building the bundle

In the short-path copy (`C:\fx\mobile`, see docs/app.md "Building the APK"), after copying in
`mobile/app.json` and `mobile/plugins/` with the rest, regenerate the project and build:

```bash
npx expo prebuild --platform android --no-install
```

```bash
./gradlew.bat bundleRelease -PfandexPlay
```

The bundle lands in `android/app/build/outputs/bundle/release/app-release.aab`. Two guards stop a
wrong one: `-PfandexPlay` without the four settings fails naming the missing one, and with
`-PreactNativeArchitectures` narrowed to one architecture it fails too, since a store build
carries every phone. **Raise `version` and `android.versionCode` in `mobile/app.json` before every
upload** (`0.3.14` is `314`: minor times 100 plus patch); Play refuses a number it has seen.

⚠️ `expo prebuild` CLEARS `android/` and writes it again, build caches included, so the next
build is a cold one. The debug key it writes is the same one as before (SHA-256 `FA:C6:17:45…`),
which is why sideloaded updates keep installing over the old app.

⚠️ The app Play installs is signed with Google's app signing key, not the debug key, so the phone
has to uninstall the sideloaded app once before installing from Play. Its rows come back from the
Worker on sign-in; anything only on the device (the widget's placement) does not.
