// The nightly website rebuild, on Nils's PC (2026-10-16). It replaced the
// GitHub workflow's timer (.github/workflows/site.yml), which needed a
// Cloudflare API token nobody had made: here Wrangler's own browser login does
// the deploy, so no token exists anywhere.
//
//   node mobile/web/nightly.mjs            fetch main, build, publish
//   node mobile/web/nightly.mjs --check    the same, stopping before the deploy
//
// Run by the Windows task "Fandex nightly site" (docs/website.md, "The nightly
// rebuild"), daily at 06:30 local time, or as soon as the PC is on after that.
//
// ⚠️ It never builds from the checkout it lives in. Other sessions work in that
// folder, so its tree can hold somebody's half-finished edits, and a publish
// from it would put them on fandex.org. It builds a worktree of origin/main of
// its own, outside OneDrive, and moves it to the newest main each night.

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const SITE = process.env.FANDEX_NIGHTLY_DIR ?? 'C:/fx/site';
const LOGS = process.env.FANDEX_NIGHTLY_LOGS ?? 'C:/fx/site-logs';
const KEEP_LOGS = 14;
const check = process.argv.includes('--check');

fs.mkdirSync(LOGS, { recursive: true });
const day = new Date().toISOString().slice(0, 10);
const logFile = path.join(LOGS, `${day}.log`);
const log = (line) => {
  const text = `${new Date().toISOString()} ${line}\n`;
  fs.appendFileSync(logFile, text);
  process.stdout.write(text);
};
const fail = (line) => {
  log(`NOT PUBLISHED: ${line}`);
  process.exit(1);
};

// One run at a time. A lock older than two hours is from a run that died.
const lock = path.join(LOGS, 'running.lock');
if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs < 2 * 3_600_000) {
  log('another run holds the lock, stopping');
  process.exit(0);
}
fs.writeFileSync(lock, String(process.pid));
process.on('exit', () => fs.rmSync(lock, { force: true }));

function run(cmd, args, cwd) {
  log(`$ ${cmd} ${args.join(' ')}  (in ${cwd})`);
  const out = spawnSync(cmd, args, { cwd, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  fs.appendFileSync(logFile, `${out.stdout ?? ''}${out.stderr ?? ''}`);
  return out.status === 0;
}
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

// 1. The worktree, on the newest origin/main.
if (!run('git', ['fetch', '--quiet', 'origin', 'main'], repo)) fail('git fetch failed.');
if (!fs.existsSync(path.join(SITE, '.git'))) {
  if (!run('git', ['worktree', 'add', '--detach', SITE, 'origin/main'], repo)) fail('could not create the worktree.');
} else if (!run('git', ['checkout', '--detach', '--force', 'origin/main'], SITE)) {
  fail('could not move the worktree to origin/main.');
}
log(`building ${git('rev-parse', '--short', 'origin/main')}: ${git('log', '-1', '--format=%s', 'origin/main')}`);

// 2. Packages, only when a lockfile changed. dist/ is gitignored and stays, so
//    the build's per-title cache carries over between nights.
const stampFile = path.join(LOGS, 'installed.json');
const stamps = fs.existsSync(stampFile) ? JSON.parse(fs.readFileSync(stampFile, 'utf8')) : {};
for (const dir of ['.', 'mobile', 'worker']) {
  const lockPath = path.join(SITE, dir, 'package-lock.json');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex');
  if (stamps[dir] === hash && fs.existsSync(path.join(SITE, dir, 'node_modules'))) continue;
  if (!run('npm', ['ci', '--no-audit', '--no-fund'], path.join(SITE, dir))) fail(`npm ci failed in ${dir}.`);
  stamps[dir] = hash;
  fs.writeFileSync(stampFile, JSON.stringify(stamps, null, 2));
}

// 3. The app's public keys (EXPO_PUBLIC_*, in the web bundle by construction)
//    come from this checkout's mobile/.env, which git does not hold.
const env = path.join(repo, 'mobile', '.env');
if (!fs.existsSync(env)) fail('mobile/.env is missing in the main checkout.');
fs.copyFileSync(env, path.join(SITE, 'mobile', '.env'));

// 4. Build and publish. publish.mjs refuses a short or half-built site itself.
const ok = run(`"${process.execPath}"`, [path.join('mobile', 'web', 'publish.mjs'), ...(check ? ['--check'] : [])], SITE);

// Old logs go; the newest KEEP_LOGS stay.
for (const old of fs.readdirSync(LOGS).filter((f) => /^\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort().slice(0, -KEEP_LOGS)) {
  fs.rmSync(path.join(LOGS, old), { force: true });
}
if (!ok) fail('publish.mjs stopped. The site is what it was before; the reason is above in this log.');
log(check ? 'checked, not deployed (--check)' : 'published');
