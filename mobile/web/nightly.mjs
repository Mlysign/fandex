// The nightly website rebuild, on Nils's PC (2026-10-16). It replaced the
// GitHub workflow's timer (.github/workflows/site.yml), which needed a
// Cloudflare API token nobody had made: here Wrangler's own browser login does
// the deploy, so no token exists anywhere.
//
//   node mobile/web/nightly.mjs            fetch main, build, publish
//   node mobile/web/nightly.mjs --check    the same, stopping before the deploy
//   node mobile/web/nightly.mjs --accept-shrink   passed on to the build (build.mjs says when)
//
// Run by the Windows task "Fandex nightly site" (docs/website.md, "The nightly
// rebuild"), daily at 06:30 local time, or as soon as the PC is on after that.
//
// ⚠️ It never builds from the checkout it lives in. Other sessions work in that
// folder, so its tree can hold somebody's half-finished edits, and a publish
// from it would put them on fandex.org. It builds a worktree of origin/main of
// its own, outside OneDrive, and moves it each night to the newest commit on
// main whose CI passed.

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickCommit } from './buildChecks.mjs';

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
// The task's own result reads 0 whatever happens (the hidden console it runs
// in does not pass the exit code on), so a failure leaves a file that does.
const FAILED = path.join(LOGS, 'LAST-RUN-FAILED.txt');
const fail = (line) => {
  log(`NOT PUBLISHED: ${line}`);
  fs.writeFileSync(FAILED, `${new Date().toISOString()} ${line}\nThe whole run: ${logFile}\n`);
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

function run(cmd, args, cwd, env = process.env) {
  log(`$ ${cmd} ${args.join(' ')}  (in ${cwd})`);
  const out = spawnSync(cmd, args, { cwd, env, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  fs.appendFileSync(logFile, `${out.stdout ?? ''}${out.stderr ?? ''}`);
  return out.status === 0;
}
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

/**
 * What GitHub says about CI on main, or null when it cannot be asked: gh not
 * installed, not logged in where this task can see it, or no network. A null
 * is a warning in the log, never a failed night.
 */
function ciRuns() {
  const out = spawnSync('gh', ['run', 'list', '--workflow=ci.yml', '--branch', 'main', '--limit', '30', '--json', 'headSha,conclusion,status'], { cwd: repo, encoding: 'utf8' });
  if (out.error || out.status !== 0) {
    log(`gh run list did not answer (${out.error?.message || (out.stderr || '').trim().split('\n')[0] || `exit ${out.status}`})`);
    return null;
  }
  try { return JSON.parse(out.stdout); } catch { return null; }
}

// Anything below that throws (a git command, a file that is not there, a
// half-written installed.json) goes through fail() too, so it leaves
// LAST-RUN-FAILED.txt and a non-zero exit like any other failure. Without this
// a throw ended the run with a stack trace and no file to say so.
try {
  // 1. The worktree, on the newest commit on origin/main whose CI passed.
  //    A commit that failed CI, or is still in it, is not published; the night
  //    builds the newest one before it that passed (buildChecks.mjs, pickCommit).
  if (!run('git', ['fetch', '--quiet', 'origin', 'main'], repo)) fail('git fetch failed.');
  const mainShas = git('rev-list', '--first-parent', '-n', '30', 'origin/main').split('\n').filter(Boolean);
  const picked = pickCommit(mainShas, ciRuns());
  if (!picked.sha) fail(`${picked.error}. Nothing was built.`);
  if (picked.warning) log(`WARNING: ${picked.warning}`);
  const sha = picked.sha;
  if (!fs.existsSync(path.join(SITE, '.git'))) {
    if (!run('git', ['worktree', 'add', '--detach', SITE, sha], repo)) fail('could not create the worktree.');
  } else if (!run('git', ['checkout', '--detach', '--force', sha], SITE)) {
    fail(`could not move the worktree to ${sha.slice(0, 7)}.`);
  }
  // A file git does not track must not reach the bundle. Not -x: dist/ (the
  // per-title cache), node_modules and mobile/.env are ignored and stay.
  if (!run('git', ['clean', '-fd'], SITE)) fail('git clean failed in the worktree.');
  log(`building ${git('rev-parse', '--short', sha)}: ${git('log', '-1', '--format=%s', sha)}`);

  // 2. Packages, only when a lockfile changed. dist/ is gitignored and stays, so
  //    the build's per-title cache carries over between nights.
  const stampFile = path.join(LOGS, 'installed.json');
  let stamps = {};
  // A stamp file that does not parse only costs an `npm ci`.
  try { stamps = fs.existsSync(stampFile) ? JSON.parse(fs.readFileSync(stampFile, 'utf8')) : {}; } catch { log('installed.json did not parse; installing again'); }
  for (const dir of ['.', 'mobile', 'worker']) {
    const lockPath = path.join(SITE, dir, 'package-lock.json');
    if (!fs.existsSync(lockPath)) fail(`${dir}/package-lock.json is missing in the worktree.`);
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

  // 4. Where Wrangler's login is. ⚠️ A `wrangler login` run inside the Claude
  //    desktop app is not where it looks: that app is a packaged Windows app,
  //    and what it writes under AppData lands in its own folder
  //    (%LOCALAPPDATA%\Packages\Claude_…\LocalCache\Roaming). A task outside it
  //    sees the real AppData, finds no login, and Wrangler asks for an API token
  //    (the first scheduled run, 2026-10-16). So a login in the real AppData
  //    wins, and otherwise the packaged app's copy is used, through the variable
  //    Wrangler reads for its config folder. One copy, never two: a refresh
  //    replaces the refresh token, and a second copy would stop working.
  const wranglerToml = (dir) => path.join(dir, '.wrangler', 'config', 'default.toml');
  let configHome = process.env.XDG_CONFIG_HOME;
  if (!configHome && !fs.existsSync(wranglerToml(path.join(process.env.APPDATA ?? '', 'xdg.config')))) {
    const packages = path.join(process.env.LOCALAPPDATA ?? '', 'Packages');
    configHome = (fs.existsSync(packages) ? fs.readdirSync(packages) : [])
      .map((dir) => path.join(packages, dir, 'LocalCache', 'Roaming', 'xdg.config'))
      .find((dir) => fs.existsSync(wranglerToml(dir)));
    if (!configHome) fail('Wrangler is not logged in. Run `npx wrangler login` in worker/, in a normal terminal.');
  }
  log(`wrangler login from ${configHome ?? 'AppData (the usual place)'}`);
  const publishEnv = configHome ? { ...process.env, XDG_CONFIG_HOME: configHome } : process.env;

  // 5. Build and publish. publish.mjs refuses a short or half-built site itself.
  //    --accept-shrink is passed on, for a night after a drop that is known to be right.
  const passOn = ['--check', '--accept-shrink'].filter((a) => process.argv.includes(a));
  const ok = run(`"${process.execPath}"`, [path.join('mobile', 'web', 'publish.mjs'), ...passOn], SITE, publishEnv);

  // Old logs go; the newest KEEP_LOGS stay.
  for (const old of fs.readdirSync(LOGS).filter((f) => /^\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort().slice(0, -KEEP_LOGS)) {
    fs.rmSync(path.join(LOGS, old), { force: true });
  }
  if (!ok) fail('publish.mjs stopped. The site is what it was before; the reason is above in this log.');
  fs.rmSync(FAILED, { force: true });
  log(check ? 'checked, not deployed (--check)' : 'published');
} catch (e) {
  fail(`the run stopped on an error: ${e instanceof Error ? e.message : String(e)}`);
}
