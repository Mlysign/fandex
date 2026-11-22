import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The website's launch pages (/app, /press, /whats-new, /delete-account) are
// read by strangers, so the house style is checked here and not hoped for. It
// lives in the site's suite because it reads files, and only this package has
// Node's types (the same reason as appSiteImports.test.ts).

const MOBILE = path.resolve(__dirname, '../../mobile/src');
const FILES = ['lib/launch.ts', 'lib/whatsNew.ts', 'components/LaunchPages.tsx'];
const BANNED = ['delve', 'leverage', 'robust', 'seamless', 'elevate', 'powerful', 'ultimate', 'revolutionary', 'best', '#1'];

describe('the launch pages copy', () => {
  for (const file of FILES) {
    const text = readFileSync(path.join(MOBILE, file), 'utf8');

    it(`${file} has no em-dash or en-dash`, () => {
      expect(text).not.toMatch(/[–—]/);
    });

    it(`${file} has none of the banned words`, () => {
      for (const word of BANNED) {
        expect(text.toLowerCase()).not.toMatch(new RegExp(`(^|[^a-z])${word.replace('#', '\\#')}([^a-z]|$)`));
      }
    });

    it(`${file} has no exclamation mark in a string`, () => {
      // A `!` followed by a quote is the end of a sentence in a string; `!==` and `!x` are code.
      expect(text).not.toMatch(/![\s]*['"`]/);
    });
  }
});
