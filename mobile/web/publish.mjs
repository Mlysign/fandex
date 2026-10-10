// Build the website and put it on fandex.org. The one command that publishes.
//
//   node mobile/web/publish.mjs                build, check, deploy
//   node mobile/web/publish.mjs --skip-build   check and deploy what the last build wrote
//   node mobile/web/publish.mjs --skip-export  passed on to build.mjs
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
  const built = spawnSync(process.execPath, [path.join(here, 'build.mjs'), ...args], { stdio: 'inherit' });
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
for (const must of ['index.html', 'app-shell.html', '404.html', 'robots.txt', 'sitemap.xml', '_headers', 'legal/de/imprint.html', 'legal/en/privacy.html']) {
  if (!fs.existsSync(path.join(OUT, must))) fail(`dist/site has no ${must}.`);
}

console.log(`\nPublishing ${build.itemPages} item pages, ${build.files} files, built ${build.builtAt}`);
const deployed = spawnSync('npx wrangler deploy --config ../mobile/web/wrangler.jsonc', { cwd: path.join(repo, 'worker'), stdio: 'inherit', shell: true });
if (deployed.status !== 0) fail('wrangler deploy failed. The site is whatever it was before.');
