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

## The order

1. Nils: upgrade the account to a business account, then re-read the testing rule.
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
