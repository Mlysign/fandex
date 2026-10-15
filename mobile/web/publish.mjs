// Build the website and put it on fandex.org. The one command that publishes.
//
//   node mobile/web/publish.mjs                build, check, deploy
//   node mobile/web/publish.mjs --skip-build   check and deploy what the last build wrote
//   node mobile/web/publish.mjs --skip-export  passed on to build.mjs
//   node mobile/web/publish.mjs --check        build and check, and stop before deploying
//
// A deploy replaces every file on the site with what is in dist/site. So this
// never deploys a folder it has not checked: the build has to finish, and the
// folder has to hold exactly the files that build counted. A build that died
// half way, or a folder something else emptied, stops here.
//
// Wrangler is the Worker package's (worker/node_modules), logged in through
// the browser. No Cloudflare token is read or written here.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const DIST = path.join(here, 'dist');
const OUT = path.join(DIST, 'site');
const args = process.argv.slice(2);

function fail(message) {
  console.error(`\nNot published: ${message}`);
  process.exit(1);
}

if (!args.includes('--skip-build')) {
  const built = spawnSync(process.execPath, [path.join(here, 'build.mjs'), ...args.filter((a) => a !== '--check')], { stdio: 'inherit' });
  if (built.status !== 0) fail('the build failed.');
}

let build;
try {
  build = JSON.parse(fs.readFileSync(path.join(DIST, 'build.json'), 'utf8'));
} catch {
  fail('there is no finished build (dist/build.json is missing).');
}
if (build.limited) fail('the last build was a --limit try-out, not the whole site.');
const ageHours = (Date.now() - Date.parse(build.builtAt)) / 3_600_000;
if (!(ageHours < 24)) fail(`the last build is ${Math.round(ageHours)} hours old. Build again.`);

function count(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);
}
const files = fs.existsSync(OUT) ? count(OUT) : 0;
if (files !== build.files) fail(`dist/site holds ${files} files and the build wrote ${build.files}.`);
for (const must of ['index.html', 'app-shell.html', '404.html', 'robots.txt', 'sitemap.xml', '_headers', '_redirects', 'legal/de/imprint.html', 'legal/en/privacy.html']) {
  if (!fs.existsSync(path.join(OUT, must))) fail(`dist/site has no ${must}.`);
}

// A Google button in the bundle is only published where it works. It needs two
// things outside this folder, and both fail in ways nobody would see from here:
// Google has to accept the address it sends people back to (a setting on the
// OAuth client, in Google's console), and the API has to be the one that
// checks the nonce (worker/src/auth/verify.ts). Without the first the button
// leads to Google's error page. Without the second it works and is less safe.
const SITE = 'https://fandex.org';
function bundles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? bundles(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
}
const googleClient = bundles(path.join(OUT, '_expo'))
  .map((f) => /\b\d+-[a-z0-9]+\.apps\.googleusercontent\.com\b/.exec(fs.readFileSync(f, 'utf8'))?.[0])
  .find(Boolean);
if (googleClient) {
  const ask = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  ask.search = new URLSearchParams({
    client_id: googleClient, redirect_uri: `${SITE}/auth/google`, response_type: 'id_token', scope: 'openid profile', state: 'publish-check', nonce: 'publish-check',
  }).toString();
  let where = '';
  try {
    where = (await fetch(ask, { redirect: 'manual' })).headers.get('location') ?? '';
  } catch (e) {
    fail(`this build has a Google button and Google could not be asked whether it works (${e instanceof Error ? e.message : e}).`);
  }
  // Checked 2026-10-11: an address the client lists is sent on to the sign-in page, one it does not is sent here.
  if (where.includes('/signin/oauth/error')) {
    fail(`this build has a Google button, and Google does not accept ${SITE}/auth/google for its client. Add that address to the OAuth client's redirect URIs in the Google Cloud console, or build without EXPO_PUBLIC_GOOGLE_CLIENT_ID in mobile/.env.`);
  }
  if (!where.includes('accounts.google.com')) console.warn(`  Google answered the sign-in check in a way this script does not know (${where.slice(0, 80) || 'no redirect'}). Try the button after publishing.`);

  const api = await fetch(`${SITE}/v1/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: 'publish-check' }) })
    .then((r) => r.status, () => 0);
  if (api !== 400) {
    fail(`this build has a Google button, and the API on ${SITE} does not ask for a nonce yet (it answered ${api || 'nothing'} where 400 was expected). Deploy the Worker first: npx wrangler deploy, in worker/.`);
  }
  console.log('  Google sign-in: the return address is accepted and the API checks the nonce');
}

if (args.includes('--check')) {
  console.log(`\nChecked and not published: ${build.itemPages} item pages, ${build.files} files, built ${build.builtAt}`);
  process.exit(0);
}

console.log(`\nPublishing ${build.itemPages} item pages, ${build.files} files, built ${build.builtAt}`);
const deployed = spawnSync('npx wrangler deploy --config ../mobile/web/wrangler.jsonc', { cwd: path.join(repo, 'worker'), stdio: 'inherit', shell: true });
if (deployed.status !== 0) fail('wrangler deploy failed. The site is whatever it was before.');
