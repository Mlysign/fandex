// The checks build.mjs and nightly.mjs make, kept out of those two so a test
// can run them (mobile/src/lib/webBuildChecks.test.ts). Both scripts do their
// work at the top level, so nothing in them can be imported on its own.
//
// Plain Node, no imports but node:crypto: build.mjs runs it before anything is
// installed beyond the Worker's esbuild.

import crypto from 'node:crypto';

// ── The Content-Security-Policy ──────────────────────────────────────────────

/** The CSP source that allows one inline script: the hash of its exact text. */
export function scriptHash(text) {
  return `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/**
 * The text of every inline script in an HTML document that a browser would
 * run. A data block (`type="application/ld+json"`) is not run, and a CSP does
 * not apply to it.
 */
export function inlineScripts(html) {
  const out = [];
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? '';
    if (/\ssrc\s*=/i.test(attrs)) continue;
    const type = /\stype\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]?.trim().toLowerCase();
    if (type && type !== 'text/javascript' && type !== 'module') continue;
    out.push(m[2]);
  }
  return out;
}

/**
 * The whole policy, ENFORCED since 2026-10-24: report-only from 2026-10-23,
 * then a signed-in session showed nothing it would block (docs/website.md, "The
 * Content-Security-Policy"). Every source is here because something asks for it:
 *
 *   script-src   the bundle, app-boot.js and the SQLite worker are files on the
 *                site. The inline scripts the build writes are allowed by
 *                their hash, so a changed script is a violation, not a hole.
 *                'wasm-unsafe-eval': expo-sqlite compiles wa-sqlite.wasm.
 *   style-src    react-native-web writes its styles into <style> elements and
 *                style attributes at run time, and every static page carries
 *                its CSS inline.
 *   img-src      posters and portraits come from many CDNs (TMDB, IGDB, Open
 *                Library, BGG, YouTube stills), and the bundle has data: icons.
 *   connect-src  /v1 and /catalog on the site, plus what the app asks for from
 *                the browser itself: TMDB (lib/tmdb.ts, facetProviders.ts),
 *                Open Library authors (facetProviders.ts), Trakt (lib/trakt.ts).
 *                Google and Discord sign-in are page navigations, not fetches.
 *   frame-src    the trailer (components/Trailer.web.tsx).
 *   worker-src   the SQLite worker is a file; a compression library in the
 *                bundle starts its own from a blob: URL.
 *   frame-ancestors  no site may frame this one (X-Frame-Options says so too).
 */
export function contentSecurityPolicy(hashes) {
  return [
    "default-src 'self'",
    "frame-ancestors 'none'",
    `script-src 'self' 'wasm-unsafe-eval' ${[...new Set(hashes)].sort().join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.themoviedb.org https://openlibrary.org https://api.trakt.tv",
    'frame-src https://www.youtube.com https://www.youtube-nocookie.com',
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

// ── Is this build as whole as the last one? ──────────────────────────────────

/**
 * The counts a full build is held to: the last full build's. A `--limit`
 * try-out writes its own build.json and carries the last full build's counts
 * on in `baseline`, so a try-out between two nights does not wipe them.
 */
export function baselineOf(previous) {
  if (!previous || typeof previous !== 'object') return null;
  if (!previous.limited) {
    const counts = { ...previous };
    delete counts.baseline;
    return counts;
  }
  return previous.baseline ?? null;
}

const COUNTED = { facetPages: 'facet pages', withRails: 'item pages with related rails' };

/**
 * What is short in this build, as sentences; empty when nothing is.
 *
 * `now` is `{ facetPages, withRails, facetKinds: { tag, person, ... } }`.
 * Held to `floor` of the last full build for the two totals, and a kind of
 * facet page that had pages then must have some now. ⚠️ A delta that returned
 * titles and produced no facet page at all is always refused, baseline or not:
 * it means the facets did not arrive, never that the catalog has none.
 */
export function shrinkProblems(baseline, now, floor = 0.9) {
  const out = [];
  if (!(now.facetPages > 0)) out.push('no facet pages at all, from a pool that has titles');
  if (!baseline) return out;
  for (const [key, label] of Object.entries(COUNTED)) {
    const before = baseline[key];
    if (typeof before === 'number' && before > 0 && !(now[key] >= before * floor)) {
      out.push(`${now[key] ?? 0} ${label}, down from ${before} in the last full build`);
    }
  }
  for (const [kind, before] of Object.entries(baseline.facetKinds ?? {})) {
    if (before > 0 && !(now.facetKinds?.[kind] > 0)) out.push(`no ${kind} pages, where the last full build had ${before}`);
  }
  return out;
}

// ── Which commit the nightly run publishes ───────────────────────────────────

/**
 * The commit to build: the newest on main whose CI passed.
 *
 * `mainShas` is main's first-parent history, newest first. `runs` is what
 * `gh run list --json headSha,conclusion,status` answered, or null when gh
 * could not be asked (not installed, not logged in, no network).
 *
 * Returns `{ sha, warning? }`, or `{ sha: null, error }` when gh answered and
 * none of those commits has a green run: publishing then would be publishing
 * something nothing checked.
 */
export function pickCommit(mainShas, runs) {
  const head = mainShas[0];
  if (!head) return { sha: null, error: 'main has no commits to build' };
  if (!Array.isArray(runs)) {
    return { sha: head, warning: `the CI result for ${head.slice(0, 7)} could not be read from GitHub, so it is built unchecked` };
  }
  const green = new Set(runs.filter((r) => r?.conclusion === 'success').map((r) => r.headSha));
  if (green.has(head)) return { sha: head };
  const own = runs.filter((r) => r?.headSha === head);
  const state = !own.length ? 'has no CI run yet'
    : own.some((r) => r.status !== 'completed') ? 'is still in CI'
      : `failed CI (${own.map((r) => r.conclusion || 'no result').join(', ')})`;
  const older = mainShas.find((s) => green.has(s));
  if (!older) return { sha: null, error: `main's newest commit ${head.slice(0, 7)} ${state}, and no recent commit on main passed CI` };
  return { sha: older, warning: `main's newest commit ${head.slice(0, 7)} ${state}; building ${older.slice(0, 7)}, the newest that passed` };
}

/**
 * Run `attempt` until it returns true, at most `tries` times, calling
 * `sleep(waitMs)` between tries and `onRetry(n)` before each new one.
 * True when one try succeeded.
 *
 * For the nightly run's `git fetch`: the task starts as soon as the PC is on
 * when it was off at 06:30, and on 2026-10-29 that was before DNS answered
 * ("Could not resolve host: github.com"), so the night published nothing.
 *
 * @param {() => boolean} attempt
 * @param {{ tries?: number, waitMs?: number, sleep: (ms: number) => unknown, onRetry?: (n: number) => unknown }} options
 * @returns {boolean}
 */
export function retrying(attempt, { tries = 5, waitMs = 60_000, sleep, onRetry = () => {} }) {
  for (let n = 1; n <= tries; n++) {
    if (attempt()) return true;
    if (n < tries) {
      onRetry(n);
      sleep(waitMs);
    }
  }
  return false;
}
