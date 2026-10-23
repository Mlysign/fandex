import { describe, expect, it } from 'vitest';

// The plugin edits the app/build.gradle that `expo prebuild` writes. These are
// the template's own lines (Expo SDK 57); if a new SDK changes them, the plugin
// throws at prebuild rather than leaving a build signed with the wrong key.
// It is plain CommonJS for Expo's config loader, so it is named through a
// variable and typed by hand, as upNextCatalog.test.ts does with node:sqlite.
const PLUGIN = './withPlayUploadSigning.js';
const { applyPlayUploadSigning } = (await import(/* @vite-ignore */ PLUGIN)) as {
  applyPlayUploadSigning: (gradle: string) => string;
};

const TEMPLATE = `def jscFlavor = 'io.github.react-native-community:jsc-android:2026004.+'

android {
    namespace 'org.fandex.app'
    defaultConfig {
        applicationId 'org.fandex.app'
        versionCode 1
        versionName "0.1.0"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

describe('withPlayUploadSigning', () => {
  const out = applyPlayUploadSigning(TEMPLATE);

  it('signs release with the upload key only under -PfandexPlay, and debug stays on the debug key', () => {
    expect(out).toMatch(/release \{[\s\S]*signingConfig project\.hasProperty\('fandexPlay'\) \? signingConfigs\.upload : signingConfigs\.debug/);
    expect(out).toMatch(/debug \{\s*signingConfig signingConfigs\.debug\s*\}/);
    expect(out.match(/signingConfig signingConfigs\.debug\n/g)).toHaveLength(1);
  });

  it('declares the upload config inside signingConfigs, from settings outside the repo', () => {
    const signing = out.slice(out.indexOf('signingConfigs {'), out.indexOf('buildTypes {'));
    expect(signing).toContain("upload {");
    for (const name of ['FANDEX_UPLOAD_STORE_FILE', 'FANDEX_UPLOAD_STORE_PASSWORD', 'FANDEX_UPLOAD_KEY_ALIAS', 'FANDEX_UPLOAD_KEY_PASSWORD']) {
      expect(signing).toContain(`fandexUploadSetting('${name}')`);
    }
    expect(out.indexOf('def fandexUploadSetting')).toBeLessThan(out.indexOf('android {'));
  });

  it('is the same after a second prebuild', () => {
    expect(applyPlayUploadSigning(out)).toBe(out);
  });

  it('works on a file with CRLF line endings', () => {
    expect(applyPlayUploadSigning(TEMPLATE.replace(/\n/g, '\r\n'))).toContain("signingConfigs.upload");
  });

  it('refuses a template it does not recognise rather than leaving release unsigned', () => {
    expect(() => applyPlayUploadSigning(TEMPLATE.replace('    buildTypes {', '    lint {}\n    buildTypes {'))).toThrow(/signingConfigs/);
  });
});
